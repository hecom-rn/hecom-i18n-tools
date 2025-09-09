# 国际化团队协作工作流程

## 👥 角色分工

### 🧑‍💻 开发人员
- 正常开发功能，直接使用中文
- 功能完成后执行国际化脚本
- 提交包含 i18n key 的代码

### 🌍 翻译人员  
- 接收 Excel 翻译任务
- 填写各语言翻译内容
- 反馈翻译完成状态

### 🔧 项目负责人
- 管理翻译进度
- 合并翻译结果
- 发布多语言版本

## 📋 详细工作流程

### 阶段1: 开发阶段

#### 开发人员操作：

1. **正常开发，使用中文**
```jsx
// 开发时直接写中文，无需考虑国际化
function LoginPage() {
  return (
    <View>
      <Text>请输入用户名</Text>
      <TextInput placeholder="用户名" />
      <Button title="登录" onPress={handleLogin} />
      <Text>忘记密码？</Text>
    </View>
  );
}
```

2. **功能开发完成后，执行国际化**
```bash
# 在项目根目录执行
npm run i18n:full
```

3. **检查转换结果**
```jsx
// 转换后的代码
import { t } from '@/utils/i18n';

function LoginPage() {
  return (
    <View>
      <Text>{t("i18n_abc123")}</Text>
      <TextInput placeholder={t("i18n_def456")} />
      <Button title={t("i18n_ghi789")} onPress={handleLogin} />
      <Text>{t("i18n_jkl012")}</Text>
    </View>
  );
}
```

4. **提交代码和翻译文件**
```bash
git add .
git commit -m "feat: 添加登录页面功能 + 国际化"
git push
```

### 阶段2: 翻译阶段

#### 项目负责人操作：

1. **生成翻译任务**
```bash
# 提取未翻译的内容
npm run i18n:extract-tasks
```

2. **分发翻译任务**
- 将生成的 `i18n/translation-tasks.xlsx` 发给翻译人员
- 说明翻译要求和截止时间

#### 翻译人员操作：

1. **打开 Excel 文件**

| key | zh | en | context | file |
|-----|----|----|---------|------|
| i18n_abc123 | 请输入用户名 | | 登录页面提示文字 | src/LoginPage.tsx |
| i18n_def456 | 用户名 | | 输入框占位符 | src/LoginPage.tsx |
| i18n_ghi789 | 登录 | | 登录按钮文字 | src/LoginPage.tsx |
| i18n_jkl012 | 忘记密码？ | | 登录页面链接文字 | src/LoginPage.tsx |

2. **填写翻译内容**

| key | zh | en | context | file |
|-----|----|----|---------|------|
| i18n_abc123 | 请输入用户名 | Please enter username | 登录页面提示文字 | src/LoginPage.tsx |
| i18n_def456 | 用户名 | Username | 输入框占位符 | src/LoginPage.tsx |
| i18n_ghi789 | 登录 | Login | 登录按钮文字 | src/LoginPage.tsx |
| i18n_jkl012 | 忘记密码？ | Forgot password? | 登录页面链接文字 | src/LoginPage.tsx |

3. **提交翻译结果**
- 保存 Excel 文件
- 发送给项目负责人

### 阶段3: 集成阶段

#### 项目负责人操作：

1. **合并翻译结果**
```bash
# 将翻译好的 Excel 文件放到 i18n 目录
# 执行合并命令
npm run i18n:merge
```

2. **生成最终语言包**
```bash
npm run i18n:gen
```

3. **测试多语言效果**
```bash
npm run dev
# 切换语言测试
```

4. **发布版本**
```bash
npm run build
npm run deploy
```

## 📊 版本迭代管理

### 场景：V2.0 版本开发

#### 1. 基于现有翻译继续开发

```bash
# 开发新功能时，扫描会自动识别新增内容
npm run i18n:scan
```

#### 2. 生成增量翻译任务

扫描结果会区分：
- **新增内容** (New): 完全新增的文本
- **修改内容** (Modified): 文本内容发生变化
- **已有内容** (Existing): 无变化，已有翻译

```bash
# 生成增量翻译Excel
npm run i18n:incremental
```

#### 3. 增量翻译文件示例

**incremental-v2.0.xlsx:**

| key | zh | en | status | version |
|-----|----|----|--------|---------|
| i18n_new001 | 新功能按钮 | | New | v2.0 |
| i18n_mod001 | 用户设置页面 | | Modified | v2.0 |

#### 4. 翻译完成后合并

```bash
npm run i18n:merge-incremental
```

## 🌍 多语言扩展

### 添加新语言（如日语）

#### 1. 扩展 Excel 结构
```bash
# 在现有 Excel 基础上添加日语列
npm run i18n:add-language ja
```

#### 2. 生成日语翻译任务

**translation-task-ja.xlsx:**

| key | zh | ja | context |
|-----|----|----|---------|
| i18n_abc123 | 请输入用户名 | | 登录页面 |
| i18n_def456 | 用户名 | | 输入框 |

#### 3. 更新代码配置

```typescript
// src/utils/i18n.ts
import zhCN from '@/locales/zh-CN.json';
import enUS from '@/locales/en-US.json';
import jaJP from '@/locales/ja-JP.json'; // 新增

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP, // 新增
};
```

## 📋 质量控制检查清单

### 开发人员自查

- [ ] 功能开发完成
- [ ] 执行了国际化脚本
- [ ] 检查转换后的代码可正常运行
- [ ] 提交了翻译 Excel 文件
- [ ] testID 等测试相关文本未被误转换

### 翻译人员自查

- [ ] 理解了上下文含义
- [ ] 翻译符合目标语言习惯
- [ ] 保持了原文的语气和风格
- [ ] 处理了特殊符号和占位符
- [ ] 检查了术语的一致性

### 项目负责人检查

- [ ] 所有新增文本已翻译完成
- [ ] 语言包文件正确生成
- [ ] 各语言版本功能正常
- [ ] 翻译质量符合要求
- [ ] 版本文档已更新

## 🚨 应急处理方案

### 场景1: 发现翻译错误

**解决方案：**
1. 直接修改语言包 JSON 文件
2. 或修改 Excel 后重新生成
3. 发布热修复版本

### 场景2: 新语言紧急上线

**快速方案：**
1. 复制现有语言包作为模板
2. 使用机器翻译快速填充
3. 后续人工优化翻译质量

### 场景3: 代码回滚影响翻译

**处理步骤：**
1. 保留翻译 Excel 文件
2. 重新扫描回滚后的代码
3. 合并保留有效的翻译结果

## 📞 协作沟通

### 沟通渠道

- **技术问题**: 项目技术群 / GitHub Issues
- **翻译问题**: 翻译协作群 / 邮件
- **进度同步**: 每周例会 / 项目看板

### 文档维护

- 本文档由项目负责人维护
- 翻译规范由翻译团队制定
- 技术细节由开发团队更新

---

**本文档更新时间**: 2025年9月9日  
**适用版本**: hecom-i18n-tools v1.0.3+
