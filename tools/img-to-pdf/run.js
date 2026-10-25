// 工具：图片转 PDF（pdf-lib 本地生成，图片不上传；pdf-lib MIT License，本地 vendor）
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

const mm = (n) => (n * 72) / 25.4;
const A4 = [595.28, 841.89];
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB');

export const manifest = {
  usage:
    '把若干张图片合成一个 PDF，每张图片一页。可选用 A4 页面（等比缩放居中，适合打印和报销）或「适应图片」（页面与图片等大，适合电子归档）。整个过程在浏览器内用 pdf-lib 完成，图片不会上传到任何服务器。',
  tips: [
    '支持 JPG 与 PNG；WebP、GIF、HEIC（iPhone 默认格式）请先用「图片格式转换」转成 PNG',
    'A4 模式只缩小不放大，小图会被居中放置而不会拉伸变糊',
    '多选时按选择顺序排列页面，想调整顺序就重新按顺序点选',
    '手机竖拍的照片若横躺，是 EXIF 方向信息未被 PDF 读取，先把图片旋转正再转',
  ],
  scenarios: [
    { scene: '报销要把一堆发票照片合成一个 PDF', how: '多选图片 → A4 纵向 → 生成', result: '一个按顺序排好的 PDF，直接上传报销系统' },
    { scene: '作品集/证件扫描件归档', how: '选「适应图片」 → 无边距', result: '页面与图片等大，无白边、无缩放' },
    { scene: '把长截图变成可打印文档', how: 'A4 纵向 + 10mm 边距', result: '每页一张图，留出打印安全边距' },
  ],
  inputs: [
    { name: 'files', label: '选择图片（可多选，选择顺序即页面顺序）', type: 'file', accept: 'image/png,image/jpeg', multiple: true },
    {
      name: 'size',
      label: '页面尺寸',
      type: 'select',
      default: 'a4',
      options: [
        { value: 'a4', label: 'A4 纵向（适合打印）' },
        { value: 'a4-landscape', label: 'A4 横向（适合宽图）' },
        { value: 'fit', label: '适应图片（页面与图片等大）' },
      ],
    },
    {
      name: 'margin',
      label: '页边距',
      type: 'select',
      default: '10',
      options: [
        { value: '0', label: '无边距（满页）' },
        { value: '10', label: '10 mm' },
        { value: '20', label: '20 mm' },
      ],
    },
  ],
  runLabel: '生成 PDF',
};

export async function run(v) {
  const files = Array.isArray(v.files) ? v.files : v.files ? [v.files] : [];
  if (!files.length) throw new Error('请先选择至少一张图片');
  if (files.length > 200) throw new Error('一次最多处理 200 张图片，请分批进行');

  await loadPdfLib();
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  const margin = mm(Number(v.margin) || 0);
  const size = v.size || 'a4';
  const report = [];
  const failed = [];

  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const isPng = /png/i.test(f.type || '') || /\.png$/i.test(f.name || '');
      const isJpg = /jpe?g/i.test(f.type || '') || /\.jpe?g$/i.test(f.name || '');
      let img;
      if (isPng) img = await doc.embedPng(bytes);
      else if (isJpg) img = await doc.embedJpg(bytes);
      else throw new Error('格式不支持，请先转成 JPG / PNG');

      let pageW;
      let pageH;
      if (size === 'fit') {
        pageW = img.width * 0.75 + margin * 2; // 96dpi 像素 → 72dpi 点
        pageH = img.height * 0.75 + margin * 2;
        if (pageW > 14400 || pageH > 14400) throw new Error('图片过长，超出 PDF 单页上限（14400 点），请改用 A4 页面或先切分图片');
      } else {
        const landscape = size === 'a4-landscape';
        pageW = landscape ? A4[1] : A4[0];
        pageH = landscape ? A4[0] : A4[1];
      }

      const page = doc.addPage([pageW, pageH]);
      const boxW = Math.max(1, pageW - margin * 2);
      const boxH = Math.max(1, pageH - margin * 2);
      const scale = Math.min(1, Math.min(boxW / img.width, boxH / img.height));
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: margin + (boxW - w) / 2,
        y: margin + (boxH - h) / 2,
        width: w,
        height: h,
      });
      report.push({ name: f.name || '图片', w: img.width, h: img.height, pageW, pageH, scale });
    } catch (e) {
      failed.push(`${f.name || '图片'}：${e.message || '无法解析这张图片（文件可能已损坏）'}`);
    }
  }

  if (!report.length) throw new Error(failed[0] || '没有可用的图片');

  const bytes = await doc.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const pagesRows = report
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.w}×${r.h} px</td><td>${Math.round(r.pageW)}×${Math.round(r.pageH)} pt</td><td>${(r.scale * 100).toFixed(0)}%</td></tr>`
    )
    .join('');

  return {
    html: `
      <div class="row" style="justify-content:space-between">
        <div class="msg-ok">✅ 已生成 ${report.length} 页 PDF（${kb(blob.size)}）</div>
        <a class="btn" href="${url}" download="images-${Date.now()}.pdf">下载 PDF</a>
      </div>
      ${failed.length ? `<div class="panel tips" style="margin-top:12px">⚠️ <b>${failed.length} 张图片被跳过</b><ul>${failed.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
      <div style="overflow-x:auto;margin-top:12px">
        <table class="tbl">
          <thead><tr><th>页</th><th>文件</th><th>原始尺寸</th><th>页面尺寸</th><th>缩放</th></tr></thead>
          <tbody>${pagesRows}</tbody>
        </table>
      </div>
      <div class="panel tips" style="margin-top:14px">📌 <b>说明</b>
        <ul>
          <li>图片没有放大，只按比例缩小到页面内并居中（缩放 100% 表示原尺寸放置）</li>
          <li>PDF 内嵌的是原始图片数据，不重新压缩；如需减小体积，先把图片压缩再转</li>
          <li>生成的文件在浏览器内存中，刷新页面即失效，请先下载保存</li>
        </ul>
      </div>`,
  };
}
