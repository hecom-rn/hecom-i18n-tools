#!/usr/bin/env node
/**
 * 测试：含 \n 转义序列的模板字符串替换
 *
 * 复现场景：用户 JSX 中有大量类似
 *   {accurate_success > 0 && `- 字段精确匹配${accurate_success}项；\n`}
 * 的模板字符串，scanner 写入 Excel 的 zh 列使用 cooked 值（真实换行符），
 * 而旧版 replacer.buildTemplateFullValue 使用 raw 值（字面 \n），两者不匹配
 * 导致替换全部跳过。
 *
 * 修复后 buildTemplateFullValue 改用 cooked ?? raw，与 scanner 保持一致。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const xlsx = require('xlsx');
const { replaceCommand } = require('../dist/replacer');

let passed = 0;
let failed = 0;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createExcel(filePath, rows) {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  xlsx.writeFile(wb, filePath);
}

// ─── 测试 1：含 \n 的简单模板字符串（无动态表达式） ─────────────────────────
async function testSimpleTemplateLiteralWithEscapedNewline() {
  const dir = tempDir('rpl-tpl-nl-simple-');
  const relFile = 'sample.jsx';
  const absFile = path.join(dir, relFile);

  // 源文件：模板字符串内含 \n 转义
  fs.writeFileSync(absFile, `
const msg = \`\\n操作完成\`;
`.trimStart(), 'utf8');

  const excelPath = path.join(dir, 'data.xlsx');
  // scanner 使用 cooked：\n → 真实换行字符
  createExcel(excelPath, [
    { file: relFile, zh: '\n操作完成', key: 'i18n_test_001' }
  ]);

  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    replaceCommand({ excel: excelPath, file: relFile, importPath: 'core/util/i18n' });
    const result = fs.readFileSync(absFile, 'utf8');
    assert.ok(/t\(["']i18n_test_001["']\)/.test(result), `替换失败，实际输出:\n${result}`);
    assert.ok(!result.includes('操作完成`'), `源字符串未被替换:\n${result}`);
  } finally {
    process.chdir(origCwd);
  }

  return 'testSimpleTemplateLiteralWithEscapedNewline passed';
}

// ─── 测试 2：含 \n 和动态表达式的模板字符串（复现用户真实场景） ──────────────
async function testTemplateLiteralWithExpressionAndNewline() {
  const dir = tempDir('rpl-tpl-nl-expr-');
  const relFile = 'MatchSummary.jsx';
  const absFile = path.join(dir, relFile);

  // 模拟用户代码片段
  const source = `
import React from 'react';
const MatchSummary = ({ accurate_success, history_success }) => (
  <Text>
    {accurate_success > 0 && \`- 字段精确匹配\${accurate_success}项；\\n\`}
    {history_success > 0 && \`- 历史数据匹配\${history_success}项；\\n\`}
  </Text>
);
export default MatchSummary;
`.trimStart();

  fs.writeFileSync(absFile, source, 'utf8');

  const excelPath = path.join(dir, 'data.xlsx');
  // scanner 用 cooked：\n → 真实换行；占位符为 {{Identifier1}}
  createExcel(excelPath, [
    { file: relFile, zh: '- 字段精确匹配{{Identifier1}}项；\n', key: 'i18n_rn_match_accurate' },
    { file: relFile, zh: '- 历史数据匹配{{Identifier1}}项；\n', key: 'i18n_rn_match_history' },
  ]);

  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    replaceCommand({ excel: excelPath, file: relFile, importPath: 'core/util/i18n' });
    const result = fs.readFileSync(absFile, 'utf8');

    assert.ok(
      /t\(["']i18n_rn_match_accurate["']/.test(result),
      `accurate 替换失败，实际输出:\n${result}`
    );
    assert.ok(
      /t\(["']i18n_rn_match_history["']/.test(result),
      `history 替换失败，实际输出:\n${result}`
    );
    // 动态参数应传入对象
    assert.ok(
      result.includes('accurate_success'),
      `accurate_success 变量未在 t() 调用中出现:\n${result}`
    );
    assert.ok(
      result.includes('history_success'),
      `history_success 变量未在 t() 调用中出现:\n${result}`
    );
    // 原始模板字符串中的中文应消失
    assert.ok(
      !result.includes('字段精确匹配'),
      `原中文字符串未被完全替换:\n${result}`
    );
    // import { t } from 应被注入（Babel 生成双引号，兼容两种引号）
    assert.ok(
      /import\s*\{\s*t\s*\}\s*from\s*['"]core\/util\/i18n['"]/.test(result),
      `import 语句未被注入:\n${result}`
    );
  } finally {
    process.chdir(origCwd);
  }

  return 'testTemplateLiteralWithExpressionAndNewline passed';
}

// ─── 测试 3：BoldText text prop 内含 \n 的模板字符串 ─────────────────────────
async function testBoldTextPropWithNewlineTemplate() {
  const dir = tempDir('rpl-tpl-nl-boldtext-');
  const relFile = 'BoldSection.jsx';
  const absFile = path.join(dir, relFile);

  const source = `
import React from 'react';
const BoldSection = ({ hasSuccess, totalSuccess }) => (
  <Text>
    {hasSuccess && <BoldText text={\`\\n匹配\${totalSuccess}项\\n\`} />}
  </Text>
);
export default BoldSection;
`.trimStart();

  fs.writeFileSync(absFile, source, 'utf8');

  const excelPath = path.join(dir, 'data.xlsx');
  // cooked 值：\n 为真实换行
  createExcel(excelPath, [
    { file: relFile, zh: '\n匹配{{Identifier1}}项\n', key: 'i18n_rn_match_total' },
  ]);

  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    replaceCommand({ excel: excelPath, file: relFile, importPath: 'core/util/i18n' });
    const result = fs.readFileSync(absFile, 'utf8');

    assert.ok(
      /t\(["']i18n_rn_match_total["']/.test(result),
      `BoldText text prop 替换失败，实际输出:\n${result}`
    );
    assert.ok(
      !result.includes('匹配'),
      `原中文字符串未被完全替换:\n${result}`
    );
  } finally {
    process.chdir(origCwd);
  }

  return 'testBoldTextPropWithNewlineTemplate passed';
}

// ─── 测试 4：无 \n 的普通模板字符串（回归：不应受影响） ──────────────────────
async function testPlainTemplateLiteralUnaffected() {
  const dir = tempDir('rpl-tpl-plain-');
  const relFile = 'plain.jsx';
  const absFile = path.join(dir, relFile);

  fs.writeFileSync(absFile, `
const a = \`匹配成功\`;
`.trimStart(), 'utf8');

  const excelPath = path.join(dir, 'data.xlsx');
  createExcel(excelPath, [
    { file: relFile, zh: '匹配成功', key: 'i18n_plain_001' }
  ]);

  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    replaceCommand({ excel: excelPath, file: relFile, importPath: 'core/util/i18n' });
    const result = fs.readFileSync(absFile, 'utf8');
    assert.ok(/t\(["']i18n_plain_001["']\)/.test(result), `普通模板字符串替换失败:\n${result}`);
  } finally {
    process.chdir(origCwd);
  }

  return 'testPlainTemplateLiteralUnaffected passed';
}

// ─── 运行所有测试 ─────────────────────────────────────────────────────────────
(async () => {
  const tests = [
    testSimpleTemplateLiteralWithEscapedNewline,
    testTemplateLiteralWithExpressionAndNewline,
    testBoldTextPropWithNewlineTemplate,
    testPlainTemplateLiteralUnaffected,
  ];

  for (const t of tests) {
    try {
      const msg = await t();
      console.log(`✔ ${msg}`);
      passed++;
    } catch (err) {
      failed++;
      console.error(`✖ ${t.name} failed:`, err.message || err);
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
