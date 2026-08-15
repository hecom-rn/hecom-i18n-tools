import fs from 'fs';
import path from 'path';
import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import xlsx from 'xlsx';
import { generateGitlabUrl } from './gitlab';
import crypto from 'crypto';
import scanOptions, { ButtonLabelRules } from './scannerOptions';

/**
 * 从 master.xlsx 读取所有 (key -> zh) 映射。
 * 用于 legacy 扫描：根据 t('key') 中的 key 反查中文文本。
 */
export function loadMasterKeyZhMap(masterPath: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!fs.existsSync(masterPath)) return map;
  try {
    const wb = xlsx.readFile(masterPath);
    wb.SheetNames.forEach((sheetName) => {
      const ws = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<any>(ws, { defval: '' });
      rows.forEach((row) => {
        if (row.key && row.zh != null && String(row.zh).trim() !== '') {
          map[String(row.key)] = String(row.zh);
        }
      });
    });
  } catch (e) {
    console.warn(`[i18n-tools] 读取 master.xlsx 失败: ${e}`);
  }
  return map;
}

/**
 * 从 locales 目录读取所有语言的 (key -> value) 映射，返回 { lang: {key:value} }。
 * 用于在 scan 完成后预填非 button-label 条目的译文，让 AI 只翻译 button-label。
 */
export function loadLocaleTranslations(outDir: string, langs: string[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const lang of langs) {
    const p = path.isAbsolute(outDir) ? path.join(outDir, `${lang}.json`) : path.join(process.cwd(), outDir, `${lang}.json`);
    if (!fs.existsSync(p)) continue;
    try {
      result[lang] = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      // ignore parse error
    }
  }
  return result;
}


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

// 长度护栏：超过 6 个字符的中文/混合文本强制判为 normal（避免长句被压成单词）
const BUTTON_LABEL_MAX_LEN = 6;
function isOverLongButtonCandidate(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  // 仅当含中文字符且 trim 后字符数 > 6 时才算超长
  if (/[\u4e00-\u9fa5]/.test(trimmed) && trimmed.length > BUTTON_LABEL_MAX_LEN) {
    return true;
  }
  return false;
}

/**
 * 顶层版 shouldIgnoreNode：判断节点的行号是否在某个 // @i18n-ignore 注释的作用域内。
 *
 * 检查规则（按优先级）：
 *   1. 节点范围内任意行含 i18n-ignore 注释
 *   2. 节点直接前一行含 i18n-ignore 注释（典型行尾注释场景）
 *   3. 块级作用域：节点前若干行内含独立成行的 i18n-ignore 注释（trim 后以 // 开头），
 *      且中间没有空行（空行 = 块边界）
 *
 * 提供给 extractTCallsFromFile（legacy 扫描）调用，因为后者不在 extractStringsFromFile 闭包内。
 */
function shouldIgnoreNodeByLine(codeLines: string[], ignoreLines: number[], nodeStartLine: number, nodeEndLine: number): boolean {
  for (let line = nodeStartLine; line <= nodeEndLine; line++) {
    if (ignoreLines.includes(line)) return true;
  }
  if (ignoreLines.includes(nodeStartLine - 1)) return true;
  for (let i = 1; i <= 10; i++) {
    const prevLine = nodeStartLine - i;
    if (prevLine < 1) break;
    const prevContent = codeLines[prevLine - 1] || '';
    if (prevContent.trim() === '') break;
    if (prevContent.trim().startsWith('//') && ignoreLines.includes(prevLine)) return true;
  }
  return false;
}

/**
 * 为 t('key') 调用点识别按钮 label 上下文（顶层版，供 extractTCallsFromFile 调用）：
 *   规则 1: 父链是 JSXAttribute 且 name 命中 jsxAttributes 白名单
 *           <Button title={t('key')}>
 *   规则 2: 父链中存在 Alert.alert 的 arguments，且本调用是 ObjectExpression.text 字段的值
 *           Alert.alert('', '', [{ text: t('key') }])
 *   规则 3: 父链上某个 JSXElement 的 tagName 在 buttonComponents 白名单内
 *           <Button><Text>{t('key')}</Text></Button>
 *   规则 4: 上一行注释命中 inlineComment 标记
 */
