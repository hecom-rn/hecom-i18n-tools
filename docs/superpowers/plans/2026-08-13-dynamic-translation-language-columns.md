# scanCommand 动态翻译语言列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `scanCommand` 的输出语言列由配置文件中的 `languages` 数组动态生成，向后兼容现状。

**Architecture:** 在 `ScanOptions` 中新增可选的 `languages: string[]`（默认 `['en','es','pt','th']`），并将 `translate` 签名扩展为 `(text, lang?)`。`scanCommand` 中的 `wsData` 行改为基于 `languages` 动态生成翻译列，`zh` 始终为中文原文；多个翻译调用并行执行。

**Tech Stack:** TypeScript 5、xlsx 0.18.5、Node ≥ 14、jest-less 断言 (assert + xlsx-utils)。测试由 `npm run build && node test/run-tests.js` 触发。

## Global Constraints

- TypeScript 严格类型，向后兼容：`translate` 第二参数 `lang?` 可选；旧实现 `translate(text)` 仍然有效。
- 不改动 `replace` / `gen` / `translate_cli.py` / `i18nGenerator` 的列处理逻辑。
- 列顺序：`gitlab, zh, [...languages], file, line, key`。
- 所有改动须通过 `npm test`（实际执行 `npm run build && node test/run-tests.js`）。
- 禁止在生成的代码中加入注释（项目现有约定）。
- 不要使用 emojis。

---

## File Structure

修改的文件：
- `src/scannerOptions.ts`：新增 `languages` 默认值；`translate` 注释更新为 `(text, lang?)`。
- `src/scanner.ts`：
  - `ScanOptions` 接口扩展 `languages?: string[]`、`translate` 签名更新。
  - 新增模块级常量 `DEFAULT_LANGUAGES`。
  - `scanCommand` 中 `wsData` 生成逻辑重构。
- `test/run-tests.js`：新增三个测试用例（`testScanDefaultLanguages`、`testScanCustomLanguages`、`testScanNoTranslateFunction`）。
- `USAGE.md`：在"扫描器配置"小节增加 `languages` 字段示例与说明。
- `rn.config.js`：注释中追加 `languages` 可选用法。

无新增文件。

---

## Task 1: 扩展 `scannerOptions.ts` 默认值与 `ScanOptions` 类型

**Files:**
- Modify: `src/scannerOptions.ts:1-21`
- Modify: `src/scanner.ts:19-27`

**Interfaces:**
- Consumes: 无
- Produces: 默认导出对象包含 `languages: string[]`；`ScanOptions.translate` 签名变为 `(text, lang?) => Promise<string|undefined>`，新增 `languages?: string[]`。

- [ ] **Step 1: 修改 `src/scannerOptions.ts`**

完整替换文件为：

```ts
export default {
    languages: ['en', 'es', 'pt', 'th'] as string[],

    async translate(text: string, lang?: string) {
        return undefined;
    },

    generateStableHash(str: string) {
        return require('crypto').createHash('sha256').update(str).digest('hex').substring(0, 16);
    },

    ignoreFiles: [] as string[],
    ignoreLogObjects: [] as string[],
    ignoreLogMethods: [] as string[],
};
```

- [ ] **Step 2: 修改 `src/scanner.ts` 中的 `ScanOptions` 接口**

将现有（line 19-27）：

```ts
interface ScanOptions {
  translate?: (text: string) => Promise<string | undefined>;
  generateStableHash?: (str: string) => string;
  ignoreFiles?: string[];
  ignoreLogObjects?: string[];
  ignoreLogMethods?: string[];
}
```

替换为：

```ts
interface ScanOptions {
  translate?: (text: string, lang?: string) => Promise<string | undefined>;
  languages?: string[];
  generateStableHash?: (str: string) => string;
  ignoreFiles?: string[];
  ignoreLogObjects?: string[];
  ignoreLogMethods?: string[];
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: 提交**

```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
git add src/scannerOptions.ts src/scanner.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(scanner): extend options with languages and lang-aware translate"
```

---

## Task 2: TDD - 默认 languages 行为

**Files:**
- Modify: `test/run-tests.js:1-9, 133-153`（新增用例并加入 tests 数组）
- Modify: `src/scanner.ts:464-478`（新增 `DEFAULT_LANGUAGES` 常量并改造 `wsData` 生成）

**Interfaces:**
- Consumes: `ScanOptions` 现已包含 `languages?: string[]`。
- Produces: 模块级常量 `DEFAULT_LANGUAGES = ['en','es','pt','th']`；`scanCommand` 使用 `configOptions.languages ?? DEFAULT_LANGUAGES` 作为列来源。

- [ ] **Step 1: 写失败测试 `testScanDefaultLanguages`**

在 `test/run-tests.js` 中 `async function testTemplateLiteralCRLFNewline`（line 118-131）后追加：

```js
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
```

并在底部 `tests` 数组（line 134-141）中加入 `testScanDefaultLanguages`。

- [ ] **Step 2: 头部 import 中新增 `scanCommand`**

将顶部（line 8-9）：

```js
const { genCommand } = require('../dist/i18nGenerator');
const { extractStringsFromFile } = require('../dist/scanner');
```

替换为：

```js
const { genCommand } = require('../dist/i18nGenerator');
const { extractStringsFromFile, scanCommand } = require('../dist/scanner');
```

- [ ] **Step 3: 编译并运行测试，确认失败**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
npm run build
node test/run-tests.js
```
Expected: `testScanDefaultLanguages` 失败（当前 wsData 仍硬编码，运行时虽然默认列名一致，但因未引入 `DEFAULT_LANGUAGES` 常量，dist 中尚未使用，将来读 config 时还可能因 `languages` 未提供而保留旧硬编码 — 若实际上当前硬编码恰好满足断言，需在 Step 5 改造后才能验证后续任务）。

