/**
 * 文件 / 粘贴内容 → 工具（v3.1）
 *
 * 为什么要有这一层：
 *   站里 34 个本地工具，用户真正的问题是「我手上这个文件该用哪个」，
 *   而不是「我要找一个叫某某的工具」。搜索框要求用户先知道工具名，
 *   这一层把入口反过来：给他一个文件或一段文本，直接推出该去哪。
 *
 * 两条硬约束：
 *   1. **纯函数，不碰 DOM**。浏览器与 Node 测试运行同一份实现，
 *      规则改错了测试会红，而不是等用户点进去才发现「这个工具根本不吃 PDF」。
 *   2. **只推荐真的能接受它的工具**。候选来自注册表里构建期派生的 `accepts`
 *      （由 run.js 的 manifest 算出），不做「看起来像」的猜测。
 */

/* ---------- 文件类型识别 ---------- */

const EXT_KIND = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  svg: 'image',
  avif: 'image',
  heic: 'image',
  ico: 'image',
  pdf: 'pdf',
  json: 'json',
  csv: 'csv',
  tsv: 'csv',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  log: 'text',
  yml: 'text',
  yaml: 'text',
  mp3: 'media',
  wav: 'media',
  m4a: 'media',
  mp4: 'media',
  mov: 'media',
  webm: 'media',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  gz: 'archive',
  tar: 'archive',
};

/** 扩名小写，不带点 */
export function extOf(name) {
  const m = /\.([a-z0-9]+)\s*$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 归成大类：image / pdf / json / csv / text / media / archive / other */
export function fileKind(file) {
  if (!file) return 'other';
  const ext = extOf(file.name);
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('audio/') || type.startsWith('video/')) return 'media';
  if (type.startsWith('text/')) return 'text';
  if (type === 'application/json') return 'json';
  return 'other';
}

const KIND_MAJOR = { image: 'image/', media: 'video/', text: 'text/' };

/** 大类在「同等接受度」时的顺位：图片先压缩，PDF 先合并，这是绝大多数人的第一诉求 */
const PREFERRED = {
  image: ['image-compress', 'image-convert', 'image-resize', 'img-to-pdf', 'exif-strip', 'image-base64', 'qr-decode'],
  pdf: ['pdf-merge'],
  json: ['json-format', 'csv-json'],
  csv: ['csv-json', 'json-format'],
  text: ['word-count', 'text-dedupe', 'markdown-preview'],
  media: [],
  archive: [],
  other: [],
};

/** 单个 accept 词与文件的匹配分：0 表示不接受 */
function scoreOne(token, file) {
  const s = String(token || '').toLowerCase().trim();
  const type = String(file.type || '').toLowerCase();
  const ext = '.' + extOf(file.name);
  const kind = fileKind(file);
  if (!s) return 0;
  if (s === '*/*' || s === '*') return 1; // 什么都能吃，但优先度最低
  if (s.startsWith('.')) return ext === s ? 4 : 0;
  if (s.endsWith('/*')) {
    const major = s.slice(0, -1);
    if (type.startsWith(major)) return 3;
    // 有些来源拿不到 MIME（拖自某些应用、扩展名大写），退化成按大类判断
    const fallback = KIND_MAJOR[kind];
    if (fallback && fallback.startsWith(major)) return 3;
    if (major === 'video/' && kind === 'media') return 2;
    return 0;
  }
  if (type && s === type) return 4;
  return 0;
}

/** 工具整体接受度 = 最强的那条 accept 词的分数 */
export function acceptScore(accepts, file) {
  let best = 0;
  for (const a of accepts || []) best = Math.max(best, scoreOne(a, file));
  return best;
}

/**
 * 把一组文件路由到工具。
 * @param {Array<{name:string,type?:string}>} files 拖入的文件
 * @param {Array<object>} tools 注册表里的工具（需要 id / name / accepts / fileMultiple）
 * @param {{limit?:number}} [opts]
 * @returns {Array<{id:string,name:string,score:number,multiple:boolean,why:string,partial:boolean}>} 由高到低
 *
 * 打分：accept 精确度（10–40）+ 大类顺位加成（0–3）+ 多文件加成（0/1）− 多文件却只吃一个（−5）。
 * 分数只用于排序，不对外展示，避免「87 分」这种让人困惑的数字。
 */
export function routeFiles(files, tools, opts = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return [];
  const limit = opts.limit || 3;
  const limit0 = limit;

  const run = (fl, partial) => {
    // 多个文件时按「最不受欢迎的那个」算接受度：拖了 2 张图 + 1 个 PDF，
    // 不能推一个只吃 PDF 的工具，否则另外两张图会被悄悄丢掉。
    const kinds = [...new Set(fl.map(fileKind))];
    const rankOf = (tool, kind) => {
      const idx = (PREFERRED[kind] || []).indexOf(tool.id);
      // 顺位加成的量级（15 起、每档 −3）刻意大于「accept 精确度」的差（10 分一档）：
      // exif-strip 精确写着 image/jpeg，但用户拖一张 jpg 进来，第一诉求几乎总是「压小」，
      // 不该因为它的 accept 更精确就被排到 image-compress 前面。
      return idx < 0 ? 0 : Math.max(0, 15 - idx * 3);
    };
    const out = [];
    for (const tool of tools || []) {
      const accepts = tool.accepts;
      if (!accepts || !accepts.length) continue;
      let worst = Infinity;
      for (const f of fl) worst = Math.min(worst, acceptScore(accepts, f));
      if (!worst) continue; // 有文件它吃不下，跳过
      const bonus = Math.max(...kinds.map((k) => rankOf(tool, k)));
      const multi = fl.length > 1;
      const multiBonus = multi && tool.fileMultiple ? 1 : 0;
      // 一次拖进来 5 张图，却推一个「只能选 1 个文件」的工具，等于让用户白干 4 次。
      // 罚得比「接受精确度」高一档：它确实接不了这个活，不是「稍差一点」。
      const multiPenalty = multi && !tool.fileMultiple ? 15 : 0;
      out.push({
        id: tool.id,
        name: tool.name,
        score: worst * 10 + bonus + multiBonus - multiPenalty,
        multiple: !!tool.fileMultiple,
        partial,
        why: whyText(accepts[0], fl),
      });
    }
    out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return out.slice(0, limit0);
  };

  let res = run(list, false);
  // 混着拖（图 + PDF）：没有工具能全吃，就退化成「只用第 1 个文件」，
  // 但必须让 UI 说清「只带入了第 1 个」，不能默默丢弃。
  if (!res.length && list.length > 1) res = run(list.slice(0, 1), true);
  return res;
}

