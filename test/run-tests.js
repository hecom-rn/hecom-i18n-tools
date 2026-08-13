#!/usr/bin/env node
/* Minimal test harness for genCommand conflict behavior */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const xlsx = require('xlsx');
const { genCommand } = require('../dist/i18nGenerator');
const { extractStringsFromFile, scanCommand } = require('../dist/scanner');

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
  const conflictFile = path.join(outDir, 'conflicts.json');
  assert.ok(fs.existsSync(conflictFile), '固定文件名 conflicts.json 未生成');
    // Excel 仍存在
    assert.ok(fs.existsSync(excel), 'Excel 不应被删除');
  }
  assert.ok(threw, '应当抛出冲突错误');
  return 'testConflictAbort passed';
}

async function testTemplateLiteralNewline() {
  const dir = tempDir('i18n-tpl-nl-');
  const file = path.join(dir, 'sample.js');
  const content = "const errMsg = '错误';\nconst tip = `${errMsg}\n请填写指导意见`;";
  fs.writeFileSync(file, content, 'utf8');
  const results = extractStringsFromFile(file);
  // 找到模板字符串结果：包含“请填写指导意见”且含占位符 Identifier
  const tpl = results.find(r => /请填写指导意见/.test(r.value) && /Identifier/.test(r.value));
  assert.ok(tpl, '未找到模板字符串扫描结果');
  // 真实换行字符存在（包含换行而不是字面 \\n 序列）
  assert.ok(tpl.value.includes('\n请填写指导意见'), '未检测到换行+中文部分');
  const hasEscaped = /\\n请填写指导意见/.test(tpl.value); // 匹配字面转义序列
  assert.ok(!hasEscaped, '模板字符串中的换行被错误转义成 \\n');
  const parts = tpl.value.split('\n');
  assert.ok(parts.length >= 2 && /请填写指导意见/.test(parts[1]), '拆分后未发现中文部分在换行后');
  return 'testTemplateLiteralNewline passed';
}

async function testTemplateLiteralMultipleExpressions() {
  const dir = tempDir('i18n-tpl-multi-');
  const file = path.join(dir, 'sample.js');
  const content = "const a='甲'; const b='乙'; const msg = `${a}和${b}\n完成操作`;";
  fs.writeFileSync(file, content, 'utf8');
  const results = extractStringsFromFile(file);
  const rec = results.find(r => /完成操作/.test(r.value));
  assert.ok(rec, '未找到多表达式模板扫描结果');
  assert.ok(/{{Identifier1}}和{{Identifier2}}\n完成操作/.test(rec.value), '占位符及换行格式不符合预期:' + rec.value);
  assert.ok(!/\\n完成操作/.test(rec.value), '出现了转义的 \\n');
  return 'testTemplateLiteralMultipleExpressions passed';
}

async function testTemplateLiteralMultiLineChinese() {
  const dir = tempDir('i18n-tpl-mlc-');
  const file = path.join(dir, 'sample.js');
  const content = "const tip = `\n\n第一行提示\n第二行确认\n第三行完成`;"; // 前导两个空行
  fs.writeFileSync(file, content, 'utf8');
  const results = extractStringsFromFile(file);
  const rec = results.find(r => /第二行确认/.test(r.value));
  assert.ok(rec, '未找到多行中文模板扫描结果');
  // 应保持原始换行（至少包含 第二行确认 之前的换行）
  const lines = rec.value.split('\n');
  assert.ok(lines.includes('第二行确认'), '分割后未找到“第二行确认”行');
  assert.ok(!/\\n第二行确认/.test(rec.value), '存在错误转义的换行');
  return 'testTemplateLiteralMultiLineChinese passed';
}

async function testTemplateLiteralCRLFNewline() {
  const dir = tempDir('i18n-tpl-crlf-');
  const file = path.join(dir, 'sample.js');
  // 使用 CRLF 换行写入文件内容
  const content = 'const tip = `第一行提示\r\n第二行指导`;';
  fs.writeFileSync(file, content, 'utf8');
  const results = extractStringsFromFile(file);
  const rec = results.find(r => /第二行指导/.test(r.value));
  assert.ok(rec, '未找到 CRLF 模板扫描结果');
  // 逻辑上应规范成单个 \n 分隔（Node 解析模板内部会保留实际换行，scanner 输出使用 cooked 已是标准换行）
  assert.ok(/第一行提示\n第二行指导/.test(rec.value), 'CRLF 未被规范成单换行');
  assert.ok(!/\\n第二行指导/.test(rec.value), '出现转义换行');
  return 'testTemplateLiteralCRLFNewline passed';
}