注：本任务的"失败"通过 Task 3 的测试反映（Task 3 测试需要 languages 配置生效，而当前实现不读取该字段）。如果 Task 2 测试已通过（因硬编码恰好满足），在 Step 5 完成 Task 3 的实现后，整体行为仍正确；Step 5 之后再跑一次 Step 3 验证全部测试绿。

- [ ] **Step 4: 在 `src/scanner.ts` 中新增 `DEFAULT_LANGUAGES` 并改造 `scanCommand`**

将 line 464-478 现有块：

```ts
    const wsData = await Promise.all(all.map(async (row) => {
      const { key, value, file, line, gitlab } = row;
      const link = gitlab ? (gitlab.includes('#L') ? gitlab : gitlab + '#L' + line) : '';
      return {
        gitlab: link ? { t: 's', l: { Target: link }, v: '链接' } : '',
        zh: value,
        en: configOptions.translate ? await configOptions.translate(value) : undefined,
        es: undefined,
        pt: undefined,
        th: undefined,
        file,
        line,
        key,
      };
    }));
```

替换为：

```ts
    const DEFAULT_LANGUAGES = ['en', 'es', 'pt', 'th'];
    const languages: string[] = Array.isArray(configOptions.languages)
      ? configOptions.languages.filter((l): l is string => typeof l === 'string' && l.length > 0)
      : DEFAULT_LANGUAGES;

    const wsData = await Promise.all(all.map(async (row) => {
      const { key, value, file, line, gitlab } = row;
      const link = gitlab ? (gitlab.includes('#L') ? gitlab : gitlab + '#L' + line) : '';
      const translated: Record<string, string | undefined> = {};
      if (configOptions.translate) {
        await Promise.all(languages.map(async (lang) => {
          translated[lang] = await configOptions.translate!(value, lang);
        }));
      } else {
        for (const lang of languages) translated[lang] = undefined;
      }
      return {
        gitlab: link ? { t: 's', l: { Target: link }, v: '链接' } : '',
        zh: value,
        ...translated,
        file,
        line,
        key,
      };
    }));
```

