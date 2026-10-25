// 工具：Markdown 预览（marked + DOMPurify 防 XSS，纯浏览器执行）
export const manifest = {
  usage: '左侧粘贴 Markdown，实时预览渲染效果。支持标题、列表、表格、代码块、引用等标准语法，输出经过 DOMPurify 消毒，粘贴恶意代码也不会执行。',
  inputs: [
    { name: 'md', label: 'Markdown 源码', type: 'textarea', placeholder: '# 标题\n\n- 列表项\n- **加粗**\n\n```js\nconsole.log("hi")\n```', default: '# Hello ToolHub\n\n这是一段 **Markdown** 文本。\n\n- 支持 [链接](https://github.com)\n- 支持 `行内代码`\n\n> 引用块也会渲染' },
  ],
  runLabel: '渲染预览',
  tips: ['写 README、Issue、公众号草稿时先用它预览排版效果', '输出经过 DOMPurify 消毒，粘贴的恶意脚本不会执行', '支持 GitHub Flavored Markdown 常用语法（表格/代码块/删除线）'],
  scenarios: [
    { scene: '写 README 不确定表格渲染效果', how: '粘贴 Markdown → 渲染预览', result: '表格/代码块排版效果提前看到' },
    { scene: '给同事发 Markdown 格式文档', how: '先预览检查标题层级', result: '避免标题跳级、列表错乱' },
    { scene: '要确认 Markdown 里有没有危险 HTML', how: '粘贴后看渲染结果', result: 'script 等标签会被消毒过滤' },
  ],
};

// marked(35KB) + DOMPurify(21KB) 只在这个工具里用，按需加载
let libsReady = null;
function loadScript(src) {
  return new Promise((ok, err) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = ok;
    sc.onerror = () => err(new Error('渲染库加载失败：' + src));
    document.head.appendChild(sc);
  });
}
function ensureLibs() {
  if (window.marked && window.DOMPurify) return Promise.resolve();
  if (!libsReady) {
    libsReady = (async () => {
      if (!window.marked) await loadScript('/assets/vendor/marked.min.js');
      if (!window.DOMPurify) await loadScript('/assets/vendor/purify.min.js');
    })().catch((e) => {
      libsReady = null;
      throw e;
    });
  }
  return libsReady;
}

export async function run({ md }) {
  await ensureLibs();
  const raw = window.marked.parse(md);
  const clean = window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
  return {
    html: `<div class="md-preview">${clean}</div>`,
  };
}
