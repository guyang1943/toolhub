// 工具：图片格式转换（Canvas 本地转码，支持 PNG / JPEG / WebP）
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB');

export const manifest = {
  usage:
    '把图片在 PNG、JPEG、WebP 之间互相转换：网页要 WebP 省流量、投稿只收 JPEG、需要透明背景就用 PNG。可以指定输出质量，JPEG/WebP 没有透明通道，透明区域会按你选的颜色填充。转换在浏览器内用 Canvas 完成，图片不会上传。',
  tips: [
    '需要透明背景：输出 PNG；JPEG 与 WebP 的有损模式会把透明区域变成填充色',
    '要显著减小体积：PNG 截图转 WebP（质量 90）通常能小一半以上且肉眼无差',
    'JPEG 反复转码会累积损失，尽量从原图直接转，不要在 JPEG 之间来回转',
    'WebP 在 Chrome / Edge / Firefox / Safari 14+ 都支持，老 IE 和内嵌浏览器可能打不开',
  ],
  scenarios: [
    { scene: '网站图片太大，想换成 WebP', how: '选 PNG/JPG → 目标 WebP → 质量 90', result: '体积明显下降，可直接下载替换' },
    { scene: '平台要求上传 JPEG，图却是 PNG', how: '目标 JPEG → 质量 90（透明处填白）', result: '符合格式要求，不会出现黑底' },
    { scene: '需要保留透明背景的图标', how: '目标 PNG', result: '透明区域原样保留' },
  ],
  inputs: [
    { name: 'file', label: '选择图片', type: 'file', accept: 'image/*' },
    {
      name: 'format',
      label: '目标格式',
      type: 'select',
      default: 'image/webp',
      options: [
        { value: 'image/webp', label: 'WebP（体积小，推荐）' },
        { value: 'image/jpeg', label: 'JPEG（通用，不支持透明）' },
        { value: 'image/png', label: 'PNG（无损，支持透明）' },
      ],
    },
    {
      name: 'quality',
      label: '输出质量',
      type: 'select',
      default: '0.9',
      options: [
        { value: '0.95', label: '95%（几乎无损）' },
        { value: '0.9', label: '90%（推荐）' },
        { value: '0.8', label: '80%（明显变小）' },
        { value: '0.6', label: '60%（极限压缩）' },
      ],
    },
    {
      name: 'bg',
      label: '透明区域填充色（仅 JPEG / WebP 有损模式生效）',
      type: 'select',
      default: '#ffffff',
      options: [
        { value: '#ffffff', label: '白色' },
        { value: '#000000', label: '黑色' },
        { value: '#f3f4f6', label: '浅灰' },
      ],
    },
  ],
  runLabel: '转换',
};

export async function run({ file, format, quality, bg }) {
  if (!file) throw new Error('请先选择一张图片');
  const target = EXT[format] ? format : 'image/webp';

  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('浏览器无法解码这张图片：HEIC / RAW / TIFF 等格式请先用系统预览另存为 JPG 或 PNG');
  }

  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  const opaque = target !== 'image/png';
  if (opaque) {
    ctx.fillStyle = bg || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bmp, 0, 0);

  const q = Number(quality) || 0.9;
  const blob = await new Promise((r) => canvas.toBlob(r, target, q));
  if (!blob) throw new Error('当前浏览器不支持导出该格式，请换 Chrome / Edge / Firefox 试试');

  // unsupported 类型会被浏览器静默降级为 PNG
  const degraded = blob.type && blob.type !== target;
  const base = (file.name || 'image').replace(/\.\w+$/, '');
  const delta = file.size ? ((1 - blob.size / file.size) * 100).toFixed(1) : '0';
  const bigger = Number(delta) < 0;
  const srcExt = (file.type || '').split('/')[1] || '未知';
  // 以 blob 的实际类型为准，避免降级后扩展名与内容不符
  const outExt = ((blob.type || target).split('/')[1] || EXT[target]).replace('jpeg', 'jpg');

  return {
    html: `
      <div class="msg-ok">✅ ${srcExt.toUpperCase()} → ${EXT[target].toUpperCase()}（${kb(file.size)} → ${kb(blob.size)}，${bigger ? '增加' : '减少'} ${Math.abs(Number(delta)).toFixed(1)}%）</div>
      ${degraded ? `<div class="panel tips" style="margin-top:12px">⚠️ 当前浏览器不支持 ${EXT[target].toUpperCase()} 编码，已降级输出 ${(blob.type || 'PNG').toUpperCase()}</div>` : ''}
      <table class="tbl" style="margin-top:12px">
        <thead><tr><th>项目</th><th style="text-align:right">值</th></tr></thead>
        <tbody>
          <tr><td>原图尺寸</td><td style="text-align:right">${bmp.width} × ${bmp.height} px</td></tr>
          <tr><td>输出格式</td><td style="text-align:right">${EXT[target].toUpperCase()}${opaque ? '（质量 ' + Math.round(q * 100) + '%）' : '（无损）'}</td></tr>
          <tr><td>原文件大小</td><td style="text-align:right">${kb(file.size)}</td></tr>
          <tr><td>输出文件大小</td><td style="text-align:right">${kb(blob.size)}</td></tr>
        </tbody>
      </table>
      <div class="panel tips" style="margin-top:14px">📌 <b>说明</b>
        <ul>
          <li>转换只改编码，不改尺寸；要同时缩小尺寸请用「图片缩放」工具</li>
          <li>JPEG / WebP 有损模式会丢弃透明通道，透明区域按下拉框所选颜色填充</li>
          <li>如果转完反而变大，说明原图本身就是高压缩格式，保留原文件即可</li>
        </ul>
      </div>`,
    files: [{ name: `${base}.${outExt}`, blob, kind: 'image' }],
    text: `${base}.${outExt} · ${bmp.width}×${bmp.height}px · ${kb(blob.size)}`,
  };
}
