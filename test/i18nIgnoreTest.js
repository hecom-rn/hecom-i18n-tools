// 使用构建后的文件以避免直接解析 TS
const { extractStringsFromFile } = require('../dist/scanner.js');
const path = require('path');
const fs = require('fs');

// 构造一个临时测试文件，含有 @i18n-ignore 注释的模板与字符串
const tempFilePath = path.join(__dirname, 'tempIgnoreSource.js');
const source = `// 这是一个测试文件\nconst length = 3;\nnames.map((item) => item.name).join(', ') +\n                (true\n                    ? // @i18n-ignore\n                      \`等\${length}人\`\n                    : '')\nconst normal = '正常中文';\n// @i18n-ignore 下一行字符串应忽略\nconst ignored = '被忽略的中文';\n/* 块注释 i18n-ignore */\nconst ignored2 = \`块注释忽略\${length}\`;\n`; // 末尾不添加额外换行
fs.writeFileSync(tempFilePath, source, 'utf8');

const results = extractStringsFromFile(tempFilePath, {});
console.log('[DEBUG] results:', results.map(r => r.value));

// 断言：正常中文被扫描；等${length}人 / 被忽略的中文 / 块注释忽略${length} 不应出现
const keys = results.map(r => r.value);
if (keys.includes('等{{Identifier1}}人')) {
  console.error('[TEST i18nIgnore] 模板字符串 等${length}人 未被忽略');
  process.exit(1);
}
if (keys.includes('被忽略的中文')) {
  console.error('[TEST i18nIgnore] 行注释忽略未生效');
  process.exit(1);
}
if (keys.find(v => v.startsWith('块注释忽略'))) {
  console.error('[TEST i18nIgnore] 块注释忽略未生效');
  process.exit(1);
}
if (!keys.includes('正常中文')) {
  console.error('[TEST i18nIgnore] 正常中文未被扫描');
  process.exit(1);
}
console.log('[TEST i18nIgnore] Passed');

// 清理
fs.unlinkSync(tempFilePath);
