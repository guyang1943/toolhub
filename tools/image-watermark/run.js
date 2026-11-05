// 工具：图片水印（Canvas，纯浏览器执行）
//
// 字号按图片宽度的百分比算，不写死像素：同一句水印贴在 800px 的图上是 6px、
// 贴在 6000px 的图上是 45px，写死 px 在哪一头都不对。
//
// 九宫格位置按「可用区域」算：内边距取短边的 3%，再用 textAlign / textBaseline
// 把文字对齐到格子，而不是靠猜坐标——四个角与四条边这才都能贴得一样齐。

const POS = {
  tl: ['left', 'top'],
  tc: ['center', 'top'],
  tr: ['right', 'top'],
  ml: ['left', 'middle'],
  mc: ['center', 'middle'],
  mr: ['right', 'middle'],
  bl: ['left', 'bottom'],
  bc: ['center', 'bottom'],
  br: ['right', 'bottom'],
};

export const manifest = {
  usage:
    '选一张图片，填水印文字，挑九宫格里的位置，调透明度与字号（字号是图片宽度的百分比，大图小图都合适），导出 PNG。全程在浏览器 Canvas 里合成，图片不上传。',
  tips: [
    '字号填的是图片宽度的百分比：3% 在 1000px 宽的图上是 30px，贴到 6000px 的大图上自动变成 180px',
    '透明度 30%–50% 通常是「看得见但不碍事」的区间，再高就开始影响看图',
    '文字带一层淡投影，贴在白底或深底上都还看得清，这是给水印加投影的唯一目的',
    '导出的 PNG 不带透明通道以外的元数据——相机型号、拍摄地这类 EXIF 不会跟出去',
  ],
  scenarios: [
    { scene: '发公众号前打水印', how: '选图 → 填「© 我的名字」→ 位置右下 → 透明度 40%', result: '导出带水印的 PNG，位置与大小不用来回试' },
    { scene: '给截图盖「内部资料」', how: '位置选居中、透明度 25%', result: '满图可见但不挡内容，转发出去一眼能看出出处' },
    { scene: '小图怕水印太大', how: '字号调 2%–3%', result: '小图上也不会糊成一团，因为字号跟着宽度走' },
  ],
  inputs: [
    { name: 'file', label: '选择图片', type: 'file', accept: 'image/*' },
    { name: 'text', label: '水印文字', type: 'text', placeholder: '© 我的名字' },
    {
      name: 'position',
      label: '位置',
      type: 'select',
      options: [
        { value: 'br', label: '右下' },
        { value: 'bc', label: '正下' },
        { value: 'bl', label: '左下' },
        { value: 'mr', label: '右中' },
        { value: 'mc', label: '正中' },
        { value: 'ml', label: '左中' },
        { value: 'tr', label: '右上' },
        { value: 'tc', label: '正上' },
        { value: 'tl', label: '左上' },
      ],
    },
    { name: 'opacity', label: '透明度（%）', type: 'range', min: 5, max: 100 },
    { name: 'size', label: '字号（图片宽度的 %）', type: 'range', min: 1, max: 20 },
  ],
  runLabel: '加水印',
};

export async function run({ file, text, position, opacity, size }) {
  if (!file) throw new Error('请先选择一张图片');
  if (file.type && !/^image\//.test(file.type)) {
    throw new Error(`「${file.name || '这个文件'}」不是图片（${file.type}），请选择 PNG / JPEG / WebP 等图片文件`);
  }
  const label = String(text || '').trim();
  if (!label) throw new Error('请填水印文字：空水印导出等于什么都没做');
  if (label.length > 120) throw new Error(`水印文字 ${label.length} 个字太长了：超过 120 字会铺满整张图，建议 20 字以内`);

  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('这张图片无法解码，可能是 HEIC/RAW 等浏览器不支持的格式，请先另存为 PNG 或 JPEG');
  }
  const w = bmp.width;
  const h = bmp.height;
  if (!w || !h) throw new Error('读到的图片尺寸为 0，文件可能已损坏');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法合成水印');
  ctx.drawImage(bmp, 0, 0);
  if (typeof bmp.close === 'function') bmp.close();

  const pct = Math.min(20, Math.max(1, Number(size) || 4));
  const fs = Math.max(10, Math.round((w * pct) / 100));
  const [align, baseline] = POS[position] || POS.br;
  const pad = Math.round(Math.min(w, h) * 0.03);

  ctx.font = `600 ${fs}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.globalAlpha = Math.min(100, Math.max(5, Number(opacity) || 40)) / 100;
  // 投影不是装饰：白字压白底、黑字压深底时，全靠这层阴影把边缘拉出来
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.max(2, Math.round(fs / 6));
  ctx.shadowOffsetX = Math.round(fs / 20);
  ctx.shadowOffsetY = Math.round(fs / 20);
  ctx.fillStyle = '#ffffff';

  const x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;
  const y = baseline === 'top' ? pad : baseline === 'bottom' ? h - pad : h / 2;
  ctx.fillText(label, x, y);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('导出 PNG 失败，这个浏览器的 Canvas 可能被禁用');
  const base = (file.name || 'image').replace(/\.[^.]+$/, '');

  return {
    html: `<div class="msg-ok">✅ 水印已合成 · ${w}×${h} · 字号 ${fs}px（宽度的 ${pct}%）· 透明度 ${Math.round(ctx.globalAlpha * 100)}%</div>
      <p style="margin-top:8px;color:var(--muted);font-size:13px">位置按九宫格对齐，内边距取短边的 3%。导出为 PNG，原图的 EXIF 不会跟出去。</p>`,
    text: `已给 ${file.name || '图片'} 加水印「${label}」：位置 ${position || 'br'}，字号 ${fs}px，透明度 ${Math.round(
      ctx.globalAlpha * 100
    )}%。`,
    files: [{ name: `${base}-watermark.png`, blob }],
  };
}

// 拖滑杆就想看到效果，而不是每次点一下「加水印」——有图时改动自动重跑。
export function onForm(form) {
  const f = form || document.getElementById('tool-form');
  if (!f) return;
  let timer = 0;
  const kick = (e) => {
    if (!['f-opacity', 'f-size', 'f-position', 'f-text'].includes(e.target && e.target.id)) return;
    const fileEl = document.getElementById('f-file');
    if (!fileEl || !fileEl.files || !fileEl.files.length) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const btn = document.getElementById('run-btn');
      if (btn) btn.click();
    }, 220);
  };
  f.addEventListener('input', kick);
  f.addEventListener('change', kick);
}
