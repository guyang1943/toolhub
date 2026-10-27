// 工具：CSV 选列与重排（纯浏览器执行，自写状态机解析）
// 与 csv-json 的分工：那个负责格式互转，这个解决「这张表 40 列我只想要 6 列，还要换个顺序」。

export const manifest = {
  usage:
    '把 CSV 粘进来（或用 Tab 分隔的表格数据），勾掉不需要的列、拖动调整顺序、按某一列的值过滤行，最后导出成新的 CSV。解析器按引号状态机走，引号内的逗号、换行、双写引号都不会把表格拆散，导出时原样保留引号风格。',
  tips: [
    '列可以写列名，也可以写序号（1 开始），两者混用没关系：例如「3, 姓名, 1」',
    '过滤是「列值包含这段文字」，不是正则，也不会去大小写差异——填「南京」匹配不到「南京市」以外的写法',
    'Excel 另存的 CSV 多是逗号分隔 + UTF-8；如果粘进来列全挤在一起，把分隔符改成实际用的那个',
  ],
  scenarios: [
    { scene: '导出的订单表 40 列，只想看 6 列', how: '粘贴内容 → 填「订单号, 客户, 金额」→ 导出', result: '只留这 3 列、按你写的顺序排列' },
    { scene: '要给财务的报表只要华东区的行', how: '过滤列填「大区」、关键字填「华东」', result: '筛掉华东以外的行，列结构不变' },
    { scene: '别人发来的表格用分号分隔，粘贴后全乱', how: '分隔符改成「分号」', result: '自动按分号重新分列' },
  ],
  inputs: [
    {
      name: 'input',
      label: 'CSV 内容',
      type: 'textarea',
      placeholder: 'id,name,city\n1,张三,南京\n2,李四,上海',
      default: 'id,name,city,amount\n1,张三,南京,128\n2,李四,上海,340\n3,王五,南京,56',
    },
    {
      name: 'delim',
      label: '分隔符',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: '自动识别' },
        { value: ',', label: '逗号 ,' },
        { value: '\t', label: '制表符 Tab' },
        { value: ';', label: '分号 ;' },
        { value: '|', label: '竖线 |' },
      ],
    },
    {
      name: 'header',
      label: '首行',
      type: 'select',
      default: 'yes',
      options: [
        { value: 'yes', label: '是表头（用列名选列）' },
        { value: 'no', label: '不是表头（用序号选列）' },
      ],
    },
    {
      name: 'cols',
      label: '保留的列（列名或序号，逗号分隔）',
      type: 'text',
      placeholder: '例如 3, 姓名, 1；留空 = 全部列',
    },
    {
      name: 'filterCol',
      label: '按哪一列过滤（可留空）',
      type: 'text',
      placeholder: '列名或序号，例如 城市',
    },
    {
      name: 'filterVal',
      label: '该列包含这段文字（可留空）',
      type: 'text',
      placeholder: '包含匹配，不是正则',
    },
  ],
  runLabel: '导出 CSV',
};

/* ---------------- 解析：引号状态机 ----------------
   不用 split(delim)：一旦字段里有引号包裹的逗号或换行，split 出来的列数就全错。
   每个单元格额外记一个 q 标记「原来带引号吗」，导出时据此还原引号风格。 */
export function parseCSV(text, delim) {
  const rows = [];
  let row = [], field = '', quoted = false, inQuotes = false;
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // 跳过 Excel 常带的 BOM

  const endRow = () => {
    row.push({ v: field, q: quoted });
    field = '';
    quoted = false;
    // 整行只有一个未加引号的空值 —— 那是空行，不是「一列空值」的数据行
    const blank = row.length === 1 && row[0].v === '' && !row[0].q;
    if (!blank) rows.push(row);
    row = [];
  };

  for (; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" 是一个字面引号
        else inQuotes = false;                          // 收尾引号
      } else field += c;                                // 引号内的逗号 / 换行都算内容
    } else if (c === '"' && field === '') {
      inQuotes = true;                                  // 只有字段开头的引号才是「包裹」
      quoted = true;
    } else if (c === '"') {
      field += c;                                       // 字段中间的裸引号：按字面处理，不静默丢数据
    } else if (c === delim) {
      row.push({ v: field, q: quoted });
      field = '';
      quoted = false;
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;                     // CRLF 与 LF 都当一次换行
      endRow();
    } else if (c === '\n') {
      endRow();
    } else field += c;
  }
  // 末尾没有换行时，最后一段也是数据；但完全空白的尾部不产生空行
  if (field !== '' || quoted || row.length) endRow();
  return rows;
}

