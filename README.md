# HECOM I18N Tools

🌍 专为 React Native/React/TypeScript 项目设计的国际化工具

[![npm version](https://img.shields.io/npm/v/hecom-i18n-tools.svg)](https://www.npmjs.com/package/hecom-i18n-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 特性

- 🔍 **自动扫描**: 智能识别代码中的中文文本
- 🚫 **智能忽略**: 自动忽略 testID、注释等无需翻译的内容  
- 🔄 **一键替换**: 自动将中文替换为 `t()` 函数调用
- 📊 **Excel管理**: 使用 Excel 管理翻译，方便团队协作
- 🔗 **GitLab集成**: 自动生成源码链接，快速定位
- 📈 **增量更新**: 支持版本迭代的增量翻译管理
- 🏷️ **按钮 label 分类**: 自动识别 JSX 属性、Alert 按钮、按钮包 Text 等场景，按 `category` 标记，AI 翻译时按极简规则生成 1~3 词译文

## 🚀 快速开始

### 安装
```bash
npm install hecom-i18n-tools -D
```

### 使用 npx（无需安装）
```bash
# 直接使用 npx 运行，无需全局安装
npx hecom-i18n-tools scan -s 'src' -o 'i18n-result.xlsx'
npx hecom-i18n-tools replace --excel=i18n-result.xlsx --importPath='@/utils/i18n'
npx hecom-i18n-tools gen
```

### 基础用法
```bash
# 1. 扫描中文文本并生成 Excel
hecom-i18n-tools scan -s 'src' -o 'i18n-result.xlsx'

# 2. 替换代码中的中文为 t() 调用
hecom-i18n-tools replace --excel=i18n-result.xlsx --importPath='@/utils/i18n'

# 3. 生成语言包文件
hecom-i18n-tools gen
```

## 📋 完整示例

### 转换前
```jsx
function App() {
  return (
    <View>
      <Text>欢迎使用我们的应用</Text>
      <Button title="确认提交" onPress={handleSubmit} />
      <Text testID="测试标识">用户名</Text>  // testID 自动忽略
    </View>
  );
}
```

### 转换后  
```jsx
import { t } from '@/utils/i18n';

function App() {
  return (
    <View>
      <Text>{t("i18n_abc123def")}</Text>
      <Button title={t("i18n_def456ghi")} onPress={handleSubmit} />
      <Text testID="测试标识">{t("i18n_ghi789jkl")}</Text>
    </View>
  );
}
```

### 生成的翻译文件
| key | zh | en | file | line |
|-----|----|----|------|------|
| i18n_abc123def | 欢迎使用我们的应用 | Welcome to our app | src/App.tsx | 4 |
| i18n_def456ghi | 确认提交 | Confirm | src/App.tsx | 5 |
| i18n_ghi789jkl | 用户名 | Username | src/App.tsx | 6 |

## 📖 详细文档

- 📘 [完整使用指南](./USAGE.md) - 详细的功能说明和最佳实践
- 🚀 [快速入门指南](./QUICKSTART.md) - 30秒上手教程
- 👥 [团队协作流程](./WORKFLOW.md) - 多人协作的完整工作流程

## 🔧 命令详解

### scan - 扫描文本
```bash
hecom-i18n-tools scan [options]

选项:
  -s, --src <paths>         源码目录，支持多个路径
  -o, --out <file>          输出 Excel 文件路径  
  --gitlab <url>            GitLab 项目地址
  --config <file>           配置文件路径
```

### replace - 替换文本
```bash
hecom-i18n-tools replace [options]

选项:
  --excel <file>           Excel 翻译文件路径
  --file <file>            只处理指定文件
  --importPath <path>      i18n 导入路径
  --fixLint               自动修复 ESLint
```

### gen - 生成语言包
```bash
hecom-i18n-tools gen [options]

选项:
  --excel <file>           Excel 文件路径
  --output <dir>           语言包输出目录
```

### translate - AI 翻译（DashScope Qwen）
```bash
hecom-i18n-tools translate [options]

选项:
  -e, --excel <file>          输入 Excel 文件路径
  -o, --out <file>            输出 Excel 文件路径（可与输入相同，原地覆盖）
  -k, --api-key <key>         DashScope API Key
  --keys <keys>               仅翻译指定 key（逗号分隔）
  --langs <langs>             仅翻译指定语言列（逗号分隔，如 en,th）
  --python <path>             Python 可执行路径（默认: python3）
  --prompt <template>         自定义 Prompt 模板（需含 {text} 和 {target_lang}）
  --prompt-file <file>        Prompt 模板文件路径
  --category-column <name>    承载 category 元数据的列名（默认: category；传空字符串禁用）
```

### flow - 一键流程
```bash
hecom-i18n-tools flow [options]

选项:
  -s, --src <paths>           源代码目录（逗号分隔）
  -e, --excel <file>          中间 Excel 文件路径
  -o, --out <dir>             语言包输出目录
  -i, --importPath <path>     i18n 工具模块的 importPath，如 core/util/i18n
  -g, --gitlab <url>          GitLab 仓库 URL 前缀
  -c, --config <file>         配置文件路径（含 email 等配置）
  -m, --master <file>         主 Excel 文件路径（可选）
  -k, --api-key <key>         DashScope API Key（不填则跳过翻译步骤）
  --langs <langs>             翻译时仅处理指定语言列
  --python <path>             Python 可执行路径（默认: python3）
  --prompt-file <file>        Prompt 模板文件路径
  -r, --conflict-report <f>   冲突报告输出路径
  -l, --fixLint <bool>        替换后是否运行 Prettier 格式化（默认: true）
  -p, --prettier-config <f>   Prettier 配置文件路径
```

## 🏷️ 按钮 label 分类翻译

工具在扫描时会按 AST 上下文给每条中文字符串打 `category` 标记：
- `button-label`：按钮 / Tab / 菜单项 / 字段名等极短文案
- `normal`：其他 UI 文案

命中规则（按优先级）：
1. 父链是 `JSXAttribute` 且属性名命中 `jsxAttributes` 白名单（如 `<Button title="确认">`）
2. 父链是 `alertCallees` 调用的数组参数，且是该参数 `ObjectExpression` 的 `text` 字段（如 `Alert.alert(...)` 的按钮文字）
3. JSXText 祖先链上存在 `buttonComponents` 白名单标签（如 `<Button><Text>登录</Text></Button>`）
4. 上一行注释包含 `inlineComment` 标记（手动兜底）

`buttonLabelRules` 通过配置文件注入：

```js
// i18nScannerOptions.js
module.exports = {
  buttonLabelRules: {
    jsxAttributes: ['title', 'okText', 'cancelText', 'backTitle', 'tabLabel', 'label'],
    alertCallees: ['Alert', 'alert'],
    buttonComponents: ['Button', 'TouchableOpacity', 'Pressable', 'BottomBtn'],
    inlineComment: '// @i18n:button-label',
    ancestorDepth: 4,
  },
};
```

Prompt 模板支持 `{category}` 占位符，AI 会按类别切换翻译风格：
- `category == "button-label"` → 英文 1~3 个 Title Case 单词（`Cancel / Confirm / Save / Upload / Retry / Set as Latest / Open with…`）
- 其他 → 完整自然的 UI 文案

Prompt 模板样例见 `examples/` 目录。

## 📞 技术支持

- 🐛 **问题反馈**: [GitHub Issues](https://github.com/hecom-rn/i18n-tools/issues)
- 📖 **详细文档**: 查看项目内的 Markdown 文档
- 💬 **技术讨论**: 联系项目维护团队

## 📄 许可证

MIT © HECOM

---

**让国际化变得简单高效！** 🌍


## Excel说明
- key: 唯一key
- zh: 中文
- file: 文件路径
- line: 行号
- gitlab: 跳转链接
- en/ja...: 各语言



## 命令行参数

### scan 命令

| 参数 | 必需 | 描述 |
|------|------|------|
| -s, --dist | 是 | 源代码目录（支持多个，用逗号分隔） |
| -o, --out | 是 | 输出Excel路径 |
| -g, --gitlab | 否 | GitLab仓库URL前缀 |
| -c, --config | 否 | 配置文件路径 |

### replace 命令

| 参数 | 必需 | 描述 |
|------|------|------|
| -e, --excel | 是 | Excel文件路径 |
| -i, --importPath | 是 | import路径 |
| -f, --file | 否 | 仅处理指定文件 |
| -l, --fixLint | 否 | 是否修复lint |

### gen 命令

| 参数 | 必需 | 描述 |
|------|------|------|
| -e, --excel | 是 | Excel文件路径 |
| -o, --out | 是 | 输出目录 |

### translate 命令

| 参数 | 必需 | 描述 |
|------|------|------|
| -e, --excel | 是 | 输入 Excel 文件路径 |
| -o, --out | 是 | 输出 Excel 文件路径（可与输入相同，原地覆盖） |
| -k, --api-key | 是 | DashScope API Key |
| --keys | 否 | 仅翻译指定 key（逗号分隔） |
| --langs | 否 | 仅翻译指定语言列（逗号分隔，如 en,th） |
| --python | 否 | Python 可执行路径（默认: python3） |
| --prompt | 否 | 自定义 Prompt 模板字符串（需含 {text} 和 {target_lang}） |
| --prompt-file | 否 | Prompt 模板文件路径 |
| --category-column | 否 | category 元数据列名（默认: category；传空字符串禁用） |

### flow 命令

| 参数 | 必需 | 描述 |
|------|------|------|
| -s, --src | 是 | 源代码目录（支持逗号分隔） |
| -e, --excel | 是 | 中间 Excel 文件路径 |
| -o, --out | 是 | 语言包输出目录 |
| -i, --importPath | 是 | i18n 工具模块的 importPath |
| -g, --gitlab | 否 | GitLab 仓库 URL 前缀 |
| -c, --config | 否 | 配置文件路径 |
| -m, --master | 否 | 主 Excel 文件路径（合并后删除当前 Excel） |
| -k, --api-key | 否 | DashScope API Key（不填则跳过翻译步骤） |
| --langs | 否 | 翻译时仅处理指定语言列 |
| --python | 否 | Python 可执行路径（默认: python3） |
| --prompt-file | 否 | Prompt 模板文件路径 |
| -r, --conflict-report | 否 | 冲突报告输出路径（默认: <out>/conflicts.json） |
| -l, --fixLint | 否 | 替换后是否运行 Prettier 格式化（默认: true） |
| -p, --prettier-config | 否 | Prettier 配置文件路径 |

## ✅ 生成语言包冲突检测测试

项目内置最小测试脚本验证以下行为：

1. 无冲突：正常生成多语言 json。
2. 冲突（已有 json 中同 key 不同翻译）：应阻止生成，不覆盖旧文件，并生成 `conflicts-*.json` 报告，Excel 原文件不删除。

运行测试：
```bash
yarn test
```
测试脚本位置：`test/run-tests.js` （使用 Node 原生 `assert`，无需额外依赖）。

## 🛠 可配置日志忽略

扫描时默认会忽略以下日志对象/方法中的中文：

- 对象：`console`, `UnionLog`
- 方法：`log`, `warn`, `error`, `info`, `debug`, `trace`, `verbose`, `fatal`

现在可通过配置文件追加自定义日志（例如忽略 `Sentry.captureMessage` 中的中文）：


> 提示：配置项是“追加”而不是“覆盖”，仍会保留默认忽略的 console/UnionLog 及其方法。
