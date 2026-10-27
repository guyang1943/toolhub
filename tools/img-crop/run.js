// 工具：图片裁剪（Canvas，纯浏览器执行）
// 裁剪框可以拖，也可以直接填坐标：两条路都写回同一组数字输入框，
// 于是「拖出来的结果」能看见、能微调、也能分享给别人复现。

export const manifest = {
  usage:
    '选一张图片，在预览图上拖出要保留的区域（或直接填左上角坐标与宽高），可锁定 1:1 / 16:9 等比例、加圆角，再导出 PNG / JPEG / WebP。裁剪框会被限制在图片范围内，越界会提示并自动收缩，不会产出空白图。',
  tips: [
    '宽或高留空、填 0 表示「从起点一直到图片边缘」，只填左上角也能用',
    '头像要圆角时先设圆角半径，再导出 PNG——JPEG 没有透明通道，圆角外会填白',
    'JPEG / WebP 用质量 0.92 导出，和原图已经压过很多次相比，画质损失主要在这一次重编码',
  ],
  scenarios: [
    { scene: '截图里只想要中间那块内容', how: '选图 → 在预览上拖出矩形 → 导出 PNG', result: '得到干净的局部图，不用再开修图软件' },
    { scene: '做头像要 1:1 且四角是圆的', how: '锁 1:1 → 拖出正方形 → 圆角填 20 → 导出 PNG', result: '圆角外透明，能直接当头像' },
    { scene: '文章配图要 16:9 封面', how: '锁 16:9 → 拖动选框 → JPEG 导出', result: '比例精确，不会被平台二次裁切' },
  ],
  inputs: [
    { name: 'file', label: '选择图片', type: 'file', accept: 'image/*' },
    { name: 'x', label: '左上角 X（像素）', type: 'number', min: 0, default: 0 },
    { name: 'y', label: '左上角 Y（像素）', type: 'number', min: 0, default: 0 },
    { name: 'w', label: '裁剪宽度（0 或留空 = 到右边缘）', type: 'number', min: 0, default: 0 },
    { name: 'h', label: '裁剪高度（0 或留空 = 到下边缘）', type: 'number', min: 0, default: 0 },
    {
      name: 'aspect',
      label: '比例锁定',
      type: 'select',
      default: 'free',
      options: [
        { value: 'free', label: '自由' },
        { value: '1:1', label: '1:1 正方形' },
        { value: '4:3', label: '4:3 横图' },
        { value: '3:4', label: '3:4 竖图' },
        { value: '16:9', label: '16:9 封面' },
        { value: '9:16', label: '9:16 竖屏' },
        { value: 'orig', label: '跟随原图比例' },
      ],
    },
    { name: 'radius', label: '圆角半径（像素，0 = 不裁圆角）', type: 'number', min: 0, default: 0 },
    {
      name: 'format',
      label: '导出格式',
      type: 'select',
      default: 'image/png',
      options: [
        { value: 'image/png', label: 'PNG（保留透明）' },
        { value: 'image/jpeg', label: 'JPEG（体积小，不透明）' },
        { value: 'image/webp', label: 'WebP（体积更小，保留透明）' },
      ],
    },
  ],
  runLabel: '裁剪',
};

const RATIOS = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16 };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtSize = (n) =>
  n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

/** 把用户填的框收进图片内。返回 { x, y, w, h, notes } —— 越界不报死，先收缩并记录原因 */
export function fitBox({ iw, ih, x, y, w, h, ratio }) {
  const notes = [];
  const bad = () =>
    new Error(
      `裁剪框超出了图片范围（图片 ${iw}×${ih}，你填的是起点 ${Math.round(num(x))},${Math.round(num(y))}、尺寸 ${Math.round(num(w))}×${Math.round(num(h))}）`
    );
  // 起点本身就在图外：再怎么收缩也只剩一条边，直接说清楚比给一张 1px 的图好
  if (num(x) >= iw || num(y) >= ih) throw bad();

  let bx = Math.round(clamp(num(x), 0, Math.max(0, iw - 1)));
  let by = Math.round(clamp(num(y), 0, Math.max(0, ih - 1)));
  if (bx !== Math.round(num(x)) || by !== Math.round(num(y))) notes.push('起点超出图片，已贴到边缘');

  let bw = num(w) > 0 ? Math.round(num(w)) : iw - bx;
  let bh = num(h) > 0 ? Math.round(num(h)) : ih - by;
  if (bw <= 0 || bh <= 0) throw bad();

  if (ratio) {
    // 等比锁定：先按较短的一边收缩，保证整框仍在图内
    if (bw / bh > ratio) bw = Math.round(bh * ratio);
    else bh = Math.round(bw / ratio);
    if (bw < 1) {
      bw = 1;
      bh = Math.max(1, Math.round(1 / ratio));
    }
    if (bh < 1) {
      bh = 1;
      bw = Math.max(1, Math.round(ratio));
    }
  }

  if (bx + bw > iw) {
    bw = iw - bx;
    if (ratio) bh = Math.max(1, Math.round(bw / ratio));
    notes.push(`宽度越过右边缘，已收到 ${bw}px`);
  }
  if (by + bh > ih) {
    bh = ih - by;
    if (ratio) bw = Math.max(1, Math.round(bh * ratio));
    notes.push(`高度越过下边缘，已收到 ${bh}px`);
  }
  if (bw < 1 || bh < 1) throw bad();
  return { x: bx, y: by, w: bw, h: bh, notes };
}

