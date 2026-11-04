#!/usr/bin/env node
// 本地 / CI 静态服务器（v2.9 D1、D5）
//
// 存在的意义：_local 静态服务器不会发送安全头，CSP 写得对不对在本地根本测不出来。
// 这里复用 assets/lib/security-headers.js —— 与线上 Worker 是同一份代码。
//
// 用法：node scripts/serve.mjs [--port 8788] [--host 127.0.0.1]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { securityHeaders, cacheControlFor } from '../assets/lib/security-headers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
// 端口既认 --port 也认位置参数：audit.mjs 的头注释与 README 一直写的是
// `node scripts/serve.mjs 8788 &`，而这里过去只认 --port —— 于是那个写法会静默
// 落到默认 8788。一直没人发现，是因为唯一的调用方（check-all）传的端口恰好就是默认值。
// 直到有人真用 8795 起服务、脚本去 8795 探活、永远探不到。
const POS_PORT = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a));
const PORT = Number(argOf('port', POS_PORT || process.env.PORT || 8788));
const HOST = argOf('host', '127.0.0.1');
// --no-sw：开发时彻底绕开 Service Worker 缓存。
// 踩过的坑：sw.js 对页面是「缓存优先 + 后台更新」，而本地反复重建不会改 VERSION，
// 于是改完 HTML 刷新看到的还是上一次的页面，人会以为「构建没生效」，一路查到数据源去。
// 这个模式下 /sw.js 返回一段自杀脚本：清空所有缓存、注销自己，然后重新加载当前页。
const NO_SW = process.argv.includes('--no-sw');
const SW_KILL = `// 本地开发模式：不注册缓存，只负责把旧缓存清干净
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  await self.registration.unregister();
  const cs = await self.clients.matchAll({ type: 'window' });
  cs.forEach((c) => c.navigate(c.url).catch(() => {}));
})()));
`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.whl': 'application/octet-stream',
  '.zip': 'application/zip',
  '.map': 'application/json; charset=utf-8',
};

function safeJoin(pathname) {
  // 先解码再 normalize，挡掉 %2e%2e%2f 这类绕过；normalize 后必须仍在 root 内
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null; // 非法编码
  }
  if (p.includes('\0')) return null;
  const abs = normalize(join(root, p));
  return abs === root || abs.startsWith(root + sep) ? abs : null;
}

function tryFile(abs) {
  try {
    return statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

function resolve(pathname) {
  const abs = safeJoin(pathname);
  if (!abs) return null;
  // 目录 → index.html（与 Workers 的 auto-trailing-slash 一致）
  const direct = tryFile(abs);
  if (direct) return direct;
  const asDir = tryFile(join(abs, 'index.html'));
  if (asDir) return asDir;
  // /tools/json-format（无斜杠）→ /tools/json-format/index.html
  if (!extname(abs)) return tryFile(join(abs, 'index.html'));
  return null;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const isAsset = pathname.startsWith('/assets/');
  const file = resolve(pathname);

  const headers = {
    ...securityHeaders(pathname),
    'Cache-Control': isAsset ? cacheControlFor(pathname) : 'no-cache',
  };

  // 开发模式接管 /sw.js：直接下发自杀脚本，见顶部 SW_KILL 说明
  if (NO_SW && pathname === '/sw.js') {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(SW_KILL);
  }

  if (!file) {
    const nf = tryFile(join(root, '404.html'));
    res.writeHead(404, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    if (nf) return createReadStream(nf).pipe(res);
    return res.end('404 Not Found');
  }

  const stat = statSync(file);
  res.writeHead(200, {
    ...headers,
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`▶ ToolHub 本地服务：http://${HOST}:${PORT}  （安全头与线上 Worker 同一份定义）`);
  if (NO_SW) console.log('   ↻ --no-sw：/sw.js 已由开发模式接管，刷新拿到的永远是磁盘上的最新版');
});

// CI 里用 Ctrl-C / SIGTERM 结束，不需要额外清理
process.on('SIGTERM', () => server.close(() => process.exit(0)));
