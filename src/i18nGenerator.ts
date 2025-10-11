import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

// 将源工作簿合并到主工作簿（按表名、按 key 去重/更新）
function mergeWorkbookIntoMaster(srcPath: string, masterPath: string) {
  if (!masterPath) return;
  const resolvedSrc = path.resolve(srcPath);
  const resolvedMaster = path.resolve(masterPath);
  if (resolvedSrc === resolvedMaster) {
    console.warn('源表与主表路径相同，跳过合并。');
    return;
  }

  // 主表不存在，直接将当前表作为主表
  if (!fs.existsSync(resolvedMaster)) {
    fs.mkdirSync(path.dirname(resolvedMaster), { recursive: true });
    fs.renameSync(resolvedSrc, resolvedMaster);
    console.log(`主表不存在，已将 ${path.basename(resolvedSrc)} 作为主表保存到 ${resolvedMaster}`);
    return;
  }

  const srcWb = xlsx.readFile(resolvedSrc);
  const masterWb = xlsx.readFile(resolvedMaster);

  srcWb.SheetNames.forEach((sheetName) => {
    const srcWs = srcWb.Sheets[sheetName];
    const srcRows: any[] = xlsx.utils.sheet_to_json(srcWs, { defval: '' });

    const masterWs = masterWb.Sheets[sheetName];
    if (!masterWs) {
      // 主表无此工作表，直接新增
      masterWb.Sheets[sheetName] = xlsx.utils.json_to_sheet(srcRows);
      if (!masterWb.SheetNames.includes(sheetName)) masterWb.SheetNames.push(sheetName);
      return;
    }

    const masterRows: any[] = xlsx.utils.sheet_to_json(masterWs, { defval: '' });

    const hasKey = srcRows.some((r) => 'key' in r) || masterRows.some((r) => 'key' in r);
    if (!hasKey) {
      const combined = masterRows.concat(srcRows);
      masterWb.Sheets[sheetName] = xlsx.utils.json_to_sheet(combined);
      return;
    }

    const map = new Map<string, any>();
    masterRows.forEach((r) => {
      const k = r && r.key != null ? String(r.key) : undefined;
      if (k) map.set(k, r);
    });
    srcRows.forEach((r) => {
      const k = r && r.key != null ? String(r.key) : undefined;
      if (!k) return;
      if (map.has(k)) {
        const existing = map.get(k) || {};
        const merged: any = { ...existing };
        Object.keys(r).forEach((col) => {
          const val = (r as any)[col];
          if (val !== undefined && val !== null && val !== '') {
            merged[col] = val;
          }
        });
        map.set(k, merged);
      } else {
        map.set(k, r);
      }
    });

    const rows = Array.from(map.values());
    const headerSet = new Set<string>();
    rows.forEach((r) => Object.keys(r).forEach((col) => headerSet.add(col)));
    const headers = ['key', ...Array.from(headerSet).filter((h) => h !== 'key')];
    masterWb.Sheets[sheetName] = xlsx.utils.json_to_sheet(rows, { header: headers });
  });

  xlsx.writeFile(masterWb, resolvedMaster);
  console.log(`已将 ${path.basename(resolvedSrc)} 合并到主表 ${resolvedMaster}`);
}

export function genCommand(opts: any) {
  const { excel, out, master } = opts;
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

  // 生成语言包后，合并到主 xlsx 并删除当前 xlsx
  if (master) {
    try {
      mergeWorkbookIntoMaster(excel, master);
    } catch (err) {
      console.error(`合并到主表失败: ${err}`);
    } finally {
      try {
        const same = path.resolve(excel) === path.resolve(master);
        if (!same && fs.existsSync(excel)) {
          fs.unlinkSync(excel);
          console.log(`已删除源文件: ${excel}`);
        }
      } catch (e) {
        console.warn(`删除源文件失败: ${e}`);
      }
    }
  }
}