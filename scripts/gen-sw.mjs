#!/usr/bin/env node
// 生成 sw.js（v3.0 E1）：把「要缓存什么」交给构建期决定，而不是手写一份会过期的清单
//
// 为什么生成：
//   1. 新增工具后，手写的预缓存清单必然漏（漏了就是「装到桌面后那个工具离线打不开」）
//   2. 版本号要跟 changelog 走，否则新 SW 不会替换旧缓存
//
// 用法：node scripts/gen-sw.mjs [--quiet]
import { readFileSync, statSync, existsSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const sizeOf = (p) => {
  try {
    return statSync(join(root, toRel(p))).size;
  } catch {
    return 0;
  }
};

/** 只在构建期用、不会进浏览器的模块（不值得让用户为它们多下一个字节） */
const BUILD_ONLY = new Set(['lib/json-schema.js', 'lib/security-headers.js']);

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
  // 注意 app.js 的两个**静态** import（pyodide-runtime / pipeline）必须在这里：
  // 静态 import 是启动链的一部分，缺一个整页直接白屏，而不是「某个功能降级」。
  const CORE_ALL = [
    '/',
    '/index.html',
    '/offline/',
    '/site.webmanifest',
    '/assets/style.css',
    '/assets/app.js',
    '/assets/pyodide-runtime.js',
    '/assets/pipeline.js',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/i18n.json',
    '/i18n-detail.json',
    '/tools/tools.json',
    '/tools/directory.json',
    '/resources.json',
    '/analytics.json',
  ];

  // 完整离线包：全部本地工具页 + 执行文件 + 它们用到的第三方库
  // 不含 Pyodide 运行时（核心 13MB / pandas 36MB）：那属于「按需下载」，不能算进安装包
  const VENDOR = ['jsQR.js', 'marked.min.js', 'pdf-lib.min.js', 'purify.min.js', 'qrcode.min.js', 'pyodide-loader.js'];
  const full = new Set(CORE_ALL);
  for (const t of tools) {
    full.add(`/tools/${t.id}/`);
    full.add(`/tools/${t.id}/run.js`);
  }
  for (const v of VENDOR) if (existsSync(join(root, 'assets', 'vendor', v))) full.add(`/assets/vendor/${v}`);
  const PAGES = ['/privacy/', '/batch/', '/offline/', '/about/', '/submit/', '/compare/', '/changelog/', '/resources/', '/topics/', '/evaluations/'];
  for (const p of PAGES) full.add(p);
  // 按需加载的应用模块（batch / drop / zip / 加密分享 / 意图解析 …）也必须进包：
  // 它们在断网时会被 import() 到，缺席就是「离线打开批量页，点一下没反应」。
  // 从磁盘扫而不是写死清单：以后新增模块自动进包，不会再漏。
  for (const rel of listAppModules()) full.add('/' + rel);
  // 页面分片 CSS（v3.3）：批量 / 离线 / 提交三页的样式单独成文件。离线时这些页面会被打开，
  // 缺了样式就是「结构在、样子全散」，所以必须一起进包。扫目录而不是写死，避免以后再漏。
  for (const f of readdirSync(join(root, 'assets'))) {
    if (f.endsWith('.css')) full.add('/assets/' + f);
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
