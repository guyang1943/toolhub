#!/usr/bin/env node
// 生成 sw.js（v3.0 E1）：把「要缓存什么」交给构建期决定，而不是手写一份会过期的清单
//
// 为什么生成：
//   1. 新增工具后，手写的预缓存清单必然漏（漏了就是「装到桌面后那个工具离线打不开」）
//   2. 版本号要跟 changelog 走，否则新 SW 不会替换旧缓存
//
// 用法：node scripts/gen-sw.mjs [--quiet]
import { readFileSync, existsSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { corePages, fullPages } from './lib/pages-registry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 是否作为 CLI 直接运行。不能直接比 import.meta.url 与 pathToFileURL(argv[1])：
// 本机工作区是 junction（C:\...\WorkBuddy\ → D:\WorkBuddyProjects\），
// import.meta.url 拿的是真实路径，argv 给的是 junction 路径，字符串永不相等。
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

/** 把站点路径映射到磁盘相对路径（目录末尾补 index.html） */
const toRel = (p) => (p === '/' ? 'index.html' : p.replace(/^\//, '') + (p.endsWith('/') ? 'index.html' : ''));
const onDisk = (p) => existsSync(join(root, toRel(p)));

// 统计口径与 perf-budget 一致：文本文件先按 LF 计。
// 仓库与线上都是 LF，只有本机检出（core.autocrlf=true）是 CRLF；不归一化时，同一份代码在
// Windows 上会凭空多出约 25 KB 离线包体积，写进 /offline/ 页的 __OFFLINE_META__ 就是假数字，
// 而它在 Linux CI 上又会变成另一个值——这类「本地红、线上绿」的账最耗人。
const TEXT_EXT = /\.(js|mjs|css|html|json|txt|xml|svg|webmanifest|md)$/i;
const sizeOf = (p) => {
  try {
    const file = join(root, toRel(p));
    const buf = readFileSync(file);
    if (!TEXT_EXT.test(file)) return buf.length;
    return Buffer.byteLength(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  } catch {
    return 0;
  }
};

/** 只在构建期用、不会进浏览器的模块（不值得让用户为它们多下一个字节） */
// v3.18 修正：lib/json-schema.js 原来被列在这里，但它其实是**浏览器里**跑的——
// toolbuilder.js 与 submit-resource.js 都 import 它做校验。排除的后果不是「省了一点流量」，
// 而是「断网打开投稿页，表单和生成器一起挂」，而且控制台只报一个 module not found，
// 看起来像网络问题。security-headers.js 才是真的只在构建期/Worker 用。
const BUILD_ONLY = new Set(['lib/security-headers.js']);

/** 扫 assets/ 与 assets/lib/ 下的应用模块（vendor 是第三方库，单独列） */
function listAppModules() {
  const out = [];
  for (const f of readdirSync(join(root, 'assets'))) {
    if (f.endsWith('.js')) out.push('assets/' + f);
  }
  const libDir = join(root, 'assets', 'lib');
  if (existsSync(libDir)) {
    for (const f of readdirSync(libDir)) {
      if (f.endsWith('.js') && !BUILD_ONLY.has('lib/' + f)) out.push('assets/lib/' + f);
    }
  }
  return out.sort();
}

/**
 * 生成 sw.js。
 * 返回 { version, core, files, bytes }：build-pages 需要用它渲染 /offline/ 页的统计数字。
 * @param {{quiet?: boolean}} [opts]
 */
export function buildSw({ quiet = false } = {}) {
  const changelog = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
  const VERSION = 'toolhub-' + (changelog.entries?.[0]?.version || 'dev');
  const tools = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools;

  // 首屏必需：装完就能打开首页并搜索、看离线页
  // 注意 app.js 的三个**静态** import（pyodide-runtime / pipeline / lib-store）必须在这里：
  // 静态 import 是启动链的一部分，缺一个整页直接白屏，而不是「某个功能降级」。
  //
  // 页面部分（'/'、'/offline/'）不再手写：v3.20 起由 scripts/lib/pages-registry.mjs 声明，
  // 这里只放数据与脚本。以前同一份页面清单在本文件里写了两遍（CORE_ALL 与 PAGES），
  // 改一处忘一处的结果是「首页能开、离线页打不开」这种只有断网才发现的错。
  const CORE_ALL = [
    ...corePages(),
    '/index.html',
    '/site.webmanifest',
    '/assets/style.css',
    '/assets/app.js',
    '/assets/pyodide-runtime.js',
    '/assets/pipeline.js',
    // v3.22：存储内核，app.js 静态 import。它必须进首屏——缺了它 app.js 连 LANG 都读不出来，
    // 整页白屏。而 store-keys.js 不进：那份清单只有 /my/ 与隐私页用，首页一条都不碰。
    '/assets/lib/store.js',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/i18n.json',
    '/i18n-detail.json',
    '/tools/tools.json',
    '/tools/directory.json',
    '/resources.json',
    // v3.24：资源条目正文，合集页要用。它不在首屏（首页用不到正文），
    // 但离线装上之后合集页得能打开，所以仍进预缓存包。
    '/resources-notes.json',
    '/analytics.json',
  ];

  // 完整离线包：全部本地工具页 + 执行文件 + 它们用到的第三方库
  // 不含 Pyodide 运行时（核心 13MB / pandas 36MB）：那属于「按需下载」，不能算进安装包
  const VENDOR = ['jsQR.js', 'marked.min.js', 'pdf-lib.min.js', 'purify.min.js', 'qrcode.min.js', 'pyodide-loader.js'];
  const full = new Set(CORE_ALL);
  for (const t of tools) {
    full.add(`/tools/${t.id}/`);
    full.add(`/tools/${t.id}/run.js`);
    // 工具自带的同源脚本（v3.27）：barcode-gen 把 JsBarcode 放进自己的目录而不是 assets/vendor/，
    // 因为它只有一个工具用、不该让所有页面为它多下一次。但上面这行只收 run.js，
    // 于是断网时条码工具会在动态 loadLib() 那一步挂掉——而它看起来只是「点了没反应」。
    // 扫目录而不是写死文件名：以后再有工具带库，自动进包。
    const dir = join(root, 'tools', t.id);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.js') && f !== 'run.js') full.add(`/tools/${t.id}/${f}`);
      }
    }
  }
  for (const v of VENDOR) if (existsSync(join(root, 'assets', 'vendor', v))) full.add(`/assets/vendor/${v}`);
  // 固定页面来自注册表。以前这里是手写清单，v3.14 / v3.15 补两次、v3.20 又补一次，
  // 每次都是「断网点了才发现 404」——同一种错犯三次，说明清单不该由人维护。
  for (const p of fullPages()) full.add(p);
  // 按需加载的应用模块（batch / drop / zip / 加密分享 / 意图解析 …）也必须进包：
  // 它们在断网时会被 import() 到，缺席就是「离线打开批量页，点一下没反应」。
  // 从磁盘扫而不是写死清单：以后新增模块自动进包，不会再漏。
  for (const rel of listAppModules()) full.add('/' + rel);
  // 页面分片 CSS（v3.3）：批量 / 离线 / 提交三页的样式单独成文件。离线时这些页面会被打开，
  // 缺了样式就是「结构在、样子全散」，所以必须一起进包。扫目录而不是写死，避免以后再漏。
  for (const f of readdirSync(join(root, 'assets'))) {
    if (f.endsWith('.css')) full.add('/assets/' + f);
  }
  // 单篇教程 JSON（v3.10）：工具页按需取自己那一篇。离线时工具页要能照常显示
  // 使用步骤与常见错误，所以一起进包——37 个文件合计约 45 KB，相对 2.7 MB 忽略不计。
  if (existsSync(join(root, 'articles'))) {
    for (const f of readdirSync(join(root, 'articles'))) {
      if (f.endsWith('.json')) full.add('/articles/' + f);
    }
  }
  // 评测（v3.12）：正文拆成单篇后，详情页要按需 fetch evaluations/<slug>.json，
  // 离线时这一下会打空。所以正文 JSON 与详情页一起进包——8 篇合计约 200 KB。
  if (existsSync(join(root, 'evaluations'))) {
    for (const f of readdirSync(join(root, 'evaluations'))) {
      if (f.endsWith('.json')) full.add('/evaluations/' + f);
      else if (existsSync(join(root, 'evaluations', f, 'index.html'))) full.add(`/evaluations/${f}/`);
    }
  }
  // 分类（v3.13 建的，v3.14 才补进包）：断网时「按用途找」是主路径之一，
  // 而 SPA 进分类页必须先取 /categories/<slug>.json，缺席就是空白页。
  if (existsSync(join(root, 'categories'))) {
    for (const f of readdirSync(join(root, 'categories'))) {
      if (f.endsWith('.json')) full.add('/categories/' + f);
      else if (existsSync(join(root, 'categories', f, 'index.html'))) full.add(`/categories/${f}/`);
    }
  }

  // 指南（v3.15）：与分类同一套道理——SPA 进指南页要先取 /guides/<slug>.json，
  // 正文缺席比页面缺席更难察觉：页头、面包屑都在，正文是空的。
  if (existsSync(join(root, 'guides'))) {
    for (const f of readdirSync(join(root, 'guides'))) {
      if (f.endsWith('.json')) full.add('/guides/' + f);
      else if (existsSync(join(root, 'guides', f, 'index.html'))) full.add(`/guides/${f}/`);
    }
  }

  // 投稿规范（v3.18）：资源表单 fetch /schemas/resource.json，工具生成器 fetch /tools/schema.json。
  // 这两份缺席不是「样式没加载」而是「表单整块加载失败」——离线打开投稿页会看到一句报错。
  // 之前 tools/schema.json 就漏了，只是没人断网开过投稿页。
  if (existsSync(join(root, 'schemas'))) {
    for (const f of readdirSync(join(root, 'schemas'))) {
      if (f.endsWith('.json')) full.add('/schemas/' + f);
    }
  }
  if (onDisk('/tools/schema.json')) full.add('/tools/schema.json');

  // 工作流（v3.23）：页面本身是壳，真正要跑起来还缺两样——流程定义 workflows.json 与
  // 每一步的 run.js。run.js 在上面的工具循环里已经进包了，这里补流程定义。
  // 漏了它的表现是「断网打开工作流页，卡片区一片空白」，而不是报错。
  if (existsSync(join(root, 'workflows'))) {
    for (const f of readdirSync(join(root, 'workflows'))) {
      if (f.endsWith('.json')) full.add('/workflows/' + f);
    }
  }

  // 只收录真的存在于磁盘上的路径：install 里的 addAll 是「全有或全无」，一个 404 会让整个装包失败
  const CORE = CORE_ALL.filter(onDisk);
  const FULL = [...full].filter(onDisk);
  const bytes = FULL.reduce((n, p) => n + sizeOf(p), 0);

  const sw = `// 由 scripts/gen-sw.mjs 生成，请勿手改（改模板请改脚本）
// 版本：${VERSION} · 预缓存 ${FULL.length} 个地址 · 约 ${(bytes / 1048576).toFixed(1)} MB
const VERSION = ${JSON.stringify(VERSION)};
const CORE = ${JSON.stringify(CORE, null, 2)};
const FULL = ${JSON.stringify(FULL, null, 2)};

self.addEventListener('install', (e) => {
  // 只预热首屏这几项：装包时一次性拉几百个文件会拖慢注册，完整的用按钮触发
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 页面点「下载离线包」时走这里：逐个抓取并回报进度，失败只记录不中断
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type !== 'PRECACHE_ALL') return;
  const client = e.source;
  e.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      let done = 0;
      let bytes = 0;
      const failed = [];
      for (const url of FULL) {
        try {
          if (!(await cache.match(url))) {
            const res = await fetch(url, { cache: 'reload' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const buf = await res.clone().arrayBuffer();
            bytes += buf.byteLength;
            await cache.put(url, res);
          }
          done++;
        } catch (err) {
          failed.push(url);
        }
        if (client && done % 5 === 0) client.postMessage({ type: 'PRECACHE_PROGRESS', done, total: FULL.length, bytes, failed: failed.length });
      }
      if (client) client.postMessage({ type: 'PRECACHE_DONE', done, total: FULL.length, bytes, failed });
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 第三方（Pyodide CDN 回退）走网络
  if (url.pathname === '/sw.js') return; // 自己不能被自己缓存，否则永远等不到新版本

  if (req.mode === 'navigate') {
    // 页面：先缓存（离线/秒开），后台再取新版本；取不到就用缓存
    e.respondWith(
      caches.match(req).then((hit) => {
        const fetching = fetch(req)
          .then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit || caches.match('/index.html'));
        return hit || fetching;
      })
    );
    return;
  }

  // 逻辑与数据：网络优先，确保部署后立即生效（离线时回退缓存）
  const isDynamic = /\\/(assets\\/app\\.js|analytics\\.json|i18n(-detail)?\\.json|resources\\.json|articles\\.json|tools\\/(tools|directory)\\.json)$/.test(url.pathname);
  if (isDynamic) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const fetching = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || fetching;
    })
  );
});
`;

  writeFileSync(join(root, 'sw.js'), sw, 'utf8');
  if (!quiet) {
    console.log(`   ↻ sw.js：${VERSION} · 首屏 ${CORE.length} 项 / 全量 ${FULL.length} 个地址 · 约 ${(bytes / 1048576).toFixed(1)} MB`);
  }
  return { version: VERSION, core: CORE.length, files: FULL, bytes };
}

if (isMain) {
  buildSw({ quiet: process.argv.includes('--quiet') });
}
