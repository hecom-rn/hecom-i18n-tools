# AGENTS.md

> **重要提示：本项目的所有回复、文档、注释和对话必须使用中文。**

本文件帮助 OpenCode 会话快速理解 `hecom-i18n-tools` 项目并避免常见错误。

## 项目本质

- Node.js CLI 工具（`hecom-i18n-tools`），用于扫描 JS/TS/TSX 代码中的中文字符串并产出 Excel 翻译文件，再回写代码为 `t('key')` 调用，最后生成多语言 JSON 包。
- 通过 Babel 进行 AST 解析（`@babel/parser`、`@babel/traverse`、`@babel/generator`、`@babel/types`），使用 `xlsx` 处理 Excel，`commander` 解析命令行。
- 入口：`src/cli.ts` → 编译产物 `dist/cli.js`（`bin` 指向此处）。

## 关键命令

| 用途 | 命令 |
|---|---|
| 构建（含类型检查） | `npm run build` |
| 运行测试 | `npm test`（先 build，再跑 `node test/run-tests.js`）|
| 启动 CLI（已构建） | `npm start` 或 `node dist/cli.js` |
| 开发期便利脚本 | `npm run scan` / `npm run replace` / `npm run gen`（直接调 `dist/cli.js` 子命令）|

子命令总览（`src/cli.ts:50`）：
- `scan -s <src> -o <out>` 扫描源码生成 Excel（`--src` 支持逗号分隔多路径）
- `replace --excel=<xlsx> --importPath=<module>` 回写代码（**会修改源文件**）
- `gen --excel=<xlsx> --out=<dir>` 生成语言包 JSON
- `translate` 通过 Python 调用 DashScope（Qwen）批量翻译 Excel 空白列，需要 Python3 + `pandas/openpyxl/dashscope`
- `flow` 一键 `scan → replace → translate（可选）→ gen`
- `static-consts` 扫描含中文的全局 const/字符串数组

## 架构要点

- `src/scanner.ts`：Babel 解析 JS/TS/TSX，提取中文字符串与模板字符串（模板字符串保留真实换行，不转义为 `\n`）。
- `src/replacer.ts`：基于 AST 改写 JSX 文本/属性为 `t('key')`，并按需执行 Prettier（`--fixLint` 实际是 Prettier 格式化）。
- `src/i18nGenerator.ts`：从 Excel 读多语言列写到 JSON；**冲突时抛错并保留旧文件**，生成冲突报告（默认 `<out>/conflicts.json`）。
- `src/staticConstsScanner.ts`：独立扫描全局 const/字符串数组到 CSV。
- `src/scannerOptions.ts`：默认配置 `languages: ['en','es','pt','th']`，可通过 `--config` 覆盖。
- `rn.config.js`：仓库根目录自带的 RN 项目配置示例，可作为 `--config` 传入。

## 测试要点（容易踩坑）

- `test/run-tests.js` 从 `../dist/...` 导入编译产物。**改完源码必须先 `npm run build`，否则测试报找不到模块。**
- 测试只用 Node 原生 `assert`，无第三方测试框架；新增测试在该文件追加函数即可。
- 已有用例覆盖：`genCommand` 无冲突 / 冲突中止 + `conflicts.json` 生成、模板字符串换行处理（多表达式/多行中文/CRLF）、`scan` 默认与自定义 languages 列。
- 仓库无 ESLint / Prettier 配置文件；`build` 即类型检查（`tsc`），没有独立的 `typecheck` 脚本。

## 行为与约定

- `replace` 是破坏性操作：直接修改源码文件。建议在 git 工作区执行，跑前先 `git status`。
- `gen` 冲突策略：**不覆盖**已有 JSON 中 key 的旧翻译，抛错并生成冲突报告，原 Excel 保留。
- 模板字符串里的换行必须保留为真实 `\n`，不能转义成字面 `\n`（测试 `testTemplateLiteral*` 强制约束）。
- 扫描时自动忽略：`console`/`UnionLog` 等日志对象及其 `log/warn/error/info/debug/trace/verbose/fatal` 方法（可在 `--config` 中**追加**自定义对象/方法，不能覆盖默认项）。
- 默认 Excel 列：`key / zh / en / es / pt / th / file / line / gitlab`；通过 `--config` 配置 `languages` 后列集随之变化。
- `key` 命名默认是截断的哈希（`scannerOptions.ts` 用 sha256，示例配置用 md5），保证稳定。

## 文档体系（仓库内）

- `README.md` / `QUICKSTART.md` / `USAGE.md` / `WORKFLOW.md` / `PROJECT-STRUCTURE.md` / `PROJECT-INTEGRATION.md` / `RN-GUIDE.md` / `TECH-TALK-I18N.md` / `DOCS.md`：面向使用者的中文文档。
- `examples/`：可运行的集成示例（`demo-integration.sh`、`rn-example.jsx`、`demo-project/`）。
- 修改/新增面向用户的功能时，先核对 `USAGE.md` 和 `README.md` 的命令描述保持一致。

## 其他约束

- Node `>=14`，TypeScript `^5.0.0`。
- `.npmrc` 含 `ts-node=true`（项目内脚本依赖）。
- `dist/`、Excel 翻译文件（`*.xlsx`）均被 `.gitignore` 忽略；不要把临时翻译表提交进版本控制。
- `tsconfig.json` `include` 中含 `gen-locale.js`（仓库暂无此文件，构建无影响，但删除/移动时不要顺手删它）。
- 当前 master 领先 origin/master 10 个 commit，发版/发 PR 前先与维护者确认是否要推送。