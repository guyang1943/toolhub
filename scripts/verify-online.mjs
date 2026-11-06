#!/usr/bin/env node
// 上线复验：一次回答「发上去了吗、线上是不是这一版」。
// 这轮踩过的坑都在这里收口：
//   1) 推完立刻探新路径会 404 —— Pages 构建有几十秒滞后，不是没发上去；
//   2) 本机 node 的 fetch 直连 GitHub Pages 会间歇超时（curl 走系统代理才稳）；
//   3) 判断「哪一版在线」最可靠的证据是 sw.js 里的版本号，它跟 changelog.json 走。
// 用法：node scripts/verify-online.mjs [https://toolhub.bot.cd] [--wait 90]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) || 'https://toolhub.bot.cd').replace(/\/$/, '');
const waitIdx = args.indexOf('--wait');
const WAIT = waitIdx >= 0 ? Number(args[waitIdx + 1] || 90) : 0;

// v3.23：工作流页与它的三个文件都在这里。新页面上线时最容易漏的正是这一步——
// 本地七套测试全绿、推送也成功，但线上少个文件，用户点进去就是空壳。
// 加页面时同步加一条：页面本体、它按需加载的脚本、它读的数据。
const PATHS = [
  '/', '/tools/', '/guides/', '/categories/', '/categories/image/', '/evaluations/',
  '/workflows/', '/workflows/workflows.json',
  '/assets/workflow.js', '/assets/style.workflows.css', '/assets/lib/workflow-core.js',
  '/sw.js', '/assets/content-pages.js', '/sitemap.xml',
  // v3.24：llms.txt 是新发布物（给 AI 抓取）。它不在任何页面里，漏传不会有 404 报错，
  // 只有「AI 拿不到」——线上核对必须主动探一次。
  '/llms.txt',
  // v3.24：资源正文从 resources.json 拆出来了。它是合集页唯一的正文来源，
  // 漏传这一份不会报错，只会让所有合集页的正文变成空白——线上核对必须盯着它。
  '/resources.json', '/resources-notes.json', '/resources/icons/',
  // v3.25 / v3.26 / v3.27 连着三版都在「手抽探活」：发完版拿浏览器点几个新页面看 200，
  // 因为这份清单一直没跟着长。/categories/ai/ 尤其冤——它是 10 个分类页里唯一没被探过的，
  // 而分类页是 SPA 的主入口之一，静态文件缺席时线上表现是「点进去空白」，不是 404。
  '/categories/ai/',
  // 本地工具页：抽三个不同技术路线的（Canvas / 媒体解码 / 动态注入第三方库），
  // 它们坏掉的方式各不相同（白屏 / 静默无反应 / 点了没反应），只探首页发现不了。
  '/tools/image-round/', '/tools/media-info/', '/tools/barcode-gen/',
  // 工具目录里的同源第三方库：它只被 barcode-gen 动态 <script> 注入，页面本身 200 也可能是 404 的库。
  // 漏传这一个文件，线上表现是「条码工具点了没反应」，控制台才有一行 404。
  '/tools/barcode-gen/jsbarcode.min.js',
  // v3.28：教程从 1 篇变 5 篇，新增的四篇共用一层正文渲染（assets/lib/guide-text.js）。
  // 只探 /guides/ 总览是不够的：总览 200 只说明列表在，单篇的正文渲染坏了要真打开才看得见
  // （静态页把 ``` 原样拼进 HTML，示例里的 <html> 会被浏览器吃掉，页面看着「少了一段」而不是报错）。
  // 抽两篇：一篇带围栏代码块（渲染层最容易坏的地方），一篇是最高访问量的入口类目。
  '/guides/github-pages-first-site/', '/guides/custom-domain/',
  // v3.29：教程 5 篇变 8 篇。抽两种最不一样的：一篇是纯站内工具串起来的流程（工具用法），
  // 一篇是 risk=high、唯一会渲染 .guide-risk 风险块的（开源部署）。这两篇坏了的表现完全不同。
  '/guides/toolhub-image-pipeline/', '/guides/cloudflare-tunnel-home/',
  // v3.29 第三批四篇（muse 草稿）：抽一篇带围栏代码块的（pwa-install，围栏前后少一个空行
  // 就会把 ``` 原样吐到页面上）和一篇 risk=mid 的（小程序注册，规定不渲染风险块）。
  '/guides/pwa-install/', '/guides/wechat-miniprogram-first/',
  // muse-guides-batch-4 第四批三篇：Actions 工作流 / AI 提示词 / AI 批量处理，都是 risk=low。
  // 三篇全探，不只抽样：这一批的正文里有整段 YAML 和提示词模板，渲染坏了是「少一段」而不是 404。
  '/guides/github-actions-deploy/', '/guides/ai-prompts-resume/', '/guides/ai-batch-media/',
  // 教程页与 SPA 共用的正文渲染模块——它一坏，五篇的代码示例同时出问题。
  '/assets/lib/guide-text.js',
];

