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
    languages: ['en', 'es', 'pt', 'th'] as string[],

    async translate(text: string, lang?: string) {
        return undefined;
    },

    generateStableHash(str: string) {
        return require('crypto').createHash('sha256').update(str).digest('hex').substring(0, 16);
    },

    ignoreFiles: [] as string[],
    ignoreLogObjects: [] as string[],
    ignoreLogMethods: [] as string[],
    // 按钮 label 识别规则（未配置则全部归类为 normal）
    buttonLabelRules: undefined as ButtonLabelRules | undefined,
};
