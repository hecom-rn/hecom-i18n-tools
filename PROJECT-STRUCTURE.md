# 项目目录结构示例

为了更好地使用 HECOM I18N Tools，建议按照以下目录结构组织项目：

```
my-react-native-app/
├── src/
│   ├── components/           # 组件目录
│   │   ├── Button/
│   │   │   └── index.tsx
│   │   └── Modal/
│   │       └── index.tsx
│   ├── screens/             # 页面目录
│   │   ├── Home/
│   │   │   └── index.tsx
│   │   └── Profile/
│   │       └── index.tsx
│   ├── utils/               # 工具函数
│   │   └── i18n.ts         # 国际化工具函数 ⭐
│   └── locales/            # 语言包目录 ⭐
│       ├── zh-CN.json      # 中文语言包
│       ├── en-US.json      # 英文语言包
│       └── index.ts        # 语言包导出
├── i18n/                   # 国际化工作目录 ⭐
│   ├── master.xlsx         # 主翻译文件
│   ├── scan-result.xlsx    # 扫描结果
│   ├── versions.json       # 版本历史
│   └── config.js          # 扫描配置
├── package.json
└── README.md
```

## 核心文件说明

### 📁 src/utils/i18n.ts - 国际化工具函数
```typescript
import zhCN from '@/locales/zh-CN.json';
import enUS from '@/locales/en-US.json';

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

let currentLocale = 'zh-CN';

export function setLocale(locale: string) {
  currentLocale = locale;
}

export function t(key: string, params?: Record<string, any>): string {
  let message = messages[currentLocale]?.[key] || messages['zh-CN']?.[key] || key;
  
  if (params) {
    Object.keys(params).forEach(paramKey => {
      const placeholder = `{{${paramKey}}}`;
      message = message.replace(new RegExp(placeholder, 'g'), String(params[paramKey]));
    });
  }
  
  return message;
}

export function getCurrentLocale() {
  return currentLocale;
}

export function getSupportedLocales() {
  return Object.keys(messages);
}
```

### 📁 src/locales/index.ts - 语言包导出
```typescript
export { default as zhCN } from './zh-CN.json';
export { default as enUS } from './en-US.json';

export const locales = {
  'zh-CN': '简体中文',
  'en-US': 'English',
};
```

### 📁 i18n/config.js - 扫描配置
```javascript
module.exports = {
  // 自定义哈希生成函数
  generateStableHash: (text) => {
    const crypto = require('crypto');
    return 'i18n_' + crypto.createHash('md5').update(text).digest('hex').substring(0, 12);
  },
  
  // 忽略的文件/目录
  ignoreFiles: [
    'node_modules',
    '__tests__',
    '__mocks__',
    '.storybook',
    'dist',
    'build'
  ],
  
  // 自动翻译函数（可选）
  translate: (text) => {
    // 这里可以集成自动翻译 API
    // return await translateAPI(text, 'zh', 'en');
    return undefined;
  }
};
```

### 📁 package.json - 便捷脚本
```json
{
  "name": "my-react-native-app",
  "scripts": {
    "dev": "react-native start",
    "build": "react-native bundle",
    
    "i18n:scan": "hecom-i18n-tools scan -s 'src' -o 'i18n/scan-result.xlsx' --gitlab='https://gitlab.example.com/my-project' --config='i18n/config.js'",
    "i18n:replace": "hecom-i18n-tools replace --excel='i18n/scan-result.xlsx' --importPath='@/utils/i18n' --fixLint",
    "i18n:gen": "hecom-i18n-tools gen --excel='i18n/scan-result.xlsx' --out='src/locales'",
    "i18n:full": "npm run i18n:scan && npm run i18n:replace && npm run i18n:gen",
    
    "i18n:check": "hecom-i18n-tools scan -s 'src' -o 'i18n/temp.xlsx' && echo '✅ 国际化检查完成'",
    "i18n:diff": "node scripts/i18n-diff.js",
    "i18n:merge": "node scripts/i18n-merge.js"
  },
  "dependencies": {
    "react": "^18.0.0",
    "react-native": "^0.72.0"
  },
  "devDependencies": {
    "hecom-i18n-tools": "^1.0.3",
    "@types/react": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

## 使用示例

### 🎯 组件开发示例

```typescript
// src/components/LoginForm/index.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { t } from '@/utils/i18n';

interface LoginFormProps {
  onLogin: (username: string, password: string) => void;
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <View>
      <Text>用户登录</Text>
      
      <TextInput
        placeholder="请输入用户名"
        value={username}
        onChangeText={setUsername}
        testID="username-input"  // 这个不会被扫描
      />
      
      <TextInput
        placeholder="请输入密码"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        testID="password-input"  // 这个不会被扫描
      />
      
      <TouchableOpacity onPress={() => onLogin(username, password)}>
        <Text>立即登录</Text>
      </TouchableOpacity>
      
      <TouchableOpacity>
        <Text>忘记密码？</Text>
      </TouchableOpacity>
    </View>
  );
}
```

### 🔄 执行国际化后

```typescript
// src/components/LoginForm/index.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { t } from '@/utils/i18n';

interface LoginFormProps {
  onLogin: (username: string, password: string) => void;
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <View>
      <Text>{t("i18n_abc123def")}</Text>
      
      <TextInput
        placeholder={t("i18n_def456ghi")}
        value={username}
        onChangeText={setUsername}
        testID="username-input"
      />
      
      <TextInput
        placeholder={t("i18n_ghi789jkl")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        testID="password-input"
      />
      
      <TouchableOpacity onPress={() => onLogin(username, password)}>
        <Text>{t("i18n_jkl012mno")}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity>
        <Text>{t("i18n_mno345pqr")}</Text>
      </TouchableOpacity>
    </View>
  );
}
```

### 📊 生成的语言包

```json
// src/locales/zh-CN.json
{
  "i18n_abc123def": "用户登录",
  "i18n_def456ghi": "请输入用户名",
  "i18n_ghi789jkl": "请输入密码", 
  "i18n_jkl012mno": "立即登录",
  "i18n_mno345pqr": "忘记密码？"
}
```

```json
// src/locales/en-US.json  
{
  "i18n_abc123def": "User Login",
  "i18n_def456ghi": "Please enter username",
  "i18n_ghi789jkl": "Please enter password",
  "i18n_jkl012mno": "Login Now", 
  "i18n_mno345pqr": "Forgot Password?"
}
```

## 🚀 开发工作流

### 日常开发流程

1. **开发新功能** - 直接使用中文编写
2. **功能完成** - 执行 `npm run i18n:full`
3. **翻译内容** - 编辑生成的 Excel 文件
4. **生成语言包** - 执行 `npm run i18n:gen`
5. **测试多语言** - 切换语言测试功能
6. **提交代码** - 包含翻译文件一起提交

### Git 工作流集成

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# 检查是否有未处理的中文文本
npm run i18n:check

# 如果有新增中文，提醒开发者处理
if [ $? -ne 0 ]; then
  echo "⚠️  检测到新增中文文本，请执行国际化流程"
  echo "运行: npm run i18n:full"
  exit 1
fi
```

## 📋 最佳实践总结

1. **目录结构清晰** - 将国际化相关文件集中管理
2. **脚本配置完善** - 在 package.json 中配置便捷命令
3. **工作流程标准化** - 制定团队统一的国际化流程
4. **版本控制规范** - 翻译文件和代码同步提交
5. **测试覆盖完整** - 每种语言都要测试功能完整性

---

这个目录结构和配置可以作为项目国际化的标准模板使用。
