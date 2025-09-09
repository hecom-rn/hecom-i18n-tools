#!/bin/bash
# 自动同步翻译数据

echo "🔄 开始自动同步..."

# 备份原文件
if [ -f translations.xlsx ]; then
    cp translations.xlsx "backups/translations/translations-$(date +%Y%m%d_%H%M%S).xlsx"
    echo "✅ 已创建备份"
fi

# 执行同步
npm run i18n:sync

# 检查变更
if git diff --quiet translations.xlsx 2>/dev/null; then
    echo "✅ 无翻译数据变更"
else
    echo "📝 检测到翻译数据变更"
    # 生成变更日志
    echo "## 翻译数据变更 - $(date)" >> CHANGELOG.md
    grep -E "^- ✅|^- 📍|^- ➕|^- ⚠️" sync-report.md >> CHANGELOG.md 2>/dev/null || true
fi
