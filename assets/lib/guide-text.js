/* 教程正文的渲染（v3.28，v3.39 重写切分逻辑）。
   作者写正文时习惯用 Markdown 的围栏代码块——这是唯一需要结构的写法，
   其余都是纯文字。之前两个渲染器各做各的：静态页把正文原样拼进 HTML，
   SPA 侧走 esc()。于是同一段正文在两边长得不一样：
   静态页里 <title> 这类标签被浏览器当成真标签吃掉，SPA 里则显示成字面的三个反引号。

   这里只有一件事要做：先转义，再把围栏换成 <pre><code>。
   除围栏以外的任何标签都不放行——教程正文不需要富文本，
   而放行一次就得在这里维护一份白名单。

   v3.39 修了一个结构性错误：旧实现先按「两个以上换行」切块，再判断每块是不是围栏。
   围栏块内部一旦有空行（教程里很常见：两条不相关的命令分两组），就会被从空行处切开，
   两半都不匹配围栏，于是页面上直接出现三个反引号。切分顺序反了——
   应该先认出围栏块，剩下的文字再分段。 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// ```lang\n...\n``` —— lang 只用来标记语言，这里不做高亮，直接忽略。
// 用全局正则逐个摘出代码块，块内允许有空行、任意缩进。
const FENCE = /```[^\n]*\n([\s\S]*?)\n```/g;

function paragraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<p>${escapeHtml(s)}</p>`)
    .join('');
}

export function guideText(raw) {
  if (!raw) return '';
  const src = String(raw);
  const out = [];
  let last = 0;
  let m;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src)) !== null) {
    out.push(paragraphs(src.slice(last, m.index)));
    out.push(`<pre><code>${escapeHtml(m[1])}</code></pre>`);
    last = m.index + m[0].length;
  }
  out.push(paragraphs(src.slice(last)));
  return out.join('');
}
