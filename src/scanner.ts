import fs from 'fs';
import path from 'path';
import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import xlsx from 'xlsx';
import { generateGitlabUrl } from './gitlab';
import crypto from 'crypto';
import scanOptions, { ButtonLabelRules } from './scannerOptions';


interface ScanResult {
  key: string;
  value: string;
  file: string;
  line: number;
  gitlab: string;
  category: 'button-label' | 'normal';
}

const DEFAULT_LANGUAGES = ['en', 'es', 'pt', 'th'];
const RESERVED_LANG_KEYS = new Set(['gitlab', 'zh', 'file', 'line', 'key']);

interface ScanOptions {
  translate?: (text: string, lang?: string) => Promise<string | undefined>;
  languages?: string[];
  generateStableHash?: (str: string) => string;
  ignoreFiles?: string[];
  // 新增：可配置需要忽略的日志对象（例如 ['Sentry']）
  ignoreLogObjects?: string[];
  // 新增：可配置需要忽略的方法名（例如 ['captureMessage']）
  ignoreLogMethods?: string[];
  // 新增：按钮 label 识别规则（未配置则全部归类为 normal）
  buttonLabelRules?: ButtonLabelRules;
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

    // 忽略的日志对象（包括内置 console 和自定义 UnionLog）
    const ignoredLogObjects = new Set<string>(['console', 'UnionLog']);
    const ignoredLogMethods = new Set<string>(['log','warn','error','info','debug','trace','verbose','fatal']);

    // 读取配置中的附加忽略日志对象与方法
    if (options.ignoreLogObjects && Array.isArray(options.ignoreLogObjects)) {
      for (const o of options.ignoreLogObjects) {
        if (o && typeof o === 'string') ignoredLogObjects.add(o);
      }
    }
    if (options.ignoreLogMethods && Array.isArray(options.ignoreLogMethods)) {
      for (const m of options.ignoreLogMethods) {
        if (m && typeof m === 'string') ignoredLogMethods.add(m);
      }
    }

    function isInIgnoredLogCall(p: NodePath<any>): boolean {
      let current: NodePath<any> | null = p.parentPath;
      while (current) {
        if (current.isCallExpression()) {
          const callee: any = current.node.callee;
            if (callee && callee.type === 'MemberExpression' &&
                callee.object && callee.object.type === 'Identifier' && ignoredLogObjects.has(callee.object.name) &&
                callee.property && callee.property.type === 'Identifier' && ignoredLogMethods.has(callee.property.name)) {
              return true;
            }
        }
        current = current.parentPath;
      }
      return false;
    }

    // 判断一个中文字符串字面量是否处于"按钮 label"上下文
    // 规则按优先级命中即返回：
    //   1) 父链是 JSXAttribute 且属性名命中 jsxAttributes 白名单
    //   2) 父链是某个 alertCallees 调用的数组参数，且是该参数 ObjectExpression 的 text 字段
    //   3) 当前节点是 JSXText 且直接父元素标签命中 buttonComponents 白名单
    //   4) 上一行注释包含 inlineComment 标记
    const buttonRules: ButtonLabelRules | undefined = options.buttonLabelRules;
    function detectButtonLabel(path: NodePath<any>, nodeType: 'StringLiteral' | 'JSXText' | 'TemplateLiteral'): boolean {
      if (!buttonRules) return false;
      const maxDepth = buttonRules.ancestorDepth ?? 4;

      // 规则 1 + 2: 仅 StringLiteral 适用（JSXText 的父级直接是 JSXElement，不可能命中规则 1）
      if (nodeType === 'StringLiteral') {
        // 规则 1: 父链上溯到 JSXAttribute，属性名命中
        let p: NodePath<any> | null = path.parentPath;
        let depth = 0;
        while (p && depth < maxDepth) {
          if (p.isJSXAttribute()) {
            const attrName = (p.node as any).name?.name;
            if (attrName && buttonRules.jsxAttributes?.includes(attrName)) return true;
            return false;
          }
          if (p.isJSXElement()) break;
          p = p.parentPath;
          depth++;
        }

        // 规则 2: Alert.alert(...) 数组参数（或直接参数）里 ObjectExpression 的 text 字段
        let c: NodePath<any> | null = path.parentPath;
        depth = 0;
        while (c && depth < maxDepth) {
          if (c.isCallExpression()) {
            const callee: any = c.node.callee;
            const name = callee?.type === 'Identifier' ? callee.name
                       : callee?.type === 'MemberExpression' ? callee.property?.name
                       : null;
            if (name && buttonRules.alertCallees?.includes(name)) {
              const args: any[] = c.node.arguments || [];
              for (const arg of args) {
                if (!arg) continue;
                const candidates = arg.type === 'ArrayExpression' ? (arg.elements || []) : [arg];
                for (const item of candidates) {
                  if (!item || item.type !== 'ObjectExpression') continue;
                  if (!Array.isArray(item.properties)) continue;
                  for (const prop of item.properties) {
                    if (prop?.type !== 'ObjectProperty') continue;
                    const k = prop.key?.name ?? prop.key?.value;
                    if (k === 'text' && prop.value === path.node) return true;
                  }
                }
              }
              return false;
            }
            return false;
          }
          c = c.parentPath;
          depth++;
        }
      }

      // 规则 3: JSXText 祖先链上存在 buttonComponents 白名单标签
      //        （覆盖 <Button><Text>...</Text></Button>、<TouchableOpacity><Text>...</Text></TouchableOpacity> 等典型按钮结构）
      if (nodeType === 'JSXText') {
        let t: NodePath<any> | null = path.parentPath;
        while (t) {
          if (t.isJSXElement()) {
            const opening: any = (t.node as any).openingElement;
            const tagName = opening?.name?.name;
            if (tagName && buttonRules.buttonComponents?.includes(tagName)) return true;
          }
          t = t.parentPath;
        }
      }

      // 规则 4: 上一行注释命中 inlineComment 标记
      const startLine = (path.node as any).loc?.start.line;
      if (startLine && startLine > 1) {
        const prevLine = codeLines[startLine - 2] || '';
        if (prevLine.includes(buttonRules.inlineComment ?? '// @i18n:button-label')) return true;
      }

      return false;
    }

