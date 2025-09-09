# 🔄 翻译数据同步工具使用指南

## 📋 **问题背景**

在项目开发过程中，代码重构是常见的操作，但这会带来翻译管理的挑战：

### 常见问题：
- ✅ **行号变化**: 代码调整后，原Excel中记录的行号不再准确
- ✅ **文件移动**: 组件重构导致文件路径发生变化
- ✅ **内容修改**: 原文本可能被修改或删除
- ✅ **新增语言**: Excel中添加了新的语言列，需要同步到新的扫描结果

---

## 🎯 **解决方案**

### **智能匹配算法**
1. **内容哈希匹配** - 优先通过文本内容+文件名生成的哈希进行精确匹配
2. **文本内容匹配** - 如果哈希匹配失败，通过原文本内容进行二次匹配
3. **上下文分析** - 结合代码上下文信息提高匹配准确性

### **数据同步策略**
- 📍 **位置更新**: 自动更新文本的新位置信息（文件路径+行号）
- ➕ **新增识别**: 检测代码中新增的中文文本
- ⚠️ **删除标记**: 标记已删除的文本但保留翻译数据
- 🌐 **语言保持**: 保持现有翻译内容，包括新增的语言列

---

## 💻 **使用方法**

### **命令行使用**

```bash
# 基础用法 - 同步单个源码目录
yarn sync -e translations.xlsx -s src

# 多目录同步
yarn sync -e translations.xlsx -s "src,components,pages"

# 指定输出文件（不覆盖原文件）
yarn sync -e master-translations.xlsx -s src -o synced-translations.xlsx

# 生成详细同步报告
yarn sync -e translations.xlsx -s src -r detailed-sync-report.md
```

### **API使用**

```typescript
import TranslationSyncer from 'hecom-i18n-tools/syncTranslations';

const syncer = new TranslationSyncer('./translations.xlsx');

// 执行同步
const syncResult = syncer.syncTranslations(['src', 'components']);

// 保存结果
syncer.saveSyncedTranslations(syncResult, './synced-translations.xlsx');

// 生成报告
const report = syncer.generateSyncReport(syncResult);
console.log(report);
```

---

## 📊 **同步结果说明**

### **输出统计**
```
🔄 开始同步翻译数据...
📍 更新位置: "用户名" src/components/User.tsx:15 -> src/pages/Profile.tsx:28
➕ 发现新文本: "确认删除" at src/components/Modal.tsx:42
⚠️  文本已删除: "旧按钮文本" from src/old/Button.tsx:20

✅ 同步完成！保存到: synced-translations.xlsx
📊 统计: 匹配125条，更新8条，新增3条，删除2条
```

### **Excel文件结构**
```
| key         | zh      | en           | ja      | ko      | file               | line | hash      | context       | status |
|-------------|---------|--------------|---------|---------|--------------------|----- |-----------|---------------|--------|
| i18n_abc123 | 用户名  | Username     | ユーザー | 사용자명 | src/pages/Profile.tsx | 28   | a1b2c3d4  | ProfilePage   | ACTIVE |
| i18n_def456 | 确认删除| Confirm Delete|         |         | src/components/Modal.tsx| 42   | e5f6g7h8  | ConfirmModal  | ACTIVE |
| i18n_old789 | 旧文本  | Old Text     |         |         | [DELETED] src/old.tsx| 0    | i9j0k1l2  | OldComponent  | DELETED|
```

### **字段说明**
- **key**: 自动生成的唯一标识符
- **zh/en/ja/ko**: 各语言翻译（支持动态语言列）
- **file**: 当前文件路径
- **line**: 当前行号
- **hash**: 内容哈希值（用于精确匹配）
- **context**: 代码上下文信息
- **status**: 状态标记（ACTIVE/DELETED）

---

## 🔍 **工作原理详解**

