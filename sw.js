// ToolHub Service Worker：离线可用（HTML 网络优先，静态资源缓存优先）
const VERSION = 'toolhub-v2.2';
const CORE = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/assets/style.css',
  '/assets/app.js',
  '/assets/pyodide-runtime.js',
  '/assets/vendor/qrcode.min.js',
  '/assets/vendor/marked.min.js',
  '/assets/vendor/purify.min.js',
  '/i18n.json',
  '/i18n-detail.json',
  '/tools/tools.json',
  '/tools/directory.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 第三方 CDN（Pyodide 等）走网络

  if (req.mode === 'navigate') {
    // 页面：网络优先，离线回退缓存
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 逻辑与数据（app.js / i18n / 工具注册表）：网络优先，确保部署后立即生效
  const isDynamic = /\/(assets\/app\.js|i18n(-detail)?\.json|resources\.json|tools\/(tools|directory)\.json)$/.test(url.pathname);
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
