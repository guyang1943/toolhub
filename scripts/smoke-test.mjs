#!/usr/bin/env node
// 上线冒烟测试：检查部署后的关键路径是否可访问
// 用法：node scripts/smoke-test.mjs https://你的域名
const BASE = (process.argv[2] || 'https://toolhub.guyang1966.workers.dev').replace(/\/$/, '');
const tools = JSON.parse(
  await import('node:fs').then((fs) => fs.readFileSync(new URL('../tools/tools.json', import.meta.url), 'utf8'))
).tools;

const paths = [
  '/',
  '/sitemap.xml',
  '/robots.txt',
  '/assets/app.js',
  '/assets/style.css',
  '/assets/pyodide-runtime.js',
  '/tools/tools.json',
  '/tools/directory.json',
  '/i18n.json',
  '/i18n-detail.json',
  '/sw.js',
  '/site.webmanifest',
  '/about/',
  '/submit/',
  '/feedback/',
  '/compare/',
  '/resources/',
  '/resources/icons/',
  '/resources/fonts/',
  '/resources/colors/',
  '/resources/learning/',
  '/resources/open-source/',
  '/resources/templates/',
  '/topics/',
  '/topics/frontend-debug/',
  '/evaluations/',
  '/evaluations/image-compress-shootout/',
  '/evaluations/markdown-editors/',
  '/evaluations/pdf-tools/',
  '/evaluations/password-tools/',
  '/evaluations/json-tools/',
  '/changelog/',
  '/api/tools.json',
  '/feed.xml',
  ...tools.map((t) => `/tools/${t.id}/`),
  '/tools/json-format/run.js',
];

let ok = 0;
const fails = [];

// 限制并发为 6：避免把单线程测试服务器或限流网关打爆
const CONCURRENCY = Number(process.env.SMOKE_CONCURRENCY || 6);
let cursor = 0;
async function worker() {
  while (cursor < paths.length) {
    const p = paths[cursor++];
    try {
      const res = await fetch(BASE + p, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'ToolHub-SmokeTest/1.0' },
      });
      if (res.status === 200) ok++;
      else fails.push({ p, code: res.status });
    } catch (e) {
      fails.push({ p, code: e.name === 'TimeoutError' ? 'timeout' : e.cause?.code || e.message });
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));

console.log(`\n🧪 冒烟测试：${BASE}`);
console.log(`   通过 ${ok}/${paths.length}`);
if (fails.length) {
  console.log('\n❌ 异常路径：');
  for (const f of fails.sort((a, b) => String(a.code).localeCompare(String(b.code)))) {
    console.log(`   ${String(f.code).padEnd(8)} ${f.p}`);
  }
  console.log('\n排障建议：');
  console.log('  1) 所有 /tools/*/ 全 404 → Worker 未开启目录索引：Settings 里 Not found handling 设为 single-page-application 后重新部署');
  console.log('  2) 只有部分失败 → 重新打包上传，确认 zip 根目录含 index.html、tools、about、submit');
  console.log('  3) 全部超时 → 网络到该域不可达（workers.dev 在国内不可直连），换代理或绑自定义域名');
} else {
  console.log('\n✅ 全部关键路径正常，可以对外发布');
}
