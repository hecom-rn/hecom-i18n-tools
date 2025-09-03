# hecom-i18n-tools

多项目（RN/JS/TS）国际化扫描、Excel导出/导入、语言包生成工具

[![npm version](https://badge.fury.io/js/hecom-i18n-tools.svg)](https://badge.fury.io/js/hecom-i18n-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)



## 用法

### 1. 扫描代码导出Excel

```sh
npx ts-node src/cli.ts scan --src core --out ./i18n.xlsx --gitlab https://xxxx
```

### 2. 通过Excel回写代码

```sh
npx ts-node src/cli.ts replace --excel ./i18n.xlsx
```

### 3. 通过Excel生成语言包

```sh
npx ts-node src/cli.ts gen --excel ./i18n.xlsx --out ./locales
```

### package.json 快捷命令
```
"replace": "ts-node node_modules/hecom-i18n-tools/src/cli.ts replace --excel=i18n.xlsx --importPath='core/util/i18n' --fixLint=true",
"scan": "ts-node node_modules/hecom-i18n-tools/src/cli.ts scan --src=standard,core --out=./i18n.xlsx --gitlab=https:xxx --config=core/util/i18n/ReplaceConfig.js",
"gen": "ts-node node_modules/hecom-i18n-tools/src/cli.ts gen --excel=./i18n.xlsx --out=core/util/i18n"
```


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
| -s, --src | 是 | 源代码目录（支持多个，用逗号分隔） |
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