export async function run({ file, x, y, w, h, aspect, radius, format }) {
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
  const iw = bmp.width, ih = bmp.height;
  if (!iw || !ih) throw new Error('读到的图片尺寸为 0，文件可能已损坏');

  const ratio = aspect === 'orig' ? iw / ih : RATIOS[aspect] || 0;
  const box = fitBox({ iw, ih, x, y, w, h, ratio });
  const r = Math.max(0, Math.round(num(radius)));
  const maxR = Math.floor(Math.min(box.w, box.h) / 2);
  const useR = Math.min(r, maxR);
  if (r > 0 && useR === 0) throw new Error(`裁剪后的图太小（${box.w}×${box.h}），放不下 ${r}px 圆角`);

  const canvas = document.createElement('canvas');
  canvas.width = box.w;
  canvas.height = box.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法裁剪图片');
  if (format === 'image/jpeg') {
    // JPEG 没有透明通道，先把底铺白，否则圆角外会变黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, box.w, box.h);
  }
  if (useR > 0) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, box.w, box.h, useR);
    else {
      const l = 0, t = 0, rr = box.w, bb = box.h;
      ctx.moveTo(l + useR, t);
      ctx.lineTo(rr - useR, t); ctx.arcTo(rr, t, rr, t + useR, useR);
      ctx.lineTo(rr, bb - useR); ctx.arcTo(rr, bb, rr - useR, bb, useR);
      ctx.lineTo(l + useR, bb); ctx.arcTo(l, bb, l, bb - useR, useR);
      ctx.lineTo(l, t + useR); ctx.arcTo(l, t, l + useR, t, useR);
    }
    ctx.closePath();
    ctx.clip();
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

  const quality = format === 'image/png' ? undefined : 0.92;
  const blob = await new Promise((res) => canvas.toBlob(res, format, quality));
  if (!blob) throw new Error('这个浏览器不支持导出该格式，换 PNG 或 JPEG 再试');
  if (typeof bmp.close === 'function') bmp.close();

  const ext = format.split('/')[1].replace('jpeg', 'jpg');
  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  const outName = `${base}-${box.w}x${box.h}.${ext}`;
  const delta = file.size ? ((blob.size - file.size) / file.size) * 100 : 0;
  const deltaTxt =
    file.size === 0
      ? ''
      : ` · 体积 ${fmtSize(file.size)} → ${fmtSize(blob.size)}（${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%）`;

  const warn = box.notes.length
    ? `<div class="msg-warn">⚠️ 裁剪框超出图片，已自动收进图内：${box.notes.join('；')}</div>`
    : '';
  const radiusNote =
    r > 0 && useR !== r ? `<div class="msg-warn">⚠️ 圆角 ${r}px 超过短边一半，已按最大可用值 ${useR}px 处理</div>` : '';

  return {
    html: `<div class="msg-ok">✅ 原图 ${iw}×${ih} → 裁剪后 ${box.w}×${box.h}${deltaTxt}</div>
      ${warn}${radiusNote}
      <p>起点 ${box.x}, ${box.y}${useR > 0 ? ` · 圆角 ${useR}px` : ''} · ${format.split('/')[1].toUpperCase()}</p>`,
    files: [{ name: outName, blob, kind: 'image' }],
    text: `${outName} · ${box.w}×${box.h}px · ${fmtSize(blob.size)}`,
  };
}

/* ---------------- 表单里的拖拽预览 ----------------
   纯增强：Canvas 上拖出矩形 → 写回 x/y/w/h 四个输入框。
   没有 DOM 或图片解码失败就静默跳过，不影响填坐标那条路。 */
