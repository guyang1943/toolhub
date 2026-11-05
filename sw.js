// 由 scripts/gen-sw.mjs 生成，请勿手改（改模板请改脚本）
// 版本：toolhub-v3.28 · 预缓存 314 个地址 · 约 4.8 MB
const VERSION = "toolhub-v3.28";
const CORE = [
  "/",
  "/offline/",
  "/index.html",
  "/site.webmanifest",
  "/assets/style.css",
  "/assets/app.js",
  "/assets/pyodide-runtime.js",
  "/assets/pipeline.js",
  "/assets/lib/store.js",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/i18n.json",
  "/i18n-detail.json",
  "/tools/tools.json",
  "/tools/aliases.json",
  "/tools/directory.json",
  "/resources.json",
  "/resources-notes.json",
  "/analytics.json"
];
const FULL = [
  "/",
  "/offline/",
  "/index.html",
  "/site.webmanifest",
  "/assets/style.css",
  "/assets/app.js",
  "/assets/pyodide-runtime.js",
  "/assets/pipeline.js",
  "/assets/lib/store.js",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/i18n.json",
  "/i18n-detail.json",
  "/tools/tools.json",
  "/tools/aliases.json",
  "/tools/directory.json",
  "/resources.json",
  "/resources-notes.json",
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
  "/tools/img-crop/",
  "/tools/img-crop/run.js",
  "/tools/file-hash/",
  "/tools/file-hash/run.js",
  "/tools/csv-columns/",
  "/tools/csv-columns/run.js",
  "/tools/disk-partition/",
  "/tools/disk-partition/run.js",
  "/tools/text-encrypt/",
  "/tools/text-encrypt/run.js",
  "/tools/markdown-table/",
  "/tools/markdown-table/run.js",
  "/tools/string-escape/",
  "/tools/string-escape/run.js",
  "/tools/lorem-kit/",
  "/tools/lorem-kit/run.js",
  "/tools/token-counter/",
  "/tools/token-counter/run.js",
  "/tools/url-kit/",
  "/tools/url-kit/run.js",
  "/tools/subnet-calc/",
  "/tools/subnet-calc/run.js",
  "/tools/xml-format/",
  "/tools/xml-format/run.js",
  "/tools/http-code/",
  "/tools/http-code/run.js",
  "/tools/radix-convert/",
  "/tools/radix-convert/run.js",
  "/tools/env-parser/",
  "/tools/env-parser/run.js",
  "/tools/css-unit/",
  "/tools/css-unit/run.js",
  "/tools/image-watermark/",
  "/tools/image-watermark/run.js",
  "/tools/image-merge/",
  "/tools/image-merge/run.js",
  "/tools/image-filter/",
  "/tools/image-filter/run.js",
  "/tools/image-round/",
  "/tools/image-round/run.js",
  "/tools/image-info/",
  "/tools/image-info/run.js",
  "/tools/palette-extract/",
  "/tools/palette-extract/run.js",
  "/tools/gradient-gen/",
  "/tools/gradient-gen/run.js",
  "/tools/shadow-gen/",
  "/tools/shadow-gen/run.js",
  "/tools/media-info/",
  "/tools/media-info/run.js",
  "/tools/barcode-gen/",
  "/tools/barcode-gen/run.js",
  "/tools/barcode-gen/jsbarcode.min.js",
  "/tools/date-calc/",
  "/tools/date-calc/run.js",
  "/tools/bmi-calc/",
  "/tools/bmi-calc/run.js",
  "/tools/json-diff/",
  "/tools/json-diff/run.js",
  "/tools/expense-aa/",
  "/tools/expense-aa/run.js",
  "/tools/text-to-pdf/",
  "/tools/text-to-pdf/run.js",
  "/assets/vendor/jsQR.js",
  "/assets/vendor/marked.min.js",
  "/assets/vendor/pdf-lib.min.js",
  "/assets/vendor/purify.min.js",
  "/assets/vendor/qrcode.min.js",
  "/assets/vendor/pyodide-loader.js",
  "/tools/",
  "/categories/",
  "/guides/",
  "/topics/",
  "/evaluations/",
  "/resources/",
  "/compare/",
  "/changelog/",
  "/about/",
  "/privacy/",
  "/submit/",
  "/feedback/",
  "/batch/",
  "/my/",
  "/workflows/",
  "/assets/batch.js",
  "/assets/content-pages.js",
  "/assets/drop.js",
  "/assets/lib/drop-route.js",
  "/assets/lib/events.js",
  "/assets/lib/guide-text.js",
  "/assets/lib/intent.js",
  "/assets/lib/json-schema.js",
  "/assets/lib/pages.js",
  "/assets/lib/secure-share.js",
  "/assets/lib/store-keys.js",
  "/assets/lib/workflow-core.js",
  "/assets/lib/zip.js",
  "/assets/my.js",
  "/assets/offline.js",
  "/assets/submit-page.js",
  "/assets/submit-resource.js",
  "/assets/tool-page.js",
  "/assets/toolbuilder.js",
  "/assets/workflow.js",
  "/assets/style.batch.css",
  "/assets/style.compare.css",
  "/assets/style.my.css",
  "/assets/style.offline.css",
  "/assets/style.submit.css",
  "/assets/style.tool.css",
  "/assets/style.workflows.css",
  "/articles/barcode-gen.json",
  "/articles/base64-url.json",
  "/articles/bmi-calc.json",
  "/articles/case-convert.json",
  "/articles/color-contrast.json",
  "/articles/color-convert.json",
  "/articles/cron-parser.json",
  "/articles/css-unit.json",
  "/articles/csv-columns.json",
  "/articles/csv-json.json",
  "/articles/date-calc.json",
  "/articles/disk-partition.json",
  "/articles/env-parser.json",
  "/articles/exif-strip.json",
  "/articles/expense-aa.json",
  "/articles/file-hash.json",
  "/articles/gradient-gen.json",
  "/articles/http-code.json",
  "/articles/id-validate.json",
  "/articles/image-base64.json",
  "/articles/image-compress.json",
  "/articles/image-convert.json",
  "/articles/image-filter.json",
  "/articles/image-info.json",
  "/articles/image-merge.json",
  "/articles/image-resize.json",
  "/articles/image-round.json",
  "/articles/image-watermark.json",
  "/articles/img-crop.json",
  "/articles/img-to-pdf.json",
  "/articles/json-diff.json",
  "/articles/json-format.json",
  "/articles/jwt-decode.json",
  "/articles/lorem-kit.json",
  "/articles/markdown-preview.json",
  "/articles/markdown-table.json",
  "/articles/media-info.json",
  "/articles/mortgage-calc.json",
  "/articles/palette-extract.json",
  "/articles/pandas-csv.json",
  "/articles/password-gen.json",
  "/articles/pdf-merge.json",
  "/articles/py-stats.json",
  "/articles/python-run.json",
  "/articles/qr-decode.json",
  "/articles/qrcode.json",
  "/articles/radix-convert.json",
  "/articles/regex-tester.json",
  "/articles/sha256-hash.json",
  "/articles/shadow-gen.json",
  "/articles/string-escape.json",
  "/articles/subnet-calc.json",
  "/articles/tax-calc.json",
  "/articles/text-dedupe.json",
  "/articles/text-diff.json",
  "/articles/text-encrypt.json",
  "/articles/text-to-pdf.json",
  "/articles/timestamp.json",
  "/articles/timezone-convert.json",
  "/articles/token-counter.json",
  "/articles/unit-convert.json",
  "/articles/url-kit.json",
  "/articles/uuid-gen.json",
  "/articles/word-count.json",
  "/articles/xml-format.json",
  "/evaluations/filee-review/",
  "/evaluations/filee-review.json",
  "/evaluations/image-compress-shootout/",
  "/evaluations/image-compress-shootout.json",
  "/evaluations/json-tools/",
  "/evaluations/json-tools.json",
  "/evaluations/markdown-editors/",
  "/evaluations/markdown-editors.json",
  "/evaluations/password-tools/",
  "/evaluations/password-tools.json",
  "/evaluations/pdf-tools/",
  "/evaluations/pdf-tools.json",
  "/evaluations/photocraft-review/",
  "/evaluations/photocraft-review.json",
  "/evaluations/voicestudio-review/",
  "/evaluations/voicestudio-review.json",
  "/categories/ai/",
  "/categories/ai.json",
  "/categories/data/",
  "/categories/data.json",
  "/categories/design/",
  "/categories/design.json",
  "/categories/dev/",
  "/categories/dev.json",
  "/categories/docs/",
  "/categories/docs.json",
  "/categories/image/",
  "/categories/image.json",
  "/categories/index.json",
  "/categories/media/",
  "/categories/media.json",
  "/categories/productivity/",
  "/categories/productivity.json",
  "/categories/text/",
  "/categories/text.json",
  "/categories/web/",
  "/categories/web.json",
  "/guides/cloudflare-free/",
  "/guides/cloudflare-free.json",
  "/guides/custom-domain/",
  "/guides/custom-domain.json",
  "/guides/github-first-lesson/",
  "/guides/github-first-lesson.json",
  "/guides/github-pages-first-site/",
  "/guides/github-pages-first-site.json",
  "/guides/index.json",
  "/guides/tv-box-server/",
  "/guides/tv-box-server.json",
  "/schemas/resource.json",
  "/tools/schema.json",
  "/workflows/workflows.json"
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
