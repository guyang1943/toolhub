// /submit/ 页的挂载逻辑（按需加载，不进首屏）
//
// 为什么整块搬出 app.js：v3.16 收尾时脚本余量只剩 0.6 KB，这一版又要加资源表单，
// 继续往 app.js 里塞就顶线了。搬出来之后 app.js 比之前还小——首页一个字节都不该
// 为「用户可能永远不打开的投稿页」付解析成本。
//
// v3.23 改法：这一页从「四类全摊开」改成「先选一类，再出那一类的字段」。
//   起因是用户反馈：一进页面，资源的七个字段、工具的生成器、教程的六条要求、测评的两条规矩
//   全在视野里，人得先自己判断「哪一块是我该填的」，而四类的门槛差别很大——看错一类就白填。
//   现在页面上只有四张卡；点了哪张，才渲染那一类的说明与表单。
//
// 两个实现上的取舍：
//   1. **表单在第一次选中时才挂载**，不是一开始就挂好再藏起来。藏起来的表单一样会执行构造函数、
//      拉 schema、绑事件；而且「DOM 里有七个输入框」和「用户看不见」是两件事，前者还会被抓去做成
//      「页面上有 7 个字段」的误报。
//   2. **说明书留在 pages.js**，这里只负责显示/隐藏与挂载。文案只有一份，SPA 与静态页读同一处。

export async function mountSubmitPage({ loadResources, stateHTML }) {
  const nav = document.getElementById('su-nav');
  if (!nav) return; // 不在投稿页

  const panels = [...document.querySelectorAll('[data-panel]')];
  const hint = document.getElementById('su-pick-hint');
  const mounted = new Set();

  /** 第一次选中某一类时才把它的表单装进来 */
  async function mountForm(slot) {
    if (mounted.has(slot)) return;
    mounted.add(slot);
    if (slot === 'resource') {
      const box = document.getElementById('resource-submit');
      if (!box) return;
      try {
        const { mountResourceSubmit } = await import('/assets/submit-resource.js');
        await mountResourceSubmit(box, { resources: await loadResources() });
      } catch (e) {
        box.innerHTML = stateHTML('error', {
          title: '资源投稿表单加载失败',
          detail: `${e.message}。可直接按 schemas/resource.json 的字段手写一份发邮件。`,
        });
      }
    } else if (slot === 'tool') {
      const box = document.getElementById('tool-builder');
      if (!box) return;
      try {
        const { mountToolBuilder } = await import('/assets/toolbuilder.js');
        await mountToolBuilder(box);
      } catch (e) {
        box.innerHTML = stateHTML('error', {
          title: '生成器加载失败',
          detail: `${e.message}。可直接参考仓库里的 docs/TOOL-CONTRACT.md 手写。`,
        });
      }
    }
    // 教程 / 测评没有表单：它们的「提交方式」是 GitHub Issue 模板，链接已经在正文里
  }

  function select(slot, { scroll = true } = {}) {
    const panel = panels.find((p) => p.dataset.panel === slot);
    if (!panel) return;
    for (const p of panels) p.hidden = p !== panel;
    for (const b of nav.querySelectorAll('[data-slot]')) b.setAttribute('aria-pressed', String(b.dataset.slot === slot));
    if (hint) hint.hidden = true;
    mountForm(slot);
    if (scroll) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slot]');
    if (btn) select(btn.dataset.slot);
  });

  // 深链：/submit/#su-tool 与 /submit/#tool 都认。老链接（v3.22 及以前的锚点）不能断，
  // 它们可能已经出现在别处的文档或聊天记录里。
  const want = (location.hash || '').replace(/^#(su-)?/, '');
  if (want && panels.some((p) => p.dataset.panel === want)) select(want, { scroll: false });
}