const NEED_QUOTE = (s, delim) => /["\r\n]/.test(s) || s.indexOf(delim) >= 0 || /^\s|\s$/.test(s);

export function toCSV(rows, delim) {
  const cell = (c) => {
    // q 为真表示原数据里就带引号：即使现在不需要，也照原样保留风格
    if (c.q || NEED_QUOTE(c.v, delim)) return '"' + c.v.replace(/"/g, '""') + '"';
    return c.v;
  };
  return rows.map((r) => r.map(cell).join(delim)).join('\r\n');
}

export function detectDelim(text) {
  const cands = [',', '\t', ';', '|'];
  let best = ',', bestN = 0;
  for (const d of cands) {
    let count = 0, inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') i++;
          else inQuotes = false;
        }
      } else if (c === '"') inQuotes = true;
      else if (c === '\n' || c === '\r') break; // 只看第一行
      else if (c === d) count++;
    }
    if (count > bestN) { bestN = count; best = d; }
  }
  return best;
}

const DELIM_NAME = { ',': '逗号', '\t': '制表符', ';': '分号', '|': '竖线' };

/* ---------------- 选列 / 过滤 ---------------- */
const splitSpec = (s) => String(s || '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);

export function resolveColumns(head, spec) {
  const tokens = splitSpec(spec);
  if (!tokens.length) return head.map((_, i) => i);
  const picks = [];
  const unknown = [];
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      const idx = Number(t) - 1;
      if (idx < 0 || idx >= head.length) unknown.push(`${t}（超出 1–${head.length}）`);
      else picks.push(idx);
      continue;
    }
    let idx = head.indexOf(t);
    if (idx < 0) {
      const lower = t.toLowerCase();
      idx = head.findIndex((x) => x.toLowerCase() === lower);
    }
    if (idx < 0) unknown.push(t);
    else picks.push(idx);
  }
  if (unknown.length) {
    throw new Error(
      `找不到这些列：${unknown.join('、')}。现有列是 ${head.map((h, i) => `${i + 1}.${h || '(空列名)'}`).join('  ')}`
    );
  }
  return picks;
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function run({ input, delim, header, cols, filterCol, filterVal }) {
  if (!input || !input.trim()) throw new Error('请先粘贴 CSV 内容（可以从 Excel 里直接复制整块表格）');

  const d = delim === 'auto' || !delim ? detectDelim(input) : delim;
  if (![',', '\t', ';', '|'].includes(d)) throw new Error('分隔符只能是逗号、制表符、分号或竖线之一');

  const rows = parseCSV(input, d);
  if (!rows.length) throw new Error('这段内容里没有解析出任何一行，检查一下是不是少了分隔符');
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2) {
    // 只解析出一列时，多半是分隔符选错了；先看看内容里有没有别的候选分隔符
    const other = [',', '\t', ';', '|'].find((x) => x !== d && input.indexOf(x) >= 0);
    if (other) {
      throw new Error(
        `只解析出 1 列，但内容里有「${DELIM_NAME[other]}」，说明分隔符选错了——把分隔符改成${DELIM_NAME[other]}再导出`
      );
    }
  }

  const hasHead = header !== 'no';
  const headCells = hasHead ? rows[0] : null;
  const head = hasHead
    ? headCells.map((c, i) => c.v || `第${i + 1}列`)
    : Array.from({ length: width }, (_, i) => `第${i + 1}列`);
  if (head.length < width) for (let i = head.length; i < width; i++) head.push(`第${i + 1}列`);
  const body = hasHead ? rows.slice(1) : rows;

  const pick = resolveColumns(head, cols);
  const warn = [];
  const dupes = pick.filter((v, i) => pick.indexOf(v) !== i);
  const uniqPick = pick.filter((v, i) => pick.indexOf(v) === i);
  if (dupes.length) warn.push(`「${head[dupes[0]]}」被重复选了，已只保留一次`);

  let kept = body;
  const fCol = String(filterCol || '').trim();
  const fVal = String(filterVal || '').trim();
  let filterDesc = '';
  if (fCol && !fVal) throw new Error('填了要过滤的列，但没填关键字；不想过滤就把这一列留空');
  if (!fCol && fVal) throw new Error(`填了过滤关键字「${fVal}」，但没说明按哪一列过滤`);
  if (fCol && fVal) {
    const [fi] = resolveColumns(head, fCol);
    const needle = fVal.toLowerCase();
    kept = body.filter((r) => String((r[fi] || { v: '' }).v).toLowerCase().includes(needle));
    filterDesc = ` · 过滤：${head[fi]} 含「${fVal}」`;
    if (!kept.length) warn.push(`没有一行满足「${head[fi]} 含 ${fVal}」，导出的文件只有表头`);
  }

  const outRows = [];
  if (hasHead) outRows.push(uniqPick.map((i) => headCells[i] || { v: head[i] || '', q: false }));
  for (const r of kept) {
    outRows.push(uniqPick.map((i) => {
      const c = r[i];
      // 短行补空单元格：CSV 里行宽不一致时不能让后面的列错位
      return c || { v: '', q: false };
    }));
  }

  const out = toCSV(outRows, d);
  // 预览只展示前 8 列、前 6 行；注意 outRows 的行已经按 uniqPick 重排过，取单元格要按「输出位置」取
  const previewCols = uniqPick.slice(0, 8);
  const bodyOut = hasHead ? outRows.slice(1) : outRows;
  const previewBody = bodyOut.slice(0, 6);
  const moreCols = uniqPick.length > previewCols.length;
  const table = `<table class="cmp-table"><thead><tr>${previewCols
    .map((i) => `<th>${esc(trunc(head[i] || '', 18))}</th>`)
    .join('')}${moreCols ? `<th>…还有 ${uniqPick.length - previewCols.length} 列</th>` : ''}</tr></thead>
    <tbody>${previewBody
      .map(
        (r) =>
          `<tr>${previewCols
            .map((_, k) => `<td>${esc(trunc((r[k] || { v: '' }).v, 30))}</td>`)
            .join('')}${moreCols ? '<td>…</td>' : ''}</tr>`
      )
      .join('')}</tbody></table>`;

  const ext = d === '\t' ? 'tsv' : 'csv';
  const blob = new Blob([out], { type: d === '\t' ? 'text/tab-separated-values' : 'text/csv;charset=utf-8' });
  const name = `columns-${uniqPick.length}col-${kept.length}row.${ext}`;

  return {
    html: `<div class="msg-ok">✅ ${body.length} 行 × ${head.length} 列 → ${kept.length} 行 × ${uniqPick.length} 列${filterDesc}</div>
      ${warn.length ? `<div class="msg-warn">⚠️ ${warn.join('；')}</div>` : ''}
      <p>分隔符：${DELIM_NAME[d]} · 输出顺序：${uniqPick.map((i) => esc(trunc(head[i], 12))).join(' / ')}</p>
      ${table}
      ${
        previewBody.length
          ? `<p>表格只预览前 ${previewBody.length} 行，完整结果在下载文件里。</p>`
          : '<p class="empty">过滤后没有数据行，导出的文件只有表头。</p>'
      }`,
    text: out,
    files: [{ name, blob, kind: 'file' }],
  };
}

