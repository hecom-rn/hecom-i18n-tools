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
    // 按 key 去重：相同 key 时以 srcRows 为准（覆盖旧行），保留无 key 的行
    const byKey = new Map<string, any>();
    for (const r of masterRows) {
      if (r.key) byKey.set(String(r.key), r);
    }
    for (const r of srcRows) {
      if (r.key) byKey.set(String(r.key), r);
    }
    const noKeyRows = masterRows.concat(srcRows).filter((r) => !r.key);
    const rows = [...byKey.values(), ...noKeyRows].sort(rowComparator);
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

// ----------------------------- 翻译质量校验 --------------------------------

/**
 * 翻译质量问题类型
 * - CJK_IN_NON_ZH: 非中文语言包含中文字符（如俄语翻译里出现"业务"）
 * - PROMPT_LEAK: 译文包含 LLM prompt 关键词（说明 LLM 回显了 prompt 内容）
 * - BUTTON_LABEL_TOO_LONG: button-label 译文超过阈值（违反极简规则）
 */
export type ValidationIssueType =
  | 'CJK_IN_NON_ZH'
  | 'PROMPT_LEAK'
  | 'BUTTON_LABEL_TOO_LONG';

export interface ValidationIssue {
  sheet: string;
  key: string;
  lang: string;
  zh: string;
  value: string;
  category: string;
  issue: ValidationIssueType;
}

export interface ValidateOptions {
  /** button-label 译文最大字符数（默认 30） */
  maxButtonLabelLen?: number;
}

// 检测 CJK 字符（中日韩统一表意文字基本平面 + 扩展 A）
// 1-鿿 = U+4E00..U+9FFF 基本平面；㐀-䶿 = U+3400..U+4DBF 扩展 A
const CJK_REGEX = /[一-鿿㐀-䶿]/;

// LLM prompt 关键词（用于检测 prompt 回显）。仅检测多语言中稳定出现的高熵短语，
// 避免误报普通翻译中含"Catég"等子串的合法条目。
const PROMPT_MARKERS: string[] = [
  '【硬性约束',
  '硬性限制',
  '【жёстк', // 俄文 "жёсткое/жёсткие ограничения"
  'Restrição obrigatória', // 葡
  'Contrainte stricte', // 法
  'Restricción obligatoria', // 西
  'Catégorie : button-label', // 法尾部泄漏
  'Categoría: button-label', // 西尾部泄漏
  'target_lang', // 多语言共有的 prompt 变量名
  '文案：{text}', // 中日泰等翻译源格式
  'Texto:',
  'Texte :',
];

const VALIDATION_RESERVED_HEADERS = new Set([
  'key', 'file', 'line', 'gitlab', 'value', 'category', 'zh',
]);

/**
 * 解析 master.xlsx 工作表为统一的 {col -> value} 格式。
 * 容错处理两种已知结构：
 * 1. 标准结构：row 0 是表头（A 列起），row 1+ 是数据
 * 2. 历史遗留结构：row 0 的 A-L 列是表头（key/gitlab/...）但 M-X 列也是数字表头；
 *    row 1 的 M-X 是表头（key/gitlab/...）副本；row 2+ 的 M-X 才是数据。
 *    （mergeWorkbookIntoMaster 早期版本的产物：数据落在了 M-X 列）
 * 这种情况直接用默认 sheet_to_json 时 row.key 永远为空（数据在 row['0']）。
 *
 * 返回：{ header: string[], rows: Array<Record<string, string>> }。
 * header[i] 是第 i 列的语义名；rows[i][colName] 是该行该列的值。
 */
function parseSheetRows(ws: any): { header: string[]; rows: Array<Record<string, string>> } {
  const arr: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (arr.length === 0) return { header: [], rows: [] };

  // 检测真实表头行：候选为 row 0 或 row 1。
  // 历史遗留结构（mergeWorkbookIntoMaster 早期版本产物）：
  //   row 0：A-L 是 named headers ('key','gitlab',...,'category')，M-X 是数字 headers ('0','1',...)
  //   row 1：A-L 全空，M-X 才是真实的 named headers
  //   row 2+：A-L 全空，M-X 是真实数据
  // 默认按 row 0 当表头时 row.key 永远为空；按 row 1 当表头时 row.key 才是真实 key。
  // 检测方法：分别用 row 0 / row 1 当表头，看后续数据行里 row.key 非空的条数，取较多的那个。
  const findKeyHits = (headerIdx: number): number => {
    if (headerIdx < 0 || headerIdx >= arr.length) return 0;
    const header = arr[headerIdx].map((c) => String(c ?? ''));
    const keyColIdx = header.indexOf('key');
    if (keyColIdx < 0) return 0;
    let hits = 0;
    for (let i = headerIdx + 1; i < arr.length; i++) {
      const v = arr[i][keyColIdx];
      if (typeof v === 'string' && v.startsWith('i18n_rn_')) hits++;
    }
    return hits;
  };

  let headerRowIdx = arr.findIndex(
    (r) => Array.isArray(r) && r.some((c) => c === 'key')
  );
  if (headerRowIdx < 0) headerRowIdx = 0;

  // 在候选行附近（0~3 行）选一个 row.key 命中率最高的，避免误选
  let bestIdx = headerRowIdx;
  let bestHits = findKeyHits(headerRowIdx);
  for (let i = 0; i <= Math.min(headerRowIdx + 3, arr.length - 1); i++) {
    if (i === headerRowIdx) continue;
    const hits = findKeyHits(i);
    if (hits > bestHits) {
      bestHits = hits;
      bestIdx = i;
    }
  }
  headerRowIdx = bestIdx;

  const header = arr[headerRowIdx].map((c) => String(c ?? ''));
  const dataRows = arr.slice(headerRowIdx + 1);
  const rows = dataRows.map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      const name = header[i];
      if (!name) continue;
      obj[name] = String(r[i] ?? '');
    }
    return obj;
  });
  return { header, rows };
}

