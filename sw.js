// 由 scripts/gen-sw.mjs 生成，请勿手改（改模板请改脚本）
// 版本：toolhub-v3.5 · 预缓存 113 个地址 · 约 2.4 MB
const VERSION = "toolhub-v3.5";
const CORE = [
  "/",
  "/index.html",
  "/offline/",
  "/site.webmanifest",
  "/assets/style.css",
  "/assets/app.js",
  "/assets/pyodide-runtime.js",
  "/assets/pipeline.js",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/i18n.json",
  "/i18n-detail.json",
  "/tools/tools.json",
  "/tools/directory.json",
  "/resources.json",
  "/analytics.json"
];
const FULL = [
  "/",
  "/index.html",
  "/offline/",
  "/site.webmanifest",
  "/assets/style.css",
  "/assets/app.js",
  "/assets/pyodide-runtime.js",
  "/assets/pipeline.js",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/i18n.json",
  "/i18n-detail.json",
  "/tools/tools.json",
  "/tools/directory.json",
  "/resources.json",
  "/analytics.json",
  "/tools/json-format/",
  "/tools/json-format/run.js",
  "/tools/image-compress/",
  "/tools/image-compress/run.js",
  "/tools/qrcode/",
  "/tools/qrcode/run.js",
  "/tools/base64-url/",
  "/tools/base64-url/run.js",
  "/tools/timestamp/",
  "/tools/timestamp/run.js",
  "/tools/sha256-hash/",
  "/tools/sha256-hash/run.js",
  "/tools/password-gen/",
  "/tools/password-gen/run.js",
  "/tools/uuid-gen/",
  "/tools/uuid-gen/run.js",
  "/tools/color-convert/",
  "/tools/color-convert/run.js",
  "/tools/text-diff/",
  "/tools/text-diff/run.js",
  "/tools/markdown-preview/",
  "/tools/markdown-preview/run.js",
  "/tools/python-run/",
  "/tools/python-run/run.js",
  "/tools/cron-parser/",
  "/tools/cron-parser/run.js",
  "/tools/jwt-decode/",
  "/tools/jwt-decode/run.js",
  "/tools/csv-json/",
  "/tools/csv-json/run.js",
  "/tools/image-resize/",
  "/tools/image-resize/run.js",
  "/tools/py-stats/",
  "/tools/py-stats/run.js",
  "/tools/pandas-csv/",
  "/tools/pandas-csv/run.js",
  "/tools/regex-tester/",
  "/tools/regex-tester/run.js",
  "/tools/case-convert/",
  "/tools/case-convert/run.js",
  "/tools/text-dedupe/",
  "/tools/text-dedupe/run.js",
  "/tools/word-count/",
  "/tools/word-count/run.js",
  "/tools/image-base64/",
  "/tools/image-base64/run.js",
  "/tools/color-contrast/",
  "/tools/color-contrast/run.js",
  "/tools/tax-calc/",
  "/tools/tax-calc/run.js",
  "/tools/unit-convert/",
  "/tools/unit-convert/run.js",
  "/tools/qr-decode/",
  "/tools/qr-decode/run.js",
  "/tools/pdf-merge/",
  "/tools/pdf-merge/run.js",
  "/tools/mortgage-calc/",
  "/tools/mortgage-calc/run.js",
  "/tools/timezone-convert/",
  "/tools/timezone-convert/run.js",
  "/tools/img-to-pdf/",
  "/tools/img-to-pdf/run.js",
  "/tools/exif-strip/",
  "/tools/exif-strip/run.js",
  "/tools/image-convert/",
  "/tools/image-convert/run.js",
  "/tools/id-validate/",
  "/tools/id-validate/run.js",
  "/assets/vendor/jsQR.js",
  "/assets/vendor/marked.min.js",
  "/assets/vendor/pdf-lib.min.js",
  "/assets/vendor/purify.min.js",
  "/assets/vendor/qrcode.min.js",
  "/assets/vendor/pyodide-loader.js",
  "/privacy/",
  "/batch/",
  "/about/",
  "/submit/",
  "/compare/",
  "/changelog/",
  "/resources/",
  "/topics/",
  "/evaluations/",
  "/assets/batch.js",
  "/assets/drop.js",
  "/assets/lib/drop-route.js",
  "/assets/lib/intent.js",
  "/assets/lib/pages.js",
  "/assets/lib/secure-share.js",
  "/assets/lib/zip.js",
  "/assets/offline.js",
  "/assets/tool-page.js",
  "/assets/toolbuilder.js",
  "/assets/style.batch.css",
  "/assets/style.offline.css",
  "/assets/style.submit.css",
  "/assets/style.tool.css"
];

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
  const isDynamic = /\/(assets\/app\.js|analytics\.json|i18n(-detail)?\.json|resources\.json|articles\.json|tools\/(tools|directory)\.json)$/.test(url.pathname);
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
