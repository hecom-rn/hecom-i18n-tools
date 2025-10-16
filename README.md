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
