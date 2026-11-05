// 工具：字符串转义（JS / JSON / URL / HTML / Unicode，双向，纯浏览器执行）
//
// 五种转义各有各的「正确」边界，这里按实际粘回源码的场景定：
// · JS：同时转义双引号与单引号，这样粘进 '...' 或 "..." 都不会破；\u2028/\u2029 也转，
//   它们在老引擎里会被当成换行，是最常见的「看起来没问题却报错」的来源。
// · JSON：走 JSON.stringify / JSON.parse 本身，不自己拼，避免漏掉控制字符。
// · URL：encodeURIComponent 是「一个值」的编码，不是整个地址；整地址该用 encodeURI。
// · HTML：五个必需字符 + 常见实体反解，认不出的实体原样保留，不猜。
// · Unicode：非 ASCII 一律 \uXXXX，代理对拆成两个转义，粘回任何 JS 引擎都能还原。
const HTML_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  divide: '÷',
  deg: '°',
  plusmn: '±',
  laquo: '«',
  raquo: '»',
  middot: '·',
  yen: '¥',
  euro: '€',
};
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const manifest = {
  usage:
    '把一段文本按 JS、JSON、URL、HTML、Unicode 五种规则转义，或者把转义后的字符串还原。选好类型与方向，粘进去就能拿到可回贴的结果。',
  tips: [
    'JS 模式会把单引号与双引号一起转义，粘进 \'...\' 或 "..." 都不会破',
    '整条 URL 编码要用 encodeURI，单个查询参数值才用 encodeURIComponent（本工具是后者）',
    'Unicode 模式把中文转成 \\u4e2d 这类形式，粘回 JS 源码里仍等价于原文',
    '反转义认不出的转义序列会原样保留，不会静悄悄地吞掉',
  ],
  scenarios: [
    { scene: '把接口返回的 JSON 字符串塞进代码', how: '选「JSON → 转义」，粘贴原文', result: '得到带引号、可直接赋值的字面量' },
    { scene: 'URL 参数里要带中文', how: '选「URL → 转义」', result: '拿到 %E4%B8%AD 这种可直接拼进地址的值' },
    { scene: '看到一段 \\u4e2d\\u6587 想读懂', how: '选「Unicode → 反转义」', result: '变回人可读的原文' },
  ],
  inputs: [
    { name: 'text', label: '文本', type: 'textarea', placeholder: '粘贴要转义或反转义的内容' },
    {
      name: 'mode',
      label: '类型',
      type: 'select',
      options: [
        { value: 'js', label: 'JS 字符串' },
        { value: 'json', label: 'JSON' },
        { value: 'url', label: 'URL 编码' },
        { value: 'html', label: 'HTML 实体' },
        { value: 'unicode', label: 'Unicode（\\uXXXX）' },
      ],
    },
    {
      name: 'dir',
      label: '方向',
      type: 'select',
      options: [
        { value: 'esc', label: '转义' },
        { value: 'unesc', label: '反转义' },
      ],
    },
  ],
  runLabel: '转换',
};

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function jsEscape(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case "'":
        out += "\\'";
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\v':
        out += '\\v';
        break;
      case '\u2028':
        out += '\\u2028';
        break;
      case '\u2029':
        out += '\\u2029';
        break;
      default:
        if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
        else out += ch;
    }
  }
  return out;
}

function jsUnescape(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|[0-7]{1,3}|[\s\S])/g, (m, body) => {
    if (body[0] === 'x' && body.length === 3) return String.fromCharCode(parseInt(body.slice(1), 16));
    if (body.startsWith('u{') && body.endsWith('}')) return String.fromCodePoint(parseInt(body.slice(2, -1), 16));
    if (body[0] === 'u' && body.length === 5) return String.fromCharCode(parseInt(body.slice(1), 16));
    if (/^[0-7]{1,3}$/.test(body)) return String.fromCharCode(parseInt(body, 8));
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '/': '/' };
    return simple[body] !== undefined ? simple[body] : body;
  });
}

function unicodeEscape(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      out += ch;
    } else if (code > 0xffff) {
      const h = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const l = ((code - 0x10000) % 0x400) + 0xdc00;
      out += '\\u' + h.toString(16).padStart(4, '0') + '\\u' + l.toString(16).padStart(4, '0');
    } else {
      out += '\\u' + code.toString(16).padStart(4, '0');
    }
  }
  return out;
}

function unicodeUnescape(s) {
  return s.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (m, braced, plain) =>
    String.fromCodePoint(parseInt(braced || plain, 16))
  );
}

export async function run({ text, mode, dir }) {
  if (text === undefined || text === null || text === '') throw new Error('请先输入文本');
  const m = mode || 'js';
  const unesc = dir === 'unesc';
  let out;
  try {
    if (m === 'js') out = unesc ? jsUnescape(text) : jsEscape(text);
    else if (m === 'json') {
      if (unesc) {
        let src = text.trim();
        if (!/^["']/.test(src)) src = '"' + src.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        else if (src.startsWith("'")) src = '"' + src.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        out = JSON.parse(src);
      } else out = JSON.stringify(text);
    } else if (m === 'url') out = unesc ? decodeURIComponent(text) : encodeURIComponent(text);
    else if (m === 'html') {
      if (unesc) {
        out = text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (all, body) => {
          if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
          }
          return HTML_MAP[body.toLowerCase()] !== undefined ? HTML_MAP[body.toLowerCase()] : all;
        });
      } else out = String(text).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
    } else if (m === 'unicode') out = unesc ? unicodeUnescape(text) : unicodeEscape(text);
    else throw new Error(`不认识的类型：${m}`);
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('反转义失败：看起来不是合法的转义序列，检查引号与反斜杠是否完整');
    if (e instanceof URIError) throw new Error('URL 解码失败：存在残缺的百分号编码（例如 %E4 后面缺了字节）');
    throw e;
  }

  const label = { js: 'JS 字符串', json: 'JSON', url: 'URL 编码', html: 'HTML 实体', unicode: 'Unicode' }[m];
  return {
    html: `<div class="msg-ok">✅ ${label} · ${unesc ? '反转义' : '转义'} · 输出 ${out.length} 字符</div>
      <textarea readonly rows="8" style="width:100%;margin-top:10px;font-family:var(--mono);font-size:12.5px;line-height:1.6">${escHtml(out)}</textarea>
      ${
        m === 'js' && !unesc
          ? '<p style="margin-top:10px;color:var(--muted);font-size:13px">单双引号都已转义，粘进 \'...\' 或 "..." 都可以；如果是模板字符串，反引号与 ${} 需要你自己再处理。</p>'
          : ''
      }`,
    text: out,
  };
}
