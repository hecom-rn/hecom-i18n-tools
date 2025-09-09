#!/bin/bash

# HECOM I18N Tools 完整使用演示脚本
# 演示如何在实际项目中使用翻译数据同步功能

echo "🎬 HECOM I18N Tools 项目集成演示"
echo "=================================="

# 模拟项目目录结构
PROJECT_DIR="demo-project"
mkdir -p $PROJECT_DIR/{src/{components,pages,utils},locales,i18n-scripts,backups/translations}

cd $PROJECT_DIR

echo "📁 1. 创建项目结构..."

# 创建示例源码文件
cat > src/components/UserProfile.jsx << 'EOF'
import React from 'react';

function UserProfile({ user }) {
  return (
    <div>
      <h1>用户资料</h1>
      <div className="info">
        <span>用户名: {user.name}</span>
        <span>邮箱地址: {user.email}</span>
        <button>编辑资料</button>
      </div>
      <div className="actions">
        <button>保存修改</button>
        <button>取消操作</button>
      </div>
    </div>
  );
}
EOF

cat > src/pages/SettingsPage.jsx << 'EOF'
import React from 'react';

function SettingsPage() {
  return (
    <div>
      <h2>系统设置</h2>
      <div className="settings">
        <div className="section">
          <h3>账号与安全</h3>
          <button>修改密码</button>
          <button>绑定手机</button>
        </div>
        <div className="section">
          <h3>通知设置</h3>
          <label>
            <input type="checkbox" />
            接收邮件通知
          </label>
        </div>
      </div>
    </div>
  );
}
EOF

# 创建package.json
cat > package.json << 'EOF'
{
  "name": "demo-project",
  "version": "1.0.0",
  "scripts": {
    "i18n:scan": "hecom-i18n-tools scan -s src -o translations.xlsx",
    "i18n:sync": "hecom-i18n-tools sync -e translations.xlsx -s src -r sync-report.md",
    "i18n:replace": "hecom-i18n-tools replace -e translations.xlsx --importPath utils/i18n",
    "i18n:gen": "hecom-i18n-tools gen -e translations.xlsx -o locales",
    "i18n:full-sync": "npm run i18n:sync && npm run i18n:gen"
  }
}
EOF

echo "✅ 项目结构创建完成"
echo ""

echo "🔍 2. 第一次扫描..."
# 执行第一次扫描
hecom-i18n-tools scan -s src -o translations.xlsx 2>/dev/null || echo "请确保已安装 hecom-i18n-tools"

echo "📊 扫描结果："
if [ -f translations.xlsx ]; then
    echo "- 生成翻译文件: translations.xlsx"
    echo "- 发现中文文本若干条"
else
    echo "- 模拟：发现12条中文文本"
    echo "- 模拟：生成 translations.xlsx"
fi

echo ""

echo "🔧 3. 模拟代码重构..."
# 模拟文件移动和内容修改
mkdir -p src/components/user
mv src/components/UserProfile.jsx src/components/user/Profile.jsx

# 模拟添加新的中文文本
cat >> src/components/user/Profile.jsx << 'EOF'

      <div className="footer">
        <span>最后更新时间</span>
        <button>返回首页</button>
      </div>
EOF

echo "- 文件移动: UserProfile.jsx -> user/Profile.jsx"
echo "- 新增中文文本: '最后更新时间', '返回首页'"

echo ""

echo "🔄 4. 执行智能同步..."
# 执行同步操作
echo "正在同步翻译数据..."

# 模拟同步结果
cat > sync-report.md << 'EOF'

# 翻译数据同步报告

## 📊 统计信息
- ✅ 精确匹配: 10 条
- 📍 位置更新: 6 条
- ➕ 新增文本: 2 条
- ⚠️ 已删除: 0 条

## 📍 位置更新详情
- "用户资料" -> src/components/user/Profile.jsx:5
- "用户名" -> src/components/user/Profile.jsx:7
- "邮箱地址" -> src/components/user/Profile.jsx:8
- "编辑资料" -> src/components/user/Profile.jsx:9
- "保存修改" -> src/components/user/Profile.jsx:12
- "取消操作" -> src/components/user/Profile.jsx:13

## ➕ 新增文本详情
- "最后更新时间" at src/components/user/Profile.jsx:18
- "返回首页" at src/components/user/Profile.jsx:19

## ⚠️ 已删除文本详情

---
生成时间: $(date)
EOF

echo "✅ 同步完成！"
cat sync-report.md

echo ""

echo "📋 5. 创建自动化脚本..."
# 创建自动同步脚本
cat > i18n-scripts/auto-sync.sh << 'EOF'
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
EOF

chmod +x i18n-scripts/auto-sync.sh

echo "✅ 自动化脚本创建完成"

echo ""

echo "🎯 6. 最佳实践演示..."

echo "📅 定期同步策略："
echo "- 每日自动同步: crontab -e 添加 '0 9 * * * cd /path/to/project && ./i18n-scripts/auto-sync.sh'"
echo "- 提交前同步: git hook pre-commit"
echo "- CI/CD集成: GitHub Actions / GitLab CI"

echo ""

echo "👥 团队协作流程："
echo "1. 开发者: 开发 -> 同步 -> 提交"
echo "2. 翻译者: 拉取 -> 翻译 -> 生成语言包 -> 提交"
echo "3. 测试者: 验证 -> 反馈"
echo "4. 发布者: 最终同步 -> 发版"

echo ""

echo "🎉 演示完成！"
echo "=================================="
echo "📂 演示项目位置: $(pwd)"
echo "📝 同步报告: sync-report.md"
echo "🔧 自动脚本: i18n-scripts/auto-sync.sh"
echo ""
echo "🚀 开始使用："
echo "1. npm install -g hecom-i18n-tools"
echo "2. npm run i18n:scan    # 扫描中文文本"  
echo "3. npm run i18n:sync    # 智能同步位置"
echo "4. npm run i18n:replace # 替换为i18n函数"
echo "5. npm run i18n:gen     # 生成语言包"

cd ..
echo ""
echo "💡 提示: 可以查看 $PROJECT_DIR 目录了解完整的项目结构"
