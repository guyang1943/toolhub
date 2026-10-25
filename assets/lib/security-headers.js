/**
 * 安全响应头的唯一来源（v2.9 D5）
 *
 * 三处共用这一份，避免「线上有 CSP、本地没有」或「改了线上忘了本地」：
 *   1. _worker.js         —— Cloudflare Workers 高级模式，逐个请求注入
 *   2. scripts/serve.mjs  —— 本地/CI 静态服务器，行为与线上一致
 *   3. scripts/verify.mjs —— 静态检查（CSP 必须放行 wasm / blob）
 *
 * 为什么用 Worker 而不是 _headers：
 *   _headers 只能按路径匹配，无法按查询串区分，而工具页的 ?embed=1 需要允许被第三方 iframe 嵌入
 *   （否则「复制嵌入代码」这个功能一直被 X-Frame-Options 挡住）。Worker 可以精确到 pathname。
 */

// Pyodide 只有在自托管运行时不可用时才回退 CDN，所以 CDN 域名仍需放行，否则回退路径会被 CSP 掐断。
const CDN = 'https://cdn.jsdelivr.net';

/**
 * Content-Security-Policy（所有页面共用，只有 frame-ancestors 按路径变化）
 * - 'wasm-unsafe-eval'：Pyodide 需要实例化 WebAssembly
 * - blob:：文件产物下载、Pyodide 的 worker
 * - 'unsafe-inline'：首帧定主题的内联脚本与 JSON-LD（静态站，无用户输入回显）
 */
function cspFor(frameAncestors) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: ${CDN}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    'img-src \'self\' data: blob:',
    "font-src 'self' data:",
    `connect-src 'self' blob: data: ${CDN}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

/**
 * 工具页允许被任意站点嵌入（?embed=1 就是为这个准备的），其余页面只允许同源嵌入。
 * 工具页里没有账号、没有敏感写操作，被框住不会造成点击劫持损失。
 */
function frameAncestorsFor(pathname) {
  return /^\/tools\/[\w-]+\/?$/.test(pathname) ? '*' : "'self'";
}

/**
 * @param {string} pathname 已解码的路径（如 /tools/json-format/）
 * @returns {Record<string,string>}
 */
export function securityHeaders(pathname) {
  const headers = {
    'Content-Security-Policy': cspFor(frameAncestorsFor(pathname)),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), serial=()',
    'Cross-Origin-Resource-Policy': 'same-site',
    // 只在 HTTPS 下生效，HTTP 下浏览器直接忽略，所以本地开发不会受影响
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
  // 公开 API 允许跨站读取（供第三方做工具索引），其余页面不需要
  if (pathname.startsWith('/api/')) {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  // 明确不设置 X-Frame-Options：它无法按查询串变化，会与工具页的嵌入需求冲突，
  // 改用上面的 CSP frame-ancestors 精确控制。
  return headers;
}

/** 静态资源缓存策略：带指纹的没有，所以用较短强缓存 + SW 兜底 */
export function cacheControlFor(pathname) {
  if (pathname.startsWith('/api/')) return 'public, max-age=600';
  if (pathname === '/sw.js' || pathname.endsWith('/index.html')) return 'no-cache';
  if (pathname.startsWith('/assets/')) return 'public, max-age=3600';
  if (pathname.startsWith('/sitemap') || pathname === '/robots.txt') return 'public, max-age=86400';
  return 'public, max-age=600';
}

export const SECURITY_HEADER_KEYS = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Strict-Transport-Security',
];
