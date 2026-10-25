// 工具：SHA-256 / SHA-512 哈希（WebCrypto，纯浏览器执行）
export const manifest = {
  inputs: [
    { name: 'text', label: '要计算哈希的文本', type: 'textarea', placeholder: '输入任意文本' },
    {
      name: 'algo',
      label: '算法',
      type: 'select',
      default: 'SHA-256',
      options: [
        { value: 'SHA-256', label: 'SHA-256' },
        { value: 'SHA-384', label: 'SHA-384' },
        { value: 'SHA-512', label: 'SHA-512' },
        { value: 'SHA-1', label: 'SHA-1（已不安全，仅兼容用）' },
      ],
    },
  ],
  runLabel: '计算哈希',
  tips: ['校验文件完整性：下载后算一次 SHA-256 与官网公布值对比', 'SHA-1 已不安全，仅用于兼容老系统，新场景用 SHA-256', '哈希是单向的，无法从结果反推原文'],
  scenarios: [
    { scene: '下载的安装包怕被篡改', how: '把文件的校验值粘进来计算，与官网公示值比对', result: '一致即可确认文件未被改动' },
    { scene: '要生成一个内容指纹做去重', how: '输入文本 → SHA-256', result: '同样的内容永远得到同样的哈希' },
    { scene: '对比两段文本是否完全一致', how: '分别算哈希再比', result: '哈希相同 = 内容一致（比肉眼看更快）' },
  ],
};

export async function run({ text, algo }) {
  if (!text) throw new Error('请先输入内容');
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    html: `<div class="msg-ok">✅ ${algo}（${hex.length * 4} 位）</div><pre class="ok">${hex}</pre>`,
    text: hex,
  };
}
