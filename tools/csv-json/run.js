// 工具：CSV ↔ JSON 互转（纯浏览器执行，支持引号转义）
export const manifest = {
  usage: '把 CSV 转成 JSON 数组，或把 JSON 数组转回 CSV。自动识别逗号分隔、处理双引号包裹的字段（含换行与逗号）、首行为表头。',
  tips: [
    'Excel 导出的 CSV 首行通常是表头，会作为 JSON 的 key',
    '字段里含逗号或换行时需要用双引号包裹，本工具能正确解析',
    '中文乱码多因编码不是 UTF-8，可在 Excel 里另存为 UTF-8 CSV',
  ],
  scenarios: [
    { scene: '运营给了一堆 Excel 数据，要转成接口数据', how: '另存为 CSV → 粘进来选「CSV → JSON」', result: '直接得到可用 JSON 数组' },
    { scene: '要把接口返回的数组导进 Excel 做分析', how: '粘贴 JSON 数组 → 选「JSON → CSV」', result: '复制进 Excel 自动分列' },
    { scene: 'CSV 里某列含逗号，导入后列错位', how: '用本工具先转 JSON 检查', result: '确认引号是否配对，定位错位原因' },
  ],
  inputs: [
    { name: 'input', label: '输入内容（CSV 或 JSON）', type: 'textarea', placeholder: 'name,age\n张三,28\n李四,31', default: 'name,age,city\n张三,28,南京\n李四,31,上海' },
    {
      name: 'dir',
      label: '转换方向',
      type: 'select',
      default: 'csv2json',
      options: [
        { value: 'csv2json', label: 'CSV → JSON' },
        { value: 'json2csv', label: 'JSON → CSV' },
      ],
    },
  ],
  runLabel: '转换',
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

function toCSV(arr) {
  if (!Array.isArray(arr) || !arr.length) throw new Error('需要一个非空 JSON 数组');
  const keys = [...new Set(arr.flatMap((o) => Object.keys(o || {})))];
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...arr.map((o) => keys.map((k) => cell(o?.[k])).join(','))].join('\n');
}

export async function run({ input, dir }) {
  if (!input.trim()) throw new Error('请先输入内容');
  let out;
  if (dir === 'csv2json') {
    const rows = parseCSV(input.trim());
    if (rows.length < 2) throw new Error('CSV 至少需要表头 + 1 行数据');
    const [head, ...body] = rows;
    const arr = body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
    out = JSON.stringify(arr, null, 2);
    return {
      html: `<div class="msg-ok">✅ 已转换：${body.length} 行 × ${head.length} 列</div>
        <pre class="ok">${escapeHTML(out)}</pre>
        <div class="row" style="margin-top:12px"><button class="btn ghost" id="copy-btn">复制 JSON</button></div>`,
      after(box) {
        box.querySelector('#copy-btn').onclick = async (e) => {
          await navigator.clipboard.writeText(out);
          e.target.textContent = '已复制 ✓';
          setTimeout(() => (e.target.textContent = '复制 JSON'), 1500);
        };
      },
    };
  }
  let arr;
  try {
    arr = JSON.parse(input);
  } catch (e) {
    throw new Error('JSON 解析失败：' + e.message);
  }
  out = toCSV(arr);
  return {
    html: `<div class="msg-ok">✅ 已转换：${arr.length} 条记录</div>
      <pre class="ok">${escapeHTML(out)}</pre>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="copy-btn">复制 CSV</button></div>`,
    after(box) {
      box.querySelector('#copy-btn').onclick = async (e) => {
        await navigator.clipboard.writeText(out);
        e.target.textContent = '已复制 ✓';
        setTimeout(() => (e.target.textContent = '复制 CSV'), 1500);
      };
    },
  };
}

function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
