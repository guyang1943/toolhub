// 工具：人脸打码（YuNet + ONNX Runtime Web，全程在本机跑）
//
// 解码口径不是猜的，是对着 OpenCV 的 modules/objdetect/src/face_detect.cpp 抄的：
//   cx = (c + bbox0) * stride, cy = (r + bbox1) * stride
//   w  = exp(bbox2) * stride,  h  = exp(bbox3) * stride
//   score = sqrt(clamp(cls) * clamp(obj))
// 把 bbox 当成「0-1 归一化中心点+宽高」是最容易犯的错：那样算出来的框比图还大，
// 而且看起来「检出了很多东西」，不像坏，更像能用——这种错最危险。
import { getModel, loadOrt, warm } from '/assets/onnx-runtime.js';

export const onForm = () => warm();

export const manifest = {
  inputs: [
    { name: 'file', label: '选择图片（JPG / PNG / WebP）', type: 'file', accept: 'image/*' },
    {
      name: 'style',
      label: '打码方式',
      type: 'select',
      default: 'mosaic',
      options: [
        { value: 'mosaic', label: '马赛克' },
        { value: 'blur', label: '高斯模糊' },
        { value: 'solid', label: '纯色块' },
      ],
    },
    { name: 'strength', label: '强度', type: 'range', min: 4, max: 40, default: 16 },
    {
      name: 'sens',
      label: '检出口径',
      type: 'select',
      default: '0.7',
      options: [
        { value: '0.5', label: '宁可多打（侧脸、小脸也处理）' },
        { value: '0.7', label: '标准' },
        { value: '0.85', label: '宁可少打（只处理很确定的）' },
      ],
    },
  ],
  runLabel: '找脸并打码',
  tips: [
    '第一次用要下载约 10 MB 的推理引擎和 227 KB 的模型，之后浏览器会缓存',
    '「宁可多打」会多框一些非人脸区域，但对隐私场景更稳；「宁可少打」漏掉的脸不会被处理',
    '侧脸、被遮挡、极小的人脸本来就难检出。要发出去的图，打完请自己再看一遍',
  ],
  scenarios: [
    { scene: '多人合影要发到公开群里', how: '选图 → 马赛克 → 宁可多打', result: '所有人的正脸被覆盖，站远看只剩色块' },
    { scene: '截图里有别人的头像', how: '选图 → 高斯模糊 → 强度 24', result: '过渡自然，不像贴了一块灰色补丁' },
    { scene: '含人脸的证件材料要外发', how: '纯色块 + 强度 30', result: '彻底遮住，不依赖压缩算法是否可逆' },
  ],
};

const SIZE = 640; // 2023mar 的 ONNX 输入固定 1×3×640×640（喂 320 会被 ORT 直接拒掉）
const MAX_SIDE = 4096;
const IOU_NMS = 0.3;
/** 框往外扩一点：YuNet 给的是面部区域，下巴和额头常常压线 */
const PAD = 0.12;

