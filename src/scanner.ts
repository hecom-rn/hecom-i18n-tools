import fs from 'fs';
import path from 'path';
import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import xlsx from 'xlsx';
import { generateGitlabUrl } from './gitlab';
import crypto from 'crypto';
import scanOptions from './scannerOptions'

interface ScanResult {
  key: string;
  value: string;
  file: string;
  line: number;
  gitlab: string;
}

interface ScanOptions {
  translate?: (text: string) => string | undefined;
  generateStableHash?: (str: string) => string;
  ignoreFiles?: string[];
}

// 默认哈希生成函数
function defaultGenerateStableHash(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 12);
}

function extractStringsFromFile(filePath: string, options: ScanOptions = scanOptions, gitlabPrefix?: string): ScanResult[] {
  const { generateStableHash = defaultGenerateStableHash } = options;
  const code = fs.readFileSync(filePath, 'utf8');
  const results: ScanResult[] = [];
  const projectRoot = process.cwd();
  let relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  // 检查文件是否包含 i18n-ignore-file 注释，如果包含则忽略整个文件
  if (code.includes('i18n-ignore-file')) {
    console.log(`[i18n-tools] 文件 ${filePath} 被 i18n-ignore-file 注释忽略`);
    return results;
  }

  // 预处理，找出所有注释区间，后续跳过注释内字符串
  const commentRanges: Array<{start:number,end:number}> = [];
  const commentRegex = /\/\*([\s\S]*?)\*\/|\/\/.*$/gm;
  let m;
  while ((m = commentRegex.exec(code))) {
    commentRanges.push({start: m.index, end: m.index + m[0].length});
  }

  // 查找 i18n-ignore 注释标记的行
  const ignoreLines: number[] = [];
  const ignoreRegex = /i18n-ignore/;
  let lineIndex = 0;
  let lineStart = 0;
  for (let i = 0; i <= code.length; i++) {
    if (i === code.length || code[i] === '\n') {
      const lineContent = code.substring(lineStart, i);
      if (ignoreRegex.test(lineContent)) {
        ignoreLines.push(lineIndex + 1); // 行号从1开始
      }
      lineIndex++;
      lineStart = i + 1;
    }
  }

  function isInComment(start: number, end: number) {
    return commentRanges.some(r => start >= r.start && end <= r.end);
  }

  // 检查指定行是否应该被忽略
  function shouldIgnoreLine(line: number): boolean {
    return ignoreLines.includes(line);
  }

  try {
    const ast = babelParser.parse(code, {
      sourceType: 'unambiguous',
      plugins: [
        'jsx',
        'typescript',
        'decorators-legacy',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'dynamicImport',
        'optionalChaining',
        'nullishCoalescingOperator',
        'objectRestSpread',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'topLevelAwait',
        'logicalAssignment',
        'numericSeparator',
        'privateIn',
      ],
      ranges: true,
    });
    traverse(ast as any, {
      StringLiteral(path: NodePath<any>) {
        if (path.node.loc && /[\u4e00-\u9fa5]/.test(path.node.value)) {
          // 跳过注释内字符串
          if (path.node.start !== undefined && path.node.end !== undefined && isInComment(path.node.start, path.node.end)) return;
          
          // 跳过被 i18n-ignore 注释标记的行
          if (shouldIgnoreLine(path.node.loc.start.line)) return;
          
          // 跳过JSX中testID属性的中文字符串
          const parent = path.parent;
          if (parent && parent.type === 'JSXAttribute' && 
              parent.name && parent.name.name === 'testID') {
            return;
          }
          
          // 跳过嵌套在JSXExpressionContainer中的testID属性的中文字符串
          if (parent && parent.type === 'JSXExpressionContainer') {
            const grandParent = (parent as any).parent;
            if (grandParent && grandParent.type === 'JSXAttribute' &&
                grandParent.name && grandParent.name.name === 'testID') {
              return;
            }
          }
          
          // 跳过对象属性testID的中文字符串
          if (parent && parent.type === 'ObjectProperty' &&
              parent.key && parent.key.type === 'Identifier' && parent.key.name === 'testID') {
            return;
          }
          
          const value = path.node.value;
          const line = path.node.loc.start.line;
          // 使用稳定的哈希算法生成key，确保唯一性且不会太长
          const key = 'i18n_' + generateStableHash(value);
          const gitlab = gitlabPrefix ? generateGitlabUrl(gitlabPrefix, relPath, line) : '';
          results.push({ key, value, file: relPath, line, gitlab });
        }
      },
      JSXText(path: NodePath<any>) {
        const value = path.node.value && path.node.value.trim();
        if (value && /[\u4e00-\u9fa5]/.test(value)) {
          if (path.node.start !== undefined && path.node.end !== undefined && isInComment(path.node.start, path.node.end)) return;
          const line = path.node.loc.start.line;
          if (shouldIgnoreLine(line)) return;
          const key = 'i18n_' + generateStableHash(value);
          const gitlab = gitlabPrefix ? generateGitlabUrl(gitlabPrefix, relPath, line) : '';
          results.push({ key, value, file: relPath, line, gitlab });
        }
      },
      TemplateLiteral(path: NodePath<any>) {
        if (path.node.loc) {
          // 将整个模板字符串作为一条处理，而不是拆分处理
          let fullValue = '';
          let hasChinese = false;
          
          // 用于跟踪每种表达式类型的计数
          const exprTypeCount: Record<string, number> = {};
          
          // 构建完整的模板字符串值
          for (let i = 0; i < path.node.quasis.length; i++) {
            const quasi = path.node.quasis[i];
            const value = quasi.value.raw;
            fullValue += value;
            if (/[\u4e00-\u9fa5]/.test(value)) {
              hasChinese = true;
            }
            
            // 添加表达式部分（如果有的话）
            if (i < path.node.expressions.length) {
              const expr = path.node.expressions[i];
              // 跟踪每种表达式类型的使用次数
              if (!exprTypeCount[expr.type]) {
                exprTypeCount[expr.type] = 0;
              }
              exprTypeCount[expr.type]++;
              
              // 使用类型和计数作为占位符，确保唯一性
              fullValue += `{{${expr.type}${exprTypeCount[expr.type]}}}`;
            }
          }
          
          // 如果整个模板字符串包含中文，则作为一个条目处理
          if (hasChinese) {
            // 跳过注释内字符串（检查第一个quasi的位置）
            const firstQuasi = path.node.quasis[0];
            if (firstQuasi.start !== undefined && firstQuasi.end !== undefined && 
                isInComment(firstQuasi.start, firstQuasi.end)) return;
                
            // 跳过被 i18n-ignore 注释标记的行
            const line = path.node.loc.start.line;
            if (shouldIgnoreLine(line)) return;
                
            // 使用稳定的哈希算法生成key，确保唯一性且不会太长
            const key = 'i18n_' + generateStableHash(fullValue);
            const gitlab = gitlabPrefix ? generateGitlabUrl(gitlabPrefix, relPath, line) : '';
            results.push({ key, value: fullValue, file: relPath, line, gitlab });
          }
        }
      }
    });
  } catch (e: any) {
    console.log(`[i18n-tools] 解析失败，已跳过: ${filePath} (${e.message})`);
  }
  return results;
}

