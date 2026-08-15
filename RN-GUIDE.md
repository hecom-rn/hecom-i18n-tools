# React Native 项目国际化集成指南

## 🚀 快速开始

### 1. 安装工具

```bash
npm install -g hecom-i18n-tools
```

### 2. RN项目中的使用

```bash
# 使用RN专用配置扫描
hecom-i18n-tools scan -s src -o translations.xlsx -c rn.config.js

# 替换为国际化函数
hecom-i18n-tools replace -e translations.xlsx --importPath 'utils/i18n'

# 智能同步（代码重构后）
hecom-i18n-tools sync -e translations.xlsx -s src
```

## 📋 RN项目特殊处理

### ✅ 支持的场景

#### 1. **RN组件属性**

```jsx
// ✅ 正常扫描
<Text>用户名</Text>
<Button title="提交" />

// ✅ 忽略测试属性
<Text testID="username">用户名</Text>
<TouchableOpacity accessibilityLabel="按钮">
  <Text>点击</Text>
</TouchableOpacity>
```

#### 2. **Alert对话框**

```javascript
// ✅ 会被正确扫描和替换
Alert.alert('提示', '确认删除？');
// 替换后: Alert.alert(t('i18n_tip'), t('i18n_confirm_delete'));
```

#### 3. **模板字符串**

```jsx
// ✅ 支持复杂模板字符串
<Text>{`用户: ${user.name}`}</Text>
// 替换后: <Text>{t('i18n_user_template', { name: user.name })}</Text>
```

#### 4. **平台特定文件**

```
src/
├── components/
│   ├── Button.js         ✅ 扫描
│   ├── Button.ios.js     ✅ 扫描  
│   ├── Button.android.js ✅ 扫描
│   └── Button.rn.js      ✅ 扫描
```

### ❌ 自动忽略的场景

#### 1. **测试相关属性**

```jsx
// ❌ 这些不会被扫描
<Text testID="测试标识">内容</Text>
<View accessibilityLabel="无障碍标签">
<Button nativeID="原生ID" />
```

#### 2. **样式相关字符串**

```javascript
// ❌ StyleSheet中的字符串不会被替换
const styles = StyleSheet.create({
  text: {
    fontFamily: '苹方-简',  // 保持不变
    color: '#333'
  }
});
```

#### 3. **RN默认忽略目录**

```
project/
├── android/          ❌ 忽略
├── ios/              ❌ 忽略
├── .expo/            ❌ 忽略
├── __tests__/        ❌ 忽略
├── metro-cache/      ❌ 忽略
└── src/              ✅ 扫描
```

## 🔧 RN专用配置

### package.json 配置

```json
{
  "scripts": {
    "i18n:scan": "hecom-i18n-tools scan -s src -o translations.xlsx -c rn.config.js",
    "i18n:sync": "hecom-i18n-tools sync -e translations.xlsx -s src",
    "i18n:replace": "hecom-i18n-tools replace -e translations.xlsx --importPath utils/i18n",
    "i18n:gen": "hecom-i18n-tools gen -e translations.xlsx -o src/locales"
  }
}
```

### rn.config.js 配置文件

```javascript
module.exports = {
  ignoreFiles: ['.expo', 'android', 'ios', '__tests__'],
  generateStableHash: (str) => 'rn_' + require('crypto').createHash('md5').update(str).digest('hex').substring(0, 12),
  // 按钮 label 识别规则（可选）
  buttonLabelRules: {
    jsxAttributes: ['title', 'okText', 'cancelText', 'backTitle', 'tabLabel'],
    alertCallees: ['Alert', 'alert'],
    buttonComponents: ['Button', 'TouchableOpacity', 'Pressable', 'TouchableHighlight'],
    inlineComment: '// @i18n:button-label',
    ancestorDepth: 4,
  },
};
```

### 按钮 label 手动标记

工具会自动识别 JSX 属性、Alert 按钮、按钮包 Text 等场景的"按钮 label"文案，并打 `category='button-label'` 标记。

对 AST 无法识别的场景（如变量字面量传入 children），可用注释手动标记：

```tsx
// @i18n:button-label
const btnText = '一键清空';
```

AI 翻译时会按 Prompt 模板里的 `{category}` 占位符切换翻译风格——按钮 label 输出 1~3 词极简译文，普通文案输出完整自然译文。

## 🎯 最佳实践

### 1. **目录结构建议**

```
rn-project/
├── src/
│   ├── components/
│   ├── screens/
│   ├── utils/
│   │   └── i18n.js       # 国际化工具
│   └── locales/          # 语言包
│       ├── zh.json
│       ├── en.json
│       └── index.js
├── translations.xlsx     # 主翻译文件
└── rn.config.js         # RN专用配置
```

### 2. **i18n工具设置**

```javascript
// src/utils/i18n.js
import I18n from 'react-native-i18n';
import zh from '../locales/zh.json';
import en from '../locales/en.json';

I18n.translations = { zh, en };
I18n.defaultLocale = 'zh';
I18n.fallbacks = true;

export const t = (key, options) => I18n.t(key, options);
export default I18n;
```

### 3. **Metro配置优化**

```javascript
// metro.config.js - 避免重复打包翻译文件
module.exports = {
  resolver: {
    alias: {
      '@i18n': './src/locales',
    },
  },
};
```

## 🚨 常见问题解决

### Q1: StyleSheet中的字符串被误替换

**A1**: 已优化replacer，自动跳过StyleSheet.create中的字符串

### Q2: 测试属性中的中文被扫描

**A2**: 扩展了测试属性识别，包括accessibilityLabel等

### Q3: 平台特定文件未被扫描

**A3**: 支持.ios.js、.android.js、.rn.js文件扫描

### Q4: Metro缓存导致更新不生效

**A4**: 清理缓存后重启

```bash
npx react-native start --reset-cache
```

## 📊 RN项目效果对比

| 场景       | 扫描前                  | 扫描后  | 替换后                                |
| ---------- | ----------------------- | ------- | ------------------------------------- |
| JSX文本    | `<Text>用户名</Text>` | ✅ 识别 | `<Text>{t('i18n_username')}</Text>` |
| Alert      | `Alert.alert('提示')` | ✅ 识别 | `Alert.alert(t('i18n_tip'))`        |
| testID     | `testID="测试"`       | ✅ 忽略 | `testID="测试"` (保持不变)          |
| StyleSheet | `fontFamily: '苹方'`  | ✅ 忽略 | `fontFamily: '苹方'` (保持不变)     |

通过这些优化，工具现在完美支持React Native项目的国际化需求！🎉
