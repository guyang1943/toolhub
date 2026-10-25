// 工具：文本对比（行级 diff，LCS 算法，纯浏览器执行）
export const manifest = {
  usage: '在左右两侧分别粘贴原文本和新文本，点击对比后：绿色 = 新增行，红色 = 删除行。适合对比配置文件、代码片段、日志的差异。',
  example: { 左侧: 'apple\nbanana\ncherry', 右侧: 'apple\nblueberry\ncherry\ndate' },
  inputs: [
    { name: 'a', label: '原文本（A）', type: 'textarea', placeholder: '粘贴原始文本…' },
    { name: 'b', label: '新文本（B）', type: 'textarea', placeholder: '粘贴修改后的文本…' },
  ],
  runLabel: '对比',
  tips: ['绿色是新增、红色是删除，适合对比配置改动和代码变更', '换行符风格不一致（CRLF/LF）会造成整篇差异，可先统一格式', '支持 2000 行以内文本，超出请分段对比'],
  scenarios: [
    { scene: '改完配置想确认到底动了哪几行', how: '左右粘贴改动前后内容 → 对比', result: '新增/删除行高亮，一眼锁定改动' },
    { scene: '同事说"我只改了一点点"，帮你核实', how: '粘贴两版文本', result: '实际差异行数一目了然' },
    { scene: '两个环境的日志为什么行为不同', how: '对比两次日志输出', result: '快速找出不一致的那几行' },
  ],
};

export async function run({ a, b }) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) throw new Error('文本太长，请单侧控制在 2000 行以内');
  // LCS 动态规划
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { rows.push(['=', A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push(['-', A[i++]]); }
    else { rows.push(['+', B[j++]]); }
  }
  while (i < n) rows.push(['-', A[i++]]);
  while (j < m) rows.push(['+', B[j++]]);
  const add = rows.filter((r) => r[0] === '+').length;
  const del = rows.filter((r) => r[0] === '-').length;
  if (!add && !del) {
    return { html: '<div class="msg-ok">✅ 两段文本完全一致</div>' };
  }
  const html = rows
    .map(([t, s]) => {
      const cls = t === '+' ? 'diff-add' : t === '-' ? 'diff-del' : 'diff-same';
      const sign = t === '=' ? '  ' : t;
      return `<div class="${cls}">${escapeHTML(sign + ' ' + s)}</div>`;
    })
    .join('');
  return {
    html: `<div class="msg-ok">✅ 差异：新增 ${add} 行，删除 ${del} 行</div>
      <pre class="ok" style="padding:0"><div class="diff-box">${html}</div></pre>`,
    text: rows.map(([t, s]) => `${t === '=' ? '  ' : t} ${s}`).join('\n'),
  };
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
