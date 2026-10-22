# 版本发布指南（RELEASING）

本文档描述 `@hecom/hecom-i18n-tools` 的版本发布流程。发布命令与 hecom-codearts 项目保持一致，CI 通过 GitHub Actions 自动发布到 npm。

## 发布命令

| 命令 | 版本变化（以 2.2.8 为例） | 说明 |
|---|---|---|
| `npm run patch` | 2.2.8 → 2.2.9 | 缺陷修复、文档等小改动 |
| `npm run minor` | 2.2.8 → 2.3.0 | 向后兼容的新功能 |
| `npm run major` | 2.2.8 → 3.0.0 | 不兼容的破坏性变更 |

三条命令的定义相同（`package.json` scripts）：

```bash
npm version <patch|minor|major> -m "Bump version to %s"; git push --follow-tags
```

执行效果：升级 `package.json` 版本号 → 生成 `chore(release):` 风格的版本提交（实际消息为 `Bump version to x.y.z`）→ 打 `v x.y.z` tag → 推送 `master` 分支和 tag 到远程。

## 发布前置条件

1. **工作区必须干净**。`npm version` 要求无未提交改动，发布前先用中文 conventional commit 提交所有功能改动（如 `feat(scan): ...`、`fix(gen): ...`，提交信息风格参照 git 历史）。
2. **本地测试通过**。建议发布前跑一遍 `npm test`（CI 发布时也会执行 `npm ci` + `npm test`，测试不过发布会失败）。
3. **确认基点**。确认当前 `master` 与 `origin/master` 同步，避免把旧代码发出去。

## 发布流程（标准操作）

```bash
# 1. 提交功能改动（中文 conventional commit）
git add <files>
git commit -m "fix(gen): 冲突时抛出错误并生成冲突报告"

# 2. 按需选择版本级别发布（一步完成：升版本 + 提交 + 打 tag + 推送）
npm run patch    # 或 minor / major
```

推送 tag `v*` 后自动触发 GitHub Actions 的 **Publish to npm** workflow（`.github/workflows/publish.yml`）：

1. `npm ci` 安装依赖；
2. `npm test`（含 `tsc` 构建）；
3. `npm run build`；
4. `npm publish --access public`（认证使用 `NPM_TOKEN` secret）。

> 备选方式：也可在 GitHub Actions 页面手动触发（`workflow_dispatch`），可留空使用 package.json 版本或指定版本号；但不推荐，它不产生版本提交和 tag，容易与仓库状态脱节。

## 发布结果验证

npm 发布成功后有传播延迟，**切勿因本地查不到就判定失败**。正确顺序：

1. **先看 CI 日志**：确认 publish 步骤输出成功行 `+ @hecom/hecom-i18n-tools@x.y.z`。
2. **再查官方源**（`--prefer-online` 防缓存）：

   ```bash
   npm view @hecom/hecom-i18n-tools version --registry=https://registry.npmjs.org --prefer-online
   ```

3. 官方源传播延迟约 2-4 分钟，查不到时先等待重试；本机 npm registry 若配置为 npmmirror 镜像，镜像同步延迟更长（可能长期显示旧版本甚至 404），不能作为发布是否成功的依据。

## 常见问题排查

| 现象 | 原因与处理 |
|---|---|
| CI publish 步骤报 `E404 - PUT @hecom/...` | 通常是 `NPM_TOKEN` 失效（scoped 包无权限时 npm 返回 404 而非 403）。token 存于 hecom-rn **组织级** Actions secret（ALL visibility，全组织共用），更新命令：`printf '%s' '<token>' \| env -u GITHUB_TOKEN gh secret set NPM_TOKEN --org hecom-rn --visibility all`（本机 shell 的 `GITHUB_TOKEN` 环境变量会覆盖 gh 凭据，需用 `env -u` 绕开，且凭据需 `admin:org` 权限）。勿再创建仓库级同名 secret。 |
| `npm version` 报工作区不干净 | 有未提交改动。先按中文 conventional commit 规范提交。 |
| 发布后 `npm install` 装不到新版本 | 多为镜像延迟。按上文"发布结果验证"确认 CI 与官方源；用户侧可临时加 `--registry=https://registry.npmjs.org`。 |
| CI 测试步骤失败 | 本地先跑 `npm test` 复现。注意测试从 `dist/` 导入编译产物，`npm test` 会先自动 build。 |

## 版本号与 tag 的关系

- **npm 上发布的版本 = tag 指向提交中 `package.json` 的版本号**。tag 触发 workflow 时不传版本参数，直接以该提交内容发布。
- 发布 patch/minor/major 前，请确保 `package.json` 版本号与最近一次已发布 tag 一致（历史上有过版本提交已推送但 tag 未打、导致该版本号"被占用却未发布"的情况，此时下一个 patch 会跳过它，属正常现象）。