function whyText(token, files) {
  const s = String(token || '').toLowerCase();
  if (s === '*/*' || s === '*') return '任意文件';
  if (s === 'image/*') return files.length > 1 ? '接受多张图片' : '接受图片';
  if (s === 'application/pdf') return files.length > 1 ? '接受多个 PDF' : '接受 PDF';
  if (s.startsWith('.')) return '接受 ' + s.slice(1).toUpperCase();
  return '接受 ' + s;
}

/* ---------- 粘贴内容识别 ---------- */

const JWT_RE = /^ey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*$/;
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/i;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const TS10_RE = /^\d{10}$/;
const TS13_RE = /^\d{13}$/;
const B64_RE = /^[A-Za-z0-9+/]{16,}={0,2}$/;

/** Unix 秒/毫秒时间戳的合理区间：1990-01-01 ~ 2100-01-01，防止把身份证号/订单号当时戳 */
const TS_MIN = 631152000;
const TS_MAX = 4102444800;

function looksLikeCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2 || lines.length > 5000) return false;
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : '';
  if (!sep) return false;
  const head = lines[0].split(sep).length;
  if (head < 2) return false;
  // 至少前 5 行（或全部）列数与表头一致，允许含引号的字段导致的不一致
  const probe = lines.slice(0, 5);
  const ok = probe.filter((l) => l.split(sep).length === head).length;
  return ok >= Math.min(3, probe.length);
}

function looksLikeBase64(text) {
  if (!B64_RE.test(text) || text.length % 4 !== 0) return false;
  try {
    // Node 与浏览器都有 atob；解完至少要能还原出可打印字符，避免把随机串当 Base64
    const bin = atob(text);
    if (!bin.length) return false;
    const printable = [...bin].filter((c) => {
      const code = c.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    }).length;
    return printable / bin.length > 0.85;
  } catch {
    return false;
  }
}

/**
 * 识别一段粘贴进来的内容，给出「该用哪个工具、带什么参数」。
 * 顺序即优先级：越具体的格式越先判，避免 JSON 被当成 CSV、JWT 被当成 Base64。
 * @returns {{id:string, params:Record<string,string>, kind:string, label:string}|null}
 */
export function routePaste(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (text.length < 4 || text.length > 20000) return null;

  if (JWT_RE.test(text)) {
    return { id: 'jwt-decode', params: { token: text }, kind: 'JWT', label: '解码这个 JWT' };
  }

  if (HEX_COLOR_RE.test(text) || RGB_RE.test(text)) {
    return { id: 'color-convert', params: { color: text }, kind: '颜色', label: '换算这个颜色' };
  }

  if (TS10_RE.test(text) || TS13_RE.test(text)) {
    const sec = text.length === 13 ? Number(text) / 1000 : Number(text);
    if (sec >= TS_MIN && sec <= TS_MAX) {
      return { id: 'timestamp', params: { value: text }, kind: '时间戳', label: '把这个时间戳转成时间' };
    }
  }

  if (URL_RE.test(text)) {
    return { id: 'qrcode', params: { text }, kind: '链接', label: '把这个链接生成二维码' };
  }

  const first = text[0];
  if (first === '{' || first === '[') {
    try {
      JSON.parse(text);
      return { id: 'json-format', params: { json: text }, kind: 'JSON', label: '格式化这段 JSON' };
    } catch {
      /* 不是合法 JSON，继续往下判（可能是一段带花括号的正文） */
    }
  }

  if (looksLikeCsv(text)) {
    return { id: 'csv-json', params: { input: text }, kind: 'CSV', label: '把这段 CSV 转成 JSON' };
  }

  if (looksLikeBase64(text)) {
    return { id: 'base64-url', params: { text, op: 'b64dec' }, kind: 'Base64', label: '解开这段 Base64' };
  }

  // Markdown：有标题/列表/代码块/分隔线，且确实是多行
  if (text.includes('\n') && /^(#{1,6}\s|[-*+]\s|\d+\.\s|```|>|---)/m.test(text)) {
    return { id: 'markdown-preview', params: { md: text }, kind: 'Markdown', label: '预览这段 Markdown' };
  }

  return null;
}

/** 把路由结果变成可直接打开的地址（run=1 表示到了就自动跑一遍） */
export function routeUrl(hit) {
  if (!hit || !hit.id) return '/';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(hit.params || {})) {
    if (typeof v === 'string' && v !== '' && v.length <= 4000) q.set(k, v);
  }
  q.set('run', '1');
  return `/tools/${hit.id}/?${q.toString()}`;
}
