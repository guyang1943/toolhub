// 工具：二维码解析（jsQR 本地解码，图片不上传；jsQR MIT License，本地 vendor）
// jsQR API：jsQR(data, width, height, { inversionAttempts }) → { data, location } | null
let libPromise = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/assets/vendor/jsQR.js';
    s.onload = () => (window.jsQR ? resolve() : reject(new Error('解码库加载异常')));
    s.onerror = () => {
      libPromise = null;
      reject(new Error('解码库加载失败，请检查网络后重试'));
    };
    document.head.appendChild(s);
  });
  return libPromise;
}

function kindOf(s) {
  if (/^https?:\/\//i.test(s)) return { label: '网址链接', url: s };
  if (/^WIFI:/i.test(s)) return { label: 'WiFi 配置' };
  if (/^BEGIN:VCARD/i.test(s)) return { label: '联系人 vCard' };
  if (/^BEGIN:VEVENT/i.test(s)) return { label: '日历事件' };
  if (/^tel:/i.test(s)) return { label: '电话号码', url: s };
  if (/^mailto:/i.test(s)) return { label: '邮箱地址', url: s };
  if (/^sms:/i.test(s)) return { label: '短信' };
  return { label: '纯文本' };
}

export const manifest = {
  inputs: [{ name: 'file', label: '选择二维码图片（截图或照片均可）', type: 'file', accept: 'image/*' }],
  runLabel: '解析二维码',
  tips: [
    '解码在本机完成，图片不会上传——含有敏感链接的二维码也能放心扫',
    '识别率低时优先裁剪：只留二维码本身，去掉周围杂物，识别率会明显提高',
    '反色（白底黑码 vs 黑底白码）二维码也能识别，库会自动尝试两种反色',
    '一张图里有多个二维码时只返回第一个，需要的码放正中间再截一次',
  ],
  scenarios: [
    { scene: '收到一张带二维码的截图', how: '上传图片 → 解析', result: '直接得到链接，不用拿手机扫' },
    { scene: '纸质海报上的二维码', how: '手机拍张照上传', result: '拍得正、光线匀就能识别' },
    { scene: '想确认二维码指向的网址安不安全', how: '先解析看完整 URL 再决定是否访问', result: '看清目标域名，避免扫到仿冒链接' },
  ],
};

export async function run({ file }) {
  if (!file) throw new Error('请先选择一张二维码图片');
  await loadJsQR();

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法读取该图片，请换一张（支持 PNG / JPG / WebP）');
  }

  // 超大图按比例缩到 2400px 以内：jsQR 逐像素扫描，太大既慢又容易内存吃紧
  const MAX = 2400;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  const found = window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
  if (!found || !found.data) {
    throw new Error('没有识别到二维码：请确认图片完整、清晰、不反光，必要时裁剪后再试');
  }

  const kind = kindOf(found.data);
  const loc = found.location;
  const quad = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];

  return {
    html: `
      <div class="msg-ok">✅ 识别成功 · <span class="qr-kind">${kind.label}</span></div>
      <div class="qr-out">
        <div class="qr-text">
          <label style="font-size:13px;color:var(--muted)">二维码内容</label>
          <pre class="ok" id="qr-content">${found.data.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>
          ${kind.url ? `<div class="row" style="margin-top:10px"><a class="btn ghost" href="${kind.url}" target="_blank" rel="noopener">打开链接 ↗</a></div>` : ''}
          <p style="font-size:13px;color:var(--muted);margin-top:10px">图片 ${bitmap.width}×${bitmap.height}${scale < 1 ? `（已缩至 ${w}×${h} 解析）` : ''} · 解码全程在本机完成</p>
        </div>
        <div class="qr-preview" id="qr-preview"></div>
      </div>`,
    text: found.data,
    after(box) {
      // 预览图 + 识别框标注
      const holder = box.querySelector('#qr-preview');
      const view = document.createElement('canvas');
      const vs = Math.min(1, 300 / Math.max(w, h));
      view.width = Math.round(w * vs);
      view.height = Math.round(h * vs);
      view.style.maxWidth = '100%';
      view.style.borderRadius = '10px';
      view.style.border = '1px solid var(--border)';
      const vctx = view.getContext('2d');
      vctx.drawImage(canvas, 0, 0, view.width, view.height);
      vctx.strokeStyle = '#e11d48';
      vctx.lineWidth = 2;
      vctx.beginPath();
      quad.forEach((p, i) => {
        const x = p.x * vs;
        const y = p.y * vs;
        if (i === 0) vctx.moveTo(x, y);
        else vctx.lineTo(x, y);
      });
      vctx.closePath();
      vctx.stroke();
      holder.appendChild(view);
    },
  };
}
