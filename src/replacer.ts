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
    fixLint: rawFixLint = false,
  // 由 fixLint 统一控制格式化和 ESLint 补空行逻辑
    // 新增：可传入 Prettier 配置文件路径（相对或绝对）
    prettierConfigPath,
    prettierConfig, // CLI 传入别名
    // 预留：额外 CLI 参数（数组）
    prettierExtraArgs = [] as string[],
    // （已移除空行自动插入功能，保持逻辑最简）
  } = opts;
  // 将 fixLint 正常化（兼容 commander 传递字符串/布尔）
  const fixLint = typeof rawFixLint === 'string' ? ['1','true','yes','y','on'].includes(rawFixLint.toLowerCase()) : !!rawFixLint;
  const retainLines = true; // 内部总是尽量保留源代码的行结构，降低非目标区域改动范围
  let effectivePrettierConfig = prettierConfigPath || prettierConfig; // 优先显式 path
  // 若未显式传入，自动探测常见 Prettier 配置文件
  if (!effectivePrettierConfig) {
    const candidates = [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.js',
      'prettier.config.js',
      'prettier.config.cjs',
      '.prettierrc.cjs',
      '.prettierrc.yaml',
      '.prettierrc.yml',
    ];
    for (const c of candidates) {
      const p = path.resolve(process.cwd(), c);
      if (fs.existsSync(p)) { effectivePrettierConfig = p; break; }
    }
  }
  // 空行处理已移除
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

  // 已移除空行自动调整函数（保持原文件格式）

  // 记录：每个文件中“类成员之间原本就有空行(>=2个换行)”的成员对
  const originalClassGapMap: Map<string, Set<string>> = new Map();

  // 辅助：稳定描述类成员（方法/属性），用于生成成员对键值
  function memberDescriptor(m: any): string {
    const isStatic = !!m.static;
    const kind = (m as any).kind || (m.type === 'ClassProperty' ? 'property' : 'member');
    let name = 'unknown';
    const key: any = (m as any).key;
    if (key) {
      if (key.name) name = key.name;
      else if (key.value != null) name = String(key.value);
      else if (key.id?.name) name = key.id.name;
    }
    if (m.type === 'ClassMethod' && (m as any).kind === 'constructor') name = 'constructor';
    return `${isStatic ? 'static' : 'instance'}:${kind}:${name}`;
  }

  // 收集：原始源码中类成员之间已有空行的位置（以成员对键标识）
  function collectOriginalClassGaps(filePath: string, src: string): Set<string> {
    const set = new Set<string>();
    let astLocal: any;
    try {
      const ext = path.extname(filePath).toLowerCase();
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
      ];
      if (ext === '.ts' || ext === '.tsx') plugins.push('typescript');
      if (ext === '.js' || ext === '.jsx') plugins.push('flow', 'flowComments');
      astLocal = babelParser.parse(src, { sourceType: 'unambiguous', plugins, ranges: true });
    } catch {
      return set;
    }
    let classIndex = 0;
    traverse(astLocal, {
      ClassBody(p: any) {
        const body = (p.node as any).body || [];
        for (let i = 0; i < body.length - 1; i++) {
          const prev: any = body[i];
          const next: any = body[i + 1];
          if (typeof prev.end !== 'number' || typeof next.start !== 'number') continue;
          const between = src.slice(prev.end, next.start);
          const newlineCount = (between.match(/\n/g) || []).length;
          if (newlineCount >= 2) {
            const key = `${classIndex}:${memberDescriptor(prev)}->${memberDescriptor(next)}`;
            set.add(key);
          }
        }
        classIndex++;
      }
    });
    return set;
  }

  // 恢复：仅对“原本就有空行”的成员对，补回一行空行（若被 Prettier 折叠）
  function restoreOriginalClassMemberBlankLines(filePath: string, origPairs: Set<string>) {
    if (!origPairs || !origPairs.size) return;
    let src = fs.readFileSync(filePath, 'utf8');
    let astLocal: any;
    try {
      const ext = path.extname(filePath).toLowerCase();
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
      ];
      if (ext === '.ts' || ext === '.tsx') plugins.push('typescript');
      if (ext === '.js' || ext === '.jsx') plugins.push('flow', 'flowComments');
      astLocal = babelParser.parse(src, { sourceType: 'unambiguous', plugins, ranges: true });
    } catch {
      return;
    }
    type Gap = { insertAt: number };
    const gaps: Gap[] = [];
    let classIndex = 0;
    traverse(astLocal, {
      ClassBody(p: any) {
        const body = (p.node as any).body || [];
        for (let i = 0; i < body.length - 1; i++) {
          const prev: any = body[i];
          const next: any = body[i + 1];
          if (typeof prev.end !== 'number' || typeof next.start !== 'number') continue;
          const pairKey = `${classIndex}:${memberDescriptor(prev)}->${memberDescriptor(next)}`;
          if (!origPairs.has(pairKey)) continue; // 仅恢复原本就有空行的成员对
          // 更稳健地计算“空行数”：
          // blankLines = 0 表示没有空行（成员紧邻，仅 1 个换行）；
          // blankLines = 1 表示恰好一空行（2 个换行）；依此类推。
          const firstNLAfterPrev = src.indexOf('\n', prev.end);
          const lastNLBeforeNext = src.lastIndexOf('\n', next.start - 1);
          let blankLines = 0;
          if (firstNLAfterPrev !== -1 && lastNLBeforeNext !== -1 && lastNLBeforeNext > firstNLAfterPrev) {
            const middle = src.slice(firstNLAfterPrev + 1, lastNLBeforeNext);
            blankLines = 1 + ((middle.match(/\n/g) || []).length);
          } else if (firstNLAfterPrev !== -1 && firstNLAfterPrev < next.start) {
            // 只有一个换行，说明没有空行
            blankLines = 0;
          }
          if (blankLines < 1) {
            // 需要补一空行：在下一成员起始行前插入一个换行
            const insertAt = lastNLBeforeNext >= 0 ? lastNLBeforeNext + 1 : next.start;
            gaps.push({ insertAt });
          }
        }
        classIndex++;
      }
    });
    if (!gaps.length) return;
    gaps.sort((a, b) => b.insertAt - a.insertAt).forEach(g => {
      src = src.slice(0, g.insertAt) + '\n' + src.slice(g.insertAt);
    });
    fs.writeFileSync(filePath, src, 'utf8');
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

    // 在任何修改之前，记录该文件中“类成员之间原本就有空行”的成员对
    if (!originalClassGapMap.has(absFile)) {
      originalClassGapMap.set(absFile, collectOriginalClassGaps(absFile, code));
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
        // 当用户要求保留原始行结构时，启用 retainLines 以尽量减少换行变化
        let output = generate(ast, retainLines ? { retainLines: true } : {}, code).code;
  // 保留生成输出，不做额外空行格式化
        fs.writeFileSync(absFile, output, 'utf8');
      } catch (generateError) {
        console.error(`❌ 代码生成或文件写入失败: ${absFile}: ${generateError.message}`);
        return;
      }
      
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
  // 不做额外空行格式化
        fs.writeFileSync(absFile, code, 'utf8');
      } catch (writeError) {
        console.error(`❌ 文件写入失败: ${absFile}: ${writeError.message}`);
        return;
      }
      
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
        // 将 --write 放在文件列表之前更稳妥
        args.push('--write');
        if (effectivePrettierConfig) {
          const resolved = path.isAbsolute(effectivePrettierConfig)
            ? effectivePrettierConfig
            : path.resolve(projectRoot, effectivePrettierConfig);
          args.push('--config', `"${resolved}"`);
          console.log(`使用 Prettier 配置: ${resolved}`);
        } else {
          console.log('未显式提供 Prettier 配置，尝试使用项目默认或内置规则');
        }
        if (prettierExtraArgs && Array.isArray(prettierExtraArgs) && prettierExtraArgs.length) {
          prettierExtraArgs.forEach((a: string) => args.push(a));
        }
        const fileArgs = unique.map(f => `"${f}"`).join(' ');
        const cmd = `npx prettier ${args.join(' ')} ${fileArgs}`;
        console.log(`执行命令: npx prettier ${args.join(' ')}`);
        execSync(cmd, { stdio: 'inherit' });
        // 仅恢复“原本就有空行”的成员对，避免新增无关空行
        try {
          unique.forEach(f => {
            const origPairs = originalClassGapMap.get(f) || new Set<string>();
            restoreOriginalClassMemberBlankLines(f, origPairs);
          });
        } catch (spErr) {
          console.warn('轻量换行恢复失败（已忽略）：' + (spErr as any).message);
        }
      }
    } catch (e) {
      console.warn('批量 Prettier 失败: ' + (e as any).message);
      console.warn('可尝试手动运行 prettier 或检查 npx / 本地路径、Node 版本与 Prettier 是否安装。');
    }
  }
  console.log('代码回写完成');
}