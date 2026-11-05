// 工具：JSON 语义对比（纯浏览器执行）
//
// 和 text-diff 的分工：那边比的是「行」，对方把缩进从 2 空格改成 4 空格、或者把键顺序换了，
// 整份就红了；这里先 JSON.parse 再按结构递归比，格式与键顺序都不算改动。
//
// 三条判定口径写死在代码里，也在结果区原样说明——不写清楚，用户会以为工具算错了：
//   1. 数字按数值比：1 与 1.0 相等（JSON.parse 之后本来就都是 1）
//   2. null 与「键不存在」是两件事，分别报「改成 null」与「新增」
//   3. 数组默认按位置比（[0] 对 [0]）；选了「按主键」就按主键对齐，元素换位置不算改动
//
// 只做对比，不猜意图：类型变了（对象 → 数组）归为一种单独的改动类型，不再往下递归，
// 否则一条「user 从对象变成数组」会被摊成几十行噪音，真正的问题反而被埋掉。

const MAX_ROWS = 300;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

const TYPE_CN = {
  null: 'null',
  array: '数组',
  object: '对象',
  string: '字符串',
  number: '数字',
  boolean: '布尔',
  undefined: '缺失',
};

function short(v, limit) {
  let s;
  try {
    s = JSON.stringify(v);
  } catch (e) {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON.parse 的报错信息在不同引擎里长得不一样：
// 新版 V8 是 "…at position 42 (line 3 column 5)"，老一点的是 "…at position 42"。
// 统一换算成「第几行第几列 + 那一段原文」，用户才知道该去改哪儿。
function explainParse(msg, src) {
  let lineNo = 0;
  let colNo = 0;
  const lc = /line (\d+) column (\d+)/i.exec(msg);
  const at = /position (\d+)/i.exec(msg);
  if (lc) {
    lineNo = Number(lc[1]);
    colNo = Number(lc[2]);
  } else if (at) {
    const pos = Number(at[1]);
    const before = src.slice(0, pos);
    lineNo = before.split('\n').length;
    colNo = pos - before.lastIndexOf('\n');
  }
  if (!lineNo) return msg.replace(/^JSON\.parse: /, '');
  const lines = src.split('\n');
  const theLine = lines[lineNo - 1] || '';
  const arrow = ' '.repeat(Math.max(0, Math.min(colNo - 1, 80))) + '^';
  const snippet =
    theLine.length > 160 ? theLine.slice(0, 160) + '…' : theLine;
  return '第 ' + lineNo + ' 行第 ' + colNo + ' 列附近。出错的那一行：\n' + snippet + '\n' + arrow;
}

function parseSide(raw, label) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) throw new Error('请填「' + label + '」：直接粘贴 JSON 文本，不用加代码围栏');
  if (/^```/.test(s)) throw new Error('「' + label + '」里带着 ``` 围栏：去掉围栏只留 JSON 本身');
  try {
    return JSON.parse(s);
  } catch (e) {
    const msg = String((e && e.message) || e);
    throw new Error('「' + label + '」不是合法 JSON —— ' + explainParse(msg, s));
  }
}

function indexByKey(arr, key, label) {
  const map = new Map();
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeOf(item) !== 'object') {
      throw new Error('「' + label + '」的第 ' + (i + 1) + ' 项不是对象，没法用「' + key + '」对齐');
    }
    if (!Object.prototype.hasOwnProperty.call(item, key)) {
      throw new Error('「' + label + '」的第 ' + (i + 1) + ' 项没有主键「' + key + '」');
    }
    const k = String(item[key]);
    if (map.has(k)) {
      throw new Error('「' + label + '」里主键「' + key + '」有重复值 ' + k + '：按主键对齐要求它唯一');
    }
    map.set(k, item);
  }
  return map;
}

// 按主键比数组：两边的元素先各自建索引，再按「先 A 后 B」的顺序走一遍键。
// 这样输出顺序稳定，元素换位置不产生改动行。
function walkByKey(path, a, b, key, out, mode) {
  const ma = indexByKey(a, key, '旧 JSON（A）');
  const mb = indexByKey(b, key, '新 JSON（B）');
  const keys = Array.from(ma.keys());
  for (const k of mb.keys()) {
    if (!ma.has(k)) keys.push(k);
  }
  for (const k of keys) {
    const p = path + '[' + key + '=' + k + ']';
    if (ma.has(k) && !mb.has(k)) out.push({ kind: 'remove', path: p, from: short(ma.get(k), 120), note: '' });
    else if (!ma.has(k) && mb.has(k)) out.push({ kind: 'add', path: p, to: short(mb.get(k), 120), note: '' });
    else walkMode(p, ma.get(k), mb.get(k), out, mode, key);
  }
}

