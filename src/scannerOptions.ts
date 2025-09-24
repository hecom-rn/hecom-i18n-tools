export default {
    // 自定义翻译函数
    async translate(text: string) {
        // 这里可以实现真实的翻译逻辑
        // 例如调用翻译API
        return undefined;
    },

    // 自定义哈希生成函数
    generateStableHash(str: string) {
        // 用户可以实现自己的哈希算法
        return require('crypto').createHash('sha256').update(str).digest('hex').substring(0, 16);
    },

    // 自定义忽略文件列表
    ignoreFiles: [] as string[],
    // 追加：自定义忽略日志对象，如 ['Sentry']
    ignoreLogObjects: [] as string[],
    // 追加：自定义忽略日志方法，如 ['captureMessage']
    ignoreLogMethods: [] as string[],
};