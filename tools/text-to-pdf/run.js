// 工具：文本转 PDF（纯浏览器执行）
//
// 不引 pdf-lib：这里的排版需求只有「一行行文字落在 A4 上」，为它背一个几百 KB 的库不值当。
// PDF 结构本身很小：对象表 + 页面树 + 两个内置字体 + 每页一段内容流。
// 手写 PDF 只有一个地方容易翻车——**xref 表里的字节偏移必须逐字节正确**，错一位阅读器就整份打不开。
// 所以这里不靠手算：边拼边记当前字节数，最后用记录的偏移写 xref；所有字符都限制在 ASCII，
// 一个字符就是一个字节，长度与偏移同一套账。
//
// 首期只支持英文/数字/常用符号（用 PDF 内置的 Helvetica，不嵌字体、0 新增字节）。
// 中文要子集化字体，约 1.1 MB，与「单工具 ≤200KB」的硬规则冲突——所以遇到中文**明确报错**，
// 绝不静默输出乱码。这条是 TP6 在 2026-11-05 定的，别改。

// Helvetica 的标准字宽表（单位 1/1000 em，对应 ASCII 32..126）。
// 用来算换行：不量宽度就只能按字符数硬切，长句会越出右边距，或者在很窄的字符上浪费半行。
const WIDTHS = (
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 ' +
  '278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 ' +
  '722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 ' +
  '556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'
)
  .trim()
  .split(/\s+/)
  .map(Number);

const PAGE = { w: 595.28, h: 841.89 }; // A4，单位 pt
const MARGIN = { narrow: 40, normal: 56, wide: 80 };
const SIZE = { 10: 10, 11: 11, 12: 12, 14: 14 };
const LEAD = 1.45; // 行距倍数

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// PDF 字符串里的括号与反斜杠要转义；控制字符直接丢掉（它们没有字形，留着只会让阅读器报错）
function pdfString(s) {
  return s
    .replace(/[\\()]/g, (c) => '\\' + c)
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
}

function widthOf(str, size) {
  let units = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const w = WIDTHS[code - 32];
    units += w === undefined ? 500 : w;
  }
  return (units / 1000) * size;
}

const isAscii = (c) => {
  const code = c.charCodeAt(0);
  return code >= 32 && code <= 126;
};

