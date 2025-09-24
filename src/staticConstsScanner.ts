import fs from 'fs';
import path from 'path';
import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';

interface ConstItem {
  name: string;
  type: 'string' | 'array' | 'object';
  // 对于 string: value 为字符串
  // 对于 array: value 为中文元素数组
  // 对于 object: value 为形如 key:value 的数组（仅中文属性）
  value: string | string[];
  file: string;
  line: number;
}

interface ScanOptions {
  ignoreFiles?: string[];
}

function walk(dir: string, ignore: string[], cb: (file: string) => void) {
  const full = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (/\.(js|jsx|ts|tsx)$/.test(full) && !/\.d\.ts$/.test(full)) cb(full);
    return;
  }
  fs.readdirSync(full).forEach(f => {
    const p = path.join(full, f);
    if (ignore.some(i => p.includes(i))) return;
    try {
      const s = fs.statSync(p);
      if (s.isDirectory()) walk(p, ignore, cb);
      else if (/\.(js|jsx|ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f)) cb(p);
    } catch {}
  });
}

export function scanStaticConstsCommand(opts: any) {
  let { src, out, config, debug } = opts;
  if (!Array.isArray(src)) src = [src];
  // 加载配置（只用 ignoreFiles）
  let ignoreFiles: string[] = [];
  if (config) {
    try {
      const configPath = path.isAbsolute(config) ? config : path.join(process.cwd(), config);
      const raw = require(configPath);
      const cfg = raw.default || raw;
      if (Array.isArray(cfg.ignoreFiles)) ignoreFiles = cfg.ignoreFiles;
    } catch (e: any) {
      console.warn(`[i18n-tools] 配置加载失败: ${e?.message || e}`);
    }
  }

  const results: ConstItem[] = [];
  const projectRoot = process.cwd();

  function logDebug(msg: string) {
    if (debug) console.log(`[static-consts][debug] ${msg}`);
  }

  function isChinese(str: string) {
    return /[\u4e00-\u9fa5]/.test(str);
  }

  function collect(filePath: string) {
    const code = fs.readFileSync(filePath, 'utf8');
    // 快速过滤：没有中文直接跳过
    if (!isChinese(code)) { if (debug) logDebug(`skip(no chinese): ${filePath}`); return; }
    try {
      const ast = babelParser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx','typescript','decorators-legacy','classProperties','classPrivateProperties','classPrivateMethods','dynamicImport','optionalChaining','nullishCoalescingOperator','objectRestSpread'],
      });
      traverse(ast as any, {
        TSEnumDeclaration(path: NodePath<any>) {
          const name = path.node.id.name;
            const members = path.node.members || [];
            const chineseMembers: string[] = [];
            members.forEach((m: any) => {
              if (m.initializer && m.initializer.type === 'StringLiteral' && isChinese(m.initializer.value)) {
                const keyName = m.id.type === 'Identifier' ? m.id.name : (m.id.type === 'StringLiteral' ? m.id.value : '');
                chineseMembers.push(`${keyName}:${m.initializer.value}`);
              }
            });
            if (chineseMembers.length) {
              results.push({
                name,
                type: 'object',
                value: chineseMembers,
                file: pathModuleRelative(filePath, projectRoot),
                line: path.node.loc?.start.line || 0,
              });
              logDebug(`enum captured: ${name}`);
            }
        },
        VariableDeclarator(path: NodePath<any>) {
          // 支持顶层 (含 export) const / let 声明；跳过 var 和非顶层
            const varDecl = path.parentPath?.node;
            if (!varDecl || varDecl.type !== 'VariableDeclaration') return;
            if (!['const','let'].includes(varDecl.kind)) return;
            // 确认顶层：沿父链直到 Program 或 ExportNamedDeclaration/ExportDefaultDeclaration
            let parentPath: any = path.parentPath?.parentPath;
            let isTopLevel = false;
            while (parentPath) {
              if (parentPath.isProgram && parentPath.isProgram()) { isTopLevel = true; break; }
              if (parentPath.node.type === 'ExportNamedDeclaration' || parentPath.node.type === 'ExportDefaultDeclaration') {
                // 再上层如果是 Program 也算顶层
                const maybeProgram = parentPath.parentPath;
                if (maybeProgram && maybeProgram.isProgram && maybeProgram.isProgram()) { isTopLevel = true; break; }
              }
              // 若遇到函数/类/块则中断
              if ([ 'FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ClassDeclaration','ClassExpression','BlockStatement'].includes(parentPath.node.type)) {
                break;
              }
              parentPath = parentPath.parentPath;
            }
            if (!isTopLevel) return;
            if (path.node.id.type !== 'Identifier') return;
            const name = path.node.id.name;
            const init = path.node.init;
            if (!init) return;
            const pushString = (value: string, nodeLoc: any) => {
              results.push({
                name,
                type: 'string',
                value,
                file: pathModuleRelative(filePath, projectRoot),
                line: nodeLoc?.start.line || 0,
              });
              logDebug(`string ${varDecl.kind} top-level: ${name}`);
            };
            if (init.type === 'StringLiteral' && isChinese(init.value)) {
              pushString(init.value, init.loc);
            } else if (init.type === 'ArrayExpression') {
              const elements = init.elements as any[];
              const chineseValues: string[] = [];
              elements.forEach(el => { if (el && el.type === 'StringLiteral' && isChinese(el.value)) chineseValues.push(el.value); });
              if (chineseValues.length) {
                results.push({ name, type: 'array', value: chineseValues, file: pathModuleRelative(filePath, projectRoot), line: init.loc?.start.line || 0 });
                logDebug(`array ${varDecl.kind} top-level: ${name}`);
              }
            } else if (init.type === 'CallExpression') {
              const firstArg = init.arguments && init.arguments[0];
              if (firstArg && firstArg.type === 'ArrayExpression') {
                const arr = firstArg.elements as any[];
                const chineseValues: string[] = [];
                arr.forEach(el => { if (el && el.type === 'StringLiteral' && isChinese(el.value)) chineseValues.push(el.value); });
                if (chineseValues.length) {
                  results.push({ name, type: 'array', value: chineseValues, file: pathModuleRelative(filePath, projectRoot), line: init.loc?.start.line || 0 });
                  logDebug(`call-wrapped array ${varDecl.kind}: ${name}`);
                }
              }
            } else if (init.type === 'ObjectExpression') {
              const props = init.properties as any[];
              const chinesePairs: string[] = [];
              props.forEach(p => { if (p && p.type === 'ObjectProperty') { const val = p.value; if (val && val.type === 'StringLiteral' && isChinese(val.value)) { let keyName=''; if (p.key.type==='Identifier') keyName=p.key.name; else if (p.key.type==='StringLiteral') keyName=p.key.value; else if (p.key.type==='NumericLiteral') keyName=String(p.key.value); chinesePairs.push(`${keyName}:${val.value}`); } } });
              if (chinesePairs.length) { results.push({ name, type: 'object', value: chinesePairs, file: pathModuleRelative(filePath, projectRoot), line: init.loc?.start.line || 0 }); logDebug(`object ${varDecl.kind} top-level: ${name}`); }
            }
        }
      });
    } catch (e: any) {
      console.warn(`[i18n-tools] 解析失败(静态常量跳过): ${filePath} ${e?.message || e}`);
    }
  }

  function pathModuleRelative(filePath: string, root: string) {
    return path.relative(root, filePath).replace(/\\/g,'/');
  }

  src.forEach((s: string) => walk(s, ignoreFiles, collect));

  if (!results.length) {
    console.log('[i18n-tools] 未发现含中文的全局静态常量 (可加 --debug 查看过程)');
    return;
  }

  // 输出
  if (out) {
  const header = 'name,type,value_count,value_preview,file,line\n';
    const lines = results.map(r => {
      const isCollection = r.type === 'array' || r.type === 'object';
      const val = r.type === 'string' ? (r.value as string) : (r.value as string[]).join('|');
      const count = isCollection ? (r.value as string[]).length : 1;
      return `${r.name},${r.type},${count},"${val.replace(/"/g,'""')}",${r.file},${r.line}`;
    });
    try {
      fs.writeFileSync(out, header + lines.join('\n'), 'utf8');
      console.log(`[i18n-tools] 已导出静态常量列表: ${out}`);
    } catch (e: any) {
      console.error(`[i18n-tools] 写入失败: ${out} ${e?.message || e}`);
    }
  } else {
    console.log('==== 静态中文常量检测结果 ====');
    results.forEach(r => {
      if (r.type === 'string') {
        console.log(`[string] ${r.name} = "${r.value}" @ ${r.file}:${r.line}`);
      } else if (r.type === 'array') {
        const preview = (r.value as string[]).slice(0,5).join('、');
        console.log(`[array] ${r.name} (${(r.value as string[]).length}) = ${preview}${(r.value as string[]).length>5?'...':''} @ ${r.file}:${r.line}`);
      } else if (r.type === 'object') {
        const preview = (r.value as string[]).slice(0,5).join('、');
        console.log(`[object] ${r.name} (${(r.value as string[]).length} 中文属性) = ${preview}${(r.value as string[]).length>5?'...':''} @ ${r.file}:${r.line}`);
      }
    });
    console.log('============================');
  }
}
