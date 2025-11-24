# HECOM I18N Tools 使用指南

## 📖 简介

HECOM I18N Tools 是一个专为 React Native/React/TypeScript 项目设计的国际化工具，支持自动扫描代码中的中文文本、生成 Excel 翻译文件、自动替换代码中的文本为 i18n 调用。

## 🚀 快速开始

### 安装

```bash
npm install hecom-i18n-tools -D
# 或
yarn add hecom-i18n-tools -D
```

### 基本用法

```bash
# 扫描项目中的中文文本
npx hecom-i18n-tools scan -s 'src' -o 'i18n-result.xlsx'

# 替换代码中的中文为 t() 调用
npx hecom-i18n-tools replace --excel=i18n-result.xlsx --importPath='@/utils/i18n'

# 生成语言包文件
npx hecom-i18n-tools gen --excel=i18n/scan-result.xlsx --out=src/locales --master=i18n/master.xlsx
```

## 📋 完整工作流程

### 1. 初次项目国际化

#### 步骤 1: 配置项目

在 `package.json` 中添加便捷脚本：

```json
{
  "scripts": {
    "i18n:scan": "hecom-i18n-tools scan -s 'src' -o 'i18n/scan-result.xlsx' --gitlab='https://gitlab.example.com/project'",
    "i18n:replace": "hecom-i18n-tools replace --excel=i18n/scan-result.xlsx --importPath='@/utils/i18n' --fixLint",
    "i18n:gen": "hecom-i18n-tools gen",
    "i18n:full": "npm run i18n:scan && npm run i18n:replace && npm run i18n:gen"
  }
}
```

#### 步骤 2: 创建项目结构

```
src/
├── locales/              # 语言包目录
│   ├── zh-CN.json       # 中文语言包
│   ├── en-US.json       # 英文语言包
│   └── index.ts         # 语言包导出
├── utils/
│   └── i18n.ts          # i18n 工具函数
└── i18n/                # 国际化工作目录
    ├── master.xlsx      # 主翻译文件
    ├── scan-result.xlsx # 扫描结果
    └── versions.json    # 版本历史
```

#### 步骤 3: 创建 i18n 工具函数

```typescript
// src/utils/i18n.ts
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
```

#### 步骤 4: 执行初次国际化

```bash
# 1. 扫描所有中文文本
npm run i18n:scan

# 2. 替换代码中的中文
npm run i18n:replace

# 3. 生成语言包
npm run i18n:gen
```

### 2. 日常开发流程

#### 开发新功能时

1. **正常编写中文文本**
   ```jsx
   // 开发时直接写中文
   <Text>欢迎使用我们的应用</Text>
   <Button title="确认提交" onPress={handleSubmit} />
   ```

2. **功能完成后执行国际化**
   ```bash
   npm run i18n:full
   ```

3. **代码自动转换为**
   ```jsx
   // 自动转换后
   import { t } from '@/utils/i18n';
   
   <Text>{t("i18n_abc123def")}</Text>
   <Button title={t("i18n_def456ghi")} onPress={handleSubmit} />
   ```

#### testID 自动忽略

工具会自动忽略 `testID` 属性中的文本：

```jsx
// 这些 testID 中的文本不会被扫描
<Text testID="用户名输入框">用户名</Text>           // 只有"用户名"被扫描
<Button testID={'确认按钮测试ID'} title="确认" />    // 只有"确认"被扫描
```

### 3. 翻译管理流程

#### Excel 文件结构

扫描生成的 Excel 文件包含以下列：

| 列名 | 说明 | 示例 |
|------|------|------|
| gitlab | 源码链接 | https://gitlab.com/project/file.js#L10 |
| zh | 中文原文 | 欢迎使用 |
| en | 英文翻译 | Welcome |
| file | 文件路径 | src/components/Welcome.tsx |
| line | 行号 | 10 |
| key | i18n key | i18n_abc123def |

#### 翻译工作流程

1. **导出翻译任务**
   ```bash
   npm run i18n:scan
   ```

2. **翻译人员填写 Excel**
   - 在 `en` 列填入英文翻译
   - 可添加更多语言列（如 `ja`、`ko`）

3. **导入翻译结果**
   ```bash
   npm run i18n:gen
   ```

### 4. 版本迭代管理

#### 增量更新流程

当项目迭代，新增功能时：

```bash
# 1. 扫描新增的文本（与历史文件对比）
npm run i18n:scan

# 2. 生成增量翻译任务
npm run i18n:diff  # 自定义脚本，比较差异

# 3. 合并翻译结果
npm run i18n:merge # 自定义脚本，合并新旧翻译
```

#### 多语言支持扩展

添加新语言支持：

1. **在 Excel 中添加新语言列**
   ```
   zh | en | ja | ko
   你好 | Hello |     | 
   ```

2. **创建对应语言包文件**
   ```bash
   touch src/locales/ja-JP.json
   touch src/locales/ko-KR.json
   ```

