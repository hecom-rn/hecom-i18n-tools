#!/usr/bin/env node
/* Minimal test harness for genCommand conflict behavior */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const xlsx = require('xlsx');
const { genCommand } = require('../dist/i18nGenerator');

let passed = 0;
let failed = 0;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createExcel(filePath, sheets) {
  const wb = xlsx.utils.book_new();
  Object.entries(sheets).forEach(([sheetName, rows]) => {
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
  });
  xlsx.writeFile(wb, filePath);
}

async function testNoConflict() {
  const dir = tempDir('i18n-no-conf-');
  const excel = path.join(dir, 'data.xlsx');
  const outDir = path.join(dir, 'out');
  createExcel(excel, {
    Sheet1: [
      { key: 'hello', en: 'Hello', zh: '你好' },
      { key: 'bye', en: 'Bye', zh: '再见' }
    ]
  });
  genCommand({ excel, out: outDir });
  const enJson = JSON.parse(fs.readFileSync(path.join(outDir, 'en.json'), 'utf8'));
  assert.strictEqual(enJson.hello, 'Hello');
  assert.strictEqual(enJson.bye, 'Bye');
  return 'testNoConflict passed';
}

async function testConflictAbort() {
  const dir = tempDir('i18n-conf-');
  const excel = path.join(dir, 'data.xlsx');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir);
  // 先写一个已有的 en.json
  fs.writeFileSync(path.join(outDir, 'en.json'), JSON.stringify({ hello: 'OldHello' }, null, 2));
  createExcel(excel, {
    Sheet1: [ { key: 'hello', en: 'NewHello' } ]
  });
  let threw = false;
  try {
    genCommand({ excel, out: outDir });
  } catch (e) {
    threw = true;
    // 确认没有被覆盖
    const enJson = JSON.parse(fs.readFileSync(path.join(outDir, 'en.json'), 'utf8'));
    assert.strictEqual(enJson.hello, 'OldHello');
    // 确认有冲突报告
    const reports = fs.readdirSync(outDir).filter(f => f.startsWith('conflicts-') && f.endsWith('.json'));
    assert.ok(reports.length === 1, '冲突报告未生成');
    // Excel 仍存在
    assert.ok(fs.existsSync(excel), 'Excel 不应被删除');
  }
  assert.ok(threw, '应当抛出冲突错误');
  return 'testConflictAbort passed';
}

(async () => {
  const tests = [testNoConflict, testConflictAbort];
  for (const t of tests) {
    try {
      const msg = await t();
      console.log(`✔ ${msg}`);
      passed++;
    } catch (err) {
      failed++;
      console.error(`✖ ${t.name} failed:`, err);
    }
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
