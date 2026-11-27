// 工具：去背景（U²-Net 轻量版 + ONNX Runtime Web，全程在本机跑）
//
// 三段：缩到 320×320 喂模型 → 取第一路输出当蒙版 → 把蒙版放大回原图尺寸做 alpha。
// 320 是模型的训练/导出尺寸（u2netp 的 ONNX 输入固定 1×3×320×320），不是随便挑的。
import { getModel, loadOrt, warm } from '/assets/onnx-runtime.js';

/** 表单渲染完就开始拉引擎，用户选图那几秒正好下载完（约 10 MB，仅首次） */
export const onForm = () => warm();

export const manifest = {
  inputs: [
    { name: 'file', label: '选择图片（JPG / PNG / WebP）', type: 'file', accept: 'image/*' },
    {
      name: 'bg',
      label: '背景',
      type: 'select',
      default: 'transparent',
      options: [
        { value: 'transparent', label: '透明（PNG）' },
        { value: 'white', label: '白色' },
      ],
    },
    { name: 'edge', label: '边缘柔化（像素）', type: 'range', min: 0, max: 4, default: 1 },
  ],
  runLabel: '去背景',
  tips: [
    '第一次用要下载约 10 MB 的推理引擎和 4.4 MB 的模型，之后浏览器会缓存，断网也能跑',
    '主体和背景颜色差别大时效果最好；毛发、半透明纱这类边缘会有毛边，把「边缘柔化」调到 2-3 遮一下',
    '本机实测一张约 3 秒（单线程 wasm 的上限），大图会慢一些',
  ],
  scenarios: [
    { scene: '商品图要去掉杂乱背景上架', how: '选图 → 透明 → 下载', result: '得到带 alpha 的 PNG，可直接叠到任意底图上' },
    { scene: '证件照要换白底', how: '选图 → 背景选「白色」', result: '边缘按柔化值过渡，不会出现一圈硬锯齿' },
    { scene: '含人脸的照片不想上传到在线抠图站', how: '直接在本页处理', result: '图片从头到尾没离开这台机器' },
  ],
};

const SIZE = 320;
// ImageNet 归一化：与 rembg 的预处理一致，换成别的数值蒙版会整体偏
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
/** 原图长边超过这个值先缩小：canvas 太大既慢又容易在手机上爆内存 */
const MAX_SIDE = 4096;

export async function run({ file, bg, edge }) {
  if (!file) throw new Error('请先选一张图片');
  if (!/^image\//.test(file.type)) throw new Error('这不是图片文件，请选 JPG / PNG / WebP');
  const t0 = Date.now();

  const session = await getModel('bg');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('这张图打不开。iPhone 的 HEIC 格式浏览器解不了，先转成 JPG 再来');
  }

  // 输出尺寸：原图，但长边封顶
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const W = Math.max(1, Math.round(bitmap.width * scale));
  const H = Math.max(1, Math.round(bitmap.height * scale));

  // 1. 缩到 320×320，取像素 → NCHW float32（BGR 还是 RGB 都可以，训练时是 RGB）
  const small = document.createElement('canvas');
  small.width = SIZE;
  small.height = SIZE;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;

  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0, p = 0; i < SIZE * SIZE; i++, p += 4) {
    input[i] = (px[p] / 255 - MEAN[0]) / STD[0];
    input[SIZE * SIZE + i] = (px[p + 1] / 255 - MEAN[1]) / STD[1];
    input[2 * SIZE * SIZE + i] = (px[p + 2] / 255 - MEAN[2]) / STD[2];
  }

  // 2. 推理。u2net 系列有 7 路输出，第 0 路是融合后的显著图（d0），其余是各级中间结果
  const ort = await loadOrt();
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const pred = out[session.outputNames[0]];

  // 3. 归一化到 0-255 做成蒙版（模型输出不保证落在 0-1，实测原图上是 min 0 max 1，但不能指望）
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of pred.data) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn || 1;
  /**
   * 蒙版是软的，不能直接当 alpha 用。
   * 本机实测：u2netp 在真实照片上，主体常在 0.3-0.5 而不是接近 1，背景在 0-0.1。
   * 原样当 alpha，会得到一张「人还在，但整张发虚」的图——看起来像导出错了格式，其实是蒙版中段没拉开。
   * 这里过一道 smoothstep(0.12, 0.45)：背景彻底透明、主体彻底不透明，中间保留渐变（头发不至于变成锯齿）。
   * 区间是量出来的，不是拍的：先按 0.15-0.6 试过一版，帽子实了但脸和肩膀仍然半透明。
   */
  const smoothstep = (v) => {
    const t = Math.min(1, Math.max(0, (v - 0.12) / 0.33));
    return t * t * (3 - 2 * t);
  };
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = SIZE;
  maskCanvas.height = SIZE;
  const mctx = maskCanvas.getContext('2d');
  const mimg = mctx.createImageData(SIZE, SIZE);
  let fg = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const norm = (pred.data[i] - mn) / span;
    const v = Math.round(smoothstep(norm) * 255);
    if (v > 128) fg++;
    // 关键是第四个通道：destination-in 认的是**源图的 alpha**，不是亮度。
    // 早先把蒙版画成「灰度 + alpha 恒 255」，结果整幅都被判成前景保留下来——
    // 那看起来不像坏，像「这张图本来就没有背景可去」，最容易被当成正常结果交出去。
    mimg.data[i * 4] = 255;
    mimg.data[i * 4 + 1] = 255;
    mimg.data[i * 4 + 2] = 255;
    mimg.data[i * 4 + 3] = v;
  }
  mctx.putImageData(mimg, 0, 0);

  // 4. 把蒙版放大回输出尺寸，用 destination-in 让原图只保留蒙版覆盖的部分
  const maskBig = document.createElement('canvas');
  maskBig.width = W;
  maskBig.height = H;
  const bctx = maskBig.getContext('2d');
  const soft = Number(edge) || 0;
  if (soft > 0) bctx.filter = `blur(${soft}px)`;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(maskCanvas, 0, 0, W, H);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = W;
  outCanvas.height = H;
  const octx = outCanvas.getContext('2d');
  if (bg === 'white') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, W, H);
  }
  octx.drawImage(bitmap, 0, 0, W, H);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(maskBig, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  const blob = await new Promise((res) => outCanvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('导出 PNG 失败，图片可能太大，试试先缩小一点');

  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  const pct = Math.round((fg / (SIZE * SIZE)) * 1000) / 10;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // 抠失败的样子通常是「整张脸都留下了」或「什么都不剩」，两者都值得明说，而不是让用户自己发现
  let warn = '';
  if (pct > 97) warn = '<div class="msg-warn">⚠️ 几乎整张图都被判成前景——这张图的背景可能太杂，或主体和背景贴得太紧</div>';
  else if (pct < 3) warn = '<div class="msg-warn">⚠️ 前景几乎没有保留——试试主体占画面比例更大的图</div>';

  return {
    html: `<div class="msg-ok">✅ ${bitmap.width}×${bitmap.height} → ${W}×${H} · 前景约 ${pct}% · 用时 ${secs} 秒</div>
      ${warn}
      <p>${bg === 'white' ? '已铺白底。' : '透明底已保留，下载后可直接叠到别的图上。'}
      ${scale < 1 ? `原图长边超过 ${MAX_SIDE}，已按比例缩到 ${W}×${H} 再处理。` : ''}</p>`,
    files: [{ name: `${base}-no-bg.png`, blob, kind: 'image' }],
    text: `${base}-no-bg.png · ${W}×${H} · PNG`,
  };
}
