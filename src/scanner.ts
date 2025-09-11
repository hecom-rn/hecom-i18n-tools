import fs from 'fs';
import path from 'path';
import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import xlsx from 'xlsx';
import { generateGitlabUrl } from './gitlab';
import crypto from 'crypto';
import scanOptions from './scannerOptions';


interface ScanResult {
  key: string;
  value: string;
  file: string;
  line: number;
  gitlab: string;
}

interface ScanOptions {
  translate?: (text: string) => Promise<string | undefined>;
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
  const codeLines = code.split(/\r?\n/); // 用于调试实际行内容
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
  const ignoreRegex = /\/\/.*i18n-ignore|\/\*.*i18n-ignore.*\*\//;
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

  // 检查 AST 节点的范围内是否有 i18n-ignore 注释
  function shouldIgnoreNode(nodeStartLine: number, nodeEndLine: number): boolean {
    // 检查节点范围内的所有行是否有 i18n-ignore 注释
    for (let line = nodeStartLine; line <= nodeEndLine; line++) {
      if (ignoreLines.includes(line)) {
        return true;
      }
    }
    
    // 还要检查节点开始行的前一行是否有 i18n-ignore 注释
    // 这是为了处理注释在前、字符串在后的情况
    if (ignoreLines.includes(nodeStartLine - 1)) {
      return true;
    }
    
    return false;
  }

  // 收集所有testID相关的字符串位置，用于后续忽略
  const testIdStringPositions = new Set<string>();

  function collectTestIdStrings(ast: any) {
    traverse(ast, {
      JSXAttribute(path: NodePath<any>) {
        // 扩展识别更多RN测试相关属性
        const testAttributes = ['testID', 'accessibilityLabel', 'accessibilityHint', 'nativeID'];
        if (path.node.name && testAttributes.includes(path.node.name.name)) {
          if (path.node.value && path.node.value.type === 'StringLiteral') {
            // testID="value" 格式
            const pos = `${path.node.value.start}-${path.node.value.end}`;
            testIdStringPositions.add(pos);
          } else if (path.node.value && path.node.value.type === 'JSXExpressionContainer') {
            // testID={expression} 格式
            const expr = path.node.value.expression;
            if (expr.type === 'StringLiteral') {
              const pos = `${expr.start}-${expr.end}`;
              testIdStringPositions.add(pos);
            } else if (expr.type === 'TemplateLiteral') {
              // testID={`template`} 格式
              const pos = `${expr.start}-${expr.end}`;
              testIdStringPositions.add(pos);
            } else if (expr.type === 'BinaryExpression') {
              // 处理 testID={"str1" + "str2"} 格式，递归收集所有字符串字面量
              function collectFromBinaryExpr(node: any) {
                if (node.type === 'StringLiteral') {
                  const pos = `${node.start}-${node.end}`;
                  testIdStringPositions.add(pos);
                } else if (node.type === 'BinaryExpression') {
                  collectFromBinaryExpr(node.left);
                  collectFromBinaryExpr(node.right);
                }
              }
              collectFromBinaryExpr(expr);
            }
          }
        }
      },
      ObjectProperty(path: NodePath<any>) {
        // 处理 RN 样式对象中的测试属性
        const testProperties = ['testID', 'accessibilityLabel', 'accessibilityHint', 'nativeID'];
        if (path.node.key && 
            ((path.node.key.type === 'Identifier' && testProperties.includes(path.node.key.name)) ||
             (path.node.key.type === 'StringLiteral' && testProperties.includes(path.node.key.value)))) {
          if (path.node.value && path.node.value.type === 'StringLiteral') {
            const pos = `${path.node.value.start}-${path.node.value.end}`;
            testIdStringPositions.add(pos);
          } else if (path.node.value && path.node.value.type === 'TemplateLiteral') {
            const pos = `${path.node.value.start}-${path.node.value.end}`;
            testIdStringPositions.add(pos);
          }
        }
      }
    });
  }

