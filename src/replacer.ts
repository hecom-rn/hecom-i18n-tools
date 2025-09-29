// @ts-nocheck
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as babelParser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

// ----------------------------- 工具函数 -----------------------------
const TS_TYPE_NODE_SET = new Set([
  'TSLiteralType','TSUnionType','TSIntersectionType','TSTypeAnnotation','TSTypeReference',
  'TSTypeLiteral','TSPropertySignature','TSMethodSignature','TSInterfaceDeclaration','TSTypeAliasDeclaration'
]);

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildParseOptions(plugins: any[]) {
  return {
    sourceType: 'unambiguous' as const,
    plugins,
    allowImportExportEverywhere: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowUndeclaredExports: true,
    strictMode: false,
    ranges: false,
    tokens: false
  };
}

function isInTsType(path: any): boolean {
  return !!path.findParent((p: any) => TS_TYPE_NODE_SET.has(p.node.type));
}

function isInFunctionReturnType(path: any): boolean {
  const fnPath = path.findParent((p: any) => (
    p.isFunctionDeclaration?.() || p.isFunctionExpression?.() || p.isArrowFunctionExpression?.() || p.isObjectMethod?.()
  ));
  if (!fnPath) return false;
  // 查找当前路径是否位于函数的 returnType 注解中
  const returnType = (fnPath.node as any).returnType;
  if (!returnType) return false;
  return !!path.findParent((p: any) => p.node === returnType);
}

function isInStyleSheetCreate(path: any): boolean {
  return !!path.findParent((p: any) => {
    const node = p.node;
    return node && node.type === 'CallExpression' &&
      node.callee && node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' && node.callee.object.name === 'StyleSheet' &&
      node.callee.property.type === 'Identifier' && node.callee.property.name === 'create';
  });
}

interface TemplateFullValueResult {
  fullValue: string;
  expressions: any[];
  typeIndexMap: string[]; // 记录顺序 (类型+序号) 用于参数对象 key
}

function buildTemplateFullValue(node: any): TemplateFullValueResult {
  let fullValue = '';
  const expressions: any[] = [];
  const exprTypeCount: Record<string, number> = {};
  const typeIndexMap: string[] = [];
  for (let i = 0; i < node.quasis.length; i++) {
    const quasi = node.quasis[i];
    fullValue += quasi.value.raw;
    if (i < node.expressions.length) {
      const expr = node.expressions[i];
      expressions.push(expr);
      exprTypeCount[expr.type] = (exprTypeCount[expr.type] || 0) + 1;
      const placeholder = `{{${expr.type}${exprTypeCount[expr.type]}}}`;
      typeIndexMap.push(`${expr.type}${exprTypeCount[expr.type]}`);
      fullValue += placeholder;
    }
  }
  return { fullValue, expressions, typeIndexMap };
}

function shouldSkipLiteral(path: any): boolean {
  if (isInTsType(path)) return true;
  if (isInFunctionReturnType(path)) return true;
  if (isInStyleSheetCreate(path)) return true;
  return false;
}

