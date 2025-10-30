// 这是一个测试文件
const length = 3;
names.map((item) => item.name).join(', ') +
                (true
                    ? // @i18n-ignore
                      `等${length}人`
                    : '')
const normal = '正常中文';
// @i18n-ignore 下一行字符串应忽略
const ignored = '被忽略的中文';
/* 块注释 i18n-ignore */
const ignored2 = `块注释忽略${length}`;
