// 工具：JSON 格式化（纯浏览器执行）
export const manifest = {
  usage: '粘贴 JSON 后选择"美化"或"压缩"。美化会把缩进对齐方便阅读，压缩会去除所有空白减小体积。输入不合法时会精确提示错误位置。',
  tips: ['压缩后的 JSON 适合放进请求体或配置文件，能减少 30%+ 体积', '把接口返回的 JSON 粘进来，一眼就能看出字段结构和层级', '所有处理都在本机完成，可以放心粘贴含密钥的配置'],
  scenarios: [
    { scene: '接口返回一大坨没排版的 JSON', how: '粘贴 → 选「美化」→ 复制结果', result: '层级清晰的缩进结构，快速定位字段' },
    { scene: '配置文件要压到最小传输', how: '粘贴 → 选「压缩」', result: '去掉所有空白，体积可减 30% 以上' },
    { scene: '报错说 Unexpected token', how: '粘贴后看错误提示的位置', result: '精确定位非法字符在第几个位置' },
  ],
  inputs: [
    { name: 'json', label: 'JSON 内容', type: 'textarea', placeholder: '粘贴 JSON，例如 {"a":1,"b":[2,3]}' },
    {
      name: 'mode',
      label: '处理方式',
      type: 'select',
      default: 'pretty',
      options: [
        { value: 'pretty', label: '美化（缩进）' },
        { value: 'min', label: '压缩（去空白）' },
      ],
    },
    {
      name: 'indent',
      label: '缩进宽度（仅美化时生效）',
      type: 'select',
      default: '2',
      options: [
        { value: '2', label: '2 空格' },
        { value: '4', label: '4 空格' },
        { value: 'tab', label: 'Tab' },
      ],
    },
  ],
  runLabel: '格式化',
};

export async function run({ json, mode, indent }) {
  if (!json.trim()) throw new Error('请先粘贴 JSON 内容');
  let obj;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    return { html: `<div class="msg-err">❌ JSON 语法错误：${e.message}</div>` };
  }
  const space = indent === 'tab' ? '\t' : Number(indent);
  const text = mode === 'min' ? JSON.stringify(obj) : JSON.stringify(obj, null, space);
  const size = new Blob([text]).size;
  return {
    html: `
      <div class="msg-ok">✅ JSON 合法 · 输出 ${size} 字节</div>
      <pre class="ok">${escapeHTML(text)}</pre>`,
    text,
  };
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
