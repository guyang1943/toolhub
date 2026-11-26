/**
 * Cloudflare Workers 高级模式入口（v2.9 D5 / v3.36 加自有埋点）
 *
 * 存在 _worker.js 目录时，wrangler 会把它当作 Worker 入口，静态资源走 env.ASSETS。
 * 这里的职责只有三类：
 *   1. 静态资源 + 安全头（原有）
 *   2. /api/e    访问事件上报（POST，无 cookie，字段白名单）
 *   3. /api/stats + /admin  运营看板（Bearer token，no-store）
 *
 * 为什么自己收事件而不接第三方统计：
 *   第三方要么写 cookie，要么只给 PV 不给漏斗。我们要回答的是
 *   「进来的人走到哪一步掉了」，这需要自定义事件；而同域上报不需要任何第三方域名。
 *
 * 隐私边界（改这里之前先读 /privacy/）：
 *   - 只存 路径 / 事件名 / 本机随机号 / 时间 / 国家二字码，**不存 IP、不存 UA、不存输入内容**。
 *   - 上报端在 assets/lib/beacon.js，三种情况不发：本机开关关闭、Do Not Track、断网。
 *   - 没有 D1 binding 时静默丢弃，不报错——本地预览与未配置环境照常工作。
 */
import { securityHeaders, cacheControlFor } from '../assets/lib/security-headers.js';

/** 事件白名单。加一个事件必须先回答「拿它做什么决定」，否则不加上。 */
const EVENTS = new Set(['view', 'tool_open', 'run', 'run_err', 'result', 'outbound']);

/** 按中国时区归日，避免「晚上 8 点后的访问算到前一天」。 */
function dayCN(ts) {
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function noStore(status = 204) {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleEvent(request, env) {
  if (request.method !== 'POST') return noStore(405);
  let body;
  try {
    body = await request.json();
  } catch {
    return noStore(); // 坏请求直接吞掉：上报端不该关心返回
  }
  const event = String((body && body.e) || '');
  if (!EVENTS.has(event)) return noStore();
  if (!env.DB) return noStore(); // 没配 D1：静默丢弃

  const ts = Date.now();
  const path = String((body && body.p) || '').slice(0, 160);
  const sid = String((body && body.v) || '').slice(0, 32);
  const country = request.headers.get('cf-ipcountry') || '';
  try {
    await env.DB.prepare(
      'INSERT INTO events (ts, day, path, event, sid, country) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(ts, dayCN(ts), path, event, sid, country)
      .run();
  } catch {
    /* 表还没建、D1 限流：静默。统计挂了不能让页面报错 */
  }
  return noStore();
}

async function handleStats(request, env, url) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'no-db', hint: '先 wrangler d1 create toolhub，再把 database_id 填进 wrangler.toml' }, 503);

  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 7) || 7));
  const since = Date.now() - days * 86400 * 1000;
  try {
    const [daily, top, funnel, uniq] = await Promise.all([
      env.DB.prepare(
        "SELECT day, COUNT(*) AS n FROM events WHERE event = 'view' AND ts >= ? GROUP BY day ORDER BY day"
      )
        .bind(since)
        .all(),
      env.DB.prepare(
        "SELECT path, COUNT(*) AS n FROM events WHERE event = 'view' AND ts >= ? GROUP BY path ORDER BY n DESC LIMIT 20"
      )
        .bind(since)
        .all(),
      env.DB.prepare('SELECT event, COUNT(*) AS n FROM events WHERE ts >= ? GROUP BY event').bind(since).all(),
      env.DB.prepare('SELECT COUNT(DISTINCT sid) AS n FROM events WHERE ts >= ?').bind(since).all(),
    ]);
    return json({
      days,
      daily: daily.results || [],
      top: top.results || [],
      funnel: funnel.results || [],
      devices: (uniq.results && uniq.results[0] && uniq.results[0].n) || 0,
    });
  } catch (e) {
    return json({ error: 'query-failed', detail: String((e && e.message) || e).slice(0, 200) }, 500);
  }
}

/**
 * 运营看板。刻意做成 worker 动态页而不是静态产物：
 *   它不该进 sitemap、不该进离线包、不该被爬虫看到，也不该让每个访客为它付首屏字节。
 */
function adminPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>运营看板 · ToolHub</title>
<style>
:root{color-scheme:light dark}body{margin:0;padding:24px;background:#f4f1eb;color:#1f1b16;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){body{background:#14120f;color:#efe9df}}
h1{font-size:18px;font-weight:500;margin:0 0 4px}.sub{color:#6f665a;font-size:13px;margin-bottom:20px}
.row{display:flex;gap:8px;align-items:center;margin-bottom:20px;flex-wrap:wrap}
input{flex:1;min-width:200px;padding:8px 10px;border:1px solid #e3ddd2;border-radius:8px;background:transparent;color:inherit;font:inherit}
button{padding:8px 14px;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;border-radius:8px;font:inherit;cursor:pointer}
button.ghost{background:transparent;color:#1d4ed8}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
.card{background:#fff;border:1px solid #e3ddd2;border-radius:10px;padding:14px}
@media(prefers-color-scheme:dark){.card{background:#1c1915;border-color:#2e2922}}
.card b{display:block;font-size:24px;font-weight:500;font-variant-numeric:tabular-nums}
.card span{color:#6f665a;font-size:12px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3ddd2;border-radius:10px;overflow:hidden;margin-bottom:20px}
@media(prefers-color-scheme:dark){table{background:#1c1915;border-color:#2e2922}}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee7db;font-variant-numeric:tabular-nums}
th{font-weight:500;color:#574f45;font-size:12px}
tr:last-child td{border-bottom:0}
.err{color:#b42318}
</style></head><body>
<h1>运营看板</h1>
<div class="sub">数据来自本站自己的 /api/e，无 cookie、不存 IP。默认看最近 7 天。</div>
<div class="row">
  <input id="tok" type="password" placeholder="ADMIN_TOKEN（存本机 sessionStorage，关掉页面即失效）" autocomplete="off">
  <button id="go">读取</button>
  <button class="ghost" id="w7">7 天</button>
  <button class="ghost" id="w30">30 天</button>
</div>
<div id="out"></div>
<script>
const $ = (s) => document.querySelector(s);
const tok = $('#tok');
tok.value = sessionStorage.getItem('toolhub_admin') || '';
let days = 7;
async function load() {
  const t = tok.value.trim();
  if (!t) return;
  sessionStorage.setItem('toolhub_admin', t);
  const out = $('#out');
  out.innerHTML = '<p class="sub">读取中…</p>';
  try {
    const r = await fetch('/api/stats?days=' + days, { headers: { authorization: 'Bearer ' + t } });
    if (r.status === 401) throw new Error('token 不对');
    const d = await r.json();
    if (d.error) throw new Error(d.error + (d.hint ? '：' + d.hint : ''));
    render(d);
  } catch (e) {
    out.innerHTML = '<p class="err">' + String(e.message || e) + '</p>';
  }
}
function render(d) {
  const f = Object.fromEntries((d.funnel || []).map((x) => [x.event, x.n]));
  const views = (d.daily || []).reduce((s, x) => s + x.n, 0);
  const card = (n, label) => '<div class="card"><b>' + n + '</b><span>' + label + '</span></div>';
  const rows = (arr, k, v) => arr.length
    ? arr.map((x) => '<tr><td>' + x[k] + '</td><td>' + x[v] + '</td></tr>').join('')
    : '<tr><td colspan="2" class="sub">还没有数据</td></tr>';
  $('#out').innerHTML =
    '<div class="grid">' +
      card(views, '页面访问（' + d.days + ' 天）') +
      card(d.devices, '本机随机号数（近似设备数）') +
      card(f.tool_open || 0, '打开工具页') +
      card(f.run || 0, '跑完一次') +
      card(f.result || 0, '点了结果操作') +
    '</div>' +
    '<table><thead><tr><th>日期</th><th>访问</th></tr></thead><tbody>' + rows(d.daily || [], 'day', 'n') + '</tbody></table>' +
    '<table><thead><tr><th>路径</th><th>访问</th></tr></thead><tbody>' + rows(d.top || [], 'path', 'n') + '</tbody></table>';
}
$('#go').onclick = load;
$('#w7').onclick = () => { days = 7; load(); };
$('#w30').onclick = () => { days = 30; load(); };
tok.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
if (tok.value) load();
</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- 自有接口：先于静态资源处理 ---
    if (url.pathname === '/api/e') return handleEvent(request, env);
    if (url.pathname === '/api/stats') return handleStats(request, env, url);
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      return new Response(adminPage(), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          'X-Content-Type-Options': 'nosniff',
          // 看板是自包含内联页：脚本与样式只允许内联，禁止任何外部资源
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
        },
      });
    }

    const res = await env.ASSETS.fetch(request);
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
