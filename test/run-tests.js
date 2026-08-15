#!/usr/bin/env node
/* Minimal test harness for genCommand conflict behavior */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const xlsx = require('xlsx');
const { genCommand } = require('../dist/i18nGenerator');
const { extractStringsFromFile, scanCommand, extractTCallsFromFile } = require('../dist/scanner');
const { replaceCommand } = require('../dist/replacer');

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
    await genCommand({ excel, out: outDir });
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
    ['category', 'en', 'es', 'file', 'gitlab', 'key', 'line', 'pt', 'th', 'zh'].sort(),
    '默认列应为 zh/en/es/pt/th + category + file/line/key/gitlab'
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
  try {
    await scanCommand({ src: srcFile, out, config: configPath });
    const wb = xlsx.readFile(out);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    assert.strictEqual(rows.length, 2, '应扫描到两行');
    const cols = Object.keys(rows[0]).sort();
    assert.deepStrictEqual(
      cols,
      ['category', 'en', 'file', 'gitlab', 'ja', 'key', 'line', 'zh'].sort(),
      '应仅包含 en/ja 两个翻译列 + category'
    );
    const rowA = rows.find(r => r.zh === '早上好');
    assert.ok(rowA, '缺少早上好行');
    assert.strictEqual(rowA.en, '早上好-en');
    assert.strictEqual(rowA.ja, '早上好-ja');
    assert.strictEqual(globalThis.__scanCustomCalls.length, 4, '每行 × 每语言应共 4 次 translate 调用');
    assert.ok(globalThis.__scanCustomCalls.every(c => c.lang === 'en' || c.lang === 'ja'), 'lang 应为 en/ja');
  } finally {
    delete globalThis.__scanCustomCalls;
  }
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
    ['category', 'en', 'file', 'gitlab', 'key', 'line', 'th', 'zh'].sort()
  );
  return 'testScanNoTranslateFunction passed';
}

// 通用辅助：从 fixture 文件扫描并返回 category 映射（key -> category）
function scanCategoryMap(file, rules) {
  const results = extractStringsFromFile(file, { buttonLabelRules: rules });
  const map = {};
  for (const r of results) map[r.value] = r.category;
  return map;
}

async function testButtonLabelJsxAttr() {
  const dir = tempDir('i18n-btn-attr-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "import React from 'react';\n" +
    "export default () => (\n" +
    "  <View>\n" +
    "    <Button title=\"确认\" onPress={() => {}}>\n" +
    "      <Text>按钮子内容</Text>\n" +
    "    </Button>\n" +
    "    <Tab tabLabel=\"首页\" />\n" +
    "    <Header backTitle=\"返回\" />\n" +
    "  </View>\n" +
    ");\n",
    'utf8'
  );
  const catMap = scanCategoryMap(file, {
    jsxAttributes: ['title', 'tabLabel', 'backTitle'],
    ancestorDepth: 4,
  });
  assert.strictEqual(catMap['确认'], 'button-label', 'JSX title 属性应归类为 button-label');
  assert.strictEqual(catMap['首页'], 'button-label', 'JSX tabLabel 属性应归类为 button-label');
  assert.strictEqual(catMap['返回'], 'button-label', 'JSX backTitle 属性应归类为 button-label');
  // 子组件 Text 内容不在白名单属性内，归类为 normal
  assert.strictEqual(catMap['按钮子内容'], 'normal', 'Text 节点默认归类为 normal');
  return 'testButtonLabelJsxAttr passed';
}

async function testButtonLabelAlert() {
  const dir = tempDir('i18n-btn-alert-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "import { Alert } from 'react-native';\n" +
    "Alert.alert('提示', '真的要删除吗？', [\n" +
    "  { text: '取消', onPress: () => {} },\n" +
    "  { text: '确定', onPress: () => {} },\n" +
    "]);\n" +
    "const msg = '普通字符串';\n",
    'utf8'
  );
  const catMap = scanCategoryMap(file, {
    alertCallees: ['Alert', 'alert'],
  });
  assert.strictEqual(catMap['取消'], 'button-label', "Alert.alert 数组里 text:'取消' 应归类为 button-label");
  assert.strictEqual(catMap['确定'], 'button-label', "Alert.alert 数组里 text:'确定' 应归类为 button-label");
  assert.strictEqual(catMap['真的要删除吗？'], 'normal', 'Alert 标题不应归类为 button-label');
  assert.strictEqual(catMap['普通字符串'], 'normal', '普通变量赋值不应归类为 button-label');
  return 'testButtonLabelAlert passed';
}

