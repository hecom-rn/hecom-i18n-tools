# scanCommand 动态翻译语言列设计

日期: 2026-08-13
范围: `src/scanner.ts` 的 `scanCommand` 输出列结构及 `src/scannerOptions.ts` 默认配置

## 背景

`scanCommand` 当前在 `wsData` 中写死了翻译语言列（zh/en/es/pt/th）。当项目需要其他语言（如 ja、ko、vi、ar）时，必须修改源码并发布新版本，无法在配置文件层扩展。本次改动引入可配置的 `languages` 列表，同时保持向后兼容。

## 目标

1. 通过配置文件声明扫描输出的翻译目标语言列。
2. `translate` 函数可感知目标语言。
3. 现有不传 `config` 或不提供 `languages` 的行为完全保持不变。

## 非目标

- 不改动 `replace` / `gen` / `translate_cli.py` / `i18nGenerator` 的列处理逻辑。
- 不引入新的 CLI flag（仅扩展现有 `--config` 配置项）。

## 设计

### 1. 配置扩展（`src/scannerOptions.ts`）

新增字段：

```ts
languages: ['en', 'es', 'pt', 'th'] as string[],
```

调整 `translate` 签名：

```ts
async translate(text: string, lang?: string) {
  // lang 可选，向后兼容旧实现
  return undefined;
},
```

### 2. `ScanOptions` 接口扩展（`src/scanner.ts`）

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

新增模块级常量：

```ts
const DEFAULT_LANGUAGES = ['en', 'es', 'pt', 'th'];
```

### 3. `scanCommand` 重构 wsData 生成

将现有的：

```ts
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
```

替换为：

```ts
const languages: string[] = Array.isArray(configOptions.languages)
  ? configOptions.languages.filter((l): l is string => typeof l === 'string' && l.length > 0)
  : DEFAULT_LANGUAGES;

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
```

要点：

- `zh` 始终存在，承载中文原文。
- 翻译列顺序等于 `languages` 数组顺序，方便与下游 `translate_cli.py --langs` 对齐。
- 多个翻译并行调用 (`Promise.all`)，保持性能。
- 无 `translate` 时仍输出所有语言列，值为 `undefined`，便于人工填写。

### 4. 行为矩阵

| `configOptions.languages` | `configOptions.translate` | 输出列                                       |
| ------------------------ | ------------------------- | -------------------------------------------- |
| `undefined`              | 任意                      | `gitlab, zh, en, es, pt, th, file, line, key`（与现状一致） |
| `['en', 'ja']`           | 已提供                    | `gitlab, zh, en, ja, file, line, key`        |
| `[]`                     | 任意                      | `gitlab, zh, file, line, key`                |
| `['en']`                 | 未提供                    | `gitlab, zh, en=undefined, file, line, key`  |

### 5. 错误处理

- `translate` 抛错 → 透传，不中断扫描（保持现状）。
- `languages` 含有非字符串或空字符串元素 → 过滤掉，避免污染列名。
- `languages` 含重复项 → 保留首次出现，后者在 `json_to_sheet` 中会被同名键覆盖；不做去重以保持简单（用户负责）。

### 6. 文档

在 `USAGE.md` 的"扫描器配置"小节追加 `languages` 字段说明及示例；在 `rn.config.js` 注释中追加可选 `languages` 示例。

### 7. 测试

在 `test/run-tests.js` 中新增：

1. `testScanDefaultLanguages`
   - 不传 `config` 调用 `scanCommand`，读取生成的 xlsx，断言包含 `zh/en/es/pt/th` 五列。
2. `testScanCustomLanguages`
   - 构造临时配置文件 `languages: ['en', 'ja']` 与 mock translate，断言输出列与翻译值。
3. `testScanNoTranslateFunction`
   - 提供 `languages: ['en', 'th']` 但不提供 `translate`，断言两列值均为空（`undefined` → xlsx 空单元格）。

## 风险与权衡

- **列顺序变化**：用户配置 `languages` 后列顺序固定为声明顺序；旧项目若依赖 en/es/pt/th 默认顺序，需保留默认配置或显式声明。
- **translate 并行**：可能对外部分翻译 API 触发并发限流；当前默认未启用 translate，因此风险有限。
- **下游 gen 影响**：`i18nGenerator` 已按列名写入语言包文件，新增列名会生成对应 `.json`；减少列名同样会缺失对应语言包，符合用户预期。

## 实施拆分

1. 修改 `src/scannerOptions.ts`，新增 `languages` 默认值与调整 `translate` 签名注释。
2. 修改 `src/scanner.ts`：
   - `ScanOptions` 接口扩展。
   - 模块常量 `DEFAULT_LANGUAGES`。
   - `scanCommand` 中 wsData 行生成逻辑。
3. `npm run build` 编译验证。
4. `test/run-tests.js` 增加三个用例；`npm test` 验证。
5. 更新 `USAGE.md` 与 `rn.config.js` 注释。