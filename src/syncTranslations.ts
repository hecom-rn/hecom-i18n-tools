// scripts/syncTranslations.ts
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import crypto from 'crypto';

interface TranslationRecord {
  key: string;
  zh: string;
  en?: string;
  ja?: string;
  ko?: string;
  file: string;
  line: number;
  hash: string;
  context?: string;
  status?: string;
  [lang: string]: string | number | undefined; // 支持string和number类型
}

interface SyncResult {
  matched: TranslationRecord[];
  updated: TranslationRecord[];
  missing: TranslationRecord[];
  newItems: TranslationRecord[];
}

class TranslationSyncer {
  private masterFile: string;
  private projectRoot: string;

  constructor(masterFile: string, projectRoot = process.cwd()) {
    this.masterFile = masterFile;
    this.projectRoot = projectRoot;
  }

  // 生成文本的内容哈希（用于精确匹配）
  private generateContentHash(text: string, file: string): string {
    if (!text || typeof text !== 'string') {
      console.warn('⚠️ 生成哈希时文本为空或非字符串:', text);
      return 'empty_' + Date.now();
    }
    
    if (!file || typeof file !== 'string') {
      console.warn('⚠️ 生成哈希时文件路径为空或非字符串:', file);
      file = 'unknown';
    }
    
    try {
      // 标准化文本内容（移除多余空白、统一换行符）
      const normalizedText = text.trim().replace(/\s+/g, ' ');
      const content = `${normalizedText}|${path.basename(file)}`;
      return crypto.createHash('md5').update(content, 'utf8').digest('hex').substring(0, 12);
    } catch (error: any) {
      console.error('❌ 生成内容哈希失败:', error.message);
      return 'error_' + Date.now();
    }
  }

  // 从Excel读取现有翻译数据
  private loadExistingTranslations(): TranslationRecord[] {
    if (!fs.existsSync(this.masterFile)) {
      return [];
    }

    const wb = xlsx.readFile(this.masterFile);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws) as any[];

