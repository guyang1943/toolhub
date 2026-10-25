// 工具：PDF 合并 / 提取 / 拆分（pdf-lib 本地处理，文件不上传；pdf-lib MIT License，本地 vendor）
let libPromise = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve();
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/assets/vendor/pdf-lib.min.js';
    s.onload = () => (window.PDFLib ? resolve() : reject(new Error('PDF 库加载异常')));
    s.onerror = () => {
      libPromise = null;
      reject(new Error('PDF 库加载失败，请检查网络后重试'));
    };
    document.head.appendChild(s);
  });
  return libPromise;
}

// "1,3,5-8" → [0,2,4,5,6,7]（0 基页码）
function parsePages(spec, total) {
  const out = [];
  const seen = new Set();
  const parts = String(spec || '')
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > total) throw new Error(`页码 ${a}-${b} 超出范围：文档共 ${total} 页（页码从 1 开始）`);
      for (let i = a; i <= b; i++) {
        if (!seen.has(i - 1)) {
          seen.add(i - 1);
          out.push(i - 1);
        }
      }
    } else if (/^\d+$/.test(p)) {
      const n = Number(p);
      if (n < 1 || n > total) throw new Error(`页码 ${n} 超出范围：文档共 ${total} 页（页码从 1 开始）`);
      if (!seen.has(n - 1)) {
        seen.add(n - 1);
        out.push(n - 1);
      }
    } else {
      throw new Error(`无法识别的页码片段「${p}」，请用 1,3,5-8 这种格式`);
    }
  }
  if (!out.length) throw new Error('页码范围为空');
  return out;
}

function loadDoc(buf) {
  return window.PDFLib.PDFDocument.load(buf);
}

export const manifest = {
  inputs: [
    {
      name: 'mode',
      label: '操作',
      type: 'select',
      default: 'merge',
      options: [
        { value: 'merge', label: '合并多个 PDF（按选择顺序）' },
        { value: 'extract', label: '提取页面（从单个 PDF 中抽出若干页）' },
        { value: 'split', label: '拆分（按固定页数切成多个文件）' },
      ],
    },
    { name: 'files', label: '选择 PDF（合并时按住 Ctrl / ⌘ 多选，顺序即合并顺序）', type: 'file', accept: 'application/pdf', multiple: true },
    { name: 'pages', label: '页码范围（如 1,3,5-8，留空表示全部）', type: 'text', placeholder: '1,3,5-8' },
    { name: 'every', label: '每份页数', type: 'number', default: '1', placeholder: '如 1 表示逐页拆分' },
  ],
  runLabel: '开始处理',
  tips: [
    '所有处理都在浏览器内完成，含敏感信息的合同、证件扫描件也能放心用',
    '加密 PDF 无法处理（需要密码），请先解密后再来',
    'pdf-lib 会保留页面内容与尺寸，但书签、表单域、部分批注不会带入新文件',
    '拆分模式下每个文件单独下载，浏览器可能提示「允许下载多个文件」',
  ],
  scenarios: [
    { scene: '三份报告要合成一份发给客户', how: '合并模式，按顺序多选 3 个 PDF', result: '一个按顺序排好的完整 PDF' },
    { scene: '80 页的合同只要留签字页', how: '提取模式，填页码范围 12,45', result: '只含这两页的新文件' },
    { scene: '扫描的一本册子想按页分发', how: '拆分模式，每份 1 页', result: '逐页生成，各自下载' },
  ],
  example: { mode: 'merge', files: null, pages: '1,3,5-8', every: '1' },
};

// 表单渲染后：按操作模式显示/隐藏相关字段
export function onForm(form) {
  const mode = form.querySelector('#f-mode');
  const pages = form.querySelector('#f-pages');
  const every = form.querySelector('#f-every');
  if (!mode || !pages || !every) return;
  const show = (el, on) => {
    const f = el.closest ? el.closest('.field') : null;
    if (f) f.style.display = on ? '' : 'none';
  };
  const sync = () => {
    show(pages, mode.value === 'extract');
    show(every, mode.value === 'split');
  };
  mode.addEventListener('change', sync);
  sync();
}