export function replaceCommand(opts: any) {
  const { 
    excel,
    file: onlyFile,
    importPath = 'core/util/i18n',
    fixLint = false,
    // 新增：可传入 Prettier 配置文件路径（相对或绝对）
    prettierConfigPath,
    prettierConfig, // CLI 传入别名
    // 预留：额外 CLI 参数（数组）
    prettierExtraArgs = [] as string[],
    methodBlankLine,
    eslintBlankLines ,
  } = opts;
  const effectivePrettierConfig = prettierConfigPath || prettierConfig; // 优先显式 path
  const enableMethodBlankLine = typeof methodBlankLine !== 'undefined' && ['true','1','yes','y'].includes(String(methodBlankLine).toLowerCase());
  const enableEslintBlankLines = typeof eslintBlankLines !== 'undefined' && ['true','1','yes','y'].includes(String(eslintBlankLines).toLowerCase());
  const projectRoot = process.cwd();
  const excelPath = path.isAbsolute(excel) ? excel : path.resolve(projectRoot, excel);
  
  let wb;
  try {
    wb = xlsx.readFile(excelPath);
  } catch (error) {
    console.error(`❌ 读取Excel文件失败: ${excelPath}`);
    console.error(`错误详情: ${error.message}`);
    return;
  }
  
  // 合并所有 sheet 的内容
  let rows: any[] = [];
  try {
    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      if (ws) {
        rows = rows.concat(xlsx.utils.sheet_to_json(ws));
      } else {
        console.warn(`⚠️ Sheet "${sheetName}" 为空或无法解析`);
      }
    });
  } catch (error) {
    console.error(`❌ 解析Excel工作表失败: ${error.message}`);
    return;
  }
  const fileMap: Record<string, Array<any>> = {};
  rows.forEach((row: any) => {
    if (!fileMap[row.file]) fileMap[row.file] = [];
    fileMap[row.file].push(row);
  });
  const files = onlyFile ? [onlyFile] : Object.keys(fileMap);

  const prettierTargets: string[] = [];

  // 轻量级：类方法之间插入空行（避免运行 ESLint --fix 的性能开销）
  function formatClassMethodBlankLines(code: string): string {
    if (!enableMethodBlankLine || enableEslintBlankLines) return code; // ESLint 模式更全面
    const lines = code.split(/\r?\n/);
    let braceDepth = 0;
    let pendingClass = false; // 发现 class 关键字但尚未进入其体
    let inClass = false;
    let classBodyDepth = 0; // 进入类体后的基准深度（类体左大括号的深度）
    const methodRegex = /^\s*(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(?:\[.*?\]|[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 粗略扫描 class 声明
      if (!inClass) {
        if (/^\s*class\b/.test(line)) {
          // 可能同一行就出现了 { ，否则下一行找
          pendingClass = true;
        }
      }
      // 扫描字符以更新 braceDepth，并判断是否进入/退出类体
      // 为保持性能，这里简单遍历当前行字符
      for (let c of line) {
        if (c === '{') {
          braceDepth++;
          if (pendingClass && !inClass) {
            inClass = true;
            pendingClass = false;
            classBodyDepth = braceDepth; // 类体内部起始深度
          }
        } else if (c === '}') {
          // 先判断退出
          if (inClass && braceDepth === classBodyDepth) {
            inClass = false; // 离开类体
          }
          braceDepth--;
        }
      }
      if (!inClass) continue;
      // 在类体内判断是否为方法定义行
      if (methodRegex.test(line)) {
        // 找上一条非空行索引
        let prevIdx = i - 1;
        while (prevIdx >= 0 && lines[prevIdx].trim() === '') prevIdx--;
        // 如果紧挨着且上一行不是类起始的 '{' 那么插入空行
        if (prevIdx >= 0) {
          const prevLine = lines[prevIdx];
            if (!/\{\s*$/.test(prevLine)) {
              // 确保方法前一行不是已经空行
              if (i > 0 && lines[i-1].trim() !== '') {
                lines.splice(i, 0, '');
                i++; // 跳过刚插入的空行
              }
            }
        }
      }
    }
    return lines.join('\n');
  }
  // ESLint 风格：类成员之间、顶层函数之间、块后接函数前插入空行
  function applyEslintLikeBlankLines(code: string): string {
    if (!enableEslintBlankLines) return code;
    const lines = code.split(/\r?\n/);
    const methodRegex = /^\s*(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(?:\[.*?\]|[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/;
    const classPropRegex = /^\s*(?:public\s+|private\s+|protected\s+)?(?:readonly\s+)?(?:static\s+)?[A-Za-z_$][\w$]*\s*(=|:)/;
    const topLevelFnRegex = /^\s*(?:export\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/;
    const topLevelConstArrowFnRegex = /^\s*(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/;
    const topLevelConstFnExprRegex = /^\s*(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?function\b/;
    let braceDepth = 0;
    let pendingClass = false;
    let inClass = false;
    let classBodyDepth = 0;
    const isClassMember: boolean[] = new Array(lines.length).fill(false);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inClass && /^\s*class\b/.test(line)) pendingClass = true;
      for (const ch of line) {
        if (ch === '{') {
          braceDepth++;
          if (pendingClass) { inClass = true; pendingClass = false; classBodyDepth = braceDepth; }
        } else if (ch === '}') {
          if (inClass && braceDepth === classBodyDepth) inClass = false;
          braceDepth--;
        }
      }
      if (inClass && (methodRegex.test(line) || classPropRegex.test(line))) {
        isClassMember[i] = true;
      }
    }
    for (let i = 0; i < lines.length; i++) {
      if (!isClassMember[i]) continue;
      let prev = i - 1;
      while (prev >= 0 && lines[prev].trim() === '') prev--;
      if (prev >= 0 && isClassMember[prev]) {
        if (i > 0 && lines[i-1].trim() !== '') { lines.splice(i,0,''); i++; }
      }
    }
    // 顶层函数
    braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) { if (ch === '{') braceDepth++; else if (ch === '}') braceDepth--; }
      if (braceDepth === 0 && (topLevelFnRegex.test(line) || topLevelConstArrowFnRegex.test(line) || topLevelConstFnExprRegex.test(line))) {
        let prev = i - 1;
        while (prev >= 0 && lines[prev].trim() === '') prev--;
        if (prev >= 0) {
          const prevLine = lines[prev];
            if (topLevelFnRegex.test(prevLine) || topLevelConstArrowFnRegex.test(prevLine) || topLevelConstFnExprRegex.test(prevLine) || /}\s*$/.test(prevLine)) {
              if (i > 0 && lines[i-1].trim() !== '') { lines.splice(i,0,''); i++; }
            }
        }
      }
    }
    return lines.join('\n');
  }

  files.forEach((file) => {
    if (!fileMap[file]) {
      console.warn(`Excel中未找到与 ${file} 匹配的行，跳过`);
      return;
    }
    const absFile = path.resolve(projectRoot, file);
    if (!fs.existsSync(absFile)) {
      console.warn(`⚠️ 文件不存在: ${absFile}，跳过`);
      return;
    }
    
    let code;
    try {
      code = fs.readFileSync(absFile, 'utf8');
    } catch (error) {
      console.error(`❌ 读取文件失败: ${absFile}`);
      console.error(`错误详情: ${error.message}`);
      return;
    }
    // 预筛：如果源码中不包含任意翻译值，直接跳过复杂 AST 解析
    // 但：含有占位符 {{...}} 的模板字符串不能用简单子串判断，否则会漏（例如 你好，{{Identifier1}}! 与源码 你好，${name}!）
    const candidates = fileMap[file];
    const candidateValues = candidates.map(r => r.zh).filter(Boolean);
    const hasPlaceholderStyle = candidateValues.some(v => /\{\{.+?\}\}/.test(v));
    let possibleHits: string[] = [];
    if (!hasPlaceholderStyle) {
      possibleHits = candidateValues.filter(v => v && code.includes(v));
      if (possibleHits.length === 0) {
        return; // 无需处理
      }
    }

    let ast;
    try {
      // 根据文件扩展名确定解析器插件
      const ext = path.extname(absFile).toLowerCase();
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
        'asyncGenerators',
        'functionBind',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'importMeta',
        'topLevelAwait',
        'numericSeparator',
        'logicalAssignment',
        'optionalCatchBinding',
        'bigInt'
      ];

      // TypeScript 文件支持
      if (ext === '.ts' || ext === '.tsx') {
        plugins.push('typescript');
      }
      
      // Flow 支持
      if (ext === '.js' || ext === '.jsx') {
        plugins.push('flow', 'flowComments');
      }

      // 尝试多种解析策略
      ast = babelParser.parse(code, buildParseOptions(plugins));
    } catch (e) {
      // 第二次尝试：使用更宽松的配置
      try {
        ast = babelParser.parse(code, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript', 'flow', 'flowComments'],
          allowImportExportEverywhere: true,
          strictMode: false
        });
      } catch (e2) {
        // 第三次尝试：作为脚本解析
        try {
          ast = babelParser.parse(code, {
            sourceType: 'script',
            plugins: ['jsx'],
            strictMode: false
          });
        } catch (e3) {
          console.warn(`Babel 解析失败，降级为正则替换: ${absFile}`);
          console.warn(`解析错误: ${e.message}`);
          // 检查是否已存在import语句
          if (!code.includes(`import { t } from '${importPath}'`)) {
            code = `import { t } from '${importPath}';\n` + code;
          }
          
          // 改进的正则替换逻辑（仅处理实际包含的候选）
          fileMap[file].forEach((row) => {
            const value = row.zh;
            if (!value || !code.includes(value)) return;
            const escapedValue = escapeRegExp(value);
            const textReg = new RegExp(`(['"` + '`' + `])${escapedValue}\\1`, 'g');
            code = code.replace(textReg, `{t('${row.key}')}`);
            const jsxAttrReg = new RegExp(`(\\w+\\s*=\\s*)(['"` + '`' + `])${escapedValue}\\2`, 'g');
            code = code.replace(jsxAttrReg, `$1{t('${row.key}')}`);
            const jsxExprReg = new RegExp(`(\\{\\s*)(['"` + '`' + `])${escapedValue}\\2(\\s*\\})`, 'g');
            code = code.replace(jsxExprReg, `$1t('${row.key}')$3`);
          });
          
          // 清理可能的重复花括号
          code = code.replace(/\{\{t\(/g, '{t(');
          code = code.replace(/t\(\)/g, 't()');
          
          try {
            fs.writeFileSync(absFile, code, 'utf8');
          } catch (writeError) {
            console.error(`❌ 写入文件失败: ${absFile}: ${writeError.message}`);
            return;
          }
          
          // 统一放入批量 Prettier 处理
          if (fixLint) prettierTargets.push(absFile);
          return;
        }
      }
    }
    
    // 构建值到键的映射
    const valueKeyMap: Record<string, string> = {};
    fileMap[file].forEach((row) => {
      valueKeyMap[row.zh] = row.key;
    });
    
    let replaced = false;
    let hasTImport = false;

    traverse(ast, {
      ImportDeclaration(path) {
        for (const specifier of path.node.specifiers) {
          if (specifier.type === 'ImportSpecifier' &&
            ((specifier.imported.type === 'Identifier' && specifier.imported.name === 't') ||
             (specifier.imported.type === 'StringLiteral' && specifier.imported.value === 't'))) {
            hasTImport = true; break;
          }
        }
      },
      StringLiteral(path) {
        const v = path.node.value;
        if (!valueKeyMap[v]) return;
        if (shouldSkipLiteral(path)) { console.warn(`⚠️ 跳过TypeScript/StyleSheet中的字符串: "${v}"`); return; }
        const callExpression = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[v])]);
        path.replaceWith(path.parentPath.isJSXAttribute() ? t.jsxExpressionContainer(callExpression) : callExpression);
        replaced = true;
      },
      JSXText(path) {
          try {
            const value = path.node.value.trim();
            if (value && valueKeyMap[value]) {
              // 替换JSXText为JSXExpressionContainer包装的t()调用
              const callExpression = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[value])]);
              const jsxExpressionContainer = t.jsxExpressionContainer(callExpression);
              path.replaceWith(jsxExpressionContainer);
              replaced = true;
            }
          } catch (jsxTextError) {
            console.error(`❌ 处理JSX文本时出错: ${jsxTextError.message}`);
            console.error(`JSX文本值: "${path.node.value}"`);
          }
        },
      TemplateLiteral(path) {
        if (shouldSkipLiteral(path)) { console.warn('⚠️ 跳过TypeScript/StyleSheet中的模板字符串'); return; }
        const { fullValue, expressions, typeIndexMap } = buildTemplateFullValue(path.node);
        if (valueKeyMap[fullValue]) {
          let callExpression;
          if (expressions.length > 0) {
            const properties = expressions.map((expr, idx) => {
              const key = t.identifier(typeIndexMap[idx]);
              return t.objectProperty(key, expr);
            });
            callExpression = t.callExpression(t.identifier('t'), [
              t.stringLiteral(valueKeyMap[fullValue]),
              t.objectExpression(properties)
            ]);
          } else {
            callExpression = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[fullValue])]);
          }
          path.replaceWith(path.parentPath.isJSXAttribute() ? t.jsxExpressionContainer(callExpression) : callExpression);
          replaced = true; return;
        }
        // 回退：按 quasi 逐段匹配（兼容旧数据）
        let changed = false;
        path.node.quasis.forEach((q: any, idx: number) => {
          const raw = q.value.raw;
          if (valueKeyMap[raw]) {
            const expr = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[raw])]);
            const exprContainer = path.parentPath.isJSXAttribute() ? t.jsxExpressionContainer(expr) : expr;
            if (idx < path.node.expressions.length) {
              path.node.expressions.splice(idx, 0, exprContainer);
            } else {
              path.node.expressions.push(exprContainer);
            }
            q.value.raw = '';
            q.value.cooked = '';
            changed = true;
          }
        });
        if (changed) replaced = true;
      }
    });
    
    if (replaced) {
      // 如果有替换且没有t导入，则添加导入语句
      if (!hasTImport) {
        const importDeclaration = t.importDeclaration(
          [t.importSpecifier(t.identifier('t'), t.identifier('t'))],
          t.stringLiteral(importPath)
        );
        ast.program.body.unshift(importDeclaration);
      }
      
      try {
        let output = generate(ast, {}, code).code;
        output = formatClassMethodBlankLines(output);
        output = applyEslintLikeBlankLines(output);
        fs.writeFileSync(absFile, output, 'utf8');
      } catch (generateError) {
        console.error(`❌ 代码生成或文件写入失败: ${absFile}: ${generateError.message}`);
        return;
      }
      
      // 对修改后的文件执行Prettier格式化
      if (fixLint) prettierTargets.push(absFile);
    } else {
      // 即使没有AST替换，也要确保添加import语句
      if (!code.includes(`import { t } from '${importPath}'`) && !hasTImport) {
        code = `import { t } from '${importPath}';\n` + code;
      }
      
      fileMap[file].forEach((row) => {
        const value = row.zh;
        if (!value || !code.includes(value)) return;
        const reg = new RegExp(`(['"` + '`' + `])${escapeRegExp(value)}\\1`, 'g');
        code = code.replace(reg, `t('${row.key}')`);
      });
      
      try {
        // 直接修改字符串替换路径也应用空行格式
        code = formatClassMethodBlankLines(code);
        code = applyEslintLikeBlankLines(code);
        fs.writeFileSync(absFile, code, 'utf8');
      } catch (writeError) {
        console.error(`❌ 文件写入失败: ${absFile}: ${writeError.message}`);
        return;
      }
      
      // 对修改后的文件执行Prettier格式化
      if (fixLint) prettierTargets.push(absFile);
    }
  });
  if (files.length && fixLint) {
    try {
      // 去重
      const unique = Array.from(new Set(prettierTargets));
      if (unique.length) {
        console.log(`运行 Prettier 格式化 ${unique.length} 个文件...`);
        // 构建命令
        const args: string[] = [];
        if (effectivePrettierConfig) {
          args.push('--config', `"${path.resolve(projectRoot, effectivePrettierConfig)}"`);
        }
        if (prettierExtraArgs && Array.isArray(prettierExtraArgs) && prettierExtraArgs.length) {
          prettierExtraArgs.forEach((a: string) => args.push(a));
        }
        const fileArgs = unique.map(f => `"${f}"`).join(' ');
        const cmd = `npx prettier ${args.join(' ')} ${fileArgs} --write`;
        execSync(cmd, { stdio: 'inherit' });
      }
    } catch (e) {
      console.warn('批量 Prettier 失败: ' + (e as any).message);
    }
  }
  console.log('代码回写完成');
}