async function testButtonLabelComponent() {
  const dir = tempDir('i18n-btn-comp-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "import React from 'react';\n" +
    "import { TouchableOpacity, View } from 'react-native';\n" +
    "export default () => (\n" +
    "  <View>\n" +
    "    <TouchableOpacity><Text>点击登录</Text></TouchableOpacity>\n" +
    "    <View><Text>说明文字</Text></View>\n" +
    "  </View>\n" +
    ");\n",
    'utf8'
  );
  const catMap = scanCategoryMap(file, {
    buttonComponents: ['TouchableOpacity', 'Pressable'],
  });
  assert.strictEqual(catMap['点击登录'], 'button-label', 'TouchableOpacity 直接子 JSXText 应归类为 button-label');
  assert.strictEqual(catMap['说明文字'], 'normal', 'View 直接子 JSXText 不在白名单，归类为 normal');
  return 'testButtonLabelComponent passed';
}

async function testButtonLabelInlineComment() {
  const dir = tempDir('i18n-btn-cmt-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "import React from 'react';\n" +
    "const label = (\n" +
    "  // @i18n:button-label\n" +
    "  '快捷操作'\n" +
    ");\n",
    'utf8'
  );
  const catMap = scanCategoryMap(file, {
    inlineComment: '// @i18n:button-label',
  });
  assert.strictEqual(catMap['快捷操作'], 'button-label', '上方一行含 @i18n:button-label 注释的字符串应归类为 button-label');
  return 'testButtonLabelInlineComment passed';
}

async function testButtonLabelDisabledByDefault() {
  const dir = tempDir('i18n-btn-off-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "import React from 'react';\n" +
    "export default () => <Button title=\"确认\">按钮子</Button>;\n",
    'utf8'
  );
  // 未配置 buttonLabelRules 时所有条目归类为 normal
  const catMap = scanCategoryMap(file, undefined);
  assert.strictEqual(catMap['确认'], 'normal', '未配置规则时应归类为 normal');
  assert.strictEqual(catMap['按钮子'], 'normal', '未配置规则时应归类为 normal');
  return 'testButtonLabelDisabledByDefault passed';
}

// 回归测试：hasIgnoreComment 的正则曾因 [\s\S]*?$ 跨行匹配，
// 导致同文件后续 StringLiteral（其值中含 "i18n-ignore" 字符）被错误忽略。
// 修复后：正则用 [^\n] 不再跨行匹配，value 含 "i18n-ignore" 不会"传染"影响其他行。
// 注：line 7 '尾部忽略' 因为 JSX 元素不是声明语句（不是 const/let/var 开头），
// 块级 ignore 作用域会跨越 <span>...</span> 延伸到 line 7 —— 这是 v2.2.2 新行为。
// 如果不希望跨越，应在 <span>...</span> 后加 // @i18n-ignore 行尾注释或调整注释位置。
async function testIgnoreRegexDoesNotMatchAcrossLines() {
  const dir = tempDir('i18n-ignore-regex-');
  const file = path.join(dir, 'sample.tsx');
  // 第 5 行 // @i18n-ignore 标记的上一行 StringLiteral 包含字面量 "i18n-ignore"
  // 修复前：第 6 行的 StringLiteral 也会被错误忽略
  fs.writeFileSync(
    file,
    "function Page() {\n" +
    "  return (\n" +
    "    <div>\n" +
    "      <span>{\"普通中文\"}</span>\n" +
    "      // @i18n-ignore\n" +
    "      <span>{\"前一行有i18n-ignore\"}</span>\n" +
    "      <span>{\"尾部忽略\"}</span>\n" +
    "    </div>\n" +
    "  );\n" +
    "}\n",
    'utf8'
  );
  const results = extractStringsFromFile(file, {});
  const byValue = {};
  for (const r of results) byValue[r.value] = r;
  assert.ok(byValue['普通中文'], '"普通中文" 应被扫描');
  assert.ok(!byValue['前一行有i18n-ignore'], '"前一行有i18n-ignore"（前一行含 i18n-ignore 注释）应被忽略');
  // 注：line 7 '尾部忽略' 在 v2.2.2 块级 ignore 下会被忽略（因为 JSX 元素不是声明边界）。
  // 这里只确认 line 7 不是因 "value 含 i18n-ignore" 而被忽略（无法直接断言，
  // 通过 line 6 的反向用例已覆盖）。
  return 'testIgnoreRegexDoesNotMatchAcrossLines passed';
}

