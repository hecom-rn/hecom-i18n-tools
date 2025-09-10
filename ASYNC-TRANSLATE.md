# 异步翻译功能使用指南

## 概述

从 v1.0.7 版本开始，`hecom-i18n-tools` 支持异步翻译功能。这允许你在扫描过程中调用真实的翻译 API 服务，如 Google Translate、百度翻译、腾讯翻译等。

## 功能特点

- ✅ 支持异步翻译 API 调用
- ✅ 并行处理多个翻译请求，提高效率
- ✅ 错误处理和重试机制友好
- ✅ 完全向后兼容同步翻译函数

## 配置示例

### 基本异步翻译配置

```javascript
// async-translate.config.js
module.exports = {
  async translate(text) {
    // 调用翻译 API
    try {
      const response = await fetch('https://api.your-translate-service.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          from: 'zh',
          to: 'en'
        })
      });
      
      const result = await response.json();
      return result.translation;
    } catch (error) {
      console.error('翻译失败:', error);
      return undefined; // 返回 undefined 表示翻译失败
    }
  }
};
```

### Google Translate API 示例

```javascript
// google-translate.config.js
const { Translate } = require('@google-cloud/translate').v2;

module.exports = {
  async translate(text) {
    const translate = new Translate({
      projectId: 'your-project-id',
      keyFilename: 'path/to/service-account-key.json',
    });

    try {
      const [translation] = await translate.translate(text, 'en');
      return translation;
    } catch (error) {
      console.error('Google 翻译失败:', error);
      return undefined;
    }
  }
};
```

### 百度翻译 API 示例

```javascript
// baidu-translate.config.js
const crypto = require('crypto');
const https = require('https');

module.exports = {
  async translate(text) {
    const appid = 'your-app-id';
    const key = 'your-secret-key';
    const salt = Date.now();
    const from = 'zh';
    const to = 'en';
    
    // 生成签名
    const str1 = appid + text + salt + key;
    const sign = crypto.createHash('md5').update(str1).digest('hex');
    
    const params = new URLSearchParams({
      q: text,
      from: from,
      to: to,
      appid: appid,
      salt: salt,
      sign: sign
    });
    
    try {
      const response = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`);
      const result = await response.json();
      
      if (result.trans_result && result.trans_result.length > 0) {
        return result.trans_result[0].dst;
      }
      return undefined;
    } catch (error) {
      console.error('百度翻译失败:', error);
      return undefined;
    }
  }
};
```

## 使用方法

### 1. 创建配置文件

创建一个包含异步翻译函数的配置文件：

```bash
# 使用提供的示例配置
cp async-translate.config.js my-translate.config.js

# 或者创建自己的配置
nano my-translate.config.js
```

### 2. 运行扫描命令

```bash
# 使用配置文件运行扫描
hecom-i18n-tools scan -s src -o output.xlsx -c my-translate.config.js
```

### 3. 查看结果

扫描完成后，Excel 文件的 "en" 列将包含翻译结果。

## 性能优化

### 并行处理

工具会自动并行处理翻译请求，以提高效率。你可以在翻译函数中实现请求限流：

```javascript
// rate-limited-translate.config.js
const pLimit = require('p-limit');
const limit = pLimit(5); // 限制并发数为 5

module.exports = {
  async translate(text) {
    return limit(async () => {
      // 你的翻译逻辑
      return await callTranslateAPI(text);
    });
  }
};
```

### 缓存机制

实现本地缓存以避免重复翻译：

```javascript
// cached-translate.config.js
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'translation-cache.json');
let cache = {};

// 加载缓存
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch (e) {
  cache = {};
}

module.exports = {
  async translate(text) {
    // 检查缓存
    if (cache[text]) {
      console.log(`缓存命中: ${text}`);
      return cache[text];
    }

    try {
      // 调用翻译 API
      const translation = await callTranslateAPI(text);
      
      // 保存到缓存
      cache[text] = translation;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      
      return translation;
    } catch (error) {
      console.error('翻译失败:', error);
      return undefined;
    }
  }
};
```

## 错误处理

### 重试机制

```javascript
module.exports = {
  async translate(text, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await callTranslateAPI(text);
      } catch (error) {
        console.warn(`翻译尝试 ${attempt + 1}/${maxRetries} 失败:`, error.message);
        
        if (attempt === maxRetries - 1) {
          console.error('翻译最终失败:', text);
          return undefined;
        }
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
};
```

## 兼容性

- ✅ 完全向后兼容同步翻译函数
- ✅ 支持 Node.js 14+
- ✅ 支持 TypeScript 项目
- ✅ 支持 React Native 项目

## 常见问题

### Q: 如何处理翻译 API 的限流？

A: 使用 `p-limit` 库限制并发请求数，并在翻译函数中添加适当的延迟。

### Q: 翻译失败时会发生什么？

A: 翻译函数返回 `undefined` 时，Excel 中对应的翻译列将为空，不会影响其他功能。

### Q: 如何调试翻译过程？

A: 在翻译函数中添加 `console.log` 语句来跟踪翻译进度和错误。

### Q: 支持批量翻译 API 吗？

A: 可以在翻译函数中实现批量逻辑，但需要自己处理文本的拆分和合并。

## 更新日志

- **v1.0.7**: 添加异步翻译支持
- **v1.0.6**: 增强 React Native 兼容性
- **v1.0.5**: 智能同步功能