function pdfBlob(bytes) {
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function run(v) {
  const mode = v.mode;
  const files = Array.isArray(v.files) ? v.files : v.files ? [v.files] : [];
  if (!files.length) throw new Error('请先选择至少一个 PDF 文件');
  for (const f of files) {
    if (f.type && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      throw new Error(`「${f.name}」不是 PDF 文件`);
    }
  }
  await loadPdfLib();

  if (mode === 'merge') {
    if (files.length < 2) throw new Error('合并至少需要选择 2 个 PDF（单选请用「提取页面」模式复制）');
    const out = await window.PDFLib.PDFDocument.create();
    const info = [];
    let totalPages = 0;
    for (const f of files) {
      let src;
      try {
        src = await loadDoc(await f.arrayBuffer());
      } catch (e) {
        throw new Error(`「${f.name}」读取失败：${/encrypt|password/i.test(e.message) ? 'PDF 已加密，请先解密' : '文件可能损坏或不是有效 PDF'}`);
      }
      const n = src.getPageCount();
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
      totalPages += n;
      info.push(`${f.name}（${n} 页）`);
    }
    const bytes = await out.save();
    return {
      html: `
        <div class="msg-ok">✅ 已合并 ${files.length} 个文件，共 ${totalPages} 页 · ${(bytes.length / 1048576).toFixed(2)} MB</div>
        <p style="font-size:13px;color:var(--muted);margin-top:10px">合并顺序：${info.join(' → ')}</p>`,
      files: [{ name: 'merged.pdf', blob: pdfBlob(bytes) }],
      text: info.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    };
  }

  // 以下两种模式只处理第一个文件
  const f = files[0];
  let src;
  try {
    src = await loadDoc(await f.arrayBuffer());
  } catch (e) {
    throw new Error(`「${f.name}」读取失败：${/encrypt|password/i.test(e.message) ? 'PDF 已加密，请先解密' : '文件可能损坏或不是有效 PDF'}`);
  }
  const total = src.getPageCount();
  const base = f.name.replace(/\.pdf$/i, '');

  if (mode === 'extract') {
    const idx = v.pages && v.pages.trim() ? parsePages(v.pages, total) : src.getPageIndices();
    const out = await window.PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, idx);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    return {
      html: `
        <div class="msg-ok">✅ 已提取 ${idx.length} / ${total} 页 · ${(bytes.length / 1048576).toFixed(2)} MB</div>
        <p style="font-size:13px;color:var(--muted);margin-top:10px">提取页码：${idx.map((i) => i + 1).join(', ')}</p>`,
      files: [{ name: `${base}-extracted.pdf`, blob: pdfBlob(bytes) }],
      text: idx.map((i) => i + 1).join(', '),
    };
  }

  // 拆分：每 every 页一个文件
  const every = Math.max(1, Math.round(Number(v.every) || 1));
  const chunks = [];
  for (let i = 0; i < total; i += every) {
    const idx = [];
    for (let j = i; j < Math.min(i + every, total); j++) idx.push(j);
    const out = await window.PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, idx);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    chunks.push({ name: `${base}-${i + 1}-${idx[idx.length - 1] + 1}.pdf`, blob: pdfBlob(bytes) });
  }
  return {
    html: `<div class="msg-ok">✅ 已拆成 ${chunks.length} 个文件（每份最多 ${every} 页）</div>
      <p style="font-size:13px;color:var(--muted);margin-top:10px">文件名格式：原名-起始页-结束页.pdf</p>`,
    files: chunks.map((c) => ({ name: c.name, blob: c.blob })),
    text: chunks.map((c) => c.name).join('\n'),
  };
}