export function onForm(form) {
  const fileEl = form.querySelector('#f-file');
  const xEl = form.querySelector('#f-x');
  const yEl = form.querySelector('#f-y');
  const wEl = form.querySelector('#f-w');
  const hEl = form.querySelector('#f-h');
  const aspectEl = form.querySelector('#f-aspect');
  if (!fileEl || !xEl || !wEl) return;

  const field = fileEl.closest ? fileEl.closest('.field') : null;
  if (!field || !document.createElement) return;

  const stage = document.createElement('div');
  stage.style.cssText = 'margin-top:10px;position:relative;line-height:0;';
  const canvas = document.createElement('canvas');
  // v3.7：颜色走变量。写死 #eef1f5 / #6b7280 在深色主题下是「浅灰画布 + 几乎看不见的提示」，
  // 体检按 4.5:1 判定的对比度只有 3.6。
  canvas.style.cssText =
    'width:100%;display:block;border-radius:8px;background:var(--border);cursor:crosshair;touch-action:none;';
  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:6px;font-size:12px;color:var(--muted);line-height:1.6;';
  hint.textContent = '在图上按住拖动即可框选；数字框里的坐标会同步更新。';
  stage.appendChild(canvas);
  stage.appendChild(hint);
  field.appendChild(stage);

  let img = null, rect = { x: 0, y: 0, w: 0, h: 0 }, drag = null;

  const readInts = () => ({
    x: Number(xEl.value) || 0,
    y: Number(yEl.value) || 0,
    w: Number(wEl.value) || 0,
    h: Number(hEl.value) || 0,
  });

  const paint = () => {
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx || !img) return;
    const { width: W, height: H } = img;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);
    const box = rect.w > 0 && rect.h > 0 ? rect : null;
    if (!box) return;
    // 选区外压暗，比画虚线更容易看清保留范围
    ctx.fillStyle = 'rgba(15,23,42,.45)';
    ctx.fillRect(0, 0, W, box.y);
    ctx.fillRect(0, box.y + box.h, W, H - box.y - box.h);
    ctx.fillRect(0, box.y, box.x, box.h);
    ctx.fillRect(box.x + box.w, box.y, W - box.x - box.w, box.h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, W / 400);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    // 三分线，方便构图
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(box.x + (box.w * i) / 3, box.y);
      ctx.lineTo(box.x + (box.w * i) / 3, box.y + box.h);
      ctx.moveTo(box.x, box.y + (box.h * i) / 3);
      ctx.lineTo(box.x + box.w, box.y + (box.h * i) / 3);
    }
    ctx.stroke();
  };

  const syncFromInputs = () => {
    if (!img) return;
    const v = readInts();
    rect = {
      x: clamp(v.x, 0, img.width - 1),
      y: clamp(v.y, 0, img.height - 1),
      w: v.w > 0 ? Math.min(v.w, img.width - clamp(v.x, 0, img.width)) : img.width - clamp(v.x, 0, img.width),
      h: v.h > 0 ? Math.min(v.h, img.height - clamp(v.y, 0, img.height)) : img.height - clamp(v.y, 0, img.height),
    };
    paint();
  };

  const load = async () => {
    const f = fileEl.files && fileEl.files[0];
    if (!f) return;
    try {
      img = typeof createImageBitmap === 'function' ? await createImageBitmap(f) : await viaImg(f);
    } catch {
      hint.textContent = '这张图片浏览器解不了码，无法预览；仍可手填坐标后点裁剪。';
      return;
    }
    canvas.width = img.width;
    canvas.height = img.height;
    // 首次载入时把宽高填成整图，省得用户先去查像素
    if (!Number(wEl.value)) wEl.value = img.width;
    if (!Number(hEl.value)) hEl.value = img.height;
    hint.textContent = `${img.width}×${img.height}px · 在图上拖动框选，或直接改下面的数字`;
    syncFromInputs();
  };

  const viaImg = (f) =>
    new Promise((res, rej) => {
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      im.src = url;
    });

  const toImage = (e) => {
    const b = canvas.getBoundingClientRect();
    if (!b.width || !img) return { x: 0, y: 0 };
    return {
      x: clamp(((e.clientX - b.left) / b.width) * img.width, 0, img.width),
      y: clamp(((e.clientY - b.top) / b.height) * img.height, 0, img.height),
    };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!img) return;
    const p = toImage(e);
    drag = { sx: p.x, sy: p.y };
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !img) return;
    const p = toImage(e);
    let x = Math.round(Math.min(drag.sx, p.x));
    let y = Math.round(Math.min(drag.sy, p.y));
    let w = Math.round(Math.abs(p.x - drag.sx));
    let h = Math.round(Math.abs(p.y - drag.sy));
    const ratio = aspectEl ? (aspectEl.value === 'orig' ? img.width / img.height : RATIOS[aspectEl.value] || 0) : 0;
    if (ratio && w > 0 && h > 0) {
      if (w / h > ratio) w = Math.round(h * ratio);
      else h = Math.round(w / ratio);
    }
    w = Math.max(1, Math.min(w, img.width - x));
    h = Math.max(1, Math.min(h, img.height - y));
    rect = { x, y, w, h };
    paint();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    xEl.value = rect.x;
    yEl.value = rect.y;
    wEl.value = rect.w;
    hEl.value = rect.h;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // 不用 pointerleave 收尾：拖到画布外一点就中断会很别扭，坐标已 clamp 在图内
  canvas.addEventListener('lostpointercapture', end);

  fileEl.addEventListener('change', load);
  [xEl, yEl, wEl, hEl, aspectEl].forEach((el) => el && el.addEventListener('input', syncFromInputs));
  if (fileEl.files && fileEl.files[0]) load();
}
