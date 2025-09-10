// @ts-nocheck
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as babelParser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export function replaceCommand(opts: any) {
  const { excel, file: onlyFile, importPath = 'core/util/i18n', fixLint = false } = opts;
  const projectRoot = process.cwd();
  const excelPath = path.isAbsolute(excel) ? excel : path.resolve(projectRoot, excel);
  const wb = xlsx.readFile(excelPath);
  // 合并所有 sheet 的内容
  let rows: any[] = [];
  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    rows = rows.concat(xlsx.utils.sheet_to_json(ws));
  });
  const fileMap: Record<string, Array<any>> = {};
  rows.forEach((row: any) => {
    if (!fileMap[row.file]) fileMap[row.file] = [];
    fileMap[row.file].push(row);
  });
  const files = onlyFile ? [onlyFile] : Object.keys(fileMap);
  files.forEach((file) => {
    if (!fileMap[file]) {
      console.warn(`Excel中未找到与 ${file} 匹配的行，跳过`);
      return;
    }
    const absFile = path.resolve(projectRoot, file);
    if (!fs.existsSync(absFile)) {
      console.warn(`文件不存在: ${absFile}，跳过`);
      return;
    }
    let code = fs.readFileSync(absFile, 'utf8');
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
      let parseOptions = {
        sourceType: 'unambiguous' as 'unambiguous',
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

      ast = babelParser.parse(code, parseOptions);
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
          
          // 改进的正则替换逻辑
          fileMap[file].forEach((row) => {
            const value = row.zh;
            const escapedValue = value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
            
            // 1. 处理普通字符串字面量 (在 JSX 文本中)
            const textReg = new RegExp(`(['"` + '`' + `])${escapedValue}\\1`, 'g');
            code = code.replace(textReg, `{t('${row.key}')}`);
            
            // 2. 处理 JSX 属性中的字符串 (需要花括号)
            const jsxAttrReg = new RegExp(`(\\w+\\s*=\\s*)(['"` + '`' + `])${escapedValue}\\2`, 'g');
            code = code.replace(jsxAttrReg, `$1{t('${row.key}')}`);
            
            // 3. 处理已经在花括号中的字符串
            const jsxExprReg = new RegExp(`(\\{\\s*)(['"` + '`' + `])${escapedValue}\\2(\\s*\\})`, 'g');
            code = code.replace(jsxExprReg, `$1t('${row.key}')$3`);
          });
          
          // 清理可能的重复花括号
          code = code.replace(/\{\{t\(/g, '{t(');
          code = code.replace(/t\(\)/g, 't()');
          
          fs.writeFileSync(absFile, code, 'utf8');
          console.log(`已处理: ${absFile}`);
          
          // 对修改后的文件执行ESLint修复
          if (fixLint) {
            try {
              execSync(`npx eslint "${absFile}" --fix`, { stdio: 'inherit' });
              console.log(`已对 ${absFile} 执行ESLint修复`);
            } catch (error) {
              console.warn(`ESLint修复失败 ${absFile}: ${error.message}`);
            }
          }
          return;
        }
      }
    }
    const valueKeyMap: Record<string, string> = {};
    fileMap[file].forEach((row) => {
      valueKeyMap[row.zh] = row.key;
    });
    let replaced = false;
    let hasTImport = false;
    
    // 检查是否已存在t的导入
    traverse(ast, {
      ImportDeclaration(path) {
        const source = path.node.source.value;
        const specifiers = path.node.specifiers;
        for (const specifier of specifiers) {
          if (specifier.type === 'ImportSpecifier' && 
              ((specifier.imported.type === 'Identifier' && specifier.imported.name === 't') ||
               (specifier.imported.type === 'StringLiteral' && specifier.imported.value === 't'))) {
            hasTImport = true;
            break;
          }
        }
      }
    });
    
    traverse(ast, {
      StringLiteral(path) {
        const v = path.node.value;
        if (valueKeyMap[v]) {
          const callExpression = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[v])]);
          
          // 检查是否在 StyleSheet.create 中，如果是则跳过
          let parent = path.parent;
          let isInStyleSheet = false;
          while (parent) {
            if (parent.type === 'CallExpression' && 
                parent.callee.type === 'MemberExpression' &&
                parent.callee.object.type === 'Identifier' && 
                parent.callee.object.name === 'StyleSheet' &&
                parent.callee.property.type === 'Identifier' && 
                parent.callee.property.name === 'create') {
              isInStyleSheet = true;
              break;
            }
            parent = parent.parent;
          }
          
          if (isInStyleSheet) {
            console.warn(`⚠️ 跳过StyleSheet中的字符串: "${v}"`);
            return;
          }
          
          // 检查父节点是否为 JSXAttribute
          if (path.parentPath.isJSXAttribute()) {
            // 在 JSX 属性中需要用 JSXExpressionContainer 包装
            path.replaceWith(t.jsxExpressionContainer(callExpression));
          } else {
            path.replaceWith(callExpression);
          }
          replaced = true;
        }
      },
      JSXText(path) {
        const value = path.node.value.trim();
        if (value && valueKeyMap[value]) {
          // 替换JSXText为JSXExpressionContainer包装的t()调用
          const callExpression = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[value])]);
          const jsxExpressionContainer = t.jsxExpressionContainer(callExpression);
          path.replaceWith(jsxExpressionContainer);
          replaced = true;
        }
      },
      TemplateLiteral(path) {
        // 构建完整的模板字符串值，与 scanner.ts 中的处理保持一致
        let fullValue = '';
        const expressions = [];
        // 用于跟踪每种表达式类型的计数
        const exprTypeCount: Record<string, number> = {};
        
        for (let i = 0; i < path.node.quasis.length; i++) {
          const quasi = path.node.quasis[i];
          fullValue += quasi.value.raw;
          
          // 添加表达式部分（如果有的话）
          if (i < path.node.expressions.length) {
            const expr = path.node.expressions[i];
            expressions.push(expr);
            // 跟踪每种表达式类型的使用次数
            if (!exprTypeCount[expr.type]) {
              exprTypeCount[expr.type] = 0;
            }
            exprTypeCount[expr.type]++;
            
            // 使用类型和计数作为占位符，与 scanner.ts 保持一致
            fullValue += `{{${expr.type}${exprTypeCount[expr.type]}}}`;
          }
        }
        
        // 检查整个模板字符串是否匹配
        if (valueKeyMap[fullValue]) {
          // 如果有表达式，则需要传递参数
          let callExpression;
          if (expressions.length > 0) {
            // 构建参数对象 { Identifier1: value1, Identifier2: value2, ... }
            // 与 scanner.ts 中的占位符保持一致
            const properties = expressions.map((expr, index) => {
              // 使用表达式的类型和计数作为 key，与 scanner.ts 保持一致
              const keyName = `${expr.type}${index + 1}`;
              const key = t.identifier(keyName);
              return t.objectProperty(key, expr);
            });
            const objectExpression = t.objectExpression(properties);
            callExpression = t.callExpression(t.identifier('t'), [
              t.stringLiteral(valueKeyMap[fullValue]),
              objectExpression
            ]);
          } else {
            // 没有表达式，直接替换
            callExpression = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[fullValue])]);
          }
          
          // 检查父节点是否为 JSXAttribute
          if (path.parentPath.isJSXAttribute()) {
            // 在 JSX 属性中需要用 JSXExpressionContainer 包装
            path.replaceWith(t.jsxExpressionContainer(callExpression));
          } else {
            path.replaceWith(callExpression);
          }
          replaced = true;
          return;
        }
        
        // 原有的逐个替换逻辑保持不变，以兼容旧的数据
        let changed = false;
        path.node.quasis.forEach((q, idx) => {
          const raw = q.value.raw;
          if (valueKeyMap[raw]) {
            const expr = t.callExpression(t.identifier('t'), [t.stringLiteral(valueKeyMap[raw])]);
            // 检查父节点是否为 JSXAttribute
            const exprContainer = path.parentPath.isJSXAttribute() ? 
              t.jsxExpressionContainer(expr) : expr;
              
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
        if (changed) {
          replaced = true;
        }
      },
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
      
      const output = generate(ast, {}, code).code;
      fs.writeFileSync(absFile, output, 'utf8');
      console.log(`已处理: ${absFile}`);
      
      // 对修改后的文件执行ESLint修复
      if (fixLint) {
        try {
          execSync(`npx eslint "${absFile}" --fix`, { stdio: 'inherit' });
          console.log(`已对 ${absFile} 执行ESLint修复`);
        } catch (error) {
          console.warn(`ESLint修复失败 ${absFile}: ${error.message}`);
        }
      }
    } else {
      // 即使没有AST替换，也要确保添加import语句
      if (!code.includes(`import { t } from '${importPath}'`) && !hasTImport) {
        code = `import { t } from '${importPath}';\n` + code;
      }
      fileMap[file].forEach((row) => {
        const value = row.zh;
        const reg = new RegExp(`(['"` + '`' + `])${value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\1`, 'g');
        code = code.replace(reg, `t('${row.key}')`);
      });
      fs.writeFileSync(absFile, code, 'utf8');
      console.log(`已处理: ${absFile}`);
      
      // 对修改后的文件执行ESLint修复
      if (fixLint) {
        try {
          execSync(`npx eslint "${absFile}" --fix`, { stdio: 'inherit' });
          console.log(`已对 ${absFile} 执行ESLint修复`);
        } catch (error) {
          console.warn(`ESLint修复失败 ${absFile}: ${error.message}`);
        }
      }
    }
  });
  console.log('代码回写完成');
}