function walkDir(dir: string, options: ScanOptions = {}, cb: (file: string) => void) {
  const { ignoreFiles = [] } = options;
  // 如果dir是相对路径，则以当前工作目录为基准
  // 如果dir只是文件夹名称，则在当前工作目录下查找
  const fullPath = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  
  fs.readdirSync(fullPath).forEach((f) => {
    if (ignoreFiles.includes(f)) return;
    const p = path.join(fullPath, f);
    if (fs.statSync(p).isDirectory()) walkDir(p, options, cb);
    else if (/\.(js|ts|tsx)$/.test(f)) cb(p);
  });
}

export function scanCommand(opts: any) {
  let { src, out, gitlab, config } = opts;
  
  // 从配置文件加载配置
  let configOptions: ScanOptions = {};
  if (config) {
    try {
      const configPath = path.isAbsolute(config) ? config : path.join(process.cwd(), config);
      configOptions = require(configPath);
      console.log(`[i18n-tools] 已加载配置文件: ${configPath}`);
    } catch (err) {
      console.error(`[i18n-tools] 加载配置文件失败: ${err}`);
    }
  }
  
  // 支持 src 为字符串或数组
  if (!Array.isArray(src)) src = [src];
  const wb = xlsx.utils.book_new();
  src.forEach((srcPath: string) => {
    const all: ScanResult[] = [];
    walkDir(srcPath, configOptions, (file) => {
      all.push(...extractStringsFromFile(file, configOptions, gitlab));
    });
    const wsData = all.map((row) => {
      const { key, value, file, line, gitlab } = row;
      const link = gitlab ? (gitlab.includes('#L') ? gitlab : gitlab + '#L' + line) : '';
      return {
        gitlab: link ? { t: 's', l: { Target: link }, v: '链接' } : '',
        zh: value,
        en: configOptions.translate?.(value) ?? undefined,
        file,
        line,
        key,
      };
    });
    const ws = xlsx.utils.json_to_sheet(wsData);
    // sheet 名取路径最后一段
    const sheetName = path.basename(srcPath);
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
    console.log(`扫描完成，导出 ${all.length} 条，Sheet: ${sheetName}`);
  });
  xlsx.writeFile(wb, out);
  console.log(`全部扫描完成，Excel: ${out}`);
}