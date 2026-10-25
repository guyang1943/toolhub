// 工具：文本去重与排序（纯浏览器执行）
export const manifest = {
  usage: '按行去重（可选忽略空白与大小写）、排序（升序/降序/按长度/保持原序）、去空行。适合清洗名单、日志、关键词列表。',
  tips: ['处理名单时勾选"忽略大小写"，能合并 Alice 与 alice', '排序后去重比先排序再人工检查更不容易漏', '想保留首次出现的顺序就选"保持原序"，此时只去重不排序'],
  scenarios: [
    { scene: '运营给的关键词表里有大量重复', how: '粘贴 → 去重 → 排序', result: '得到一份干净的唯一值清单' },
    { scene: '日志里同一错误刷屏', how: '粘贴错误行 → 去重', result: '立刻看到有几种不同错误' },
    { scene: '要按长度整理一批标签', how: '选择"按长度排序"', result: '长标签与短标签自动分组' },
  ],
  inputs: [
    { name: 'text', label: '文本（每行一条）', type: 'textarea', placeholder: '每行一条内容…', default: 'apple\nBanana\napple\n  banana  \ncherry\n\ncherry\ndate' },
    { name: 'ignoreCase', label: '忽略大小写与首尾空格', type: 'select', default: 'yes', options: [
      { value: 'yes', label: '是（推荐）' }, { value: 'no', label: '否（严格区分）' },
    ] },
    { name: 'sort', label: '排序方式', type: 'select', default: 'none', options: [
      { value: 'none', label: '保持原序（只去重）' }, { value: 'asc', label: '升序 A→Z' },
      { value: 'desc', label: '降序 Z→A' }, { value: 'len', label: '按长度' },
    ] },
    { name: 'dropEmpty', label: '去除空行', type: 'select', default: 'yes', options: [
      { value: 'yes', label: '是' }, { value: 'no', label: '否' },
    ] },
  ],
  runLabel: '处理',
};

export async function run({ text, ignoreCase, sort, dropEmpty }) {
  let lines = String(text).split('\n');
  const before = lines.length;
  if (dropEmpty === 'yes') lines = lines.filter((l) => l.trim() !== '');
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const key = ignoreCase === 'yes' ? raw.trim().toLowerCase() : raw;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ignoreCase === 'yes' ? raw.trim() : raw);
  }
  if (sort === 'asc') out.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  else if (sort === 'desc') out.sort((a, b) => b.localeCompare(a, 'zh-CN'));
  else if (sort === 'len') out.sort((a, b) => a.length - b.length);
  const result = out.join('\n');
  return {
    html: `<div class="msg-ok">✅ ${before} 行 → ${out.length} 行（去重 ${before - out.length} 条）</div>
      <pre class="ok">${escapeHTML(result)}</pre>`,
    text: result,
  };
}

function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