    return data.map(row => ({
      key: row.key,
      zh: row.zh,
      en: row.en,
      ja: row.ja,
      ko: row.ko,
      file: row.file,
      line: row.line || 0,
      hash: row.hash || this.generateContentHash(row.zh, row.file),
      context: row.context,
      // 动态添加其他语言列
      ...Object.keys(row).reduce((acc, key) => {
        if (!['key', 'zh', 'en', 'ja', 'ko', 'file', 'line', 'hash', 'context'].includes(key)) {
          acc[key] = row[key];
        }
        return acc;
      }, {} as Record<string, string>)
    }));
  }

  // 扫描当前代码获取最新的文本位置
  private scanCurrentCode(srcPaths: string[]): TranslationRecord[] {
    const results: TranslationRecord[] = [];
    const self = this; // 保存this引用
    let processedFiles = 0;
    let totalFiles = 0;

    const scanFile = (filePath: string) => {
      try {
        const code = fs.readFileSync(filePath, 'utf8');
        
        // 跳过过大的文件（>1MB）
        if (code.length > 1024 * 1024) {
          console.warn(`⚠️ 跳过过大文件: ${filePath} (${(code.length / 1024 / 1024).toFixed(1)}MB)`);
          return;
        }
        
        const codeLines = code.split(/\r?\n/);
        const relPath = path.relative(this.projectRoot, filePath).replace(/\\/g, '/');

        const ast = babelParser.parse(code, {
          sourceType: 'unambiguous',
          plugins: [
            'jsx', 'typescript', 'decorators-legacy', 'classProperties',
            'dynamicImport', 'optionalChaining', 'nullishCoalescingOperator'
          ],
          ranges: true,
        });

        // 收集testID位置，用于忽略
        const testIdPositions = new Set<string>();
        traverse(ast, {
          JSXAttribute(path: NodePath<any>) {
            if (path.node.name && path.node.name.name === 'testID') {
              if (path.node.value && path.node.value.type === 'StringLiteral') {
                testIdPositions.add(`${path.node.value.start}-${path.node.value.end}`);
              } else if (path.node.value && path.node.value.type === 'JSXExpressionContainer') {
                const expr = path.node.value.expression;
                if (expr.type === 'StringLiteral') {
                  testIdPositions.add(`${expr.start}-${expr.end}`);
                }
              }
            }
          }
        });

        let textCount = 0;
        // 扫描中文文本
        traverse(ast, {
          StringLiteral(path: NodePath<any>) {
            if (path.node.loc && /[\u4e00-\u9fa5]/.test(path.node.value)) {
              const pos = `${path.node.start}-${path.node.end}`;
              if (testIdPositions.has(pos)) return; // 忽略testID

              const text = path.node.value.trim();
              if (!text) return; // 跳过空文本

              const line = path.node.loc.start.line;
              const hash = self.generateContentHash(text, relPath);
              const context = self.extractContext(path, codeLines, line);

              results.push({
                key: 'i18n_' + crypto.createHash('md5').update(text).digest('hex').substring(0, 12),
                zh: text,
                file: relPath,
                line,
                hash,
                context
              });
              textCount++;
            }
          },

          TemplateLiteral(path: NodePath<any>) {
            if (path.node.loc) {
              let fullValue = '';
              let hasChinese = false;

              for (let i = 0; i < path.node.quasis.length; i++) {
                const value = path.node.quasis[i].value.raw;
                fullValue += value;
                if (/[\u4e00-\u9fa5]/.test(value)) {
                  hasChinese = true;
                }
                if (i < path.node.expressions.length) {
                  const expr = path.node.expressions[i];
                  fullValue += `{{${expr.type}${i + 1}}}`;
                }
              }

              if (hasChinese && fullValue.trim()) {
                const line = path.node.loc.start.line;
                const hash = self.generateContentHash(fullValue, relPath);
                const context = self.extractContext(path, codeLines, line);

                results.push({
                  key: 'i18n_' + crypto.createHash('md5').update(fullValue).digest('hex').substring(0, 12),
                  zh: fullValue,
                  file: relPath,
                  line,
                  hash,
                  context
                });
                textCount++;
              }
            }
          },

          JSXText(path: NodePath<any>) {
            const value = path.node.value;
            if (/[\u4e00-\u9fa5]/.test(value) && value.trim()) {
              const line = path.node.loc?.start.line || 0;
              const trimmedValue = value.trim();
              const hash = self.generateContentHash(trimmedValue, relPath);
              const context = self.extractContext(path, codeLines, line);

              results.push({
                key: 'i18n_' + crypto.createHash('md5').update(trimmedValue).digest('hex').substring(0, 12),
                zh: trimmedValue,
                file: relPath,
                line,
                hash,
                context
              });
              textCount++;
            }
          }
        });

        processedFiles++;
        if (textCount > 0) {
          console.log(`📄 ${relPath}: ${textCount}条文本`);
        }

      } catch (e: any) {
        console.warn(`⚠️ 解析文件失败: ${filePath} - ${e.message}`);
      }
    };

    // 递归扫描源码目录
    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(file)) {
          walkDir(fullPath);
        } else if (stat.isFile() && /\.(js|jsx|ts|tsx)$/.test(file) && !/\.d\.ts$/.test(file)) {
          totalFiles++;
          scanFile(fullPath);
        }
      });
    };

    console.log('📂 开始扫描源码文件...');
    srcPaths.forEach(srcPath => {
      const fullPath = path.isAbsolute(srcPath) ? srcPath : path.join(this.projectRoot, srcPath);
      walkDir(fullPath);
    });

    console.log(`✅ 扫描完成: 处理${processedFiles}/${totalFiles}个文件，发现${results.length}条中文文本`);
    return results;
  }

  // 提取上下文信息
  private extractContext(path: NodePath<any>, codeLines: string[], line: number): string {
    // 获取函数名或组件名
    let context = '';
    let current = path.getFunctionParent();
    
    while (current && !context) {
      if (current.isClassDeclaration() || current.isFunctionDeclaration()) {
        context = (current.node as any).id?.name || '';
        break;
      }
      current = current.getFunctionParent();
    }

    // 如果没找到函数名，尝试找变量声明
    if (!context) {
      let statementParent = path.getStatementParent();
      if (statementParent && (statementParent as any).node && (statementParent as any).node.id) {
        context = (statementParent as any).node.id.name || '';
      }
    }

    // 添加周围代码作为上下文
    const contextLines = [];
    for (let i = Math.max(0, line - 2); i <= Math.min(codeLines.length - 1, line + 1); i++) {
      if (i !== line - 1) { // 跳过当前行
        contextLines.push(codeLines[i].trim());
      }
    }

    return context + (contextLines.length > 0 ? ` | ${contextLines.join(' ')}` : '');
  }

  // 同步翻译数据
  public syncTranslations(srcPaths: string[]): SyncResult {
    console.log('🔄 开始同步翻译数据...');

    // 输入验证
    if (!srcPaths || srcPaths.length === 0) {
      throw new Error('源代码路径不能为空');
    }

    // 验证源码路径是否存在
    const validPaths = srcPaths.filter(srcPath => {
      const fullPath = path.isAbsolute(srcPath) ? srcPath : path.join(this.projectRoot, srcPath);
      const exists = fs.existsSync(fullPath);
      if (!exists) {
        console.warn(`⚠️ 源码路径不存在: ${srcPath}`);
      }
      return exists;
    });

    if (validPaths.length === 0) {
      throw new Error('没有找到有效的源码路径');
    }

    console.log(`📂 扫描路径: ${validPaths.join(', ')}`);

    const existingTranslations = this.loadExistingTranslations();
    const currentCodeData = this.scanCurrentCode(validPaths);

    console.log(`📊 现有翻译: ${existingTranslations.length}条`);
    console.log(`📊 当前代码: ${currentCodeData.length}条`);

    // 创建哈希映射表用于快速匹配
    const existingByHash = new Map<string, TranslationRecord>();
    const existingByText = new Map<string, TranslationRecord>();

    existingTranslations.forEach(item => {
      if (item.hash) {
        existingByHash.set(item.hash, item);
      }
      existingByText.set(item.zh, item);
    });

    const result: SyncResult = {
      matched: [],
      updated: [],
      missing: [],
      newItems: []
    };

    // 处理当前代码中的文本
    currentCodeData.forEach(currentItem => {
      // 1. 优先通过内容哈希精确匹配
      let existingItem = existingByHash.get(currentItem.hash);
      
      // 2. 如果哈希匹配失败，尝试通过文本内容匹配
      if (!existingItem) {
        existingItem = existingByText.get(currentItem.zh);
      }

      if (existingItem) {
        // 找到匹配项，更新位置信息
        const updatedItem: TranslationRecord = {
          ...existingItem,
          file: currentItem.file,
          line: currentItem.line,
          hash: currentItem.hash,
          context: currentItem.context
        };

        if (existingItem.file !== currentItem.file || existingItem.line !== currentItem.line) {
          result.updated.push(updatedItem);
          console.log(`📍 更新位置: "${currentItem.zh}" ${existingItem.file}:${existingItem.line} -> ${currentItem.file}:${currentItem.line}`);
        } else {
          result.matched.push(updatedItem);
        }
      } else {
        // 新增的文本
        result.newItems.push(currentItem);
        console.log(`➕ 发现新文本: "${currentItem.zh}" at ${currentItem.file}:${currentItem.line}`);
      }
    });

    // 检查已删除的文本
    const currentHashes = new Set(currentCodeData.map(item => item.hash));
    const currentTexts = new Set(currentCodeData.map(item => item.zh));

    existingTranslations.forEach(existingItem => {
      if (!currentHashes.has(existingItem.hash) && !currentTexts.has(existingItem.zh)) {
        result.missing.push(existingItem);
        console.log(`⚠️  文本已删除: "${existingItem.zh}" from ${existingItem.file}:${existingItem.line}`);
      }
    });

    return result;
  }

  // 保存同步结果到Excel
  public saveSyncedTranslations(syncResult: SyncResult, outputFile?: string) {
    const output = outputFile || this.masterFile;
    
    try {
      // 合并所有数据
      const allData = [
        ...syncResult.matched,
        ...syncResult.updated,
        ...syncResult.newItems
      ];

      // 如果有缺失的项目，可以选择保留（标记为已删除）或完全移除
      const missingWithFlag = syncResult.missing.map(item => ({
        ...item,
        status: 'DELETED', // 标记为已删除
        file: `[DELETED] ${item.file}`,
        line: 0
      }));

      const finalData = [...allData, ...missingWithFlag];
      
      if (finalData.length === 0) {
        console.warn('⚠️ 没有数据需要保存');
        return;
      }

      // 生成Excel数据
      const wsData = finalData.map(item => ({
        key: item.key,
        zh: item.zh,
        en: item.en || '',
        ja: item.ja || '',
        ko: item.ko || '',
        // 动态添加其他语言列
        ...this.extractDynamicLanguages(item),
        file: item.file,
        line: item.line,
        hash: item.hash,
        context: item.context || '',
        status: item.status || 'ACTIVE'
      }));

      // 创建备份
      if (output === this.masterFile && fs.existsSync(this.masterFile)) {
        const backupPath = `${this.masterFile}.backup.${Date.now()}`;
        fs.copyFileSync(this.masterFile, backupPath);
        console.log(`📁 已创建备份: ${backupPath}`);
      }

      // 保存到Excel
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(wsData);
      xlsx.utils.book_append_sheet(wb, ws, 'translations');
      xlsx.writeFile(wb, output);

      console.log(`✅ 同步完成！保存到: ${output}`);
      console.log(`📊 统计: 匹配${syncResult.matched.length}条，更新${syncResult.updated.length}条，新增${syncResult.newItems.length}条，删除${syncResult.missing.length}条`);
    } catch (error: any) {
      console.error(`❌ 保存失败: ${output}`, error.message);
      throw new Error(`保存同步结果失败: ${error.message}`);
    }
  }

  // 提取动态语言字段
  private extractDynamicLanguages(item: TranslationRecord): Record<string, string> {
    const standardFields = ['key', 'zh', 'en', 'ja', 'ko', 'file', 'line', 'hash', 'context', 'status'];
    const result: Record<string, string> = {};
    
    Object.keys(item).forEach(key => {
      if (!standardFields.includes(key)) {
        const value = (item as any)[key];
        if (typeof value === 'string') {
          result[key] = value;
        }
      }
    });
    
    return result;
  }

  // 生成同步报告
  public generateSyncReport(syncResult: SyncResult): string {
    const report = `
# 翻译数据同步报告

## 📊 统计信息
- ✅ 精确匹配: ${syncResult.matched.length} 条
- 📍 位置更新: ${syncResult.updated.length} 条
- ➕ 新增文本: ${syncResult.newItems.length} 条
- ⚠️ 已删除: ${syncResult.missing.length} 条

## 📍 位置更新详情
${syncResult.updated.map(item => 
  `- "${item.zh}" -> ${item.file}:${item.line}`
).join('\n')}

## ➕ 新增文本详情
${syncResult.newItems.map(item => 
  `- "${item.zh}" at ${item.file}:${item.line}`
).join('\n')}

## ⚠️ 已删除文本详情
${syncResult.missing.map(item => 
  `- "${item.zh}" from ${item.file}:${item.line} (保留翻译数据)`
).join('\n')}

---
生成时间: ${new Date().toLocaleString()}
`;

    return report;
  }
}

