// 工具：图片圆角（Canvas，纯浏览器执行）
//
// 两种形状的差别不只是半径大小：
// · 圆角：画布尺寸不变，只把四角切掉，图外的像素是透明的
// · 圆形：必须先按短边居中裁成正方形，否则一个 1600×900 的图「做成圆的」会得到椭圆
//
// 描边一律往里画：往外画会让画布装不下，边缘被切掉一半，看起来像描边只剩内侧一条。

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normColor(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('请填描边颜色，十六进制写法，例如 #ffffff');
  const m = HEX.exec(s);
  if (!m) throw new Error(`描边颜色「${s}」不是十六进制：写 #fff 或 #ffffff 都可以`);
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export const manifest = {
  usage:
    '把图片做成圆角或圆形，可加一圈描边，导出带透明通道的 PNG。圆角模式保留原图尺寸，只切四角；圆形模式先按短边居中裁成正方形再切圆，所以 16:9 的图不会变成椭圆。',
  tips: [
    '圆角半径按「短边的百分比」算：填 50 就是能切的最大圆角，等价于把短边完全圆掉',
    '圆形模式会裁掉长边的两侧，构图靠边的图先想清楚再切——裁切居中，不可调',
    '导出 PNG 才有透明角；转成 JPEG 的话四角会被填白，不是变透明',
    '描边是往里画的，所以画面尺寸不变，也不会出现边缘被切掉半条线的情况',
  ],
  scenarios: [
    { scene: '做圆角头像', how: '形状选圆形、描边 4px 白色', result: '正方形头像，四角透明，直接能上传' },
    { scene: '卡片截图要圆角', how: '圆角模式、半径填 8%', result: '四角切掉，尺寸不变，贴进页面不会露出直角' },
    { scene: '给图标加白边', how: '圆形 + 描边 6px', result: '描边在内侧，深色背景上也看得清' },
  ],
  inputs: [
    { name: 'file', label: '选择图片', type: 'file', accept: 'image/*' },
    {
      name: 'shape',
      label: '形状',
      type: 'select',
      options: [
        { value: 'round', label: '圆角（保留原尺寸）' },
        { value: 'circle', label: '圆形（按短边裁切）' },
      ],
    },
    { name: 'radius', label: '圆角半径（短边 %，仅圆角模式）', type: 'range', min: 0, max: 50 },
    { name: 'border', label: '描边宽度（px，0 = 不描边）', type: 'number', placeholder: '0', min: 0, max: 200 },
    { name: 'borderColor', label: '描边颜色（HEX）', type: 'text', placeholder: '#ffffff' },
  ],
  runLabel: '生成图片',
};

export async function run({ file, shape, radius, border, borderColor }) {
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

  const circle = shape === 'circle';
  const side = Math.min(iw, ih);
  const cw = circle ? side : iw;
  const ch = circle ? side : ih;
  const sx = circle ? Math.round((iw - side) / 2) : 0;
  const sy = circle ? Math.round((ih - side) / 2) : 0;

  const bw = Math.max(0, Math.round(Number(border) || 0));
  if (bw > Math.min(cw, ch) / 2) {
    throw new Error(`描边 ${bw}px 太宽了：图片短边只有 ${Math.min(cw, ch)}px，描边最多 ${Math.floor(Math.min(cw, ch) / 2)}px`);
  }
  const color = bw > 0 ? normColor(borderColor) : '#000000';

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法处理图片');

  // 先把形状裁出来，再画图：先画后裁会连描边一起被裁掉
  ctx.save();
  if (circle) {
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2, Math.min(cw, ch) / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  } else {
    const pct = Math.min(50, Math.max(0, Number(radius) || 0));
    const r = Math.round((Math.min(cw, ch) * pct) / 100);
    if (r > 0) {
      roundRectPath(ctx, 0, 0, cw, ch, r);
      ctx.clip();
    }
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, cw, ch, 0, 0, cw, ch);
  if (typeof bmp.close === 'function') bmp.close();
  ctx.restore();

  if (bw > 0) {
    // 描边压在图像之上、沿同一条路径往里画一半
    ctx.lineWidth = bw;
    ctx.strokeStyle = color;
    if (circle) {
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, Math.min(cw, ch) / 2 - bw / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.stroke();
    } else {
      const pct = Math.min(50, Math.max(0, Number(radius) || 0));
      const r = Math.round((Math.min(cw, ch) * pct) / 100);
      roundRectPath(ctx, bw / 2, bw / 2, cw - bw, ch - bw, Math.max(0, r - bw / 2));
      ctx.stroke();
    }
  }

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('导出 PNG 失败，这个浏览器的 Canvas 可能被禁用');
  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  const pct = Math.min(50, Math.max(0, Number(radius) || 0));

  return {
    html: `<div class="msg-ok">✅ 已生成 ${cw}×${ch} PNG${
      circle ? `（按短边 ${side}px 居中裁切）` : ''
    }${bw > 0 ? ` · 描边 ${bw}px ${color}` : ''}</div>
      <p style="margin-top:8px;color:var(--muted);font-size:13px">${
        circle
          ? '圆形模式只保留中间的正方形区域，长边两侧已被裁掉。'
          : `圆角半径按短边的 ${pct}% 计算，约 ${Math.round((Math.min(cw, ch) * pct) / 100)}px。`
      }四角是透明的，导出格式为 PNG；转成 JPEG 会变白。</p>`,
    text: `已生成 ${cw}×${ch} PNG${circle ? '（圆形，按短边居中裁切）' : `（圆角 ${pct}%）`}${bw > 0 ? `，描边 ${bw}px ${color}` : ''}。`,
    files: [{ name: `${base}-${circle ? 'circle' : 'round'}.png`, blob }],
  };
}