// 主键模式下要递归进每一层对象里的数组，所以 walk 需要知道模式
function walkMode(path, a, b, out, mode, key) {
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    out.push({ kind: 'type', path, from: short(a, 120), to: short(b, 120), note: TYPE_CN[ta] + ' → ' + TYPE_CN[tb] });
    return;
  }
  if (ta === 'object') {
    const keys = Object.keys(a);
    for (const k of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) keys.push(k);
    }
    for (const k of keys) {
      const hasA = Object.prototype.hasOwnProperty.call(a, k);
      const hasB = Object.prototype.hasOwnProperty.call(b, k);
      const p = path ? path + '.' + k : k;
      if (hasA && !hasB) out.push({ kind: 'remove', path: p, from: short(a[k], 120), note: '' });
      else if (!hasA && hasB) out.push({ kind: 'add', path: p, to: short(b[k], 120), note: '' });
      else walkMode(p, a[k], b[k], out, mode, key);
    }
    return;
  }
  if (ta === 'array') {
    if (mode === 'key') {
      walkByKey(path, a, b, key, out, mode);
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const p = path + '[' + i + ']';
      if (i >= b.length) out.push({ kind: 'remove', path: p, from: short(a[i], 120), note: '' });
      else if (i >= a.length) out.push({ kind: 'add', path: p, to: short(b[i], 120), note: '' });
      else walkMode(p, a[i], b[i], out, mode, key);
    }
    return;
  }
  if (a !== b) out.push({ kind: 'change', path, from: short(a, 120), to: short(b, 120), note: '' });
}

const KIND = {
  add: { label: '新增', cls: 'kd-add' },
  remove: { label: '删除', cls: 'kd-del' },
  change: { label: '改值', cls: 'kd-chg' },
  type: { label: '类型变了', cls: 'kd-typ' },
};

export const manifest = {
  usage:
    '左边贴旧 JSON、右边贴新 JSON，点「对比」得到按路径列出的差异。格式化、缩进、键顺序都不算改动；数组可以选「按位置」或「按主键对齐」（后者元素换位置不算改）。差异定位到 a.b[2].c 这种路径，直接拿去改代码。',
  tips: [
    '只贴 JSON 本身，不要带 ``` 围栏：带了会被拦下并提示，不会把围栏当好内容去猜',
    '数组默认按位置比：中间插入一条，后面每条都会报改值——这种情况改用「按主键」',
    '「按主键」要求该字段在两边都唯一存在，缺键或重复值会直接报错，不会静默给出错的结果',
    'null 和「键不存在」是两回事：接口把字段删掉是「删除」，把值改成 null 是「改值」',
  ],
  scenarios: [
    {
      scene: '接口升级后返回体变了',
      how: '把改版前后的两次返回各贴一边，点对比',
      result: '逐条列出哪个字段新增、删除、改了值，不用肉眼逐行扫',
    },
    {
      scene: '配置文件被谁改了',
      how: '贴两个版本的配置 JSON',
      result: '定位到具体键路径，审查时只看这几行',
    },
    {
      scene: '列表顺序变化算不算改动',
      how: '数组比法选「按主键」，主键填 id',
      result: '只报真正增减与改值的条目，顺序变化不产生噪音',
    },
  ],
  inputs: [
    { name: 'a', label: '旧 JSON（A）', type: 'textarea', placeholder: '粘贴第一份 JSON' },
    { name: 'b', label: '新 JSON（B）', type: 'textarea', placeholder: '粘贴第二份 JSON' },
    {
      name: 'arrayBy',
      label: '数组怎么比',
      type: 'select',
      options: [
        { value: 'index', label: '按位置（[0] 对 [0]）' },
        { value: 'key', label: '按主键对齐（换位置不算改）' },
      ],
    },
    { name: 'keyName', label: '主键字段名（选「按主键」时必填）', type: 'text', placeholder: 'id' },
  ],
  runLabel: '对比',
};

