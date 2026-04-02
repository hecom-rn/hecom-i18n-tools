#!/usr/bin/env node
import { Command } from 'commander';
import { scanCommand } from './scanner';
import { replaceCommand } from './replacer';
import { genCommand } from './i18nGenerator';
import { scanStaticConstsCommand } from './staticConstsScanner';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/** 调用 Python translate_cli.py 的辅助函数 */
function runPythonTranslate(opts: {
  excel: string;
  out: string;
  apiKey: string;
  keys?: string;
  langs?: string;
  python?: string;
  prompt?: string;
  promptFile?: string;
}) {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'translate_cli.py');
  if (!fs.existsSync(scriptPath)) {
    console.error(`[translate] 找不到翻译脚本: ${scriptPath}`);
    process.exit(1);
  }
  const args: string[] = [
    scriptPath,
    '--excel', opts.excel,
    '--out',   opts.out,
    '--api-key', opts.apiKey,
  ];
  if (opts.keys)       args.push('--keys',        opts.keys);
  if (opts.langs)      args.push('--langs',        opts.langs);
  if (opts.prompt)     args.push('--prompt',       opts.prompt);
  if (opts.promptFile) args.push('--prompt-file',  opts.promptFile);

  const python = opts.python || 'python3';
  const result = spawnSync(python, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`[translate] 启动 Python 失败: ${result.error.message}`);
    console.error('请确保已安装 Python3 及依赖: pip install pandas openpyxl dashscope');
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const program = new Command();
program
  .name('hecom-i18n-tools')
  .description('RN/JS/TS 多项目国际化扫描与Excel导出/导入工具')
  .version('0.1.0');

program
  .command('scan')
  .description('扫描代码，导出静态字符串到Excel')
  .requiredOption('-s, --src <src>', '源代码目录')
  .requiredOption('-o, --out <out>', '输出Excel路径')
  .option('-g, --gitlab <gitlab>', 'GitLab仓库URL前缀')
  .option('-c, --config <config>', '配置文件路径')
  .action(async (opts) => {
    // 支持 --src=../../a,../../b 逗号分隔
    if (typeof opts.src === 'string' && opts.src.includes(',')) {
      opts.src = opts.src.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    await scanCommand(opts);
  });


program
  .command('replace')
  .description('通过Excel回写代码，替换为i18n方法')
  .requiredOption('-e, --excel <excel>', 'Excel文件路径')
  .requiredOption('-i, --importPath <importPath>', 'importPath')
  .option('-f, --file <file>', '仅处理指定文件')
  .option('-l, --fixLint <fixLint>', '是否在回写后运行 Prettier 进行格式化')
  .option('-p, --prettier-config <prettierConfig>', '指定 .prettierrc.js 配置文件路径（可选）')
  .action(replaceCommand);

program
  .command('gen')
  .description('通过Excel生成语言包')
  .requiredOption('-e, --excel <excel>', 'Excel文件路径')
  .requiredOption('-o, --out <out>', '输出目录')
  .option('-m, --master <master>', '主Excel文件路径（可选，合并后删除当前Excel）')
  .option('-r, --conflict-report <conflictReport>', '冲突报告输出路径（默认: <out>/conflicts.json）')
  .option('-c, --config <config>', '配置文件路径（可包含 email 配置）')
  .action(genCommand);

program
  .command('translate')
  .description('使用 AI（DashScope Qwen）批量翻译 Excel 中空白的翻译列')
  .requiredOption('-e, --excel <excel>', '输入 Excel 文件路径')
  .requiredOption('-o, --out <out>', '输出 Excel 文件路径（可与输入相同，原地覆盖）')
  .requiredOption('-k, --api-key <apiKey>', 'DashScope API Key')
  .option('--keys <keys>', '仅翻译指定 key（逗号分隔）')
  .option('--langs <langs>', '仅翻译指定语言列（逗号分隔，如 en,th）')
  .option('--python <python>', 'Python 可执行路径（默认: python3）')
  .option('--prompt <prompt>', '自定义 Prompt 模板（需含 {text} 和 {target_lang}）')
  .option('--prompt-file <promptFile>', 'Prompt 模板文件路径')
  .action((opts) => {
    runPythonTranslate({
      excel:      opts.excel,
      out:        opts.out,
      apiKey:     opts.apiKey,
      keys:       opts.keys,
      langs:      opts.langs,
      python:     opts.python,
      prompt:     opts.prompt,
      promptFile: opts.promptFile,
    });
  });

program
  .command('flow')
  .description('一键流程：扫描 → AI翻译 → 生成语言包')
  .requiredOption('-s, --src <src>', '源代码目录，支持逗号分隔')
  .requiredOption('-e, --excel <excel>', '中间 Excel 文件路径')
  .requiredOption('-o, --out <out>', '语言包输出目录')
  .option('-g, --gitlab <gitlab>', 'GitLab 仓库 URL 前缀')
  .option('-c, --config <config>', '配置文件路径（含 email 等配置）')
  .option('-m, --master <master>', '主 Excel 文件路径（可选）')
  .option('-k, --api-key <apiKey>', 'DashScope API Key（不填则跳过翻译步骤）')
  .option('--langs <langs>', '翻译时仅处理指定语言列（逗号分隔）')
  .option('--python <python>', 'Python 可执行路径（默认: python3）')
  .option('--prompt-file <promptFile>', 'Prompt 模板文件路径')
  .option('-r, --conflict-report <conflictReport>', '冲突报告输出路径')
  .action(async (opts) => {
    // 支持逗号分隔 src
    if (typeof opts.src === 'string' && opts.src.includes(',')) {
      opts.src = opts.src.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    console.log('\n========== [1/3] 扫描中文文本 ==========');
    await scanCommand({
      src:    opts.src,
      out:    opts.excel,
      gitlab: opts.gitlab,
      config: opts.config,
    });

    if (opts.apiKey) {
      console.log('\n========== [2/3] AI 翻译空白列 ==========');
      runPythonTranslate({
        excel:      opts.excel,
        out:        opts.excel,   // 原地覆盖
        apiKey:     opts.apiKey,
        langs:      opts.langs,
        python:     opts.python,
        promptFile: opts.promptFile,
      });
    } else {
      console.log('\n[2/3] 未提供 --api-key，跳过翻译步骤。');
    }

    console.log('\n========== [3/3] 生成语言包 ==========');
    await genCommand({
      excel:          opts.excel,
      out:            opts.out,
      master:         opts.master,
      conflictReport: opts.conflictReport,
      config:         opts.config,
    });

    console.log('\n✅ 一键流程完成！');
  });

program
  .command('static-consts')
  .description('扫描含中文的全局 const 静态字符串或纯中文字符串数组')
  .requiredOption('-s, --src <src>', '源代码目录或文件，支持逗号分隔')
  .option('-o, --out <out>', '输出 CSV 文件路径（不填则打印到控制台）')
  .option('-c, --config <config>', '配置文件（复用 ignoreFiles）')
  .action((opts) => {
    if (typeof opts.src === 'string' && opts.src.includes(',')) {
      opts.src = opts.src.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    scanStaticConstsCommand(opts);
  });

program.parse(process.argv);
