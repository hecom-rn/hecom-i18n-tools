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

  const getFileName = (r: any) => {
    const f = r && r.file != null ? String(r.file) : '';
    return f ? path.basename(f) : '';
  };
  const getLine = (r: any) => {
    const v = r && r.line != null ? Number(r.line) : NaN;
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };
  const rowComparator = (a: any, b: any) => {
    const fa = getFileName(a);
    const fb = getFileName(b);
    if (fa && fb) {
      const cmp = fa.localeCompare(fb);
      if (cmp !== 0) return cmp;
    } else if (fa && !fb) {
      return -1; // 有文件名的排前
    } else if (!fa && fb) {
      return 1; // 无文件名的排后
    }
    // 文件名相同或都缺失，按行号
    const la = getLine(a);
    const lb = getLine(b);
    if (la !== lb) return la - lb;
    return 0;
  };

  srcWb.SheetNames.forEach((sheetName) => {
    const srcWs = srcWb.Sheets[sheetName];
    const srcRows: any[] = xlsx.utils.sheet_to_json(srcWs, { defval: '' });

    const masterWs = masterWb.Sheets[sheetName];
    if (!masterWs) {
      // 主表无此工作表，直接新增
      const sortedSrc = [...srcRows].sort(rowComparator);
      masterWb.Sheets[sheetName] = xlsx.utils.json_to_sheet(sortedSrc);
      if (!masterWb.SheetNames.includes(sheetName)) masterWb.SheetNames.push(sheetName);
      return;
    }

    const masterRows: any[] = xlsx.utils.sheet_to_json(masterWs, { defval: '' });
    // 不去重：直接按顺序追加 srcRows 到 masterRows，并按 file 名 + line 排序
    const rows = masterRows.concat(srcRows).sort(rowComparator);
    // 保留并扩展表头：使用两侧的列并将 key 放到最前（若存在）
    const headerSet = new Set<string>();
    [...masterRows, ...srcRows].forEach((r) => Object.keys(r).forEach((col) => headerSet.add(col)));
    const headersAll = Array.from(headerSet);
    const headers = headersAll.includes('key')
      ? ['key', ...headersAll.filter((h) => h !== 'key')]
      : headersAll;
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