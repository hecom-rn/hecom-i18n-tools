// React Native 项目专用配置
// 使用方式: hecom-i18n-tools scan -s src -o translations.xlsx -c rn.config.js

module.exports = {
  // 忽略文件和目录
  ignoreFiles: [

  ],
  
  // 自定义哈希生成（可选）
  generateStableHash: (str) => {
    const crypto = require('crypto');
    return 'rn_' + crypto.createHash('md5').update(str).digest('hex').substring(0, 12);
  },
  
  // RN特有的测试属性（会被自动忽略）
  testAttributes: [
    'testID',
    'accessibilityLabel', 
    'accessibilityHint',
    'nativeID'
  ],
  
  // 翻译函数（可选）
  translate: (text) => {
    // 可以集成翻译API
    return undefined; // 返回undefined表示需要手动翻译
  }
};
