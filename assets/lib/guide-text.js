/* 教程正文的渲染（v3.28）。
   作者写正文时习惯用 Markdown 的围栏代码块——这是唯一需要结构的写法，
   其余都是纯文字。之前两个渲染器各做各的：静态页把正文原样拼进 HTML，
   SPA 侧走 esc()。于是同一段正文在两边长得不一样：
   静态页里 <title> 这类标签被浏览器当成真标签吃掉，SPA 里则显示成字面的三个反引号。

   这里只有一件事要做：先转义，再把围栏换成 <pre><code>。
   除围栏以外的任何标签都不放行——教程正文不需要富文本，
   而放行一次就得在这里维护一份白名单。 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// ```lang\n...\n``` —— lang 只用来标记语言，这里不做高亮，直接忽略
const FENCE = /^```[^\n]*\n([\s\S]*?)\n```$/;

export function guideText(raw) {
  if (!raw) return '';
  return String(raw)
    .split(/\n{2,}/)
    .map((chunk) => {
      const m = chunk.match(FENCE);
      return m ? `<pre><code>${escapeHtml(m[1])}</code></pre>` : `<p>${escapeHtml(chunk)}</p>`;
    })
    .join('');
}