    // 判断节点或其前后关联注释中是否含有 i18n-ignore
    function hasIgnoreComment(path: NodePath<any>): boolean {
      const node: any = path.node;
      // 行号方式：本行、上一行、上一行到本行之间的块注释
      if (!node.loc) return false;
      const startLine = node.loc.start.line;
      const endLine = node.loc.end.line;
      // 检查节点前一行
      if (startLine > 1) {
        const prevLine = codeLines[startLine - 2];
        if (/\/\/.*i18n-ignore/.test(prevLine)) return true;
      }
      // 当前行尾部注释
      const currentLine = codeLines[startLine - 1];
      if (/\/\/.*i18n-ignore/.test(currentLine)) return true;
      // 查找与节点相邻的块注释：在源码中截取节点开始前的最多300字符
      if (node.start !== undefined) {
        const lookBehindStart = Math.max(0, node.start - 300);
        const prefix = code.slice(lookBehindStart, node.start);
        // 只取最后一个块注释或行注释片段
        const blockMatch = /\/\*[\s\S]*?i18n-ignore[\s\S]*?\*\/$/.exec(prefix);
        if (blockMatch) return true;
        const lineMatch = /\/\/.*i18n-ignore[\s\S]*?$/.exec(prefix);
        if (lineMatch) return true;
      }
      return false;
    }

    traverse(ast as any, {
      StringLiteral(path: NodePath<any>) {
        if (path.node.loc && /[\u4e00-\u9fa5]/.test(path.node.value)) {
          if (path.node.start !== undefined && path.node.end !== undefined && isInComment(path.node.start, path.node.end)) return;
          if (hasIgnoreComment(path)) return;
          
          // 检查是否为testID相关的字符串，如果是则忽略
          const pos = `${path.node.start}-${path.node.end}`;
          if (testIdStringPositions.has(pos)) {
            return;
          }
          
          // 检查是否在需要忽略的日志调用中（console / UnionLog）
          if (isInIgnoredLogCall(path)) {
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
          const category = detectButtonLabel(path, 'StringLiteral') ? 'button-label' : 'normal';
          results.push({ key, value, file: relPath, line, gitlab, category });
        }
      },
      TemplateLiteral(path: NodePath<any>) {
        if (path.node.loc) {
          if (hasIgnoreComment(path)) return;
          // 检查是否为testID相关的模板字符串，如果是则忽略
          if (path.node.start !== undefined && path.node.end !== undefined) {
            const pos = `${path.node.start}-${path.node.end}`;
            if (testIdStringPositions.has(pos)) {
              // console.log(`[i18n-tools] 忽略testID模板字符串`);
              return;
            }
          }
          
          // 忽略 console / UnionLog 等日志调用中的模板字符串
          if (isInIgnoredLogCall(path)) {
            return;
          }
          
          let fullValue = '';
          let hasChinese = false;
          const exprTypeCount: Record<string, number> = {};
          for (let i = 0; i < path.node.quasis.length; i++) {
            const quasi = path.node.quasis[i];
            // 使用 cooked 优先，避免 \n 被二次转义成 \\n 导致 Excel 中出现双斜杠；对于非法转义 cooked 可能为 undefined 回退 raw
            const value = (quasi.value.cooked ?? quasi.value.raw);
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
            const category = detectButtonLabel(path, 'TemplateLiteral') ? 'button-label' : 'normal';
            results.push({ key, value: fullValue, file: relPath, line, gitlab, category });
          }
        }
      },
      JSXText(path: NodePath<any>) {
        // 只处理包含中文的 JSXText
        const value = path.node.value;
        if (/[\u4e00-\u9fa5]/.test(value)) {
          if (!value.trim()) return;
          if (hasIgnoreComment(path)) return;
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
          const category = detectButtonLabel(path, 'JSXText') ? 'button-label' : 'normal';
          results.push({ key, value: value.trim(), file: relPath, line, gitlab, category });
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
    const languages: string[] = Array.isArray(configOptions.languages)
      ? configOptions.languages.filter((l): l is string => typeof l === 'string' && l.length > 0 && !RESERVED_LANG_KEYS.has(l))
      : DEFAULT_LANGUAGES;

    const wsData = await Promise.all(all.map(async (row) => {
      const { key, value, file, line, gitlab, category } = row;
      const link = gitlab ? (gitlab.includes('#L') ? gitlab : gitlab + '#L' + line) : '';
      const translated: Record<string, string | undefined> = {};
      if (configOptions.translate) {
        await Promise.all(languages.map(async (lang) => {
          translated[lang] = await configOptions.translate!(value, lang);
        }));
      } else {
        for (const lang of languages) translated[lang] = undefined;
      }
      return {
        gitlab: link ? { t: 's', l: { Target: link }, v: '链接' } : '',
        zh: value,
        category: category ?? 'normal',
        ...translated,
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