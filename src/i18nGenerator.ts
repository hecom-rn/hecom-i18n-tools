import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

export function genCommand(opts: any) {
  const { excel, out } = opts;
  const wb = xlsx.readFile(excel);
  const langMap: Record<string, Record<string, string>> = {};
  
  // 遍历所有工作表
  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws);
    rows.forEach((row: any) => {
      Object.keys(row).forEach((k) => {
        if (k !== 'key' && k !== 'file' && k !== 'line' && k !== 'gitlab' && k !== 'value') {
          if (!langMap[k]) langMap[k] = {};
          langMap[k][row.key] = row[k];
        }
      });
    });
  });
  
  fs.mkdirSync(out, { recursive: true });
  Object.keys(langMap).forEach((lang) => {
    const outputPath = path.join(out, `${lang}.json`);
    // 如果文件已存在，则读取现有内容并合并
    if (fs.existsSync(outputPath)) {
      try {
        const existingContent = fs.readFileSync(outputPath, 'utf8');
        const existingLangMap = JSON.parse(existingContent);
        // 合并现有内容和新内容，新内容优先
        langMap[lang] = { ...existingLangMap, ...langMap[lang] };
      } catch (err) {
        console.warn(`读取现有文件 ${outputPath} 时出错: ${err}`);
      }
    }
    fs.writeFileSync(outputPath, JSON.stringify(langMap[lang], null, 2), 'utf8');
    console.log(`生成: ${lang}.json`);
  });
  console.log('语言包生成完成');
}