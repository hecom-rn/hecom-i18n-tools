#!/usr/bin/env node
import { Command } from 'commander';
import { scanCommand } from './scanner';
import { replaceCommand } from './replacer';
import { genCommand } from './i18nGenerator';
import { syncCommand } from './syncTranslations';
import { scanStaticConstsCommand } from './staticConstsScanner';

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
  .option('-l, --fixLint <fixLint>', '是否修复lint')
  .action(replaceCommand);

program
  .command('gen')
  .description('通过Excel生成语言包')
  .requiredOption('-e, --excel <excel>', 'Excel文件路径')
  .requiredOption('-o, --out <out>', '输出目录')
  .action(genCommand);

program
  .command('sync')
  .description('同步翻译数据，处理代码重构后的行号对应问题')
  .requiredOption('-e, --excel <excel>', '主Excel翻译文件路径')
  .option('-s, --src <src>', '源代码目录', 'src')
  .option('-o, --output <output>', '输出同步后的Excel文件路径（默认覆盖原文件）')
  .option('-r, --report <report>', '生成同步报告文件', 'sync-report.md')
  .action((opts) => {
    // 处理src参数，支持逗号分隔
    if (typeof opts.src === 'string' && opts.src.includes(',')) {
      opts.src = opts.src.split(',').map((s: string) => s.trim()).filter(Boolean);
    } else if (typeof opts.src === 'string') {
      opts.src = [opts.src];
    }
    syncCommand(opts);
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
