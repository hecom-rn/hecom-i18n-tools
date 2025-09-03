export function generateGitlabUrl(prefix: string, file: string, line: number): string {
  // prefix 形如 https://newgitlab.hecom.cn/rn/RNModules/-/blob/dev
  // file 已为相对路径，无 ../
  return `${prefix}/${file}#L${line}`;
}
