// /submit/ 页的挂载逻辑（按需加载，不进首屏）
//
// 为什么整块搬出 app.js：v3.16 收尾时脚本余量只剩 0.6 KB，这一版又要加资源表单，
// 继续往 app.js 里塞就顶线了。搬出来之后 app.js 比之前还小——首页一个字节都不该
// 为「用户可能永远不打开的投稿页」付解析成本。
//
// 依赖从外面传进来，不在这里 import：loadResources 与 stateHTML 在 app.js 里已有单例，
// 多引一份会在打包/缓存上各算一遍。

export async function mountSubmitPage({ loadResources, stateHTML }) {
  // ① 工具包生成器
  const builderBox = document.getElementById('tool-builder');
  if (builderBox) {
    try {
      const { mountToolBuilder } = await import('/assets/toolbuilder.js');
      await mountToolBuilder(builderBox);
    } catch (e) {
      builderBox.innerHTML = stateHTML('error', {
        title: '生成器加载失败',
        detail: `${e.message}。可直接参考仓库里的 docs/TOOL-CONTRACT.md 手写。`,
      });
    }
  }

  // ② 资源投稿表单。resources 直接从首屏那份数据里取，不额外发请求。
  const resBox = document.getElementById('resource-submit');
  if (resBox) {
    try {
      const { mountResourceSubmit } = await import('/assets/submit-resource.js');
      await mountResourceSubmit(resBox, { resources: await loadResources() });
    } catch (e) {
      resBox.innerHTML = stateHTML('error', {
        title: '资源投稿表单加载失败',
        detail: `${e.message}。可直接按 schemas/resource.json 的字段手写一份发邮件。`,
      });
    }
  }
}
