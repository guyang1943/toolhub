/**
 * Cloudflare Workers 高级模式入口（v2.9 D5）
 *
 * 存在 _worker.js 目录时，wrangler 会把它当作 Worker 入口，静态资源走 env.ASSETS。
 * 这里只做一件事：给每个响应补上安全头，其余全部交给静态资源层，
 * 所以 html_handling / not_found_handling 的行为与之前完全一致。
 */
import { securityHeaders, cacheControlFor } from '../assets/lib/security-headers.js';

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const headers = new Headers(res.headers);

    for (const [k, v] of Object.entries(securityHeaders(url.pathname))) headers.set(k, v);
    // 静态资源层已经给了 Cache-Control 就不覆盖；页面类再按路径细分
    if (!headers.has('Cache-Control') || url.pathname.startsWith('/assets/')) {
      headers.set('Cache-Control', cacheControlFor(url.pathname));
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
