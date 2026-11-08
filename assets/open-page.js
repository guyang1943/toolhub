// 页面型路由：about / submit / feedback / privacy / batch / offline / my / workflows
//
// 从 app.js 拆出（v3.32）。这八个页面首页一次都进不去，而 openPage 是首屏脚本里
// 第二大的单个函数；它躺在 app.js 里，等于每个进首页的人都在为「可能去看隐私说明」付解析成本。
//
// 依赖全部显式传入，不靠模块作用域。拆出去之后这里读不到 app.js 的变量，
// 任何遗漏都只会在「用户真的点进某个页面」时才炸——而首页与工具页的测试全绿，
// 那种漏最难发现。所以宁可多写一行解构。

export async function openPage(name, deps) {
  const { loadRegistry, loadI18n, store, SITE, $, setView, stateHTML, loadResources, analyticsOptedOut, ensureCss, PAGE_CSS } = deps;
  const reg = await loadRegistry();
  await loadI18n();
  const { makePages } = await import('/assets/lib/pages.js');
  // 隐私页只需要知道「本机是否已关闭统计」。键名与清单由 pages.js 自己从 store-keys 取，
  // 不再由这里注入——v3.22 之前注入的是一个键名常量，而清单本体在另外两处各写了一遍。
  const PAGES = makePages(reg, { analyticsOptedOut });
  if (PAGE_CSS[name]) ensureCss(PAGE_CSS[name]);
  const fn = PAGES[name];
  setView('page');
  const titles = { about: '关于', submit: '投稿', feedback: '意见反馈', privacy: '隐私说明', batch: '批量处理', offline: '离线包与安装', my: '我的数据', workflows: '工作流' };
  document.title = `${titles[name] || '页面'} · ${SITE}`;
  $('#page-body').innerHTML = fn ? fn() : stateHTML('empty', { title: '页面不存在', detail: '看看地址是否拼错，或回到首页重新找。' });

  // 反馈页的复制模板
  const copyBtn = document.getElementById('fb-copy');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const text = document.getElementById('fb-tpl').textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => (copyBtn.textContent = '复制模板'), 1600);
      } catch {
        copyBtn.textContent = '复制失败，请手动选中复制';
      }
    };
  }

  // 隐私页：本机统计开关（只写本机存储，不上传）
  const optOut = document.getElementById('analytics-optout');
  if (optOut) {
    optOut.onclick = () => {
      const next = optOut.dataset.off !== '1';
      store.set('no-analytics', next);
      optOut.dataset.off = next ? '1' : '0';
      optOut.textContent = next ? '恢复统计' : '在本机关闭统计';
    };
  }

  // 页面级模块（v3.23 收成一张表）：容器 id → 模块 / 导出 / 是否要注册表 / 报错时的说法。
  // 这里原本是四段几乎一样的 try/catch，加第五个页面时发现又是同一段——「每加一个页面就抄一段」
  // 正是 v3.20 页面注册表要治的病，只不过这次病在挂载侧。加页面从此是一行。
  for (const [id, mod, fn, withReg, label] of [
    ['my-app', '/assets/my.js', 'mountMy', 1, '数据面板'],
    ['flow-app', '/assets/workflow.js', 'mountWorkflows', 1, '工作流引擎'],
    ['batch-app', '/assets/batch.js', 'mountBatch', 0, '批量模块'],
    ['offline-app', '/assets/offline.js', 'mountOffline', 0, '离线模块'],
  ]) {
    const box = document.getElementById(id);
    if (!box) continue;
    try {
      await (await import(mod))[fn](box, ...(withReg ? [reg] : []));
    } catch (e) {
      box.innerHTML = stateHTML('error', { title: label + '加载失败', detail: e.message });
    }
  }

  // 提交页的两个挂载点（工具生成器 + 资源投稿表单）整体按需加载。
  // v3.18 起从 app.js 搬去 assets/submit-page.js：首页不该为投稿页付解析成本。
  // 加载失败只降级不炸页——投稿页的骨架（四类说明 + Issue 模板链接）是静态渲染的，
  // 表单挂了还能走模板。所以这里兜住异常，让读者至少拿得到一条能走的路。
  // 投稿页：挂载点改成 #su-nav（v3.23）。表单要等用户选中那一类才挂，
  // 先挂满再藏起来，等于让每个访客为一张还没决定要不要填的表单付解析成本。
  if (document.getElementById('su-nav')) {
    try {
      const { mountSubmitPage } = await import('/assets/submit-page.js');
      await mountSubmitPage({ loadResources, stateHTML });
    } catch (e) {
      console.warn('[ToolHub] 投稿页模块加载失败，可改用 Issue 模板提交', e);
    }
  }
}
