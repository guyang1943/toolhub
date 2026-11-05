// 工具：.env 解析（纯浏览器执行）
//
// 三件常被忽略的细节，这里都按 shell / dotenv 的实际行为处理：
// · 单引号里的一切都是字面量（$ 不展开、\n 不是换行）；双引号里才处理 \n \t \" \\ 与 $ 展开
// · 行尾注释只在不带引号时生效，且前面必须有空白：`A=foo#bar` 的 # 属于值，`A=foo #bar` 才是注释
// · 重复键不报死，按「后者覆盖前者」处理（与 dotenv 一致），但会指到行号，因为静默覆盖最坑人
//
// 不做变量展开（${FOO} 原样保留）。真要展开得连 export 顺序与环境一起算，那是另一个工具的事，
// 半吊子展开只会给出与运行时不一致的结果。
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const manifest = {
  usage:
    '把一段 .env 解析成键值对：支持 export 前缀、单双引号、行尾注释与转义，重复键与格式错误会指到具体行号，结果可一键转成 JSON 或 shell 的 export 语句。',
  tips: [
    '重复键按后者覆盖前者（与 dotenv 行为一致），但会列出两处行号，别让它静默生效',
    '单引号里是字面量，双引号里才处理 \\n \\t \\" 这类转义——和你写 shell 时的直觉一致',
    '行尾注释前面要有空格：A=foo#bar 的 # 是值的一部分，A=foo #bar 才是注释',
    '不做变量展开：${HOME} 之类会原样保留，避免给出与运行时不一致的结果',
  ],
  scenarios: [
    { scene: '把 .env 转成给 Docker 用的 JSON', how: '粘贴 → 选 JSON', result: '直接拿到可写进配置的键值对象，重复键一眼看到' },
    { scene: '检查同事发来的 .env 有没有写错', how: '粘贴后看错误清单', result: '第几行少了引号、哪个键重复，都列出来' },
    { scene: '临时在终端里导入一组变量', how: '选 shell export', result: '复制到终端就能 source，值里的单引号已转义' },
  ],
  inputs: [
    { name: 'text', label: '.env 内容', type: 'textarea', placeholder: 'DB_HOST=127.0.0.1\nDB_PORT=5432\nAPI_KEY="abc123"\n# 注释行会被忽略' },
    {
      name: 'out',
      label: '输出格式',
      type: 'select',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'shell', label: 'shell export' },
      ],
    },
  ],
  runLabel: '解析',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function parseValue(raw, lineNo) {
  const v = raw.replace(/^\s+/, '');
  if (v.startsWith('"')) {
    let out = '';
    let i = 1;
    let closed = false;
    while (i < v.length) {
      const ch = v[i];
      if (ch === '\\') {
        const next = v[i + 1];
        if (next === 'n') out += '\n';
        else if (next === 't') out += '\t';
        else if (next === 'r') out += '\r';
        else if (next === '"') out += '"';
        else if (next === '\\') out += '\\';
        else out += '\\' + (next === undefined ? '' : next);
        i += 2;
        continue;
      }
      if (ch === '"') {
        closed = true;
        i++;
        break;
      }
      out += ch;
      i++;
    }
    if (!closed) throw new Error(`第 ${lineNo} 行：双引号没有闭合`);
    const rest = v.slice(i).trim();
    if (rest && !rest.startsWith('#')) throw new Error(`第 ${lineNo} 行：引号后面还有多余内容「${rest}」`);
    return out;
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    if (end < 0) throw new Error(`第 ${lineNo} 行：单引号没有闭合`);
    const out = v.slice(1, end);
    const rest = v.slice(end + 1).trim();
    if (rest && !rest.startsWith('#')) throw new Error(`第 ${lineNo} 行：引号后面还有多余内容「${rest}」`);
    return out;
  }
  // 无引号：行尾注释要求 # 前面有空白
  const m = /\s#/.exec(v);
  return (m ? v.slice(0, m.index) : v).trim();
}

export async function run({ text, out }) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  if (!src.trim()) throw new Error('请先粘贴 .env 内容');

  const fmt = out === 'shell' ? 'shell' : 'json';
  const map = new Map(); // key -> { value, line }
  const errors = [];
  const lines = src.split('\n');

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    line = line.replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (eq < 0) {
      errors.push(`第 ${lineNo} 行：缺少 = 号，整行未采用（内容：${rawLine.trim().slice(0, 40)}）`);
      return;
    }
    const key = line.slice(0, eq).trim();
    if (!key) {
      errors.push(`第 ${lineNo} 行：= 左边没有键名`);
      return;
    }
    if (!KEY_RE.test(key)) {
      errors.push(`第 ${lineNo} 行：键名「${key}」不合法——只能是字母、数字、下划线，且不能以数字开头`);
      return;
    }
    let value;
    try {
      value = parseValue(line.slice(eq + 1), lineNo);
    } catch (e) {
      errors.push(e.message);
      return;
    }
    if (map.has(key)) {
      const prev = map.get(key);
      errors.push(`第 ${prev.line} 行与第 ${lineNo} 行：键「${key}」重复，按后者覆盖（后者生效）`);
    }
    map.set(key, { value, line: lineNo });
  });

  if (!map.size && !errors.length) throw new Error('没有解析出任何键值对');

  const entries = [...map.entries()];
  const obj = Object.fromEntries(entries.map(([k, v]) => [k, v.value]));
  let result = '';
  if (fmt === 'json') {
    result = JSON.stringify(obj, null, 2);
  } else {
    result = entries.map(([k, v]) => `export ${k}='${v.value.replace(/'/g, "'\\''")}'`).join('\n');
  }

  const errBlock = errors.length
    ? `<p style="margin:14px 0 6px;color:var(--muted);font-size:13px">问题清单（${errors.length} 条，不影响已解析出来的键）：</p>
       <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8;color:var(--danger,#c33)">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '';

  return {
    html: `<div class="msg-ok">✅ 解析出 ${entries.length} 个键${errors.length ? ` · ${errors.length} 条问题` : ' · 没有发现问题'}</div>
      ${errBlock}
      <p style="margin:14px 0 6px;color:var(--muted);font-size:13px">${fmt === 'json' ? 'JSON' : 'shell export'}：</p>
      <textarea readonly rows="${Math.min(18, entries.length + 2)}" style="width:100%;font-family:var(--mono);font-size:12.5px;line-height:1.6">${esc(result)}</textarea>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">不做变量展开：值里的 ${'${FOO}'} 会原样保留。JSON 输出只是文本，不会替你写进任何文件。</p>`,
    text: result,
  };
}