/**
 * 校验 master.xlsx 中的翻译质量，识别常见 LLM 输出问题：
 * 1. 非中文语言包含中文字符（语言混淆，例如俄文混入"业务"）
 * 2. 译文含 LLM prompt 关键词（prompt 回显）
 * 3. button-label 译文过长（违反 prompt-i18n.txt 极简规则）
 *
 * 任何 issue 都意味着 LLM 输出不可信，应中止后续 i18n:gen 防止脏数据落盘到 locales。
 *
 * @param masterPath master.xlsx 路径
 * @param opts 校验选项
 * @returns 问题列表；返回 [] 表示无问题
 */
export function validateTranslations(
  masterPath: string,
  opts: ValidateOptions = {}
): ValidationIssue[] {
  const maxLen = opts.maxButtonLabelLen ?? 30;
  if (!fs.existsSync(masterPath)) {
    throw new Error(`[i18n-validate] master.xlsx 不存在: ${masterPath}`);
  }
  const wb = xlsx.readFile(masterPath);
  const issues: ValidationIssue[] = [];

  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const { rows } = parseSheetRows(ws);
    rows.forEach((row) => {
      if (!row.key) return;
      const cat = row.category || 'normal';
      const key = String(row.key);
      const zh = row.zh || '';
      Object.keys(row).forEach((col) => {
        if (VALIDATION_RESERVED_HEADERS.has(col)) return;
        const v = row[col];
        if (!v || typeof v !== 'string') return;
        // 检查1: 非中文语言包含 CJK 字符
        if (CJK_REGEX.test(v)) {
          issues.push({
            sheet: sheetName,
            key,
            lang: col,
            zh,
            value: v,
            category: cat,
            issue: 'CJK_IN_NON_ZH',
          });
        }
        // 检查2: 含 prompt 关键词（仅在值足够长时才报，避免单词误中）
        if (v.length >= 12 && PROMPT_MARKERS.some((m) => v.includes(m))) {
          issues.push({
            sheet: sheetName,
            key,
            lang: col,
            zh,
            value: v,
            category: cat,
            issue: 'PROMPT_LEAK',
          });
        }
        // 检查3: button-label 超长
        if (cat === 'button-label' && v.length > maxLen) {
          issues.push({
            sheet: sheetName,
            key,
            lang: col,
            zh,
            value: v,
            category: cat,
            issue: 'BUTTON_LABEL_TOO_LONG',
          });
        }
      });
    });
  });

  return issues;
}

/**
 * 打印校验问题到 stderr，按 issue 类型分组。
 * 无问题时打印成功提示到 stdout。
 */
