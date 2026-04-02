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

// ----------------------------- 邮件发送 ------------------------------------

interface EmailConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };
  from: string;
  to: string | string[];
}

type ConflictMap = Record<
  string,
  Record<string, { existing: string; incoming: string; zh?: string }>
>;

async function sendGenEmail(
  langMap: Record<string, Record<string, string>>,
  conflicts: ConflictMap,
  emailConfig: EmailConfig,
  conflictReportPath?: string
): Promise<void> {
  let nodemailer: any;
  try {
    const _nm = require('nodemailer');
    nodemailer = _nm.default || _nm;
  } catch {
    console.warn(
      '[i18n-gen] 未安装 nodemailer，跳过邮件发送。请运行: npm install nodemailer'
    );
    return;
  }

  if (!emailConfig.smtp?.host || !emailConfig.from || !emailConfig.to) {
    console.warn(
      '[i18n-gen] email 配置不完整，跳过邮件发送。\n' +
      '请确保 i18nScannerOptions.js 中配置了完整的 email 对象，格式如下：\n' +
      '  email: {\n' +
      '    smtp: { host: "smtp.xxx.com", port: 465, secure: true, auth: { user: "...", pass: "..." } },\n' +
      '    from: "sender@xxx.com",\n' +
      '    to: ["mashuai@hecom.cn"]\n' +
      '  }'
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port,
    secure: emailConfig.smtp.secure,
    auth: emailConfig.smtp.auth,
  });

  const recipients = Array.isArray(emailConfig.to)
    ? emailConfig.to.join(', ')
    : emailConfig.to;

  const conflictCount = Object.values(conflicts).reduce(
    (sum, ks) => sum + Object.keys(ks).length,
    0
  );
  const langCount = Object.keys(langMap).length;
  const keyCount = Object.keys(Object.values(langMap)[0] ?? {}).length;
  const date = new Date().toLocaleDateString('zh-CN');
  const hasConflicts = conflictCount > 0;

  const conflictRows = Object.entries(conflicts).flatMap(([lang, keys]) =>
    Object.entries(keys).map(
      ([key, pair]) =>
        `<tr>
          <td style="padding:4px 8px">${lang}</td>
          <td style="padding:4px 8px;font-family:monospace">${key}</td>
          <td style="padding:4px 8px">${pair.zh ?? ''}</td>
          <td style="padding:4px 8px">${pair.existing}</td>
          <td style="padding:4px 8px">${pair.incoming}</td>
        </tr>`
    )
  );

  const conflictSection = hasConflicts ? `
    <h3 style="color:#c0392b">冲突详情（共 ${conflictCount} 条，已保留原有值，如需更新请手动处理）</h3>
    <table border="1" cellpadding="0" cellspacing="0"
           style="border-collapse:collapse;font-size:13px;width:100%">
      <thead style="background:#f5f5f5">
        <tr>
          <th style="padding:6px 8px">语言</th>
          <th style="padding:6px 8px">Key</th>
          <th style="padding:6px 8px">中文原文</th>
          <th style="padding:6px 8px">原有值（已保留）</th>
          <th style="padding:6px 8px">新值</th>
        </tr>
      </thead>
      <tbody>${conflictRows.join('')}</tbody>
    </table>` : `<p style="color:#27ae60">✅ 本次生成无翻译冲突。</p>`;

  const html = `
    <h2 style="color:#333">i18n 语言包生成报告</h2>
    <p>生成时间：${new Date().toLocaleString('zh-CN')}</p>
    <p>共生成 <strong>${langCount}</strong> 个语言包，<strong>${keyCount}</strong> 个 key</p>
    ${conflictSection}
    <p style="color:#888;font-size:12px">由 hecom-i18n-tools 自动发送</p>
  `;

  const subject = hasConflicts
    ? `[i18n] 语言包生成报告 ${date}（⚠️ ${conflictCount} 条冲突）`
    : `[i18n] 语言包生成报告 ${date}（✅ 无冲突）`;

  const attachments: any[] = [];
  if (conflictReportPath && fs.existsSync(conflictReportPath)) {
    attachments.push({
      filename: path.basename(conflictReportPath),
      path: conflictReportPath,
    });
  }

  try {
    await transporter.sendMail({
      from: emailConfig.from,
      to: recipients,
      subject,
      html,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    console.log(`[i18n-gen] 生成报告邮件已发送至: ${recipients}`);
    // 作为附件发送成功后删除 conflicts.json，避免提交到代码库
    if (conflictReportPath && fs.existsSync(conflictReportPath)) {
      try {
        fs.unlinkSync(conflictReportPath);
        console.log(`[i18n-gen] 已删除冲突报告文件: ${conflictReportPath}`);
      } catch (e) {
        console.warn(`[i18n-gen] 删除冲突报告文件失败: ${e}`);
      }
    }
  } catch (e) {
    console.warn(`[i18n-gen] 发送生成报告邮件失败: ${e}`);
  }
}

// ----------------------------- 主入口 ------------------------------------

export async function genCommand(opts: any) {
  const { excel, out, master, conflictReport, config } = opts;

  // 从配置文件加载 email 配置
  let emailConfig: EmailConfig | undefined;
  if (config) {
    try {
      const configPath = path.isAbsolute(config)
        ? config
        : path.join(process.cwd(), config);
      const rawConfig = require(configPath);
      const cfg = rawConfig.default || rawConfig;
      if (cfg.email) emailConfig = cfg.email;
    } catch (e) {
      console.warn(`[i18n-gen] 加载配置文件失败: ${e}`);
    }
  }

  const wb = xlsx.readFile(excel);
  const langMap: Record<string, Record<string, string>> = {};
  const conflicts: ConflictMap = {};
  
  // 遍历所有工作表，构建 langMap
  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws);
    rows.forEach((row: any) => {
      if (!row.key) return;
      Object.keys(row).forEach((k) => {
        if (k !== 'key' && k !== 'file' && k !== 'line' && k !== 'gitlab' && k !== 'value') {
          if (!langMap[k]) langMap[k] = {};
          langMap[k][row.key] = row[k];
        }
      });
    });
  });

  // 检测冲突（非阻塞，仅用于生成报告和发送邮件）
  Object.keys(langMap).forEach((lang) => {
    const outputPath = path.join(out, `${lang}.json`);
    if (!fs.existsSync(outputPath)) return;
    try {
      const existingLangMap: Record<string, string> = JSON.parse(
        fs.readFileSync(outputPath, 'utf8')
      );
      Object.keys(langMap[lang]).forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(existingLangMap, k)) {
          const oldVal = existingLangMap[k];
          const newVal = langMap[lang][k];
          // 跳过 Excel 中该 key 无有效值的情况（空格/undefined），避免产生无意义的冲突记录
          if (newVal == null || String(newVal).trim() === '') return;
          if (oldVal !== newVal) {
            if (!conflicts[lang]) conflicts[lang] = {};
            conflicts[lang][k] = {
              existing: oldVal,
              incoming: newVal,
              zh: langMap['zh']?.[k],
            };
          }
        }
      });
    } catch (e) {
      console.warn(`读取旧文件以检测冲突失败 ${outputPath}: ${e}`);
    }
  });

  const hadConflicts = Object.keys(conflicts).length > 0;
  if (hadConflicts) {
    const summary = Object.entries(conflicts)
      .map(([lang, ks]) => `${lang}:${Object.keys(ks).length}`)
      .join(', ');
    console.warn(`[i18n-gen] 检测到翻译差异 (${summary})，已保留原有值，Excel 中的差异已记录到冲突报告。`);

    // 写入冲突报告文件
    const reportPath = conflictReport || path.join(out, 'conflicts.json');
    try {
      fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(conflicts, null, 2), 'utf8');
      console.log(`[i18n-gen] 冲突报告已写入: ${reportPath}`);
    } catch (e) {
      console.warn(`[i18n-gen] 写入冲突报告失败: ${e}`);
    }

    // 发送邮件（有冲突），conflicts.json 作为附件，发送后自动删除
    if (emailConfig) {
      await sendGenEmail(langMap, conflicts, emailConfig, reportPath);
    } else {
      console.warn('[i18n-gen] 未找到 email 配置，跳过邮件发送。请在配置文件中添加 email 字段。');
    }
  }

  // 写入语言包文件（原有值优先，新 key 追加到末尾）
  fs.mkdirSync(out, { recursive: true });
  Object.keys(langMap).forEach((lang) => {
    const outputPath = path.join(out, `${lang}.json`);
    let finalMap: Record<string, string> = { ...langMap[lang] };
    if (fs.existsSync(outputPath)) {
      try {
        const existingLangMap: Record<string, string> = JSON.parse(
          fs.readFileSync(outputPath, 'utf8')
        );
        // 以原有 JSON 为基础（保留原有值及其顺序），仅将 langMap 中的新 key 追加到末尾
        finalMap = { ...existingLangMap };
        Object.keys(langMap[lang]).forEach((k) => {
          if (!Object.prototype.hasOwnProperty.call(existingLangMap, k)) {
            finalMap[k] = langMap[lang][k];
          }
        });
      } catch (e) {
        console.warn(`读取现有文件 ${outputPath} 失败，忽略旧内容: ${e}`);
      }
    }
    fs.writeFileSync(outputPath, JSON.stringify(finalMap, null, 2), 'utf8');
    console.log(`生成: ${lang}.json`);
  });

  console.log('语言包生成完成');

  // 无冲突时也发邮件（生成摘要，无附件）
  if (!hadConflicts) {
    if (emailConfig) {
      await sendGenEmail(langMap, {}, emailConfig);
    } else {
      console.warn('[i18n-gen] 未找到 email 配置，跳过邮件发送。请在配置文件中添加 email 字段。');
    }
  }

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