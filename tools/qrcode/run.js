// 工具：二维码生成（基于开源 qrcodejs，MIT，本地 vendor）
export const manifest = {
  inputs: [
    { name: 'text', label: '内容（网址或任意文本）', type: 'text', placeholder: 'https://sitool.eu.org' },
    { name: 'size', label: '尺寸（像素）', type: 'select', default: '256', options: [
      { value: '128', label: '128' }, { value: '256', label: '256' }, { value: '512', label: '512' },
    ] },
  ],
  runLabel: '生成二维码',
  tips: ['网址越长二维码越密，打印后扫不出可以试试短链', '二维码中心可以贴 logo 而不影响识别（容错级别 M）', '生成全程本地，不会把你的链接发送到任何服务器'],
  scenarios: [
    { scene: '要把公众号文章转到线下海报', how: '粘贴文章链接 → 生成 512px → 下载 PNG', result: '高分辨率图片，印刷清晰' },
    { scene: '会议投屏让观众扫码进群', how: '粘贴群邀请链接 → 256px', result: '屏幕大小正好，扫码即入' },
    { scene: '分享 WiFi 密码给客人', how: '输入 WIFI:T:WPA;S:名称;P:密码;;', result: '扫码自动连网，不用手输密码' },
  ],
};

// 只有真正用到二维码时才加载 20KB 的库：首屏不再为一个工具背着它
let qrReady = null;
function ensureQRCode() {
  if (window.QRCode) return Promise.resolve();
  if (!qrReady) {
    qrReady = new Promise((ok, err) => {
      const sc = document.createElement('script');
      sc.src = '/assets/vendor/qrcode.min.js';
      sc.onload = ok;
      sc.onerror = () => {
        qrReady = null;
        err(new Error('二维码库加载失败，请检查网络后重试'));
      };
      document.head.appendChild(sc);
    });
  }
  return qrReady;
}

export async function run({ text, size }) {
  if (!text.trim()) throw new Error('请输入要生成的内容');
  // 超容量时 qrcodejs 抛的是内部错（Cannot read properties of undefined），
  // 用户只看到一堆天书。容错级别 M 的字节模式下上限是 2331 字节，先自己判一次。
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > 2331) throw new Error(`内容太长：${bytes} 字节，二维码最多放 2331 字节（容错 M）。缩短内容或改用短链`);
  await ensureQRCode();
  const s = Number(size);
  const holder = document.createElement('div');
  new window.QRCode(holder, { text, width: s, height: s, correctLevel: window.QRCode.CorrectLevel.M });
  const img = holder.querySelector('img') || holder.querySelector('canvas');
  const canvas = holder.querySelector('canvas');
  let url = canvas?.toDataURL('image/png');
  if (!url && img) url = img.src;

  // 产物必须给 Blob。以前这里只有 url（Data URL 字符串），工作流把它当文件传给下一个工具时，
  // new File([{name,url,kind}]) 会把对象转成 "[object Object]"——转出来的 Base64 全是垃圾，
  // 而且不报错。工具页只用 html，不受影响；url 保留，免得别处还引用着。
  const blob = canvas ? await new Promise((ok) => canvas.toBlob((b) => ok(b), 'image/png')) : null;
  // 兜底不走 fetch：本地工具一律不许发网络请求（哪怕只是个 data: URL，闸门也照拦）。
  // 自己把 base64 解成字节，纯本地。
  const png = blob || (() => {
    const [head, b64] = String(url).split(',');
    const bin = atob(b64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    return new Blob([bytes], { type });
  })();

  return {
    html: `<div class="msg-ok">✅ 已生成 ${s}×${s} 二维码</div>`,
    files: [{ name: 'qrcode.png', blob: png, url, kind: 'image' }],
    text,
  };
}