export function printValidationIssues(issues: ValidationIssue[]): void {
  if (issues.length === 0) {
    console.log('[i18n-validate] ✅ 所有翻译通过校验');
    return;
  }
  // 按 issue 类型分组
  const groups = new Map<ValidationIssueType, ValidationIssue[]>();
  issues.forEach((iss) => {
    if (!groups.has(iss.issue)) groups.set(iss.issue, []);
    groups.get(iss.issue)!.push(iss);
  });
  const labels: Record<ValidationIssueType, string> = {
    CJK_IN_NON_ZH: '非中文语言含中文字符',
    PROMPT_LEAK: '译文含 prompt 关键词',
    BUTTON_LABEL_TOO_LONG: 'button-label 译文超长',
  };
  console.error(`[i18n-validate] ❌ 发现 ${issues.length} 处翻译质量问题：`);
  groups.forEach((items, type) => {
    console.error(`\n  [${type}] ${labels[type]} (${items.length} 条)`);
    items.forEach((iss) => {
      const sample =
        iss.value.length > 80 ? iss.value.slice(0, 80) + '...' : iss.value;
      console.error(
        `    ${iss.sheet}/${iss.lang} ${iss.key} (cat=${iss.category})`
      );
      console.error(`      zh: ${JSON.stringify(iss.zh)}`);
      console.error(`      ${iss.lang}: ${JSON.stringify(sample)}`);
    });
  });
  console.error(`\n请修复 master.xlsx 中上述条目后重试。`);
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

  // 遍历所有工作表，构建 langMap 和 keyCategoryMap
  // 记录每个 key 的 category（来自 Excel 的 category 列），用于 gen 阶段决定是否覆盖现有翻译
  const keyCategoryMap: Record<string, string> = {};
  // 记录每个 key 的全部 row 是否至少有一个是 normal。Mixed (button-label + normal 共存) 的 key
  // 视为 normal：跳过覆写，避免 buttonLabelRules 误判误改非按钮文案。
  const keyHasNormal: Record<string, boolean> = {};
  const GEN_RESERVED_HEADERS = new Set(['key', 'file', 'line', 'gitlab', 'value', 'category']);
  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws);
    rows.forEach((row: any) => {
      if (!row.key) return;
      if (row.category) {
        // 收集每个 key 出现过的所有 category
        if (row.category === 'normal') keyHasNormal[row.key] = true;
        // 写入策略：若该 key 出现 normal 行，视为 normal（不覆写）；否则按最后一次 row 的 category
        if (!keyHasNormal[row.key]) {
          keyCategoryMap[row.key] = row.category;
        }
      }
      Object.keys(row).forEach((k) => {
        if (!GEN_RESERVED_HEADERS.has(k)) {
          if (!langMap[k]) langMap[k] = {};
          langMap[k][row.key] = row[k];
        }
      });
    });
  });

  // 检测冲突（仅对非 button-label 条目报警；button-label 是预期覆盖，不算冲突）
  Object.keys(langMap).forEach((lang) => {
    const outputPath = path.join(out, `${lang}.json`);
    if (!fs.existsSync(outputPath)) return;
    try {
      const existingLangMap: Record<string, string> = JSON.parse(
        fs.readFileSync(outputPath, 'utf8')
      );
      Object.keys(langMap[lang]).forEach((k) => {
        // safe button-label 类条目预期会被新译文覆盖，跳过冲突检测（避免误报）
        // mixed key（button-label + normal 共存）也跳过冲突检测（视为 normal，不覆写）
        if (keyCategoryMap[k] === 'button-label' && !keyHasNormal[k]) return;
        if (keyHasNormal[k]) return; // mixed key 视为 normal，不报警
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

    throw new Error(
      `[i18n-gen] 检测到翻译冲突 (${summary})，已保留原有 JSON 中的旧翻译，未覆盖。` +
      `请查看冲突报告 ${reportPath} 处理后重试。`
    );
  }

// 写入语言包文件
  //   - 新 key：直接追加
  //   - 已有 key + category='button-label' + 全 row 都是 button-label：用新译文覆盖（AI 按 prompt-i18n.txt 重新润色）
  //   - 已有 key + 任意 row 是 normal（含 mixed 情况）：保留原值（避免误改 normal 文案）
  fs.mkdirSync(out, { recursive: true });
  let overriddenCount = 0;
  Object.keys(langMap).forEach((lang) => {
    const outputPath = path.join(out, `${lang}.json`);
    let finalMap: Record<string, string> = { ...langMap[lang] };
    if (fs.existsSync(outputPath)) {
      try {
        const existingLangMap: Record<string, string> = JSON.parse(
          fs.readFileSync(outputPath, 'utf8')
        );
        // 以原有 JSON 为基础（保留原有值及其顺序）
        finalMap = { ...existingLangMap };
        Object.keys(langMap[lang]).forEach((k) => {
          const newVal = langMap[lang][k];
          const hasNewTranslation = newVal != null && String(newVal).trim() !== '';
          if (!Object.prototype.hasOwnProperty.call(existingLangMap, k)) {
            // 新 key：直接追加
            finalMap[k] = newVal;
          } else if (
            keyCategoryMap[k] === 'button-label' &&
            !keyHasNormal[k] &&
            hasNewTranslation
          ) {
            // 安全 button-label 类条目（所有 row 都是 button-label，无 normal 行）：
            // 用新译文覆盖（润色）。Mixed (button-label + normal 共存) 的 key 跳过覆写。
            if (finalMap[k] !== newVal) overriddenCount++;
            finalMap[k] = newVal;
          }
          // 其它情况（normal/mixed + 已有 key）：保留现有值，不写入
        });
      } catch (e) {
        console.warn(`读取现有文件 ${outputPath} 失败，忽略旧内容: ${e}`);
      }
    }
    fs.writeFileSync(outputPath, JSON.stringify(finalMap, null, 2), 'utf8');
    console.log(`生成: ${lang}.json`);
  });
  if (overriddenCount > 0) {
    console.log(`[i18n-gen] 已按 category='button-label' 覆盖 ${overriddenCount} 条历史翻译`);
  }
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