### **1. 智能内容识别**
```typescript
// 生成内容哈希用于精确匹配
const hash = crypto.createHash('md5')
  .update(`${text}|${path.basename(file)}`)
  .digest('hex')
  .substring(0, 12);
```

### **2. 多层匹配策略**
```typescript
// 第一层：哈希精确匹配
let existingItem = existingByHash.get(currentItem.hash);

// 第二层：文本内容匹配
if (!existingItem) {
  existingItem = existingByText.get(currentItem.zh);
}
```

### **3. 上下文信息提取**
```typescript
// 提取函数名、组件名等上下文
const context = extractContext(path, codeLines, line);
// 示例输出: "UserProfile | const handleClick = () => {"
```

---

## 🚀 **最佳实践**

### **1. 同步频率建议**
- 🔄 **每次重构后**: 立即执行同步操作
- 📅 **定期同步**: 每周执行一次完整同步
- 🚀 **发版前**: 确保所有翻译数据同步完成

### **2. 版本管理**
```bash
# 创建备份
cp translations.xlsx translations-backup-$(date +%Y%m%d).xlsx

# 执行同步
yarn sync -e translations.xlsx -s src -r sync-report.md

# 检查同步报告
cat sync-report.md

# 提交变更
git add translations.xlsx sync-report.md
git commit -m "sync: 更新翻译数据位置信息"
```

### **3. 团队协作**
- 📋 **同步报告**: 每次同步后分享详细报告
- 🔍 **代码审查**: 重构时考虑翻译数据影响
- 📚 **文档更新**: 及时更新翻译相关文档

---

## ⚠️ **注意事项**

### **数据安全**
- ✅ 同步前自动创建备份
- ✅ 保留已删除文本的翻译数据
- ✅ 支持增量同步和全量同步

### **性能优化**
- ⚡ 大项目建议按模块分批同步
- 🎯 使用准确的源码路径减少扫描时间
- 📊 关注同步报告中的性能统计

### **兼容性**
- ✅ 支持所有现有Excel格式
- ✅ 兼容新增的语言列
- ✅ 保持原有数据结构不变

---

## 🛠️ **故障排除**

### **常见问题**

**Q: 同步后某些翻译丢失了？**
A: 检查 `status=DELETED` 的记录，这些是被标记为删除但保留翻译数据的文本。

**Q: 新增的语言列没有同步？**
A: 确保Excel中的语言列名称符合规范，工具会自动检测并保留所有语言列。

**Q: 同步速度很慢？**
A: 使用更精确的 `--src` 路径，避免扫描不必要的目录。

**Q: 哈希匹配失败？**
A: 哈希匹配基于文本内容+文件名，如果都发生变化会回退到文本匹配。

---

## 📈 **进阶用法**

### **自动化工作流**
```bash
#!/bin/bash
# auto-sync.sh - 自动同步脚本

echo "开始自动同步翻译数据..."

# 创建备份
cp translations.xlsx "backup/translations-$(date +%Y%m%d_%H%M%S).xlsx"

# 执行同步
yarn sync -e translations.xlsx -s src,components -r "reports/sync-$(date +%Y%m%d).md"

# 检查是否有变更
if git diff --quiet translations.xlsx; then
  echo "无需更新"
else
  echo "检测到变更，准备提交..."
  git add translations.xlsx reports/
  git commit -m "chore: 自动同步翻译数据 $(date +%Y-%m-%d)"
fi
```

### **集成到CI/CD**
```yaml
# .github/workflows/i18n-sync.yml
name: I18N Sync Check
on: [push, pull_request]

jobs:
  sync-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'
      - name: Install dependencies
        run: yarn install
      - name: Check translation sync
        run: yarn sync -e translations.xlsx -s src -r sync-report.md
      - name: Upload sync report
        uses: actions/upload-artifact@v2
        with:
          name: sync-report
          path: sync-report.md
```

---

通过这套完整的同步解决方案，您可以轻松应对代码重构带来的翻译管理挑战，确保国际化数据的准确性和完整性！ 🌍✨
