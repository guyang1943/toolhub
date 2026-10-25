// 工具：Base64 / URL 编解码（纯浏览器执行）
export const manifest = {
  inputs: [
    { name: 'text', label: '文本内容', type: 'textarea', placeholder: '输入要编码/解码的文本' },
    {
      name: 'op',
      label: '操作',
      type: 'select',
      default: 'b64enc',
      options: [
        { value: 'b64enc', label: 'Base64 编码' },
        { value: 'b64dec', label: 'Base64 解码' },
        { value: 'urlenc', label: 'URL 编码' },
        { value: 'urldec', label: 'URL 解码' },
      ],
    },
  ],
  runLabel: '执行',
  tips: ['带中文的文本请用本工具的 Base64 编码（原生 btoa 不支持中文）', 'URL 编码适合处理带 &、?、中文的链接参数', 'Base64 不是加密！不要用它保存密码'],
  scenarios: [
    { scene: '接口传输中文乱码', how: '输入文本 → Base64 编码 → 传给后端', result: '中文完整传输，不再乱码' },
    { scene: '链接里带中文参数打不开', how: '粘贴链接参数 → URL 编码', result: '得到可直接拼进 URL 的安全字符串' },
    { scene: '收到一段 Base64 不知道是什么', how: '粘贴 → 选 Base64 解码', result: '还原文案，中文也能正确显示' },
  ],
};

export async function run({ text, op }) {
  if (!text) throw new Error('请先输入内容');
  let out;
  try {
    if (op === 'b64enc') {
      out = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    } else if (op === 'b64dec') {
      const bin = atob(text.trim());
      out = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } else if (op === 'urlenc') {
      out = encodeURIComponent(text);
    } else {
      out = decodeURIComponent(text.replace(/\+/g, ' '));
    }
  } catch (e) {
    return { html: `<div class="msg-err">❌ 解码失败：内容不是合法的编码格式</div>` };
  }
  return {
    html: `<div class="msg-ok">✅ 完成</div><pre class="ok">${escapeHTML(out)}</pre>`,
    text: out,
  };
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
