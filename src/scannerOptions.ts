export interface ButtonLabelRules {
    // JSX 属性名白名单：值若为中文则归类为 button-label
    jsxAttributes?: string[];
    // 函数名白名单：其调用参数中的 ObjectExpression.text 字段归类为 button-label
    alertCallees?: string[];
    // 父链 JSX 元素名白名单：仅当 JSXText 是直接子元素时归类为 button-label
    buttonComponents?: string[];
    // 行级注释标记：字符串字面量所在行的上一行包含该标记则归类为 button-label
    inlineComment?: string;
    // 祖先链最大上溯层数（默认 4），避免误判远处祖先
    ancestorDepth?: number;
}

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
    // 按钮 label 识别规则（未配置则全部归类为 normal）
    buttonLabelRules: undefined as ButtonLabelRules | undefined,
};
