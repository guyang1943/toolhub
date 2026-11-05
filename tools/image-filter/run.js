// 工具：图片滤镜（Canvas，纯浏览器执行）
//
// 调色走 Canvas 的 filter 字符串，而不是逐像素改写 ImageData：filter 在浏览器里是
// 原生实现（部分场景走 GPU），逐像素在 4000×3000 的图上要几秒，滑一下卡一下没法用。
//
// 预设 = 一组固定系数，手调的三个滑杆叠在预设之上（100 为不改变）。
// 顺序固定为「亮度 → 对比度 → 饱和度 → 预设」，因为滤镜链是有序的：先加对比再提亮
// 与先提亮再加对比，出来的白点不一样。
//
// 大图先降采样再调色：单边超过 4096 或超过 2400 万像素时按比例缩到 4096 长边，
// 并在结果里写明缩到了多少——不写清楚，用户会以为原图被「压坏了」。
const PRESETS = {
  orig: { css: '', label: '原图' },
  gray: { css: 'grayscale(1)', label: '灰度' },
  bw: { css: 'grayscale(1) contrast(1.35)', label: '黑白（高对比）' },
  vintage: { css: 'sepia(0.35) saturate(0.85) contrast(1.05) brightness(1.02)', label: '复古' },
  cool: { css: 'hue-rotate(-12deg) saturate(0.95) brightness(1.02)', label: '冷色' },
  warm: { css: 'sepia(0.18) saturate(1.15) hue-rotate(-6deg)', label: '暖色' },
};
const MAX_SIDE = 4096;
const MAX_PIXELS = 24_000_000;

const clampPct = (v, fallback = 100) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(0, Math.round(n)));
};

function filterString(preset, brightness, contrast, saturate) {
  const parts = [`brightness(${brightness}%)`, `contrast(${contrast}%)`, `saturate(${saturate}%)`];
  const p = PRESETS[preset] || PRESETS.orig;
  if (p.css) parts.push(p.css);
  return parts.join(' ');
}

export const manifest = {
  usage:
    '选一张图片，挑一个预设（原图 / 灰度 / 黑白 / 复古 / 冷色 / 暖色），再用三个滑杆微调亮度、对比度、饱和度，导出调好的图。全程 Canvas 本地处理，图片不上传；单边超过 4096px 的大图会先按比例缩小再调色，结果里会写明实际处理尺寸。',
  tips: [
    '三个滑杆的 100% 是「不改变」，不是「一半」：想加深对比就往 100 以上拖',
    '预设与手调是叠加的：选了黑白再加 120% 饱和度，出来的仍是灰度图，饱和度对灰度无效',
    '滤镜链顺序固定（亮度 → 对比度 → 饱和度 → 预设），先提亮再加对比与反过来，白点不一样',
    '超过 4096px 的图会被缩小处理，这是为了避免卡死；要保留原始像素请先用裁剪工具切块',
  ],
  scenarios: [
    { scene: '截图发朋友圈前统一色调', how: '预设选暖色、饱和度 110', result: '偏黄但不脏，比直接滤镜轻很多' },
    { scene: '把彩色图做成黑白', how: '预设选黑白（高对比）', result: '灰阶且暗部压得住，不是单纯的灰度' },
    { scene: '手机原图太大，处理时卡住', how: '直接选图调参', result: '自动降到 4096 长边处理，结果里写明缩小比例' },
  ],
  inputs: [
    { name: 'file', label: '选择图片', type: 'file', accept: 'image/*' },
    {
      name: 'preset',
      label: '预设',
      type: 'select',
      options: [
        { value: 'orig', label: '原图（不加预设）' },
        { value: 'gray', label: '灰度' },
        { value: 'bw', label: '黑白（高对比）' },
        { value: 'vintage', label: '复古' },
        { value: 'cool', label: '冷色' },
        { value: 'warm', label: '暖色' },
      ],
    },
    { name: 'brightness', label: '亮度（%，100 = 不变）', type: 'range', min: 20, max: 200 },
    { name: 'contrast', label: '对比度（%，100 = 不变）', type: 'range', min: 20, max: 200 },
    { name: 'saturate', label: '饱和度（%，100 = 不变）', type: 'range', min: 0, max: 200 },
  ],
  runLabel: '应用滤镜',
};