- [ ] **Step 5: 编译并跑测试**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
npm run build
node test/run-tests.js
```
Expected: `testScanDefaultLanguages passed`，其他既有测试继续通过。

- [ ] **Step 6: 提交**

```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
git add src/scanner.ts test/run-tests.js
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(scanner): generate translation columns from configurable languages list"
```

---

## Task 3: TDD - 自定义 languages 与 translate 调用

**Files:**
- Modify: `test/run-tests.js`（新增 `testScanCustomLanguages` 并加入 tests 数组）
- Verify: `src/scanner.ts:464-490`（确认 `languages` 配置与 `translate(value, lang)` 调用已生效）

**Interfaces:**
- Consumes: `ScanOptions.languages` 与 `translate(text, lang)` 已实现。
- Produces: 测试验证 `languages: ['en','ja']` 时输出对应列、`translate` 接收正确的 `lang` 参数。

- [ ] **Step 1: 写失败测试 `testScanCustomLanguages`**

在 `test/run-tests.js` 中 `testScanDefaultLanguages` 之后追加：

```js
async function testScanCustomLanguages() {
  const dir = tempDir('i18n-scan-custom-');
  const srcFile = path.join(dir, 'sample.js');
  fs.writeFileSync(srcFile, "const a = '早上好'; const b = '下午好';\n", 'utf8');
  const out = path.join(dir, 'result.xlsx');
  const configPath = path.join(dir, 'cfg.js');
  const calls = [];
  fs.writeFileSync(
    configPath,
    "module.exports = {\n" +
      "  languages: ['en', 'ja'],\n" +
      "  translate: async (text, lang) => { calls.push({ text, lang }); return lang === 'ja' ? text + '-ja' : text + '-en'; }\n" +
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
  assert.strictEqual(calls.length, 4, '每行 × 每语言应共 4 次 translate 调用');
  assert.ok(calls.every(c => c.lang === 'en' || c.lang === 'ja'), 'lang 应为 en/ja');
  return 'testScanCustomLanguages passed';
}
```

并在 `tests` 数组中加入 `testScanCustomLanguages`。

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
npm run build
node test/run-tests.js
```
Expected: `testScanCustomLanguages` 失败（因为旧 dist 不识别 languages 字段）。如已成功（说明 dist 已包含 Task 2 改动），则确认 cols 与 translate 调用次数即可。

- [ ] **Step 3: 确认 Task 2 改动满足需求**

读 `dist/scanner.js` 中 wsData 相关逻辑确认：
- `languages` 来自 `configOptions.languages`；
- `translate(value, lang)` 调用，lang 取自 `languages` 数组元素；
- 输出列仅为 `gitlab, zh, en, ja, file, line, key`。

若不满足，回到 Task 2 Step 4 修正。

- [ ] **Step 4: 编译并跑测试**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
npm run build
node test/run-tests.js
```
Expected: `testScanCustomLanguages passed`，所有先前测试继续通过。

- [ ] **Step 5: 提交**

```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
git add test/run-tests.js
git -c user.email=opencode@local -c user.name=opencode commit -m "test(scanner): cover custom languages config with translate dispatch"
```

---

## Task 4: TDD - 无 translate 函数时的空值行为

**Files:**
- Modify: `test/run-tests.js`（新增 `testScanNoTranslateFunction` 并加入 tests 数组）
- Verify: `src/scanner.ts:464-490`

**Interfaces:**
- Consumes: 已实现的 `languages` 过滤与无 translate 分支。
- Produces: 测试验证当仅配置 `languages` 而无 `translate` 时，所有翻译列值为空字符串（xlsx 读取时 `undefined` → `''`）。

- [ ] **Step 1: 写失败测试 `testScanNoTranslateFunction`**

在 `test/run-tests.js` 中 `testScanCustomLanguages` 之后追加：

```js
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
```

并在 `tests` 数组中加入 `testScanNoTranslateFunction`。

- [ ] **Step 2: 编译并运行**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
npm run build
node test/run-tests.js
```
Expected: `testScanNoTranslateFunction passed`，其他测试继续通过。

- [ ] **Step 3: 提交**

```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
git add test/run-tests.js
git -c user.email=opencode@local -c user.name=opencode commit -m "test(scanner): cover empty translation columns when no translate fn"
```

---

## Task 5: 文档更新

**Files:**
- Modify: `USAGE.md:225-255`（在"扫描器配置"小节增加 `languages` 示例）
- Modify: `rn.config.js:1-29`（注释中追加 `languages` 可选用法）

- [ ] **Step 1: 修改 `USAGE.md`**

在 `USAGE.md` line 245（`translate: (text) => {` 之前）插入：

```markdown
   // 翻译目标语言列（默认 ['en','es','pt','th']，可按需增减；与 translate_cli.py --langs 配合使用）
   languages: ['en', 'ja'],
   
   // 自动翻译函数（可选；接收目标语言作为第二参数）
   translate: (text, lang) => {
     return translateAPI(text, lang);
   }
```

确保整段"扫描器配置"小节展示 `languages` 字段并修正 `translate` 注释为 `translate: (text, lang) =>`。

- [ ] **Step 2: 修改 `rn.config.js`**

将 `rn.config.js` line 24-28 替换为：

```js
  // 翻译目标语言列（可选；默认 ['en','es','pt','th']）
  languages: ['en', 'es', 'pt', 'th'],
  
  // 翻译函数（可选；lang 为目标语言代码，未配置 languages 时为 undefined）
  translate: (text, lang) => {
    return undefined;
  }
```

- [ ] **Step 3: 提交**

```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
git add USAGE.md rn.config.js
git -c user.email=opencode@local -c user.name=opencode commit -m "docs: document configurable languages list in scanner options"
```

---

## Task 6: 最终验证

- [ ] **Step 1: 完整构建**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
npm run build
```
Expected: 编译无错误。

- [ ] **Step 2: 完整测试**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
npm test
```
Expected: 全部测试通过，输出包含 `testScanDefaultLanguages passed`、`testScanCustomLanguages passed`、`testScanNoTranslateFunction passed`，结尾 `Result: N passed, 0 failed`。

- [ ] **Step 3: 检查 git 状态**

Run:
```bash
cd /Users/summer/Documents/GitHub/hecom-i18n-tools
git status
git log --oneline -8
```
Expected: 工作区干净；最近几次提交依次为 docs（spec）、Task1 类型扩展、Task2 wsData 重构、Task3 自定义配置测试、Task4 空值测试、Task5 文档。