async function testScanDefaultLanguages() {
  const dir = tempDir('i18n-scan-default-');
  const srcFile = path.join(dir, 'sample.js');
  fs.writeFileSync(srcFile, "const msg = '你好世界';\n", 'utf8');
  const out = path.join(dir, 'result.xlsx');
  await scanCommand({ src: srcFile, out });
  const wb = xlsx.readFile(out);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  assert.strictEqual(rows.length, 1, '应扫描到一行');
  const cols = Object.keys(rows[0]).sort();
  assert.deepStrictEqual(
    cols,
    ['en', 'es', 'file', 'gitlab', 'key', 'line', 'pt', 'th', 'zh'].sort(),
    '默认列应为 zh/en/es/pt/th + file/line/key/gitlab'
  );
  assert.strictEqual(rows[0].zh, '你好世界');
  return 'testScanDefaultLanguages passed';
}

async function testScanCustomLanguages() {
  const dir = tempDir('i18n-scan-custom-');
  const srcFile = path.join(dir, 'sample.js');
  fs.writeFileSync(srcFile, "const a = '早上好'; const b = '下午好';\n", 'utf8');
  const out = path.join(dir, 'result.xlsx');
  const configPath = path.join(dir, 'cfg.js');
  globalThis.__scanCustomCalls = [];
  fs.writeFileSync(
    configPath,
    "module.exports = {\n" +
      "  languages: ['en', 'ja'],\n" +
      "  translate: async (text, lang) => { globalThis.__scanCustomCalls.push({ text, lang }); return lang === 'ja' ? text + '-ja' : text + '-en'; }\n" +
      "};\n"
  );
  await scanCommand({ src: srcFile, out, config: configPath });
  const wb = xlsx.readFile(out);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  assert.strictEqual(rows.length, 2, '应扫描到两行');
  const cols = Object.keys(rows[0]).sort();
  assert.deepStrictEqual(
    cols,
    ['en', 'file', 'gitlab', 'ja', 'key', 'line', 'zh'].sort(),
    '应仅包含 en/ja 两个翻译列'
  );
  const rowA = rows.find(r => r.zh === '早上好');
  assert.ok(rowA, '缺少早上好行');
  assert.strictEqual(rowA.en, '早上好-en');
  assert.strictEqual(rowA.ja, '早上好-ja');
  assert.strictEqual(globalThis.__scanCustomCalls.length, 4, '每行 × 每语言应共 4 次 translate 调用');
  assert.ok(globalThis.__scanCustomCalls.every(c => c.lang === 'en' || c.lang === 'ja'), 'lang 应为 en/ja');
  delete globalThis.__scanCustomCalls;
  return 'testScanCustomLanguages passed';
}

async function testScanNoTranslateFunction() {
  const dir = tempDir('i18n-scan-no-translate-');
  const srcFile = path.join(dir, 'sample.js');
  fs.writeFileSync(srcFile, "const greeting = '欢迎';\n", 'utf8');
  const out = path.join(dir, 'result.xlsx');
  const configPath = path.join(dir, 'cfg.js');
  fs.writeFileSync(
    configPath,
    "module.exports = { languages: ['en', 'th'] };\n"
  );
  await scanCommand({ src: srcFile, out, config: configPath });
  const wb = xlsx.readFile(out);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].zh, '欢迎');
  assert.strictEqual(rows[0].en, '', '无 translate 时 en 列应为空');
  assert.strictEqual(rows[0].th, '', '无 translate 时 th 列应为空');
  const cols = Object.keys(rows[0]).sort();
  assert.deepStrictEqual(
    cols,
    ['en', 'file', 'gitlab', 'key', 'line', 'th', 'zh'].sort()
  );
  return 'testScanNoTranslateFunction passed';
}

(async () => {
  const tests = [
    testNoConflict,
    testConflictAbort,
    testTemplateLiteralNewline,
    testTemplateLiteralMultipleExpressions,
    testTemplateLiteralMultiLineChinese,
    testTemplateLiteralCRLFNewline,
    testScanDefaultLanguages,
    testScanCustomLanguages,
    testScanNoTranslateFunction
  ];
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
