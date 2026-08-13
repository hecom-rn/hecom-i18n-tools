# HECOM I18N Tools 快速入门 🚀

## 30秒上手指南

### 1. 安装
```bash
npm install hecom-i18n-tools -D
```

### 1.5 或者直接使用 npx（无需安装）
```bash
# 无需安装，直接使用
npx hecom-i18n-tools scan -s 'src' -o 'i18n.xlsx'
npx hecom-i18n-tools replace --excel=i18n.xlsx --importPath='@/utils/i18n'
```

### 2. 添加脚本到 package.json
```json
{
  "scripts": {
    "i18n": "hecom-i18n-tools scan -s 'src' -o 'i18n.xlsx' && hecom-i18n-tools replace --excel=i18n.xlsx --importPath='@/utils/i18n'"
  }
}
```

### 3. 创建 i18n 工具函数
```typescript
// src/utils/i18n.ts
export function t(key: string, params?: Record<string, any>): string {
  // 你的翻译逻辑
  return translations[key] || key;
}
```

### 4. 执行国际化
```bash
npm run i18n
```

## 效果展示

### 🔄 自动转换过程

**转换前:**
```jsx
<Text>欢迎使用我们的应用</Text>
<Button title="确认提交" />
<Text testID="测试ID">用户名</Text>  // testID自动忽略
```

**转换后:**
```jsx
import { t } from '@/utils/i18n';

<Text>{t("i18n_abc123def")}</Text>
<Button title={t("i18n_def456ghi")} />
<Text testID="测试ID">{t("i18n_ghi789jkl")}</Text>
```

**生成的 Excel:**
| key | zh | en | file | line |
|-----|----|----|------|------|
| i18n_abc123def | 欢迎使用我们的应用 | Welcome to our app | src/App.tsx | 10 |
| i18n_def456ghi | 确认提交 | Confirm | src/App.tsx | 11 |
| i18n_ghi789jkl | 用户名 | Username | src/App.tsx | 12 |

## 🎯 核心特性

✅ **智能识别**: 自动扫描 JS/TS/TSX 文件中的中文  
✅ **自动忽略**: testID、注释、特殊标记自动跳过  
✅ **一键替换**: 中文文本自动替换为 t() 调用  
✅ **Excel管理**: 翻译文件用 Excel 管理，方便协作  
✅ **GitLab集成**: 生成源码链接，方便定位  
✅ **增量更新**: 支持版本迭代的增量翻译管理  
✅ **按钮 label 分类**: 自动识别按钮 / Tab / 菜单项，AI 翻译时按极简规则生成 1~3 词译文  

## 📋 完整命令

```bash
# 扫描中文文本
hecom-i18n-tools scan -s 'src' -o 'i18n-result.xlsx' --gitlab='https://gitlab.com/your-project'

# 替换代码中的中文
hecom-i18n-tools replace --excel=i18n-result.xlsx --importPath='@/utils/i18n' --fixLint

# 生成语言包文件  
hecom-i18n-tools gen
```

## 🔧 高级用法

### 忽略特定文本
```javascript
const debug = "调试信息"; // i18n-ignore
```

### 忽略整个文件
```javascript
// i18n-ignore-file
export const constants = { ... };
```
### 模板字符串支持

```javascript
const msg = `欢迎 ${name}，积分 ${score}`;
// 自动识别为: "欢迎 {{Identifier1}}，积分 {{Identifier2}}"
// 使用: t('welcome_msg', { Identifier1: name, Identifier2: score })
```

### 按钮 label 自动分类

```javascript
// i18nScannerOptions.js
module.exports = {
  buttonLabelRules: {
    jsxAttributes: ['title', 'tabLabel', 'backTitle'],
    alertCallees: ['Alert'],
    buttonComponents: ['Button', 'TouchableOpacity', 'Pressable'],
    inlineComment: '// @i18n:button-label',
  },
};
```

```jsx
// 以下场景会自动识别为 button-label：
<Button title="确认">...</Button>          // 命中 jsxAttributes
<Alert.alert('', 'msg', [{ text: '确定' }]) />  // 命中 alertCallees
<Button><Text>登录</Text></Button>         // 命中 buttonComponents
// @i18n:button-label
const btn = '一键清空'                      // 命中 inlineComment
```

Prompt 模板支持 `{category}` 占位符，AI 会按类别切换翻译风格——按钮 label 输出英文 1~3 词，普通文案输出完整自然译文。

## 📞 需要帮助？

- 📖 **详细文档**: 查看 [USAGE.md](./USAGE.md)
- 🐛 **问题反馈**: [GitHub Issues](https://github.com/hecom-rn/i18n-tools/issues)
- 💬 **技术讨论**: 联系项目维护团队

---

**开始你的国际化之旅吧！** 🌍
