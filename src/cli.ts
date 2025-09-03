#!/usr/bin/env node
import { Command } from 'commander';
import { scanCommand } from './scanner';
import { replaceCommand } from './replacer';
import { genCommand } from './i18nGenerator';

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
  .action((opts) => {
    // 支持 --src=../../a,../../b 逗号分隔
    if (typeof opts.src === 'string' && opts.src.includes(',')) {
      opts.src = opts.src.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    scanCommand(opts);
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

program.parse(process.argv);
