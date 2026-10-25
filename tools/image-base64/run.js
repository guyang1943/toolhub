// 工具：图片转 Base64 / Data URI（纯浏览器执行）
export const manifest = {
  usage: '把图片转成 Base64 编码或完整 Data URI，可直接嵌入 HTML/CSS/JSON。也支持反向：粘贴 Data URI 还原并下载图片。适合做小图标内联、邮件模板、接口调试。',
  tips: ['内联图片只适合小图（几 KB），超过 10KB 会明显拖慢 HTML 体积', 'Data URI 格式是 data:image/png;base64,xxx，CSS 里要放在 url() 内', '转换在本地完成，图片不会上传'],
  scenarios: [
    { scene: '邮件模板里的 logo 想内联显示', how: '上传小图 → 复制 Data URI', result: '邮件客户端不加载外链也能显示' },
    { scene: 'CSS 里需要一个几 KB 的图标', how: '上传 → 复制 data URI → 放进 background-image', result: '少一个 HTTP 请求' },
    { scene: '接口返回了 Base64 图片看不清', how: '粘贴 Data URI → 还原下载', result: '直接保存为图片文件查看' },
  ],
  inputs: [
    { name: 'file', label: '选择图片（转 Base64 时用）', type: 'file', accept: 'image/*' },
    { name: 'dataUri', label: '或粘贴 Data URI / Base64（还原图片时用）', type: 'textarea', placeholder: 'data:image/png;base64,iVBORw0KG...' },
    { name: 'mode', label: '操作', type: 'select', default: 'toBase64', options: [
      { value: 'toBase64', label: '图片 → Data URI' }, { value: 'toRaw', label: '图片 → 纯 Base64' },
      { value: 'toImage', label: 'Data URI → 图片下载' },
    ] },
  ],
  runLabel: '转换',
};

export async function run({ file, dataUri, mode }) {
  if (mode === 'toImage') {
    const raw = String(dataUri || '').trim();
    if (!raw) throw new Error('请粘贴 Data URI 或 Base64 内容');
    const uri = raw.startsWith('data:') ? raw : 'data:image/png;base64,' + raw.replace(/\s/g, '');
    const m = uri.match(/^data:(image\/\w+);base64,/);
    if (!m) throw new Error('格式不对，应为 data:image/png;base64,xxxx');
    return {
      html: `<div class="msg-ok">✅ 已还原图片（${m[1]}）</div>
        <div style="margin-top:12px"><img class="qr" src="${uri}" style="max-width:100%;max-height:320px" /></div>
        <div class="row" style="margin-top:12px"><a class="btn ghost" href="${uri}" download="restored.${m[1].split('/')[1]}">下载图片</a></div>`,
    };
  }
  if (!file) throw new Error('请先选择一张图片');
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const b64 = btoa(bin);
  const out = mode === 'toRaw' ? b64 : `data:${file.type || 'image/png'};base64,${b64}`;
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  return {
    html: `<div class="msg-ok">✅ ${file.name} · 原图 ${kb(file.size)} → Base64 约 ${kb(out.length)}（体积约增加 33%）</div>
      <pre class="ok" style="max-height:300px">${escapeHTML(out)}</pre>`,
    text: out,
  };
}

function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