export async function run({ file, preset, brightness, contrast, saturate }) {
  if (!file) throw new Error('请先选择一张图片');
  if (file.type && !/^image\//.test(file.type)) {
    throw new Error(`「${file.name || '这个文件'}」不是图片（${file.type}），请选择 PNG / JPEG / WebP 等图片文件`);
  }

  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('这张图片无法解码，可能是 HEIC/RAW 等浏览器不支持的格式，请先另存为 PNG 或 JPEG');
  }
  const iw = bmp.width;
  const ih = bmp.height;
  if (!iw || !ih) throw new Error('读到的图片尺寸为 0，文件可能已损坏');

  const b = clampPct(brightness);
  const c = clampPct(contrast);
  const s = clampPct(saturate);
  const p = PRESETS[preset] || PRESETS.orig;
  const filter = filterString(preset, b, c, s);

  // 降采样：单边超 4096 或总像素超 2400 万时等比缩到 4096 长边
  let scale = 1;
  const longest = Math.max(iw, ih);
  if (longest > MAX_SIDE) scale = MAX_SIDE / longest;
  if (iw * ih * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (iw * ih));
  const ow = Math.max(1, Math.round(iw * scale));
  const oh = Math.max(1, Math.round(ih * scale));

  const canvas = document.createElement('canvas');
  canvas.width = ow;
  canvas.height = oh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法调色');
  if (!('filter' in ctx)) throw new Error('这个浏览器的 Canvas 不支持 filter，请换 Chrome / Edge / Safari 新版本');
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = filter;
  ctx.drawImage(bmp, 0, 0, ow, oh);
  ctx.filter = 'none';
  if (typeof bmp.close === 'function') bmp.close();

  const keepJpeg = file.type === 'image/jpeg' || file.type === 'image/webp';
  const mime = keepJpeg ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((res) => canvas.toBlob(res, mime, keepJpeg ? 0.92 : undefined));
  if (!blob) throw new Error('导出失败，这个浏览器的 Canvas 可能被禁用');
  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';

  const dsNote =
    scale < 1
      ? `⚠️ 原图 ${iw}×${ih} 超过 4096px 长边，已按 ${(scale * 100).toFixed(0)}% 缩到 ${ow}×${oh} 再调色（避免卡死）。`
      : '';

  return {
    html: `<div class="msg-ok">✅ 已应用滤镜 · ${ow}×${oh} · ${ext.toUpperCase()}</div>
      ${dsNote ? `<div class="msg-warn" style="margin-top:8px">${dsNote}</div>` : ''}
      <p style="margin-top:8px;color:var(--muted);font-size:13px">预设「${p.label}」；亮度 ${b}%、对比度 ${c}%、饱和度 ${s}%。实际滤镜：<code>${filter}</code>。${
        p.css ? '' : '未选预设时只有三个滑杆生效。'
      }</p>`,
    text: `已应用滤镜：预设 ${p.label}，亮度 ${b}%、对比度 ${c}%、饱和度 ${s}%，输出 ${ow}×${oh}。${
      scale < 1 ? `原图已缩到 ${(scale * 100).toFixed(0)}%。` : ''
    }`,
    files: [{ name: `${base}-filtered.${ext}`, blob }],
  };
}

// 拖滑杆就想看到效果：有图时改动自动重跑。
export function onForm(form) {
  const f = form || document.getElementById('tool-form');
  if (!f) return;
  let timer = 0;
  const kick = (e) => {
    const id = (e.target && e.target.id) || '';
    if (!['f-brightness', 'f-contrast', 'f-saturate', 'f-preset'].includes(id)) return;
    const fileEl = document.getElementById('f-file');
    if (!fileEl || !fileEl.files || !fileEl.files.length) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const btn = document.getElementById('run-btn');
      if (btn) btn.click();
    }, 260);
  };
  f.addEventListener('input', kick);
  f.addEventListener('change', kick);
}