export async function run({ file, style, strength, sens }) {
  if (!file) throw new Error('请先选一张图片');
  if (!/^image\//.test(file.type)) throw new Error('这不是图片文件，请选 JPG / PNG / WebP');

  const session = await getModel('face');
  const ort = await loadOrt();
  const t0 = Date.now();

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('这张图打不开。iPhone 的 HEIC 格式浏览器解不了，先转成 JPG 再来');
  }

  // 送进模型的图：非等比缩放到 640×640（与 OpenCV 的 resize 一致，不做 letterbox）
  const small = document.createElement('canvas');
  small.width = SIZE;
  small.height = SIZE;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;

  // blobFromImage 的默认参数是 BGR、原值 0-255、不减均值——照抄
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0, p = 0; i < SIZE * SIZE; i++, p += 4) {
    input[i] = px[p + 2];
    input[SIZE * SIZE + i] = px[p + 1];
    input[2 * SIZE * SIZE + i] = px[p];
  }

  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });

  const thr = Number(sens) || 0.7;
  const boxes = [];
  for (const stride of [8, 16, 32]) {
    const cls = out['cls_' + stride].data;
    const obj = out['obj_' + stride].data;
    const bb = out['bbox_' + stride].data;
    const cols = Math.floor(SIZE / stride);
    const rows = Math.floor(SIZE / stride);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const sc = Math.sqrt(
          Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i]))
        );
        if (sc < thr) continue;
        const cx = (c + bb[i * 4]) * stride;
        const cy = (r + bb[i * 4 + 1]) * stride;
        const w = Math.exp(bb[i * 4 + 2]) * stride;
        const h = Math.exp(bb[i * 4 + 3]) * stride;
        boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, sc });
      }
    }
  }

  // NMS：同一个脸会被相邻格子各框一次，不压掉就会叠出十几层马赛克
  boxes.sort((a, b) => b.sc - a.sc);
  const kept = [];
  for (const b of boxes) {
    let keep = true;
    for (const k of kept) {
      const ix = Math.max(0, Math.min(b.x + b.w, k.x + k.w) - Math.max(b.x, k.x));
      const iy = Math.max(0, Math.min(b.y + b.h, k.y + k.h) - Math.max(b.y, k.y));
      const inter = ix * iy;
      const uni = b.w * b.h + k.w * k.h - inter;
      if (uni > 0 && inter / uni > IOU_NMS) {
        keep = false;
        break;
      }
    }
    if (keep) kept.push(b);
  }

  if (!kept.length) {
    // 故意不返回「原图改个名」：那会让人以为处理过了。宁可什么都不给，也要说清楚
    return {
      html: `<div class="msg-warn">⚠️ 这张图里没有检出人脸（口径：${thr}）。</div>
        <p>可能是侧脸、戴了口罩/头盔、脸太小（分辨率不够），或者这张图里确实没有人。
        把「检出口径」换成「宁可多打」再试一次；还是找不到的话，这个工具帮不了你，别硬发原图。</p>`,
      text: '未检出人脸',
    };
  }

  // 输出尺寸：原图，长边封顶
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const W = Math.max(1, Math.round(bitmap.width * scale));
  const H = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, W, H);

  // 640 → 原图坐标
  const kx = W / SIZE;
  const ky = H / SIZE;
  const amount = Number(strength) || 16;
  const areas = [];
  for (const b of kept) {
    const padW = b.w * PAD;
    const padH = b.h * PAD;
    let x = Math.floor((b.x - padW) * kx);
    let y = Math.floor((b.y - padH) * ky);
    let w = Math.ceil((b.w + padW * 2) * kx);
    let h = Math.ceil((b.h + padH * 2) * ky);
    // 收进画面内：超出画布的 drawImage 会静默变形
    x = Math.max(0, Math.min(W - 1, x));
    y = Math.max(0, Math.min(H - 1, y));
    w = Math.min(W - x, w);
    h = Math.min(H - y, h);
    if (w < 2 || h < 2) continue;
    areas.push({ x, y, w, h });
    if (style === 'solid') {
      ctx.fillStyle = '#1f1b16';
      ctx.fillRect(x, y, w, h);
    } else if (style === 'blur') {
      // 先画到临时画布再贴回：直接对自身 drawImage 会递归叠图，边缘发黑
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const t = tmp.getContext('2d');
      t.filter = `blur(${Math.round(amount / 2)}px)`;
      t.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      ctx.drawImage(tmp, x, y);
    } else {
      const bw = Math.max(2, Math.round(amount / 2));
      const sw = Math.max(1, Math.round(w / bw));
      const sh = Math.max(1, Math.round(h / bw));
      const tmp = document.createElement('canvas');
      tmp.width = sw;
      tmp.height = sh;
      const t = tmp.getContext('2d');
      t.imageSmoothingEnabled = true;
      t.drawImage(canvas, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    }
  }

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('导出 PNG 失败，图片可能太大，试试先缩小一点');

  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const conf = kept.map((b) => b.sc.toFixed(2)).join(' / ');

  return {
    html: `<div class="msg-ok">✅ 处理了 ${areas.length} 张脸 · ${W}×${H} · 用时 ${secs} 秒</div>
      <p>置信度：${conf}${kept.length > 12 ? ' …' : ''}</p>
      <p>侧脸、被遮挡、极小的人脸可能没被找到。要发出去的图，请自己再看一遍再发。</p>`,
    files: [{ name: `${base}-faces-blurred.png`, blob, kind: 'image' }],
    text: `${base}-faces-blurred.png · ${areas.length} 张脸 · ${W}×${H}`,
  };
}
