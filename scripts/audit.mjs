#!/usr/bin/env node
// 全站体检（v3.2）：多视口 + 全量页面巡检，专找「测试没覆盖但用户会遇到」的问题
//
// 与 browser-test.mjs 的分工：
//   browser-test 验「功能对不对」（点一下有没有反应）；
//   audit 验「页面立不立得住」（有没有横向溢出、控制台报错、表单没渲染、按钮太小）。
//
// 用法：
//   node scripts/serve.mjs 8788 &
//   node scripts/audit.mjs [http://127.0.0.1:8788] [--json audit.json] [--only-tools]
//
// 退出码：0 无问题 / 1 有问题（CI 可直接用）
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8'));
const dir = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8'));

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || process.env.BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
const ONLY_TOOLS = args.includes('--only-tools');
const CONTRAST = !args.includes('--no-contrast');
// 定向扫描：--pages "/,/about/"（调试单页或只复查刚改过的那几页时用，省两分钟）
const PAGE_FILTER = args.includes('--pages')
  ? args[args.indexOf('--pages') + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const PORT = 9533 + Math.floor(Math.random() * 200);
const PROFILE = join(tmpdir(), 'toolhub-audit-' + Date.now());

// 三档视口：桌面 / 平板 / 手机（375 是 iPhone SE 起的主流窄屏）
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'mobile', width: 375, height: 812, mobile: true },
];

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error('❌ 未找到 Edge / Chrome，跳过体检');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else for (const fn of this.listeners) fn(msg);
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('CDP 超时: ' + method));
      }, 30000);
    });
  }
}

async function waitDevtools(port, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('DevTools 端口未就绪');
}

const browser = spawn(
  exe,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
process.on('exit', () => {
  try {
    browser.kill('SIGKILL');
  } catch {}
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {}
});

let cdp = null;
let consoleErrors = [];
let cspViolations = [];
let httpFails = [];

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function setViewport(vp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 2,
    mobile: vp.mobile,
  });
}

async function goto(pathname, opts = {}) {
  consoleErrors = [];
  cspViolations = [];
  httpFails = [];
  await cdp.send('Page.navigate', { url: BASE + pathname });
  await sleep(280);
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`document.querySelectorAll('#main-content *').length`).catch(() => 0);
    if (n > 20) break;
    await sleep(120);
  }
  // 工具页的表单是懒渲染的（等 run.js 的 manifest 到位才画），
  // 只等 #main-content 有元素会在表单还没出现时就下结论「没渲染」——那是假问题
  if (opts.waitForm) {
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate(`!!document.getElementById('run-btn') || !!document.querySelector('[id^="f-"]')`).catch(() => false);
      if (ready) break;
      await sleep(120);
    }
  }
  await sleep(220);
}

