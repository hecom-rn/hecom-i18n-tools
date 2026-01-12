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
  const { excel, out, master, conflictReport } = opts;
  const wb = xlsx.readFile(excel);
  const langMap: Record<string, Record<string, string>> = {};
  // 记录冲突: { lang: { key: { existing: string, incoming: string } } }
  const conflicts: Record<string, Record<string, { existing: string; incoming: string }>> = {};
  
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
  
  // 第一阶段：预检测冲突（严格模式：一旦发现冲突直接终止，不写任何语言包文件）
  Object.keys(langMap).forEach((lang) => {
    const outputPath = path.join(out, `${lang}.json`);
    if (!fs.existsSync(outputPath)) return; // 无旧文件，不会有冲突
    try {
      const existingContent = fs.readFileSync(outputPath, 'utf8');
      const existingLangMap = JSON.parse(existingContent);
      Object.keys(langMap[lang]).forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(existingLangMap, k)) {
          const oldVal = existingLangMap[k];
          const newVal = langMap[lang][k];
            if (oldVal !== newVal) {
              if (!conflicts[lang]) conflicts[lang] = {};
              if (!conflicts[lang][k]) {
                conflicts[lang][k] = { existing: oldVal, incoming: newVal };
              }
            }
        }
      });
    } catch (e) {
      console.warn(`读取旧文件以检测冲突失败 ${outputPath}: ${e}`);
    }
  });

  const hadConflicts = Object.keys(conflicts).length > 0;
  if (hadConflicts) {
    // 若提供 conflictReport，则尝试读取并应用选择
    let allResolved = false;
    if (conflictReport && fs.existsSync(conflictReport)) {
      try {
        const reportJson = JSON.parse(fs.readFileSync(conflictReport, 'utf8'));
        // 验证并应用选择
        allResolved = true;
        Object.entries(conflicts).forEach(([lang, ks]) => {
          const langReport = reportJson[lang];
          if (!langReport) { allResolved = false; return; }
          Object.entries(ks).forEach(([key, pair]) => {
            const item = langReport[key];
            if (!item || typeof item !== 'object') { allResolved = false; return; }
            const sel = item.selected;
            if (sel == null) { allResolved = false; return; }
            if (!langMap[lang]) langMap[lang] = {};
            if (sel === 'existing') {
              // 保留旧值
              langMap[lang][key] = pair.existing;
            } else if (sel === 'incoming') {
              // 维持新值（langMap 已设为 incoming）
              // 确保存在
              langMap[lang][key] = pair.incoming;
            } else if (typeof sel === 'string') {
              // 自定义覆盖值
              langMap[lang][key] = sel;
            } else {
              allResolved = false;
            }
          });
        });
      } catch (e) {
        console.warn(`读取冲突报告失败，将生成新的报告: ${e}`);
      }
    }

    if (!allResolved) {
      const summary = Object.entries(conflicts).map(([lang, ks]) => `${lang}:${Object.keys(ks).length}`).join(', ');
      console.error(`发现翻译冲突 (${summary})。需先在冲突报告中选择处理方式后再重试。`);
      try {
        fs.mkdirSync(out, { recursive: true });
        const reportPath = path.join(out, 'conflicts.json');
        // 如果已有旧的 conflicts.json，直接覆盖（保留简洁性）；如需历史版本可自行备份。
        const selectable = Object.fromEntries(
          Object.entries(conflicts).map(([lang, ks]) => [
            lang,
            Object.fromEntries(
              Object.entries(ks).map(([key, pair]) => [
                key,
                { 
                  existing: pair.existing, 
                  incoming: pair.incoming, 
                  zh: langMap['zh']?.[key] || '', 
                  selected: 'incoming' 
                }
              ])
            )
          ])
        );
        fs.writeFileSync(reportPath, JSON.stringify(selectable, null, 2), 'utf8');
        console.error(`冲突详情已写入: ${reportPath}`);
        console.error('编辑该文件，将 selected 设为 "existing" | "incoming" 或自定义字符串，然后使用 --conflict-report 指向该文件再次执行。');
      } catch (e) {
        console.warn(`写入冲突报告失败: ${e}`);
      }
      throw new Error('存在未解决的翻译冲突，生成过程已中断。');
    } else {
      console.log('所有冲突已根据报告选择处理，继续生成语言包。');
    }
  }

  // 第二阶段：写入文件（只有在没有冲突时才执行）
  fs.mkdirSync(out, { recursive: true });
  Object.keys(langMap).forEach((lang) => {
    const outputPath = path.join(out, `${lang}.json`);
    let finalMap = { ...langMap[lang] };
    let existingLangMap: Record<string, string> | null = null;
    if (fs.existsSync(outputPath)) {
      try {
        existingLangMap = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      } catch (e) {
        console.warn(`读取现有文件 ${outputPath} 失败，忽略旧内容: ${e}`);
      }
    }
    if (existingLangMap) {
      // 没有冲突（否则已提前退出），直接合并：新值覆盖旧值
      finalMap = { ...existingLangMap, ...finalMap };
    }
    fs.writeFileSync(outputPath, JSON.stringify(finalMap, null, 2), 'utf8');
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