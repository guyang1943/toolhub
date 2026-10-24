// 工具：图片缩放（Canvas，纯浏览器执行）
export const manifest = {
  usage: '上传图片后指定最大边长，工具会按比例缩放到该边长内（不放大、不拉伸），并输出可下载的图片。适合压缩后仍嫌大的截图、需要固定尺寸的头像或封面。',
  tips: [
    '社交平台头像常用 512×512，封面常用 1200×630',
    '只按最大边长缩放：宽或高哪个超了就缩哪个，比例不变形',
    'PNG 转 JPEG 会丢失透明背景，需要透明请保留 PNG 输出',
  ],
  scenarios: [
    { scene: '上传头像被要求 512×512', how: '选图 → 最大边长 512 → 下载', result: '等比缩放到合规尺寸，不变形' },
    { scene: '手机拍的图太大传不上', how: '选 1200 → JPEG 输出', result: '尺寸和体积同时降下来' },
    { scene: '做公众号封面 1200×630', how: '选 1200 + JPEG', result: '宽度对齐平台规范，避免被裁切' },
  ],
  inputs: [
    { name: 'file', label: '选择图片', type: 'file', accept: 'image/*' },
    { name: 'max', label: '最大边长（像素）', type: 'select', default: '1200', options: [
      { value: '256', label: '256' }, { value: '512', label: '512' },
      { value: '1200', label: '1200（社交封面）' }, { value: '1920', label: '1920（高清屏）' },
    ] },
    { name: 'format', label: '输出格式', type: 'select', default: 'image/jpeg', options: [
      { value: 'image/jpeg', label: 'JPEG' }, { value: 'image/png', label: 'PNG（保留透明）' }, { value: 'image/webp', label: 'WebP' },
    ] },
  ],
  runLabel: '缩放',
};

export async function run({ file, max, format }) {
  if (!file) throw new Error('请先选择一张图片');
  const limit = Number(max);
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, limit / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, format, 0.9));
  if (!blob) throw new Error('该格式不被浏览器支持');
  const url = URL.createObjectURL(blob);
  const ext = format.split('/')[1].replace('jpeg', 'jpg');
  const base = file.name.replace(/\.\w+$/, '');
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB');
  return {
    html: `
      <div class="row" style="justify-content:space-between">
        <div class="msg-ok">✅ ${bmp.width}×${bmp.height} → ${w}×${h}（${kb(file.size)} → ${kb(blob.size)}）</div>
        <a class="btn ghost" href="${url}" download="${base}-${w}x${h}.${ext}">下载</a>
      </div>
      <div style="margin-top:12px"><img class="qr" src="${url}" style="max-width:100%;max-height:320px" /></div>`,
  };
}