3. **更新 i18n 配置**
   ```typescript
   // src/utils/i18n.ts
   import jaJP from '@/locales/ja-JP.json';
   import koKR from '@/locales/ko-KR.json';
   
   const messages = {
     'zh-CN': zhCN,
     'en-US': enUS,
     'ja-JP': jaJP,
     'ko-KR': koKR,
   };
   ```

## 🔧 高级配置

### 扫描器配置

创建 `i18n.config.js` 文件：

```javascript
// i18n.config.js
module.exports = {
  // 自定义哈希生成函数
  generateStableHash: (text) => {
    return 'custom_' + require('crypto').createHash('md5').update(text).digest('hex').substring(0, 8);
  },
  
  // 忽略的文件/目录
  ignoreFiles: [
    'node_modules',
    '__tests__',
    '.storybook'
  ],
  
  // 自动翻译函数（可选）
  translate: (text) => {
    // 集成自动翻译 API
    return translateAPI(text);
  }
};
```

使用配置文件：
```bash
hecom-i18n-tools scan -s 'src' -o 'result.xlsx' --config=i18n.config.js
```

### 忽略特定日志调用（新增）

默认忽略以下日志中的中文：`console.*`、`UnionLog.*`（log / warn / error / info / debug / trace / verbose / fatal）。

你可以在配置中追加自定义日志（例如 `Sentry.captureMessage`）：

```js
// i18n.config.js
module.exports = {
  ignoreLogObjects: ['Sentry'],
  ignoreLogMethods: ['captureMessage']
};
```

说明：
- 配置是“追加”模式，不会覆盖默认集合。
- 只要匹配到  对象.方法(...)  形式，其参数里的中文都会被忽略。
- 如果你需要忽略多个 SDK，例如 NewRelic、CustomLogger：
```js
module.exports = {
  ignoreLogObjects: ['Sentry','NewRelic','CustomLogger'],
  ignoreLogMethods: ['captureMessage','recordError','track']
};
```

### 忽略特定文本

#### 方法 1: 行级忽略
```javascript
const text = "这段文本不需要翻译"; // i18n-ignore
```

#### 方法 2: 文件级忽略
```javascript
// i18n-ignore-file
// 整个文件的中文都会被忽略
export const constants = {
  DEBUG_MESSAGE: "调试信息"
};
```

### 命令行参数详解

#### scan 命令
```bash
hecom-i18n-tools scan [options]

选项:
  -s, --src <paths>         扫描的源码目录/文件，支持多个路径
  -o, --out <file>          输出的 Excel 文件路径
  --gitlab <url>            GitLab 项目地址，用于生成源码链接
  --config <file>           配置文件路径
  -h, --help               显示帮助信息
```

#### replace 命令
```bash
hecom-i18n-tools replace [options]

选项:
  --excel <file>           Excel 翻译文件路径
  --file <file>            只处理指定文件（可选）
  --importPath <path>      i18n 工具函数的导入路径
  --fixLint               自动修复 ESLint 问题
  -h, --help              显示帮助信息
```

#### gen 命令
```bash
hecom-i18n-tools gen [options]

选项:
  --excel <file>         Excel 翻译文件路径
  --out <dir>            输出语言包目录（生成 zh-CN.json / en-US.json 等）
  --master <file>        主 Excel 文件路径（可选）。若提供：
                         - 完成语言包生成后，将当前 Excel 合并入主表（按工作表直接追加，不去重）
                         - 主表不存在将创建（直接移动当前 Excel 为主表）
                         - 合并后删除当前 Excel（若与主表路径不同）
  -h, --help             显示帮助信息
```

  ##### 冲突处理与可选合并

  当生成阶段检测到同一语言同一 key 旧语言包与新 Excel 中出现不同翻译，会生成“冲突报告”并中断（不写入任何语言包文件）。报告文件结构示例：

  ```jsonc
  {
    "en": {
      "i18n_xxx123": {
        "existing": "旧翻译",
        "incoming": "新翻译",
        "selected": "incoming" // 可编辑：incoming | existing | 自定义字符串
      }
    }
  }
  ```

  处理流程：
  1. 首次出现冲突：工具会在 `--out` 目录写固定文件 `conflicts.json`，默认 `selected` 为 `incoming`。
  2. 你可以逐个编辑 `selected` 字段：
     - `incoming`：采用新 Excel 翻译（默认）
     - `existing`：保留旧语言包翻译
     - 任意字符串：使用你手动填写的覆盖值
  3. 重新执行命令并指定该报告：

  ```bash
  hecom-i18n-tools gen --excel=i18n/scan-result.xlsx --out=src/locales --conflict-report=src/locales/conflicts-2025-11-24T03-00-53.json
  ```

  全部冲突都有效选择后将继续生成语言包。若报告缺失或仍有未选项，会再次生成新的报告并中断。

  新增参数：
  | 参数 | 描述 |
  |------|------|
  | --conflict-report <file> | 指向已编辑完成的冲突报告文件以自动应用选择并继续生成 |

  注意：
  * 冲突判定只比较旧文件与新 Excel 对同 key 的字符串不相等情况。
  * 报告中的语言 / key 必须与当前检测到的冲突集合匹配；缺失或无效将视为未解决。
  * 编辑后可提交到版本库，便于代码审核时查看翻译决策。

  #### static-consts 命令
  扫描全局 `const` 声明中值为：
  - 直接中文字符串 `const today = '今天';`
  - 纯中文字符串数组 `const week = ['星期一','星期二',...];`

  这些常量往往需要按需改成惰性翻译或 key 映射。

  ```bash
  hecom-i18n-tools static-consts -s src
  hecom-i18n-tools static-consts -s src,packages/common -o static_consts.csv
  hecom-i18n-tools static-consts -s src --config=i18n.config.js
  ```

  选项:
  | 参数 | 必需 | 描述 |
  |------|------|------|
  | -s, --src | 是 | 源代码目录/文件，支持逗号分隔多个 |
  | -o, --out | 否 | 输出 CSV 文件路径。不提供则打印在控制台 |
  | -c, --config | 否 | 复用已有配置文件（使用其中的 ignoreFiles） |

  输出示例（控制台）：
  ```
  ==== 静态中文常量检测结果 ====
  [array] week (7) = 星期日、星期一、星期二、星期三、星期四 @ src/utils/date.ts:3
  [string] today = "今天" @ src/utils/date.ts:12
  ============================
  ```

  CSV 列说明：
  | name | type | value_count | value_preview | file | line |

  后续处理建议：
  - 需要运行时切换语言：改为函数或 Proxy 包装（见 README 建议）
  - 不切换语言：保持直接 `t()` 替换即可
  - 大量数组：可以改成 key 生成规则 + 动态取值函数