/* ---------------- 表单里的列编辑器 ----------------
   拖动排序的落点是 #f-cols 那个文本框：拖完把顺序写回去，
   这样「拖出来的结果」在 URL 里也能复现，run() 也不必知道 UI 的存在。 */
export function onForm(form) {
  const textEl = form.querySelector('#f-input');
  const delimEl = form.querySelector('#f-delim');
  const headerEl = form.querySelector('#f-header');
  const colsEl = form.querySelector('#f-cols');
  if (!textEl || !colsEl) return;
  const field = textEl.closest ? textEl.closest('.field') : null;
  if (!field) return;

  // v3.7：改用类名而不是内联样式。内联把颜色写死成 #fff / #eff6ff，深色主题下是一排白块；
  // 列多时（40 列的报表很常见）容器还要限高滚动，否则标签换五六行把运行按钮推出首屏。
  const wrap = document.createElement('div');
  wrap.className = 'chip-row';
  const hint = document.createElement('div');
  hint.className = 'chip-hint';
  field.appendChild(wrap);
  field.appendChild(hint);

  let heads = [];
  let order = [];
  let picked = new Set();
  let dragName = '';

  const writeCols = () => {
    const sel = order.filter((n) => picked.has(n));
    colsEl.value = sel.length === order.length ? '' : sel.join(',');
  };

  const render = () => {
    wrap.textContent = '';
    order.forEach((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.draggable = true;
      chip.textContent = trunc(name, 12) + (picked.has(name) ? ' ✓' : '');
      chip.title = `${name}${picked.has(name) ? '（保留）' : '（不保留）'}，拖动可调顺序`;
      chip.className = 'chip-pick' + (picked.has(name) ? ' on' : '');
      chip.addEventListener('click', () => {
        if (picked.has(name)) {
          if (picked.size === 1) {
            hint.textContent = '至少保留一列；想恢复全部列，把「保留的列」输入框清空即可。';
            return;
          }
          picked.delete(name);
        } else picked.add(name);
        writeCols();
        render();
      });
      chip.addEventListener('dragstart', () => { dragName = name; });
      chip.addEventListener('dragover', (e) => e.preventDefault());
      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = order.indexOf(dragName);
        if (from < 0 || dragName === name) return;
        const target = order.indexOf(name);
        order.splice(from, 1);
        order.splice(order.indexOf(name) + (from < target ? 1 : 0), 0, dragName);
        dragName = '';
        writeCols();
        render();
      });
      wrap.appendChild(chip);
    });
    hint.textContent = heads.length
      ? `共 ${heads.length} 列，已保留 ${picked.size || heads.length} 列。点一下切换保留，拖动调整顺序。`
      : '粘贴内容后这里会出现列名，可点选与拖动排序。';
  };

  const readCols = () => {
    const tokens = splitSpec(colsEl.value);
    if (!tokens.length) {
      picked = new Set(order);
      return;
    }
    picked = new Set();
    for (const t of tokens) {
      if (/^\d+$/.test(t)) {
        const name = order[Number(t) - 1];
        if (name) picked.add(name);
      } else {
        const name = order.find((n) => n === t) || order.find((n) => n.toLowerCase() === t.toLowerCase());
        if (name) picked.add(name);
      }
    }
  };

  const refresh = () => {
    const text = textEl.value;
    if (text.length > 400000) {
      heads = [];
      order = [];
      wrap.textContent = '';
      hint.textContent = '内容较长，已跳过列预览；直接填列名或序号也能正常导出。';
      return;
    }
    if (!text.trim()) {
      heads = [];
      order = [];
      render();
      return;
    }
    const d = !delimEl || delimEl.value === 'auto' ? detectDelim(text) : delimEl.value;
    const rows = parseCSV(text, d);
    if (!rows.length) {
      heads = [];
      order = [];
      render();
      return;
    }
    const width = Math.max(...rows.map((r) => r.length));
    const hasHead = !headerEl || headerEl.value !== 'no';
    heads = Array.from({ length: width }, (_, i) => {
      const v = hasHead && rows[0][i] ? rows[0][i].v : '';
      return v || `第${i + 1}列`;
    });
    order = heads.slice();
    readCols();
    render();
  };

  let t = 0;
  const later = () => {
    clearTimeout(t);
    t = setTimeout(refresh, 250);
  };
  textEl.addEventListener('input', later);
  if (delimEl) delimEl.addEventListener('change', refresh);
  if (headerEl) headerEl.addEventListener('change', refresh);
  colsEl.addEventListener('input', () => { readCols(); render(); });
  refresh();
}