// 命令行接口
export async function syncCommand(options: {
  excel: string;
  src: string | string[];
  output?: string;
  report?: string;
}) {
  try {
    // 参数验证
    if (!options.excel) {
      throw new Error('Excel文件路径不能为空 (--excel)');
    }

    if (!options.src) {
      throw new Error('源代码路径不能为空 (--src)');
    }

    // 处理src参数
    let srcPaths: string[];
    if (typeof options.src === 'string') {
      srcPaths = options.src.includes(',') 
        ? options.src.split(',').map(s => s.trim()).filter(Boolean)
        : [options.src];
    } else {
      srcPaths = options.src;
    }

    if (srcPaths.length === 0) {
      throw new Error('源代码路径不能为空');
    }

    // 验证Excel文件存在
    if (!fs.existsSync(options.excel)) {
      console.warn(`⚠️ Excel文件不存在: ${options.excel}，将创建新文件`);
    }

    console.log('🔄 同步参数:');
    console.log(`  Excel文件: ${options.excel}`);
    console.log(`  源码路径: ${srcPaths.join(', ')}`);
    console.log(`  输出文件: ${options.output || '覆盖原文件'}`);
    console.log(`  报告文件: ${options.report || 'sync-report.md'}`);
    console.log('');

    const syncer = new TranslationSyncer(options.excel);
    const syncResult = syncer.syncTranslations(srcPaths);
    
    // 保存同步后的数据
    syncer.saveSyncedTranslations(syncResult, options.output);
    
    // 生成报告
    if (options.report) {
      const report = syncer.generateSyncReport(syncResult);
      fs.writeFileSync(options.report, report, 'utf8');
      console.log(`📝 同步报告已保存到: ${options.report}`);
    }
    
    return syncResult;
  } catch (error: any) {
    console.error(`❌ 同步失败: ${error.message}`);
    process.exit(1);
  }
}

export default TranslationSyncer;