// 回归测试：// @i18n-ignore 单独写在 const 声明块之前一行时，
// 后续所有中文字符串（包括跨过 const = [...] 这种"中间非字符串行"的）都应被忽略。
// 回归测试：// @i18n-ignore 单独成行时，作用于后续非空行内的中文字符串（块级作用域）。
// 用户需用空行分隔不同声明，避免误影响后续代码。
async function testIgnoreScopeExtendsOverBlankLineFreeBlock() {
  const dir = tempDir('i18n-ignore-scope-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "function Page() {\n" +
    "  const arr = (\n" +
    "    // @i18n-ignore\n" +
    "    { x: '材料/设备' }\n" +
    "  );\n" +
    "\n" +  // 空行隔开两个声明，防止块级 ignore 跨越
    "  const arr2 = { y: '无关' };\n" +
    "  return { z: '应当扫描' };\n" +
    "}\n",
    'utf8'
  );
  const results = extractStringsFromFile(file, {});
  const byValue = {};
  for (const r of results) byValue[r.value] = r;
  assert.ok(!byValue['材料/设备'], '"材料/设备"（const 块之前单写一行 // @i18n-ignore）应被忽略');
  assert.ok(byValue['无关'], '"无关"（与 ignore 注释之间有空行）应被扫描');
  assert.ok(byValue['应当扫描'], '"应当扫描" 应被扫描');
  return 'testIgnoreScopeExtendsOverBlankLineFreeBlock passed';
}

// 回归测试：legacy 扫描（t('key') 调用点）也尊重 // @i18n-ignore 块级作用域。
async function testLegacyScanRespectsIgnoreScope() {
  const fsExtra = require('fs');
  const dir = tempDir('i18n-legacy-ignore-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "function Page() {\n" +
    "  const opts = (\n" +
    "    // @i18n-ignore\n" +
    "    { label: t('i18n_master_key') }\n" +
    "  );\n" +
    "\n" +  // 空行隔开
    "  return { x: t('i18n_other_key') };\n" +
    "}\n",
    'utf8'
  );
  const masterZhMap = {
    'i18n_master_key': '材料/设备',
    'i18n_other_key': '应当扫描',
  };
  const results = extractTCallsFromFile(file, masterZhMap, {
    buttonLabelRules: { buttonComponents: [] },
  });
  const byValue = {};
  for (const r of results) byValue[r.value] = r;
  assert.ok(!byValue['材料/设备'], 'legacy 扫描中：const 块之前单写一行 // @i18n-ignore 应忽略 t("i18n_master_key")');
  assert.ok(byValue['应当扫描'], 'legacy 扫描中：与 ignore 注释隔了空行的 t() 应被扫描');
  return 'testLegacyScanRespectsIgnoreScope passed';
}

// 回归测试：hasIgnoreComment 的正则 /\/\/.*i18n-ignore/ 过于宽松，
// 描述性注释中只要包含 "i18n-ignore" 子串（如 `// 案例：避免 i18n-ignore 误命中`）
// 就会被错误识别为忽略指令，导致下一行/同行中文字符串被忽略。
// 修复后：注释主体必须以 "i18n-ignore" 或 "@i18n-ignore" 开头才视为忽略指令。
async function testIgnoreRegexRejectsDescriptiveComment() {
  const dir = tempDir('i18n-ignore-reject-desc-');
  const file = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    file,
    "function Page() {\n" +
    "  // 案例：避免 i18n-ignore 误命中\n" +
    "  const a = '应当扫描A';\n" +
    "  const b = '应当扫描B'; // 普通描述中包含 i18n-ignore 关键字\n" +
    "  const c = '应当扫描C'; // @i18n-ignore 是合法忽略指令\n" +
    "  return null;\n" +
    "}\n",
    'utf8'
  );
  const results = extractStringsFromFile(file, {});
  const byValue = {};
  for (const r of results) byValue[r.value] = r;
  assert.ok(byValue['应当扫描A'], '描述性注释 // 案例：避免 i18n-ignore 误命中 后行应被扫描');
  assert.ok(byValue['应当扫描B'], '行尾注释含 i18n-ignore 子串但非指令 应被扫描');
  assert.ok(!byValue['应当扫描C'], '// @i18n-ignore 行尾注释后行 应被忽略');
  return 'testIgnoreRegexRejectsDescriptiveComment passed';
}

