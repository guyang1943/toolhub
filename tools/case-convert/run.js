// 工具：命名风格转换（camelCase / snake_case / kebab-case 等，纯浏览器执行）
export const manifest = {
  usage: '把变量名、字段名在 camelCase、PascalCase、snake_case、kebab-case、CONSTANT_CASE、空格短语之间互相转换，自动识别原输入的分词。',
  tips: ['数据库字段用 snake_case，前端变量用 camelCase，URL 用 kebab-case', '转换器会自动切分 httpResponseCode → http/response/code 这类驼峰', '含数字时建议自己核对一遍，如 v2Api 的分词可能有歧义'],
  scenarios: [
    { scene: '后端返回 snake_case，前端要 camelCase', how: '粘贴字段名 → 选 camelCase', result: '直接得到可用的变量名' },
    { scene: '建表需要统一字段命名', how: '逐个粘贴 → 选 snake_case', result: '命名风格保持一致，减少踩坑' },
    { scene: '写 CSS 类名', how: '选 kebab-case', result: '符合 CSS 社区惯例' },
  ],
  inputs: [
    { name: 'input', label: '原始名称（可多行，每行一个）', type: 'textarea', placeholder: 'user_name\nhttpResponseCode', default: 'user_name\nhttpResponseCode\nAPI_KEY_value\norder total' },
  ],
  runLabel: '转换全部风格',
};

function words(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-./]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const STYLES = {
  camel: (w) => w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x)).join(''),
  pascal: (w) => w.map((x) => x[0].toUpperCase() + x.slice(1)).join(''),
  snake: (w) => w.join('_'),
  kebab: (w) => w.join('-'),
  constant: (w) => w.join('_').toUpperCase(),
  title: (w) => w.map((x) => x[0].toUpperCase() + x.slice(1)).join(' '),
};

export async function run({ input }) {
  const lines = String(input).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请输入至少一个名称');
  const keys = Object.keys(STYLES);
  const head = keys.map((k) => `<th style="padding:6px;text-align:left">${k}</th>`).join('');
  const rows = lines
    .map((line) => {
      const w = words(line);
      if (!w.length) return '';
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px;font-family:var(--mono);color:var(--muted)">${line}</td>
        ${keys.map((k) => `<td style="padding:6px;font-family:var(--mono)">${STYLES[k](w)}</td>`).join('')}
      </tr>`;
    })
    .join('');
  const all = lines.map((l) => STYLES.snake(words(l))).join('\n');
  return {
    html: `<div class="msg-ok">✅ 已转换 ${lines.length} 个名称</div>
      <div style="overflow-x:auto;margin-top:10px">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr style="border-bottom:2px solid var(--border)"><th style="padding:6px;text-align:left">输入</th>${head}</tr>
          ${rows}
        </table>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="copy-btn">复制 snake_case 列</button></div>`,
    after(box) {
      box.querySelector('#copy-btn').onclick = async (e) => {
        await navigator.clipboard.writeText(all);
        e.target.textContent = '已复制 ✓';
        setTimeout(() => (e.target.textContent = '复制 snake_case 列'), 1500);
      };
    },
  };
}
