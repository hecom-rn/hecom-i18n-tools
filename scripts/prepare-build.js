/**
 * git 依赖安装时的构建脚本。
 *
 * npm/yarn 安装 git 依赖只会装 dependencies，不会装 devDependencies，
 * 因此本包自带的 typescript 在这种场景下不可用；这里按需通过 npx 临时取一份
 * typescript 来编译 dist。dist 已存在时直接跳过（npm publish 流程中
 * prepublishOnly 已经构建过，避免重复构建）。
 */
const fs = require('fs');
const { execSync } = require('child_process');

if (fs.existsSync('dist/cli.js')) {
    console.log('[prepare] dist 已存在，跳过构建');
    process.exit(0);
}

console.log('[prepare] 通过 npx 临时取 typescript 构建 dist');
execSync('npx --yes -p typescript@5 tsc', { stdio: 'inherit' });
execSync('chmod +x dist/cli.js');
