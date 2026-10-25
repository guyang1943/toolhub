// 工具：图片压缩（Canvas API，纯浏览器执行，图片不出本机）
export const manifest = {
  inputs: [
    { name: 'file', label: '选择图片（JPG / PNG / WebP）', type: 'file', accept: 'image/*' },
    { name: 'quality', label: '压缩质量（%）', type: 'range', min: 10, max: 95, default: 70 },
    {
      name: 'format',
      label: '输出格式',
      type: 'select',
      default: 'image/jpeg',
      options: [
        { value: 'image/jpeg', label: 'JPEG（体积最小）' },
        { value: 'image/webp', label: 'WebP（现代浏览器）' },
        { value: 'image/png', label: 'PNG（无损，压缩有限）' },
      ],
    },
  ],
  runLabel: '压缩',
  tips: ['质量 70-80 通常肉眼几乎无损，体积却能减半', '需要透明背景的图别转 JPEG（会变白底），保留 PNG 输出', '所有图片都在本机处理，适合压缩含敏感信息的截图'],
  scenarios: [
    { scene: '截图太大发不上微信群', how: '选图 → 质量 70 → 下载', result: '体积减半以上，文字依然清晰' },
    { scene: '网页首屏图片加载慢', how: '选 WebP 格式 + 质量 75', result: '同画质下比 JPEG 更小，现代浏览器全支持' },
    { scene: '含客户信息的截图要外发', how: '直接压缩后下载', result: '图片从未离开本机，无隐私泄露风险' },
  ],
};

export async function run({ file, quality, format }) {
  if (!file) throw new Error('请先选择一张图片');
  const bitmap = await createImageBitmap(file);
  const scale = 1; // MVP 保持原始尺寸；后续可加"限制最大边长"
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const q = Number(quality) / 100;
  const blob = await new Promise((res) => canvas.toBlob(res, format, q));
  if (!blob) throw new Error('该图片无法以此格式压缩（PNG 源转 PNG 时请调高质量）');

  const before = file.size, after = blob.size;
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  const ext = format.split('/')[1].replace('jpeg', 'jpg');
  const base = file.name.replace(/\.\w+$/, '');
  const outName = `${base}-compressed.${ext}`;

  return {
    html: `
      <div class="msg-ok">✅ ${canvas.width}×${canvas.height} · ${fmt(before)} → ${fmt(after)}（${
        pct > 0 ? '省 ' + pct + '%' : '已比原图大，可调低质量'
      }）</div>`,
    files: [{ name: outName, blob, kind: 'image' }],
    text: `${outName} · ${canvas.width}×${canvas.height}px · ${fmt(before)} → ${fmt(after)}`,
  };
}

function fmt(n) {
  return n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB';
}