function detectButtonLabelForTCall(
  callPath: NodePath<any>,
  codeLines: string[],
  buttonRules: ButtonLabelRules,
  zhValue?: string
): boolean {
  // 长度护栏：超长中文候选直接判定为 normal（与上下文无关）
  if (zhValue && isOverLongButtonCandidate(zhValue)) return false;

  const maxDepth = buttonRules.ancestorDepth ?? 4;

  // 规则 1：<Button title={t('key')}>
  let p: NodePath<any> | null = callPath.parentPath;
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

  // 规则 2：Alert.alert('', '', [{ text: t('key') }])
  let c: NodePath<any> | null = callPath.parentPath;
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
              if (k === 'text' && prop.value === callPath.node) return true;
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

  // 规则 3：<Button><Text>{t('key')}</Text></Button>
  let t: NodePath<any> | null = callPath.parentPath;
  while (t) {
    if (t.isJSXElement()) {
      const opening: any = (t.node as any).openingElement;
      const tagName = opening?.name?.name;
      if (tagName && buttonRules.buttonComponents?.includes(tagName)) return true;
    }
    t = t.parentPath;
  }

  // 规则 4：行级注释标记
  const callLine = (callPath.node as any).loc?.start.line;
  if (callLine && callLine > 1) {
    const prevLine = codeLines[callLine - 2] || '';
    if (prevLine.includes(buttonRules.inlineComment ?? '// @i18n:button-label')) return true;
  }

  return false;
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
  // 严格匹配：注释主体必须以 @?i18n-ignore 开头（行注释独占一行或行尾均可），
  // 块注释要求 /* 后紧跟 @?i18n-ignore。避免描述性注释中包含 "i18n-ignore"
  // 子串时被误识别为忽略指令。
  const ignoreLines: number[] = [];
  const ignoreRegex = /(?:^|[^\n])\/\/\s*@?i18n-ignore\b|^\s*\/\*\s*@?i18n-ignore\b[\s\S]*?\*\//m;
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

    // 扩展块级作用域：// @i18n-ignore 单独成行时（例如 const 声明块之前），
    // 后续所有非空行内的中文字符串也应被忽略，直到遇到空行（块边界）。
    // 注意：JS 中 const/let/var 等声明本身可能跨多行（`const x = [` 后到 `];`），
    // scanner 无法识别这种语法边界，因此遇到 const 关键字不会 break。
    // 用户若希望把 ignore 限定在单一声明块，应在声明之间用空行分隔。
    for (let i = 1; i <= 10; i++) {
      const prevLine = nodeStartLine - i;
      if (prevLine < 1) break;
      const prevContent = codeLines[prevLine - 1] || '';
      if (prevContent.trim() === '') break; // 空行：块边界
      if (prevContent.trim().startsWith('//') && ignoreLines.includes(prevLine)) return true;
      // 中间隔了正常代码行：继续向上回溯
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

      // 长度护栏：超长候选直接判定为 normal（与上下文无关）
      const candidateText = (path.node as any).value;
      if (isOverLongButtonCandidate(candidateText)) return false;

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
    // 严格匹配：注释主体必须以 @?i18n-ignore 开头，避免描述性注释中的子串误命中。
    function hasIgnoreComment(path: NodePath<any>): boolean {
      const node: any = path.node;
      // 行号方式：本行、上一行、上一行到本行之间的块注释
      if (!node.loc) return false;
      const startLine = node.loc.start.line;
      const endLine = node.loc.end.line;
      // 检查节点前一行（独立成行的 // 注释）
      if (startLine > 1) {
        const prevLine = codeLines[startLine - 2];
        if (/^\s*\/\/\s*@?i18n-ignore\b/.test(prevLine)) return true;
      }
      // 当前行尾部 // 注释（要求 // 前是空白/标点/行首）
      const currentLine = codeLines[startLine - 1];
      if (/(?:^|[^\w\/])\/\/\s*@?i18n-ignore\b/.test(currentLine)) return true;
      // 查找与节点相邻的块注释：在源码中截取节点开始前的最多300字符
      if (node.start !== undefined) {
        const lookBehindStart = Math.max(0, node.start - 300);
        const prefix = code.slice(lookBehindStart, node.start);
        // 只取最后一个块注释片段：/* @?i18n-ignore ... */
        const blockMatch = /\/\*\s*@?i18n-ignore\b[\s\S]*?\*\/$/.exec(prefix);
        if (blockMatch) return true;
        // 行尾注释：// 后面紧跟 @?i18n-ignore（不跨行匹配，避免误判字符串值中含 "i18n-ignore" 的场景）
        const lineMatch = /\/\/\s*@?i18n-ignore\b[^\n]*$/.exec(prefix);
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

/**
 * Legacy 扫描：从源码中提取 t('key') 调用点，结合 master.xlsx 反查中文，
 * 按 buttonLabelRules 判断调用点上下文是否属于按钮 label。
 *
 * 设计目的：让历史已 wrap 的条目（master.xlsx 中已有的 key）也能被分类、
 * 重新翻译并由 gen 按 category 覆盖回写到语言包。
 */
function extractTCallsFromFile(
  filePath: string,
  masterKeyZhMap: Record<string, string>,
  options: ScanOptions = scanOptions,
  gitlabPrefix?: string
): ScanResult[] {
  const buttonRules: ButtonLabelRules | undefined = options.buttonLabelRules;
  if (!buttonRules) return [];
  if (Object.keys(masterKeyZhMap).length === 0) return [];

  const code = fs.readFileSync(filePath, 'utf8');
  const codeLines = code.split(/\r?\n/);
  const results: ScanResult[] = [];
  const projectRoot = process.cwd();
  let relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  if (code.includes('i18n-ignore-file')) return results;

// 收集 // i18n-ignore / /* i18n-ignore */ 注释行号
  // （与 extractStringsFromFile 内的 ignoreLines 收集逻辑一致）
  const ignoreRegex = /(?:^|[^\n])\/\/\s*@?i18n-ignore\b|^\s*\/\*\s*@?i18n-ignore\b[\s\S]*?\*\//m;
  const ignoreLines: number[] = [];
  for (let li = 0; li < codeLines.length; li++) {
    if (ignoreRegex.test(codeLines[li])) ignoreLines.push(li + 1);
  }

  const isTypeScript =
    /\.(ts|tsx)$/.test(filePath) || code.includes('import type') || code.includes('export type');
  let ast: any;
  try {
    ast = babelParser.parse(code, {
      sourceType: 'unambiguous',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: isTypeScript
        ? ['typescript', 'jsx', 'classProperties', 'decorators-legacy']
        : ['jsx', 'classProperties'],
      errorRecovery: true,
    });
  } catch (e: any) {
    return results;
  }

  // 已处理过的 key（同一文件多次出现只取第一次位置）
  const seen = new Set<string>();

  traverse(ast as any, {
    CallExpression(callPath: NodePath<any>) {
      const node = callPath.node;
      const callee: any = node.callee;
      // 仅匹配 Identifier 名为 t（裸 t('key')）。i18n.t(...) / translation.t(...) 不命中
      if (!callee || callee.type !== 'Identifier' || callee.name !== 't') return;
      const args: any[] = node.arguments || [];
      if (!args.length) return;
      const keyArg = args[0];
      if (!keyArg || keyArg.type !== 'StringLiteral') return;
      const key = keyArg.value;
      if (!key || seen.has(key)) return;
      // 必须存在于 master.xlsx
      const zhValue = masterKeyZhMap[key];
      if (!zhValue) return;
      seen.add(key);

      const line = keyArg.loc?.start.line || node.loc?.start.line || 0;
      const endLine = node.loc?.end.line || line;
      // 跳过被 // @i18n-ignore 注释作用域覆盖的 t() 调用点
      if (shouldIgnoreNodeByLine(codeLines, ignoreLines, line, endLine)) return;
      const gitlab = gitlabPrefix ? generateGitlabUrl(gitlabPrefix, relPath, line) : '';
      const isButton = detectButtonLabelForTCall(callPath, codeLines, buttonRules, zhValue);
      const category: 'button-label' | 'normal' = isButton ? 'button-label' : 'normal';

      results.push({ key, value: zhValue, file: relPath, line, gitlab, category });
    },
  });

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
  let { src, out, gitlab, config, master, localesDir, localeLangs } = opts;

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

  // 加载 master.xlsx，用于 legacy 扫描时反查 t('key') 的中文文本
  let masterKeyZhMap: Record<string, string> = {};
  if (master) {
    const masterPath = path.isAbsolute(master) ? master : path.join(process.cwd(), master);
    masterKeyZhMap = loadMasterKeyZhMap(masterPath);
    console.log(`[i18n-tools] 已加载 master: ${masterPath}（${Object.keys(masterKeyZhMap).length} 个 key）`);
  }

  // 加载现有语言包，用于预填 non-button-label 条目的译文（让 AI 只翻译 button-label）
  let localeTranslations: Record<string, Record<string, string>> = {};
  if (localesDir) {
    const langs: string[] = Array.isArray(localeLangs) && localeLangs.length
      ? localeLangs
      : ['en', 'es', 'pt', 'th', 'fr', 'ru'];
    localeTranslations = loadLocaleTranslations(localesDir, langs);
    const loadedLangs = Object.keys(localeTranslations);
    if (loadedLangs.length) {
      console.log(`[i18n-tools] 已加载现有语言包: ${loadedLangs.join(', ')}（预填非 button-label 条目）`);
    }
  }

  // 支持 src 为字符串或数组
  if (!Array.isArray(src)) src = [src];
  const wb = xlsx.utils.book_new();

  for (const srcPath of src) {
    const all: ScanResult[] = [];
    walkDir(srcPath, configOptions, (file) => {
      all.push(...extractStringsFromFile(file, configOptions, gitlab));
      // legacy 扫描：补充 t('key') 调用点（仅当 master.xlsx 提供时启用）
      if (master) {
        all.push(...extractTCallsFromFile(file, masterKeyZhMap, configOptions, gitlab));
      }
    });
    const languages: string[] = Array.isArray(configOptions.languages)
      ? configOptions.languages.filter((l): l is string => typeof l === 'string' && l.length > 0 && !RESERVED_LANG_KEYS.has(l))
      : DEFAULT_LANGUAGES;

    const wsData = await Promise.all(all.map(async (row) => {
      const { key, value, file, line, gitlab, category } = row;
      const link = gitlab ? (gitlab.includes('#L') ? gitlab : gitlab + '#L' + line) : '';
      const cat = category ?? 'normal';
      // 仅当 category !== 'button-label' 时预填现有译文；button-label 留空让 AI 重新润色
      const prefill = (lang: string): string | undefined => {
        if (cat === 'button-label') return undefined;
        const m = localeTranslations[lang];
        return m && m[key] ? m[key] : undefined;
      };
      const translated: Record<string, string | undefined> = {};
      if (configOptions.translate) {
        await Promise.all(languages.map(async (lang) => {
          // 已有预填译文时优先使用，避免重复翻译；否则调 translate
          const prefilled = prefill(lang);
          translated[lang] = prefilled ?? await configOptions.translate!(value, lang);
        }));
      } else {
        for (const lang of languages) translated[lang] = prefill(lang);
      }
      return {
        gitlab: link ? { t: 's', l: { Target: link }, v: '链接' } : '',
        zh: value,
        category: cat,
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
export { extractStringsFromFile, extractTCallsFromFile };