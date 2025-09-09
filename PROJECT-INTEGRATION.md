# 在项目中集成HECOM I18N Tools同步功能

## 📦 安装方式

### 方式1：全局安装（推荐）
```bash
npm install -g hecom-i18n-tools
# 或
yarn global add hecom-i18n-tools
```

### 方式2：项目本地安装
```bash
npm install --save-dev hecom-i18n-tools
# 或
yarn add -D hecom-i18n-tools
```

## 📁 项目结构建议

```
your-project/
├── src/                    # 源代码目录
│   ├── components/         # 组件目录
│   ├── pages/             # 页面目录
│   └── utils/
│       └── i18n.js        # 国际化工具
├── locales/               # 语言包目录
│   ├── zh.json
│   ├── en.json
│   └── ja.json
├── translations.xlsx      # 主翻译文件
├── package.json
└── i18n-scripts/         # 国际化脚本目录
    ├── sync-translations.js
    └── auto-sync.sh
```

## 🔧 package.json 配置

```json
{
  "scripts": {
    "i18n:scan": "hecom-i18n-tools scan -s src -o translations.xlsx",
    "i18n:sync": "hecom-i18n-tools sync -e translations.xlsx -s src -r sync-report.md",
    "i18n:replace": "hecom-i18n-tools replace -e translations.xlsx --importPath utils/i18n",
    "i18n:gen": "hecom-i18n-tools gen -e translations.xlsx -o locales",
    "i18n:full-sync": "npm run i18n:sync && npm run i18n:gen",
    "pre-commit-i18n": "npm run i18n:sync && git add translations.xlsx sync-report.md"
  },
  "devDependencies": {
    "hecom-i18n-tools": "^1.0.5"
  }
}
```

## 🔄 实际使用场景和工作流

### **场景1：日常开发中的使用**

#### 开发者日常工作流：
```bash
# 1. 开发新功能，添加了中文文本
# 2. 提交代码前，执行同步
npm run i18n:sync

# 3. 查看同步报告，确认变更
cat sync-report.md

# 4. 如果有新增文本，通知翻译团队
# 5. 提交代码
git add . && git commit -m "feat: 新增用户设置页面"
```

#### 自动化脚本 (i18n-scripts/auto-sync.sh)：
```bash
#!/bin/bash
# 自动同步翻译数据脚本

set -e

echo "🔄 开始自动同步翻译数据..."

# 创建备份
BACKUP_DIR="backups/translations"
mkdir -p $BACKUP_DIR
cp translations.xlsx "$BACKUP_DIR/translations-$(date +%Y%m%d_%H%M%S).xlsx"
echo "✅ 已创建备份"

# 执行同步
npm run i18n:sync

# 检查是否有变更
if git diff --quiet translations.xlsx; then
    echo "✅ 无翻译数据变更"
else
    echo "📝 检测到翻译数据变更："
    git diff --stat translations.xlsx
    
    # 生成变更摘要
    echo "## 翻译数据变更摘要 - $(date)" >> CHANGELOG.md
    echo "- 同步时间: $(date)" >> CHANGELOG.md
    grep -E "^- ✅|^- 📍|^- ➕|^- ⚠️" sync-report.md >> CHANGELOG.md
    echo "" >> CHANGELOG.md
    
    echo "📋 变更摘要已添加到 CHANGELOG.md"
fi

echo "🎉 同步完成！"
```

### **场景2：代码重构后的数据恢复**

#### 重构后的恢复流程：
```bash
# 1. 完成代码重构（文件移动、结构调整等）
git commit -m "refactor: 重构组件结构"

# 2. 执行翻译数据同步
npm run i18n:sync

# 3. 检查同步结果
echo "📊 同步统计："
grep -E "精确匹配|位置更新|新增文本|已删除" sync-report.md

# 4. 验证关键文本是否正确匹配
npm run i18n:verify  # 自定义验证脚本
```

### **场景3：团队协作中的使用**

#### 翻译团队工作流：
```bash
# 翻译人员的日常工作
# 1. 获取最新的翻译文件
git pull origin main

# 2. 执行同步，确保数据最新
npm run i18n:sync

# 3. 检查新增文本
grep "新增文本详情" sync-report.md

# 4. 在Excel中补充翻译
# 5. 生成最新语言包
npm run i18n:gen

# 6. 提交翻译更新
git add translations.xlsx locales/
git commit -m "i18n: 更新英文/日文翻译"
```

### **场景4：CI/CD集成**

#### GitHub Actions 配置 (.github/workflows/i18n-check.yml)：
```yaml
name: I18N Translation Check

on:
  pull_request:
    paths:
      - 'src/**'
      - 'components/**'
      - 'translations.xlsx'

jobs:
  translation-sync:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v3
      
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '16'
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Sync translations
      run: npm run i18n:sync
      
    - name: Check for translation changes
      run: |
        if ! git diff --quiet translations.xlsx; then
          echo "🔄 检测到翻译数据变更"
          git diff --stat translations.xlsx
        else
          echo "✅ 无翻译数据变更"
        fi
        
    - name: Upload sync report
      uses: actions/upload-artifact@v3
      with:
        name: translation-sync-report
        path: sync-report.md
```

## 🎯 **最佳实践建议**

### **1. 同步频率**
- 📅 **每日同步**: 开发活跃期，建议每日执行一次
- 🔄 **提交前同步**: 每次代码提交前自动执行
- 🚀 **发版前全量同步**: 确保所有翻译数据准确

### **2. 数据管理**
- 💾 **定期备份**: 自动创建翻译文件备份
- 📝 **变更记录**: 记录每次同步的详细变更
- 🔍 **质量检查**: 定期验证翻译数据完整性

### **3. 团队协作**
- 📢 **及时通知**: 新增文本自动通知翻译团队
- 🔗 **流程标准化**: 建立标准的翻译工作流程
- 📊 **进度跟踪**: 定期生成翻译完成度报告