// 把一段文字按可用宽度折行。先按空格断，单词本身超宽（长 URL）才按字符硬断。
function wrap(text, maxWidth, size) {
  const out = [];
  const words = String(text).split(/(\s+)/);
  let line = '';
  const pushLine = () => {
    if (line.trim()) out.push(line.replace(/\s+$/, ''));
    line = '';
  };
  for (const w of words) {
    if (!w) continue;
    if (/^\s+$/.test(w)) {
      if (line && line.trim()) line += ' ';
      continue;
    }
    const candidate = line ? line.replace(/\s+$/, '') + ' ' + w : w;
    if (widthOf(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line.trim()) {
      pushLine();
    }
    if (widthOf(w, size) <= maxWidth) {
      line = w;
      continue;
    }
    // 单词自己就超宽：逐字符硬断
    let chunk = '';
    for (const ch of w) {
      if (widthOf(chunk + ch, size) > maxWidth && chunk) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  pushLine();
  return out;
}

export const manifest = {
  usage:
    '把纯文本贴进文本框，选字号与页边距，点「生成 PDF」下载。排版在本机完成：文字不发给任何服务器，断网也能用。标题可选，会以粗体排在首页顶部。',
  tips: [
    '首期仅支持英文、数字与常用符号：用 PDF 内置字体，零嵌入字节。出现中文会直接提示，不会给你一份乱码 PDF',
    '段落不会被分页切断：一段放不下就整段挪到下一页，不会出现「半句话在上页、半句在下页」',
    '空行会保留成段间距；连续多个空行最多保留一行，避免正文被顶到第三页',
    '长网址这类没有空格的超长串会按字符硬断，不会越出右边距',
  ],
  scenarios: [
    {
      scene: '把一段日志或报错贴成 PDF 发给别人',
      how: '粘贴文本，选 10 号字与「窄」边距',
      result: '拿到可直接转发的 PDF，内容没有经过任何服务器',
    },
    {
      scene: '给英文稿加个标题交作业',
      how: '标题填一行，正文贴进文本框',
      result: '首页顶部粗体标题，正文自动分页',
    },
    {
      scene: '内网机器上要出 PDF',
      how: '离线打开工具页，粘贴文本',
      result: '不需要联网也不需要装字体包，PDF 直接落盘',
    },
  ],
  inputs: [
    { name: 'text', label: '正文（纯文本）', type: 'textarea', placeholder: '粘贴要排版的文字' },
    { name: 'title', label: '标题（可留空）', type: 'text', placeholder: '留空则不排标题' },
    {
      name: 'fontSize',
      label: '字号',
      type: 'select',
      options: [
        { value: '10', label: '小（10pt）' },
        { value: '11', label: '常规（11pt）' },
        { value: '12', label: '大（12pt）' },
        { value: '14', label: '特大（14pt）' },
      ],
    },
    {
      name: 'margin',
      label: '页边距',
      type: 'select',
      options: [
        { value: 'narrow', label: '窄（40pt）' },
        { value: 'normal', label: '标准（56pt）' },
        { value: 'wide', label: '宽（80pt）' },
      ],
    },
  ],
  runLabel: '生成 PDF',
};

export async function run({ text, title, fontSize, margin }) {
  const body = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  if (!body.trim()) throw new Error('正文是空的：先贴一段文字再生成');

  // 非 ASCII 一律拦在前面。中文单独给一句话，其余字符点名——比「生成失败」有用得多。
  const bad = new Set();
  for (const ch of body + String(title || '')) {
    if (ch === '\n' || ch === '\t') continue;
    if (!isAscii(ch)) bad.add(ch);
  }
  if (bad.size) {
    const list = Array.from(bad);
    const hasCjk = list.some((c) => /[\u3400-\u9fff\uf900-\ufaff]/.test(c));
    if (hasCjk) {
      throw new Error(
        '首期仅支持英文/数字/常用符号：正文里有中文（如「' + list.find((c) => /[\u3400-\u9fff]/.test(c)) +
          '」）。中文要嵌字体子集，约 1.1 MB，与本站「单工具 ≤200KB」的规矩冲突，所以这一版不做——' +
          '与其给你一份乱码 PDF，不如直接说清楚。'
      );
    }
    throw new Error(
      '这些字符不在首期支持范围内：' + list.slice(0, 8).join(' ') +
        (list.length > 8 ? ' 等' : '') + '。首期只用 PDF 内置的 Helvetica，仅覆盖英文、数字与常用符号。'
    );
  }

  const size = SIZE[String(fontSize)] || 11;
  const m = MARGIN[margin] || MARGIN.normal;
  const innerW = PAGE.w - m * 2;
  const lineH = size * LEAD;

  const titleText = String(title == null ? '' : title).trim();
  const titleSize = size + 6;

  // 段落切分：每个非空行是一段，连续空行只留一个段间距
  const rawLines = body.split('\n');
  const paras = [];
  let gap = 0;
  for (const line of rawLines) {
    if (!line.trim()) {
      gap = 1;
      continue;
    }
    paras.push({ lines: wrap(line.replace(/\t/g, '    '), innerW, size), gapBefore: gap });
    gap = 0;
  }
  if (!paras.length) throw new Error('正文里没有可排的文字（只有空行）');

  // 分页：一段是一个整体，放不下就整段挪到下一页——这是「不切断段落」的实现方式。
  const pages = [];
  let cur = null;
  const newPage = () => {
    cur = { items: [] };
    pages.push(cur);
    return cur;
  };
  newPage();

  let y = PAGE.h - m;
  if (titleText) {
    const titleLines = wrap(titleText, innerW, titleSize);
    for (const tl of titleLines) {
      if (y - titleSize < m) newPage(), (y = PAGE.h - m);
      cur.items.push({ text: tl, x: m, y: y - titleSize, size: titleSize, bold: true });
      y -= titleSize * 1.35;
    }
    y -= size * 0.8;
  }
  let firstPara = true;
  for (const p of paras) {
    const blockH = p.lines.length * lineH + (p.gapBefore && !firstPara ? lineH * 0.6 : 0);
    if (y - blockH < m && cur.items.length) {
      newPage();
      y = PAGE.h - m;
    }
    if (p.gapBefore && !firstPara) y -= lineH * 0.6;
    for (const ln of p.lines) {
      cur.items.push({ text: ln, x: m, y: y - size, size, bold: false });
      y -= lineH;
    }
    firstPara = false;
  }

  // ---- 拼 PDF 字节 ----
  // 所有字符都是 ASCII，一个字符 = 一个字节，所以「字符串长度」就是「字节数」，
  // 偏移可以直接用累加长度，不用再转一次编码去找位置。
  const parts = [];
  let bytes = 0;
  const put = (s) => {
    parts.push(s);
    bytes += s.length;
  };

  put('%PDF-1.4\n');
  put('%\u00e2\u00e3\u00cf\u00d3\n'); // 二进制标记：让传输层别把它当纯文本改写换行

  const offsets = [];
  const obj = (id, body) => {
    offsets[id] = bytes;
    put(id + ' 0 obj\n' + body + '\nendobj\n');
  };

  const pageCount = pages.length;
  const kids = [];
  // 页面对象是 7、9、11…，内容流是 6、8、10…：Kids 里必须指页面对象，指成内容流的话
  // 阅读器会「打开成功但一个字都没有」——这种错不会抛异常，只能靠真解析一遍才发现。
  for (let i = 0; i < pageCount; i++) kids.push(7 + i * 2 + ' 0 R');

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageCount + ' >>');
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  obj(5, '<< /Producer (ToolHub) /Creator (ToolHub text-to-pdf) >>');

  for (let i = 0; i < pageCount; i++) {
    const items = pages[i].items;
    const lines = ['BT'];
    for (const it of items) {
      lines.push('/' + (it.bold ? 'F2' : 'F1') + ' ' + it.size + ' Tf');
      lines.push('1 0 0 1 ' + it.x.toFixed(2) + ' ' + it.y.toFixed(2) + ' Tm');
      lines.push('(' + pdfString(it.text) + ') Tj');
    }
    lines.push('ET');
    const stream = lines.join('\n') + '\n';
    const contentId = 6 + i * 2;
    const pageId = 7 + i * 2;
    obj(contentId, '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
    obj(
      pageId,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE.w + ' ' + PAGE.h + '] ' +
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentId + ' 0 R >>'
    );
  }

  const total = 6 + pageCount * 2;
  const xrefAt = bytes;
  let xref = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (let i = 1; i < total; i++) {
    const off = offsets[i];
    if (off === undefined) throw new Error('内部错误：对象 ' + i + ' 没有写入，PDF 会损坏');
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  put(xref);
  put('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n');

  const bytesArr = new Uint8Array(bytes);
  const all = parts.join('');
  for (let i = 0; i < all.length; i++) bytesArr[i] = all.charCodeAt(i) & 0xff;
  const blob = new Blob([bytesArr], { type: 'application/pdf' });

  const name = (titleText ? titleText.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) : 'text') + '.pdf';
  const chars = body.replace(/\s/g, '').length;

  return {
    html:
      '<div class="msg-ok">✅ 已生成 ' + pageCount + ' 页 PDF（' + (bytes / 1024).toFixed(1) + ' KB · ' + chars + ' 个字）</div>' +
      '<p style="margin-top:8px;color:var(--muted);font-size:13px">文字只用 PDF 内置的 Helvetica，没有嵌入任何字体，' +
      '所以体积只有几 KB。排版在本机完成，原文没有发给任何服务器。</p>',
    text: '已生成 ' + pageCount + ' 页 PDF，' + (bytes / 1024).toFixed(1) + ' KB，文件名 ' + name,
    files: [{ name, blob, kind: 'file' }],
  };
}
