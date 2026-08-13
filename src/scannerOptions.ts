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
};