async function get(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { signal: AbortSignal.timeout(12000) });
      return r;
    } catch {
      // 直连超时是常态，隔一秒再来；三次都不通才判失败
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  return null;
}

function localVersion() {
  const cl = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
  const list = cl.entries || cl;
  // changelog 里存的是 "v3.14"，sw.js 里是 "toolhub-v3.14"。统一在这里收口成完整 token，
  // 免得调用处再拼一次前缀（v3.14 首次上线时就这样比出了 "toolhub-vv3.14"，误报未到位）。
  const v = String(list[0].version || list[0].v || '').replace(/^v/, '');
  return 'toolhub-v' + v;
}

function gitHead(kind) {
  try {
    const out =
      kind === 'local'
        ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
        : execFileSync('git', ['ls-remote', 'origin', 'main'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    return out.trim().slice(0, 7);
  } catch {
    return '?';
  }
}

if (WAIT) {
  // Pages 构建滞后：先探一次，404 就等（不是失败）
  const first = await get('/', 1);
  const probe = await get('/sw.js', 1);
  const txt = probe ? await probe.text() : '';
  const v = (txt.match(/toolhub-v[\d.]+/) || [])[0];
  if (!first || first.status !== 200 || v !== localVersion()) {
    console.log(`   首次探测：${first ? first.status : '超时'} / ${v || '无版本号'}，等 ${WAIT}s 再验（Pages 构建有滞后）`);
    await new Promise((res) => setTimeout(res, WAIT * 1000));
  }
}

const rows = [];
for (const p of PATHS) {
  const r = await get(p);
  rows.push({ p, code: r ? r.status : 0 });
}
const sw = await get('/sw.js');
const swText = sw ? await sw.text() : '';
const online = (swText.match(/toolhub-v[\d.]+/) || ['(读不到)'])[0];
const local = localVersion();
const head = gitHead('local');
const remote = gitHead('remote');

const bad = rows.filter((r) => r.code !== 200);
console.log(`🌐 线上复验 ${BASE}`);
for (const r of rows) console.log(`   ${r.code === 200 ? '✅' : '❌'} ${String(r.code).padEnd(3)} ${r.p}`);
console.log(`   版本  线上 ${online} / 本地 ${local}${online === local ? ' ✅' : ' ❌'}`);
// 「查不到远端 HEAD」不等于「没推上去」。这个脚本跑在沙箱里时读不到 SSH 凭证，
// git ls-remote 会失败并返回 '?'；把它当成未推送，就会得出「上线未确认」这种假结论
// （v3.23 当场踩到：其实 ef8fa61 早已推上去，只是脚本自己查不动）。
// 所以分三种状态：一致 / 不一致 / 查不到（跳过，不参与判定）。
const remoteKnown = remote !== '?';
console.log(
  `   提交  本地 ${head} / 远端 ${remoteKnown ? remote : '查不到（本机无 GitHub 凭证，跳过）'}` +
    (!remoteKnown ? ' ⏭️' : head === remote ? ' ✅ 已推送' : ' ⚠️ 未推送')
);

const ok = !bad.length && online === local && (!remoteKnown || head === remote);
console.log(ok ? '\n✅ 上线确认：路径全通，线上就是本地这一版' : '\n❌ 上线未确认，按上面标红的项排查');
process.exit(ok ? 0 : 1);