export async function run({ a, b, arrayBy, keyName }) {
  const left = parseSide(a, '旧 JSON（A）');
  const right = parseSide(b, '新 JSON（B）');
  const mode = arrayBy === 'key' ? 'key' : 'index';
  const key = String(keyName == null ? '' : keyName).trim();
  if (mode === 'key' && !key) {
    throw new Error('选了「按主键对齐」，请填主键字段名（比如 id）；不确定就选「按位置」');
  }

  const out = [];
  walkMode('', left, right, out, mode, key);

  if (!out.length) {
    return {
      html:
        '<div class="msg-ok">✅ 两份 JSON 语义相同，没有差异</div>' +
        '<p style="margin-top:8px;color:var(--muted);font-size:13px">比的是解析后的结构：缩进、换行、键顺序不同都不算改动' +
        (mode === 'key' ? '；数组按主键「' + esc(key) + '」对齐，元素换位置也不算' : '') +
        '。</p>',
      text: '两份 JSON 语义相同，没有差异。',
    };
  }

  const counts = { add: 0, remove: 0, change: 0, type: 0 };
  for (const d of out) counts[d.kind]++;

  const shown = out.slice(0, MAX_ROWS);
  const rows = shown
    .map((d) => {
      const k = KIND[d.kind];
      const from = d.from === undefined ? '' : esc(d.from);
      const to = d.to === undefined ? '' : esc(d.to);
      let detail;
      if (d.kind === 'add') detail = '<span style="color:var(--ok)">+ ' + to + '</span>';
      else if (d.kind === 'remove') detail = '<span style="color:var(--err)">− ' + from + '</span>';
      else if (d.kind === 'type') detail = from + ' → ' + to + '（' + esc(d.note) + '）';
      else detail = from + ' → ' + to;
      return (
        '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:6px 6px;white-space:nowrap;font-size:12px">' + k.label + '</td>' +
        '<td style="padding:6px 6px;font-family:var(--mono);font-size:12px;word-break:break-all">' + esc(d.path) + '</td>' +
        '<td style="padding:6px 6px;font-family:var(--mono);font-size:12px;word-break:break-all">' + detail + '</td>' +
        '</tr>'
      );
    })
    .join('');

  const head =
    '<div class="msg-ok">🔍 找到 ' + out.length + ' 处差异：新增 ' + counts.add + ' · 删除 ' + counts.remove +
    ' · 改值 ' + counts.change + (counts.type ? ' · 类型变化 ' + counts.type : '') + '</div>';

  const more =
    out.length > MAX_ROWS
      ? '<p style="margin-top:8px;color:var(--muted);font-size:13px">只显示前 ' + MAX_ROWS + ' 处，共 ' + out.length + ' 处。复制文本结果可以拿到全部。</p>'
      : '';

  const rules =
    '<p style="margin-top:10px;color:var(--muted);font-size:13px">口径：数字按数值比（1 与 1.0 相同）；null 与「键不存在」分开报；数组' +
    (mode === 'key' ? '按主键「' + esc(key) + '」对齐' : '按位置对齐') +
    '。格式化与键顺序不算改动。</p>';

  const textLines = out.map((d) => {
    if (d.kind === 'add') return '+ ' + d.path + ' = ' + d.to;
    if (d.kind === 'remove') return '- ' + d.path + '（原值 ' + d.from + '）';
    if (d.kind === 'type') return '~ ' + d.path + '：' + d.note + '（' + d.from + ' → ' + d.to + '）';
    return '~ ' + d.path + '：' + d.from + ' → ' + d.to;
  });

  return {
    html:
      head +
      '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px">' +
      '<thead><tr><th style="text-align:left;padding:6px;font-size:12px;color:var(--muted);width:70px">改动</th>' +
      '<th style="text-align:left;padding:6px;font-size:12px;color:var(--muted)">路径</th>' +
      '<th style="text-align:left;padding:6px;font-size:12px;color:var(--muted)">新 / 旧值</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' + more + rules,
    text:
      '共 ' + out.length + ' 处差异（新增 ' + counts.add + ' / 删除 ' + counts.remove + ' / 改值 ' + counts.change +
      (counts.type ? ' / 类型变化 ' + counts.type : '') + '）\n' + textLines.join('\n'),
  };
}