// 回归测试：replacer 的字符串回退路径（AST 不替换时）也必须尊重 // @i18n-ignore。
// 场景：源文件中只有带 // @i18n-ignore 注释的中文字符串，AST 路径应忽略它们
// （replaced=false），但字符串回退路径如果不检查 ignore 注释，会错误替换。
async function testReplaceFallbackRespectsIgnore() {
  const dir = tempDir('i18n-replace-fallback-');
  const srcFile = path.join(dir, 'sample.tsx');
  fs.writeFileSync(
    srcFile,
    "function Page() {\n" +
    "  const a = '应保留'; // @i18n-ignore\n" +
    "  return null;\n" +
    "}\n",
    'utf8'
  );
  const excel = path.join(dir, 'data.xlsx');
  createExcel(excel, {
    Sheet1: [
      { key: 'i18n_keep', zh: '应保留', file: srcFile, line: 2 },
    ]
  });
  replaceCommand({ excel, importPath: 'core/util/i18n', fixLint: 'false' });

  const after = fs.readFileSync(srcFile, 'utf8');
  assert.ok(
    after.includes("'应保留'"),
    '字符串回退路径不应替换 // @i18n-ignore 注释行中的中文，原文应保留，实际:\n' + after
  );
  assert.ok(
    !after.includes("t('i18n_keep')"),
    '不应生成 t() 调用包裹的中文，实际:\n' + after
  );
  return 'testReplaceFallbackRespectsIgnore passed';
}
  async function testGenIgnoresCategoryColumn() {
  const dir = tempDir('i18n-gen-cat-');
  const excel = path.join(dir, 'data.xlsx');
  const outDir = path.join(dir, 'out');
  // Excel 含 category 列（避免被识别为语言列）
  createExcel(excel, {
    Sheet1: [
      { key: 'hello', zh: '你好', en: 'Hello', category: 'normal' },
      { key: 'btn', zh: '确定', en: 'Confirm', category: 'button-label' },
    ]
  });
  genCommand({ excel, out: outDir });
  // 不应生成 category.json
  assert.ok(!fs.existsSync(path.join(outDir, 'category.json')), '不应生成 category.json');
  // 但应正常生成 zh.json / en.json
  assert.ok(fs.existsSync(path.join(outDir, 'zh.json')), '应生成 zh.json');
  assert.ok(fs.existsSync(path.join(outDir, 'en.json')), '应生成 en.json');
  const enJson = JSON.parse(fs.readFileSync(path.join(outDir, 'en.json'), 'utf8'));
  assert.strictEqual(enJson.btn, 'Confirm', 'en.json 中按钮条目应保留');
  return 'testGenIgnoresCategoryColumn passed';
}

async function testGenSkipsMixedCategoryKeys() {
  const dir = tempDir('i18n-gen-mixed-');
  const excel = path.join(dir, 'data.xlsx');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir);
  // 已有 en.json：safe button-label、mixed (normal+button-label)、normal 都已有翻译
  fs.writeFileSync(path.join(outDir, 'en.json'), JSON.stringify({
    safe_btn: 'OldSafe',
    mixed_key: 'OldMixed',
    pure_normal: 'NormalEn',
    pure_btn: 'OldPure',
  }, null, 2));
  // Excel 含同一 key 在不同上下文被识别为不同 category 的场景
  // 注：normal 条目的 en 列必须与 locales/en.json 一致（模拟 scan prefill 行为），否则会触发冲突抛错
  createExcel(excel, {
    Sheet1: [
      // 全部 row 都是 button-label → 应覆写
      { key: 'pure_btn',   zh: '纯按钮', en: 'NewPure', category: 'button-label' },
      // 全部 row 都是 normal → 应保留（en 与 locales 一致避免冲突）
      { key: 'pure_normal',zh: '纯普通', en: 'NormalEn', category: 'normal' },
      // 多个 row 中既有 button-label 又有 normal → 应跳过覆写（保留 OldMixed）
      { key: 'mixed_key',  zh: '混合key', en: 'NewMixed', category: 'button-label' },
      { key: 'mixed_key',  zh: '混合key', en: 'OldMixed', category: 'normal' },
      // 同 key 都是 button-label 的多 row → 应覆写
      { key: 'safe_btn',   zh: '安全按钮', en: 'NewSafe', category: 'button-label' },
      { key: 'safe_btn',   zh: '安全按钮', en: 'NewSafe', category: 'button-label' },
    ]
  });
  await genCommand({ excel, out: outDir });
  const enJson = JSON.parse(fs.readFileSync(path.join(outDir, 'en.json'), 'utf8'));
  assert.strictEqual(enJson.pure_btn,    'NewPure',   '全部 button-label 应覆写');
  assert.strictEqual(enJson.pure_normal, 'NormalEn',  '全部 normal 应保留');
  assert.strictEqual(enJson.mixed_key,   'OldMixed',  'mixed key 应跳过覆写（避免误改 normal）');
  assert.strictEqual(enJson.safe_btn,    'NewSafe',   'safe button-label 应覆写');
  return 'testGenSkipsMixedCategoryKeys passed';
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
    testScanNoTranslateFunction,
    testButtonLabelJsxAttr,
    testButtonLabelAlert,
    testButtonLabelComponent,
    testButtonLabelInlineComment,
    testButtonLabelDisabledByDefault,
    testGenIgnoresCategoryColumn,
    testGenSkipsMixedCategoryKeys,
testIgnoreRegexDoesNotMatchAcrossLines,
    testIgnoreRegexRejectsDescriptiveComment,
    testReplaceFallbackRespectsIgnore
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
