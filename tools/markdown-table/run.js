// 工具：Markdown 表格生成器（纯浏览器执行）
//
// 一个必须说清的点：Markdown 的管道表格语法**没有「无表头」这种写法**——`| a | b |` 下面那行
// `| --- | --- |` 是语法的一部分，第一行天然被当成表头。所以选「无表头」时本工具输出的是
// HTML `<table>` 片段（Markdown 允许内嵌 HTML），而不是硬凑一个假表头骗过渲染器。
const MAX_ROWS = 30;
const MAX_COLS = 12;

export const manifest = {
  usage:
    '选好行数、列数、有没有表头、怎么对齐，一次生成可直接粘贴的表格源码：有表头时输出 Markdown 管道表格，无表头时输出 HTML 表格片段（Markdown 的管道表格语法必须有表头行，硬凑会多出一行假的）。',
  tips: [
    'Markdown 管道表格必须有表头与分隔行，所以「无表头」走的是 HTML 表格片段，粘进 Markdown 一样能渲染',
    '对齐只看整表一种：左 `:---`、居中 `:---:`、右 `---:`，混排需要手动改分隔行',
    '单元格内容先留空，粘到文档里再填；表格宽度由内容决定，不用手动补空格',
  ],
  scenarios: [
    { scene: '写需求文档要一张参数表', how: '设 5 行 3 列、有表头、左对齐', result: '直接粘出可渲染的表格骨架，不用数竖线' },
    { scene: 'README 里对比几个方案', how: '设 4 行 4 列、有表头、居中', result: '对齐语法一次写对，不会因为少一个冒号整表跑版' },
    { scene: '要一张没有表头的排版表', how: '选「无表头」，得到 HTML 片段', result: '粘进 Markdown 仍是干净的两列排版' },
  ],
  inputs: [
    { name: 'rows', label: '数据行数', type: 'number', min: 1, max: MAX_ROWS, placeholder: '留空按 3 行' },
    { name: 'cols', label: '列数', type: 'number', min: 1, max: MAX_COLS, placeholder: '留空按 3 列' },
    {
      name: 'header',
      label: '表头',
      type: 'select',
      options: [
        { value: 'yes', label: '有表头' },
        { value: 'no', label: '无表头（输出 HTML）' },
      ],
    },
    {
      name: 'align',
      label: '对齐',
      type: 'select',
      options: [
        { value: 'left', label: '左对齐' },
        { value: 'center', label: '居中' },
        { value: 'right', label: '右对齐' },
      ],
    },
  ],
  runLabel: '生成表格',
};

const ALIGN = { left: ':---', center: ':---:', right: '---:' };

function clampInt(v, fallback, min, max, name) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${name}要填整数`);
  if (n < min || n > max) throw new Error(`${name}要在 ${min}–${max} 之间（填的是 ${n}）`);
  return n;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export async function run({ rows, cols, header, align }) {
  const r = clampInt(rows, 3, 1, MAX_ROWS, '行数');
  const c = clampInt(cols, 3, 1, MAX_COLS, '列数');
  const withHeader = header !== 'no';
  const sep = ALIGN[align] || ALIGN.left;

  const cell = '  ';
  let source = '';
  let preview = '';

  if (withHeader) {
    const head = `| ${Array.from({ length: c }, (_, i) => `列 ${i + 1}`).join(' | ')} |`;
    const line = `| ${Array.from({ length: c }, () => sep).join(' | ')} |`;
    const body = Array.from({ length: r }, () => `| ${Array.from({ length: c }, () => cell).join(' | ')} |`).join('\n');
    source = [head, line, body].filter(Boolean).join('\n');
    preview = `<table style="border-collapse:collapse;font-size:13px"><thead><tr>${Array.from(
      { length: c },
      (_, i) => `<th style="border:1px solid var(--border);padding:5px 10px">列 ${i + 1}</th>`
    ).join('')}</tr></thead><tbody>${Array.from(
      { length: r },
      () => `<tr>${Array.from({ length: c }, () => `<td style="border:1px solid var(--border);padding:5px 10px">&nbsp;</td>`).join('')}</tr>`
    ).join('')}</tbody></table>`;
  } else {
    const body = Array.from(
      { length: r },
      () => `  <tr>${Array.from({ length: c }, () => '<td></td>').join('')}</tr>`
    ).join('\n');
    source = `<table>\n${body}\n</table>`;
    preview = `<table style="border-collapse:collapse;font-size:13px"><tbody>${Array.from(
      { length: r },
      () => `<tr>${Array.from({ length: c }, () => `<td style="border:1px solid var(--border);padding:5px 10px">&nbsp;</td>`).join('')}</tr>`
    ).join('')}</tbody></table>`;
  }

  const total = withHeader ? r + 1 : r;
  return {
    html: `<div class="msg-ok">✅ ${total} 行 × ${c} 列${withHeader ? '（含表头行）' : '（HTML 片段）'}</div>
      <p style="margin:10px 0 6px;color:var(--muted);font-size:13px">预览：</p>
      <div style="overflow-x:auto">${preview}</div>
      <p style="margin:14px 0 6px;color:var(--muted);font-size:13px">源码：</p>
      <textarea readonly rows="${Math.min(14, total + 2)}" style="width:100%;font-family:var(--mono);font-size:12.5px;line-height:1.6">${esc(source)}</textarea>
      ${
        withHeader
          ? ''
          : '<p style="margin-top:10px;color:var(--muted);font-size:13px">Markdown 的管道表格语法必须有表头分隔行，所以「无表头」输出的是 HTML 表格片段——粘进 Markdown 正文里照样渲染成表。</p>'
      }`,
    text: source,
  };
}
