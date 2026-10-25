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
const PORT = Number(argOf('port', process.env.PORT || 8788));
const HOST = argOf('host', '127.0.0.1');

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
});

// CI 里用 Ctrl-C / SIGTERM 结束，不需要额外清理
process.on('SIGTERM', () => server.close(() => process.exit(0)));
