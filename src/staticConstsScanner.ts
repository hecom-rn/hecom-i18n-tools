import fs from 'fs';
import path from 'path';
import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';

interface ConstItem {
  name: string;
  type: 'string' | 'array';
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
  let { src, out, config } = opts;
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

  function collect(filePath: string) {
    const code = fs.readFileSync(filePath, 'utf8');
    // 快速过滤：没有中文直接跳过
    if (!/[\u4e00-\u9fa5]/.test(code)) return;
    try {
      const ast = babelParser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx','typescript','decorators-legacy','classProperties','classPrivateProperties','classPrivateMethods','dynamicImport','optionalChaining','nullishCoalescingOperator','objectRestSpread'],
      });
      traverse(ast as any, {
        VariableDeclarator(path: NodePath<any>) {
          // 只处理 const 声明
            const decl = path.parentPath?.parent;
            if (!decl || decl.type !== 'VariableDeclaration' || decl.kind !== 'const') return;
            if (path.node.id.type !== 'Identifier') return;
            const name = path.node.id.name;
            const init = path.node.init;
            if (!init) return;
            // 忽略函数、调用、对象等
            if (init.type === 'StringLiteral' && /[\u4e00-\u9fa5]/.test(init.value)) {
              results.push({
                name,
                type: 'string',
                value: init.value,
                file: pathModuleRelative(filePath, projectRoot),
                line: init.loc?.start.line || 0,
              });
            } else if (init.type === 'ArrayExpression') {
              const elements = init.elements;
              if (elements.length && elements.every((el: any) => el && el.type === 'StringLiteral' && /[\u4e00-\u9fa5]/.test(el.value))) {
                const arrValues = elements.map((el: any) => el.value);
                results.push({
                  name,
                  type: 'array',
                  value: arrValues,
                  file: pathModuleRelative(filePath, projectRoot),
                  line: init.loc?.start.line || 0,
                });
              }
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
    console.log('[i18n-tools] 未发现含中文的全局静态常量');
    return;
  }

  // 输出
  if (out) {
    const header = 'name,type,value_count,value_preview,file,line\n';
    const lines = results.map(r => {
      const val = r.type === 'string' ? (r.value as string) : (r.value as string[]).join('|');
      return `${r.name},${r.type},${r.type === 'array' ? (r.value as string[]).length : 1},"${val.replace(/"/g,'""')}",${r.file},${r.line}`;
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
      } else {
        const preview = (r.value as string[]).slice(0,5).join('、');
        console.log(`[array] ${r.name} (${(r.value as string[]).length}) = ${preview}${(r.value as string[]).length>5?'...':''} @ ${r.file}:${r.line}`);
      }
    });
    console.log('============================');
  }
}