// 页面布局体检：横向溢出 + 溢出元凶 + 太小的可点区域 + 表单是否渲染
const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const out = {
    title: document.title,
    scrollWidth: de.scrollWidth,
    clientWidth: vw,
    overflow: de.scrollWidth - vw,
    offenders: [],
    smallTargets: [],
    fields: 0,
    hasRunBtn: !!document.getElementById('run-btn'),
    bodyText: (document.body.innerText || '').slice(0, 120),
  };
  if (out.overflow > 1) {
    // 找真正越界的最外层元素：只收「自身右边界超出视口」的，且父元素没超
    const all = [...document.querySelectorAll('body *')];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 && (!el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 1)) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
        out.offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 60)) || '',
          id: el.id || '',
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
      if (out.offenders.length >= 5) break;
    }
  }
  // 移动端可点区域：WCAG 2.5.8 的硬线是 24×24，32 是舒适线。
  // 正文里的行内链接（display:inline）按 2.5.8 的 "inline" 豁免条款不参与判断，
  // 否则每一段正文里的「JSON 格式化」都会被报成问题，把真问题埋掉。
  const clickable = [...document.querySelectorAll('button, a[href], [role=button], input[type=button], input[type=submit]')];
  const tiny = [], small = [];
  for (const el of clickable) {
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().slice(0, 20);
    const item = { text: label, w: Math.round(r.width), h: Math.round(r.height) };
    // 24×24 正好达标，不算问题；只有落在 24 与 28 之间才提示「能点但不够舒服」
    if (r.height < 24 || r.width < 24) tiny.push(item);
    else if ((r.height > 24 && r.height < 28) || (r.width > 24 && r.width < 28)) small.push(item);
    if (tiny.length >= 8 && small.length >= 8) break;
  }
  out.tinyTargets = tiny;
  out.smallTargets = small;
  out.fields = document.querySelectorAll('[id^="f-"]').length;
  return JSON.stringify(out);
})()`;

const findings = [];
function addFinding(sev, page, vp, kind, detail) {
  findings.push({ sev, page, vp, kind, detail });
}

// 深色模式对比度：只看「直接含文本」的元素，前景/背景都取计算样式，按 WCAG 相对亮度算。
// 跳过 background-clip:text 的渐变文字（它们的 color 是 transparent，实际由渐变着色）。
const CONTRAST_PROBE = `(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[,\\/\\s]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own.length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.35) continue;
    if (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) continue;
    const bg = bgOf(el);
    if (fg.a < 1) {
      fg.r = fg.r * fg.a + bg.r * (1 - fg.a);
      fg.g = fg.g * fg.a + bg.g * (1 - fg.a);
      fg.b = fg.b * fg.a + bg.b * (1 - fg.a);
    }
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const cr = ratio(fg, bg);
    // 留 8% 余量：有些背景是渐变/半透明叠出来的，扫描器取不到真实值
    if (cr < need * 0.92) {
      bad.push({
        text: own.map((n) => n.textContent.trim()).join(' ').slice(0, 24),
        cr: +cr.toFixed(2),
        need,
        cls: String(el.className || '').slice(0, 30),
        fg: cs.color,
        bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')',
      });
      if (bad.length >= 6) break;
    }
  }
  return JSON.stringify(bad);
})()`;

// ------------- 待检页面 -------------
const PAGES = ONLY_TOOLS
  ? []
  : [
      '/',
      '/about/',
      '/submit/',
      '/feedback/',
      '/privacy/',
      '/batch/',
      '/offline/',
      '/changelog/',
      '/compare/',
      '/topics/',
      '/evaluations/',
      '/resources/',
    ];
const TOOL_PAGES = reg.tools.map((t) => `/tools/${t.id}/`);
// 目录工具页抽样（60 个全跑太慢，取每 10 个一个）
const DIR_PAGES = dir.tools.filter((_, i) => i % 10 === 0).map((t) => `/tools/${t.id}/`);

const allPages = [...new Set([...PAGES, ...TOOL_PAGES, ...DIR_PAGES])];
const scanPages = PAGE_FILTER || allPages;

(async () => {
  console.log('\n🔍 全站体检：' + BASE);
  console.log('   页面 ' + scanPages.length + ' 个 × 视口 ' + VIEWPORTS.length + ' 档' + (CONTRAST ? ' · 含深色模式对比度' : '') + '\n');

  await waitDevtools(PORT);
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');

  cdp.on((msg) => {
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.source === 'security' || /Content Security Policy|Refused to/i.test(e.text || '')) cspViolations.push(e.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 200));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push('未捕获异常: ' + (d.exception?.description || d.text).slice(0, 200));
    }
    if (msg.method === 'Network.responseReceived') {
      const { status, url, type } = msg.params.response;
      if (status >= 400 && type !== 'Other' && !/favicon/.test(url)) httpFails.push(`${status} ${url.replace(BASE, '')}`);
    }
  });

  let n = 0;
  for (const path of scanPages) {
    n++;
    process.stdout.write(`\r   [${String(n).padStart(3)}/${scanPages.length}] ${path.padEnd(34)}`);
    for (const vp of VIEWPORTS) {
      await setViewport(vp);
      const isTool = /^\/tools\/[^/]+\/$/.test(path);
      const isLocalTool = TOOL_PAGES.includes(path);
      await goto(path, { waitForm: isLocalTool });
      const raw = await evaluate(PROBE).catch((e) => JSON.stringify({ error: e.message }));
      const info = JSON.parse(raw || '{}');

      if (info.error) {
        addFinding('high', path, vp.name, '探测失败', info.error);
        continue;
      }
      if (info.overflow > 1) {
        addFinding('high', path, vp.name, '横向溢出', `${info.overflow}px · ${JSON.stringify(info.offenders.slice(0, 3))}`);
      }
      if (/^\s*(404|页面不存在|Not Found)/i.test(info.bodyText || '') || !info.bodyText) {
        addFinding('high', path, vp.name, '空页面或 404', String(info.bodyText).slice(0, 60));
      }
      if (consoleErrors.length) {
        addFinding('high', path, vp.name, '控制台报错', [...new Set(consoleErrors)].slice(0, 2).join(' | '));
      }
      if (cspViolations.length) {
        addFinding('high', path, vp.name, 'CSP 违规', [...new Set(cspViolations)].slice(0, 2).join(' | '));
      }
      if (httpFails.length) {
        addFinding('mid', path, vp.name, '资源 4xx/5xx', [...new Set(httpFails)].slice(0, 3).join(' | '));
      }
      // 本地工具页必须画出表单
      if (isLocalTool && info.fields === 0) {
        addFinding('high', path, vp.name, '工具表单未渲染', `fields=0 runBtn=${info.hasRunBtn}`);
      }
      if (vp.name === 'mobile' && info.tinyTargets && info.tinyTargets.length) {
        addFinding('mid', path, 'mobile', '可点区域 <24px（WCAG 2.5.8 硬线）', JSON.stringify(info.tinyTargets.slice(0, 4)));
      }
      if (vp.name === 'mobile' && info.smallTargets && info.smallTargets.length >= 3) {
        addFinding('low', path, 'mobile', '可点区域 24–28px', `${info.smallTargets.length} 个 · ${JSON.stringify(info.smallTargets.slice(0, 3))}`);
      }
      if (isTool && vp.name === 'desktop' && info.bodyText && info.bodyText.length < 40) {
        addFinding('mid', path, 'desktop', '正文过短', info.bodyText.replace(/\s+/g, ' ').slice(0, 50));
      }
      // 深色模式只在桌面档扫一次：CSS 变量按 [data-theme] 即时生效，不必重新导航
      if (CONTRAST && vp.name === 'desktop') {
        // 关键时序：页面加载后 app.js 的 applyTheme() 会按 localStorage / 系统偏好重设主题，
        // 抢在它前面设 dark 会被覆盖回去，扫到「前景已深、背景还浅」的中间态，全是假阳性。
        // 所以先等它跑完，设完再确认 body 背景真的变暗了，没变就补设一次。
        await sleep(450);
        const darkApplied = await evaluate(`(() => {
          const apply = () => document.documentElement.setAttribute('data-theme', 'dark');
          apply();
          const rgb = (getComputedStyle(document.body).backgroundColor.match(/\\d+/g) || []).map(Number);
          if (rgb.length < 3 || (rgb[0] + rgb[1] + rgb[2]) / 3 > 90) { apply(); return false; }
          return true;
        })()`).catch(() => false);
        await sleep(darkApplied ? 160 : 260);
        const cRaw = await evaluate(CONTRAST_PROBE).catch(() => '[]');
        await evaluate(`(() => { document.documentElement.removeAttribute('data-theme'); return true; })()`).catch(() => {});
        const cBad = JSON.parse(cRaw || '[]');
        if (cBad.length) {
          addFinding('mid', path, 'dark', '深色模式对比度不足', cBad.map((b) => `${b.cr}/${b.need} "${b.text}"${b.cls ? '.' + b.cls : ''} [${b.fg} on ${b.bg}]`).join(' · '));
        }
      }
    }
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');

  // ---- 汇总 ----
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;

  console.log('\n' + '─'.repeat(70));
  if (!findings.length) {
    console.log('✅ 未发现问题（' + scanPages.length * VIEWPORTS.length + ' 次页面检查）');
  } else {
    const order = { high: 0, mid: 1, low: 2 };
    findings.sort((a, b) => order[a.sev] - order[b.sev]);
    // 同类问题聚一下，避免 300 行刷屏
    const groups = new Map();
    for (const f of findings) {
      const k = f.kind + '|' + f.detail.slice(0, 70);
      if (!groups.has(k)) groups.set(k, { ...f, pages: [f.page + '@' + f.vp] });
      else groups.get(k).pages.push(f.page + '@' + f.vp);
    }
    for (const g of groups.values()) {
      const icon = g.sev === 'high' ? '❌' : g.sev === 'mid' ? '⚠️ ' : '·';
      console.log(`${icon} [${g.kind}] ${g.detail}`);
      console.log(`   ${g.pages.length} 处: ${g.pages.slice(0, 6).join(', ')}${g.pages.length > 6 ? ' …' : ''}`);
    }
    console.log('\n合计 ' + findings.length + ' 条：' + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' / '));
  }

  if (JSON_OUT) {
    writeFileSync(join(root, JSON_OUT), JSON.stringify({ base: BASE, at: new Date().toISOString(), findings }, null, 1));
    console.log('已写入 ' + JSON_OUT);
  }

  const high = findings.filter((f) => f.sev === 'high').length;
  console.log('─'.repeat(70) + '\n');
  browser.kill('SIGKILL');
  process.exit(high ? 1 : 0);
})().catch((e) => {
  console.error('\n❌ 体检中断：' + e.message);
  browser.kill('SIGKILL');
  process.exit(2);
});