## 🎯 最佳实践

### 1. 文本编写规范

```javascript
// ✅ 推荐：语义清晰的完整句子
const welcomeMessage = "欢迎使用我们的产品";
const confirmButton = "确认提交";

// ❌ 避免：过于简短或语义不明
const text1 = "的";
const text2 = "确认";  // 缺乏上下文
```

### 2. 动态文本处理

```javascript
// ✅ 推荐：使用模板语法
const message = `您有 ${count} 条未读消息`;
// 扫描结果：您有 {{Identifier1}} 条未读消息

// 使用时：
t('i18n_abc123', { Identifier1: count })
```

### 3. 条件文本处理

```javascript
// ✅ 推荐：完整的条件句子
const statusText = isOnline ? "用户在线" : "用户离线";

// ❌ 避免：拼接式文本
const statusText = "用户" + (isOnline ? "在线" : "离线");
```

### 4. 复数形式处理

```javascript
// 扩展 t 函数支持复数
function t(key, params, options) {
  if (options?.plural !== undefined) {
    const pluralKey = options.plural === 1 ? `${key}_one` : `${key}_other`;
    return getTranslation(pluralKey, params);
  }
  return getTranslation(key, params);
}

// 使用示例
const text = t('message_count', { count }, { plural: count });
```

## 🐛 常见问题

### Q1: 扫描后代码中还有中文没有被替换？

**A:** 检查以下情况：
- 是否在注释中？工具会忽略注释中的文本
- 是否有 `i18n-ignore` 标记？
- 是否在 `testID` 属性中？工具会自动忽略
- 检查文本是否过长（超过32767字符）

### Q2: 替换后的代码格式不正确？

**A:** 使用 `--fixLint` 参数自动修复：
```bash
npm run i18n:replace -- --fixLint
```

### Q3: 如何处理富文本和 HTML？

**A:** 使用参数化翻译：
```javascript
// 原文：点击<a href="#">这里</a>查看详情
// 翻译：点击{{link}}查看详情
t('click_link_detail', {
  link: <a href="#">这里</a>
})
```

### Q4: 模板字符串中的变量如何处理？

**A:** 工具会自动识别并生成占位符：
```javascript
// 原代码
const msg = `欢迎 ${userName}，您的积分是 ${score}`;

// 扫描结果
"欢迎 {{Identifier1}}，您的积分是 {{Identifier2}}"

// 使用时
t('welcome_score', { Identifier1: userName, Identifier2: score })
```

## 📞 技术支持

如遇到问题，请通过以下方式联系：

1. **GitHub Issues**: [https://github.com/hecom-rn/i18n-tools/issues](https://github.com/hecom-rn/i18n-tools/issues)
2. **内部技术群**: 联系项目维护人员
3. **文档更新**: 发现文档问题请提交 PR

## 📝 更新日志

### v1.0.3
- ✅ 支持 testID 自动忽略
- ✅ 优化 JSXText 替换支持
- ✅ 清理调试日志输出
- ✅ 改进行号定位准确性

### v1.0.2
- ✅ 支持模板字符串扫描和替换
- ✅ 添加注释忽略功能
- ✅ 优化 Excel 输出格式

### v1.0.1
- ✅ 基础扫描和替换功能
- ✅ Excel 导入导出支持
- ✅ GitLab 链接生成

---

**最后更新**: 2025年9月9日  
**维护团队**: HECOM 前端团队