  try {
    // 动态确定插件配置
    const isTypeScript = /\.(ts|tsx)$/.test(filePath) || code.includes('import type') || code.includes('export type');
    const isFlow = !isTypeScript && (code.includes('@flow') || code.includes('// @flow'));
    
    const plugins: any[] = [
      'jsx',
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
      'asyncGenerators',
      'functionBind',
      'doExpressions',
      'throwExpressions',
      'partialApplication'
    ];

    // 根据文件类型添加相应的类型系统插件
    if (isTypeScript) {
      plugins.push('typescript');
    } else if (isFlow) {
      plugins.push('flow', 'flowComments');
    }

    const ast = babelParser.parse(code, {
      sourceType: 'unambiguous',
      plugins,
      ranges: true,
    });

    // 首先收集所有testID相关的字符串位置
    collectTestIdStrings(ast);
    traverse(ast as any, {
      StringLiteral(path: NodePath<any>) {
        if (path.node.loc && /[\u4e00-\u9fa5]/.test(path.node.value)) {
          if (path.node.start !== undefined && path.node.end !== undefined && isInComment(path.node.start, path.node.end)) return;
          
          // 检查是否为testID相关的字符串，如果是则忽略
          const pos = `${path.node.start}-${path.node.end}`;
          if (testIdStringPositions.has(pos)) {
            return;
          }
          
          // 检查字符串范围内是否有 i18n-ignore 注释
          const startLine = path.node.loc.start.line;
          const endLine = path.node.loc.end.line;
          if (shouldIgnoreNode(startLine, endLine)) return;
          const value = path.node.value;
          let line = path.node.loc.start.line;
          const actualLine = codeLines[line - 1] || '';
          const isCommentLine = actualLine.trim().startsWith('//') || actualLine.trim().startsWith('/*');
          if (!isCommentLine && !actualLine.includes(value) && codeLines[line] && codeLines[line].includes(value)) {
            line = line + 1;
          }
          if (value.length > 32767) {
            console.warn(`[i18n-tools] 跳过超长文本: ${filePath}:${line} (${value.length} 字符)`);
            return;
          }
          const key = 'i18n_' + generateStableHash(value);
          const gitlab = gitlabPrefix ? generateGitlabUrl(gitlabPrefix, relPath, line) : '';
          results.push({ key, value, file: relPath, line, gitlab });
        }
      },
      TemplateLiteral(path: NodePath<any>) {
        if (path.node.loc) {
          // 检查是否为testID相关的模板字符串，如果是则忽略
          if (path.node.start !== undefined && path.node.end !== undefined) {
            const pos = `${path.node.start}-${path.node.end}`;
            if (testIdStringPositions.has(pos)) {
              // console.log(`[i18n-tools] 忽略testID模板字符串`);
              return;
            }
          }
          
          let fullValue = '';
          let hasChinese = false;
          const exprTypeCount: Record<string, number> = {};
          for (let i = 0; i < path.node.quasis.length; i++) {
            const quasi = path.node.quasis[i];
            const value = quasi.value.raw;
            fullValue += value;
            if (/[\u4e00-\u9fa5]/.test(value)) {
              hasChinese = true;
            }
            if (i < path.node.expressions.length) {
              const expr = path.node.expressions[i];
              if (!exprTypeCount[expr.type]) {
                exprTypeCount[expr.type] = 0;
              }
              exprTypeCount[expr.type]++;
              fullValue += `{{${expr.type}${exprTypeCount[expr.type]}}}`;
            }
          }
          if (hasChinese) {
            const firstQuasi = path.node.quasis[0];
            if (firstQuasi.start !== undefined && firstQuasi.end !== undefined && 
                isInComment(firstQuasi.start, firstQuasi.end)) return;
            let line = path.node.loc.start.line;
            const endLine = path.node.loc.end.line;
            
            // 检查整个模板字符串范围内是否有 i18n-ignore 注释
            if (shouldIgnoreNode(line, endLine)) return;
            
            const actualLine = codeLines[line - 1] || '';
            const isCommentLine = actualLine.trim().startsWith('//') || actualLine.trim().startsWith('/*');
            if (!isCommentLine && !actualLine.includes(fullValue) && codeLines[line] && codeLines[line].includes(fullValue)) {
              line = line + 1;
            }
            if (fullValue.length > 32767) {
              console.warn(`[i18n-tools] 跳过超长模板文本: ${filePath}:${line} (${fullValue.length} 字符)`);
              return;
            }
            const key = 'i18n_' + generateStableHash(fullValue);
            const gitlab = gitlabPrefix ? generateGitlabUrl(gitlabPrefix, relPath, line) : '';
            results.push({ key, value: fullValue, file: relPath, line, gitlab });
          }
        }
      },
      JSXText(path: NodePath<any>) {
        // 只处理包含中文的 JSXText
        const value = path.node.value;
        if (/[\u4e00-\u9fa5]/.test(value)) {
          if (!value.trim()) return;
          // 精确推算内容实际所在行号
          let line = path.node.loc?.start.line || 0;
          // 统计 value 前的换行数，推算实际内容行
          const lines = value.split('\n');
          let offset = 0;
          for (let i = 0; i < lines.length; i++) {
            if (/[\u4e00-\u9fa5]/.test(lines[i])) {
              offset = i;
              break;
            }
          }
          line = line + offset;
          
          // 检查JSX文本范围内是否有 i18n-ignore 注释
          const startLine = path.node.loc?.start.line || 0;
          const endLine = path.node.loc?.end.line || startLine;
          if (shouldIgnoreNode(startLine, endLine)) return;
          
          if (path.node.start !== undefined && path.node.end !== undefined && isInComment(path.node.start, path.node.end)) return;
          const actualLine = codeLines[line - 1] || '';
          const isCommentLine = actualLine.trim().startsWith('//') || actualLine.trim().startsWith('/*');
          if (!isCommentLine && !actualLine.includes(value.trim()) && codeLines[line] && codeLines[line].includes(value.trim())) {
            line = line + 1;
          }
          if (value.length > 32767) {
            console.warn(`[i18n-tools] 跳过超长JSX文本: ${filePath}:${line} (${value.length} 字符)`);
            return;
          }
          const key = 'i18n_' + generateStableHash(value.trim());
          const gitlab = gitlabPrefix ? generateGitlabUrl(gitlabPrefix, relPath, line) : '';
          results.push({ key, value: value.trim(), file: relPath, line, gitlab });
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
  
  // 检查是否是单个文件
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const f = path.basename(fullPath);
    if ((/\.(js|jsx|ts|tsx|rn\.js|android\.js|ios\.js)$/.test(f)) && !/\.d\.ts$/.test(f)) {
      cb(fullPath);
    }
    return;
  }
  
  fs.readdirSync(fullPath).forEach((f) => {
    const p = path.join(fullPath, f);
    // 检查是否为默认忽略目录
    // 如果 ignoreFiles 中任意一项在路径中出现，则忽略（目录和文件都跳过）
    if (ignoreFiles.some(ignore => p.includes(ignore))) return;
    try {
      if (fs.statSync(p).isDirectory()) {
        // 跳过被 ignoreFiles 命中的目录
        walkDir(p, options, cb);
      } else if ((/\.(js|jsx|ts|tsx|rn\.js|android\.js|ios\.js)$/.test(f)) && !/\.d\.ts$/.test(f)) {
        cb(p);
      }
    } catch (e) {
      // 跳过无法访问的文件或目录（如损坏的软链、缺失的依赖等）
      // console.warn(`[i18n-tools] 跳过无法访问: ${p} (${e.message})`);
    }
  });
}

export async function scanCommand(opts: any) {
  let { src, out, gitlab, config } = opts;
  
  // 从配置文件加载配置
  let configOptions: ScanOptions = {};
  if (config) {
    try {
      const configPath = path.isAbsolute(config) ? config : path.join(process.cwd(), config);
      const rawConfig = require(configPath);
      configOptions = rawConfig.default || rawConfig;
      console.log(`[i18n-tools] 已加载配置文件: ${configPath}`);
    } catch (err) {
      console.error(`[i18n-tools] 加载配置文件失败: ${err}`);
    }
  }
  
  // 支持 src 为字符串或数组
  if (!Array.isArray(src)) src = [src];
  const wb = xlsx.utils.book_new();
  
  for (const srcPath of src) {
    const all: ScanResult[] = [];
    walkDir(srcPath, configOptions, (file) => {
      all.push(...extractStringsFromFile(file, configOptions, gitlab));
    });
    const wsData = await Promise.all(all.map(async (row) => {
      const { key, value, file, line, gitlab } = row;
      const link = gitlab ? (gitlab.includes('#L') ? gitlab : gitlab + '#L' + line) : '';
      return {
        gitlab: link ? { t: 's', l: { Target: link }, v: '链接' } : '',
        zh: value,
        en: configOptions.translate ? await configOptions.translate(value) : undefined,
        file,
        line,
        key,
      };
    }));
    const ws = xlsx.utils.json_to_sheet(wsData);
    // sheet 名取路径最后一段
    const sheetName = path.basename(srcPath);
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
    console.log(`扫描完成，导出 ${all.length} 条，Sheet: ${sheetName}`);
  }
  xlsx.writeFile(wb, out);
  console.log(`全部扫描完成，Excel: ${out}`);
}

// 导出 extractStringsFromFile 函数以便测试
export { extractStringsFromFile };