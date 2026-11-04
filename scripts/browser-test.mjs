#!/usr/bin/env node
// 真浏览器端到端测试：驱动本机 Edge/Chrome 无头实例（CDP），
// 验证真实 DOM 交互、控制台错误、资源 4xx、文件上传链路。
// 用法：node scripts/serve.mjs & node scripts/browser-test.mjs [http://127.0.0.1:8788]
// CI 可用 BROWSER_PATH 指定 Chromium 路径
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { PYTHON, PYTHON_HINT } from './lib/python.mjs';
// 键清单在浏览器侧那一份，Node 直接读同一份——不复制到测试里，
// 否则「清单改了、测试还在断言旧键」会变成又一处漂移。
import { KEYS } from '../assets/lib/store-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 工具总数从数据推导，新增工具时不必再改测试
const LOCAL_TOOLS = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools.length;
const TOTAL_TOOLS = LOCAL_TOOLS + JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8')).tools.length;
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const PORT = 9333 + Math.floor(Math.random() * 200);
const PROFILE = join(tmpdir(), 'toolhub-btest-' + Date.now());
const SHOTS = join(root, '.tmp-shots');

const CANDIDATES = [
  process.env.BROWSER_PATH, // CI 里由 setup-chrome 之类注入
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  // Linux（GitHub Actions / 容器）
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error('❌ 未找到 Edge / Chrome，跳过浏览器测试');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// ---------------- CDP 极简客户端 ----------------
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
      } else {
        for (const fn of this.listeners) fn(msg);
      }
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

async function waitForDevtools(port, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('DevTools 端口未就绪');
}

const browser = spawn(exe, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-extensions',
  // 容器/CI 里没有 user namespace，沙箱起不来（仅测试进程，不加载不可信内容之外的页面）
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  '--hide-scrollbars',
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' });

let cdp = null;
let pageErrors = [];
let netFails = [];
let cspViolations = [];
let netUrls = [];

function cleanup() {
  try { browser.kill('SIGKILL'); } catch {}
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);

// ---------------- 页面操作封装 ----------------
async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

async function goto(pathname) {
  pageErrors = [];
  netFails = [];
  netUrls = [];
  await cdp.send('Page.navigate', { url: BASE + pathname });
  await sleep(300);
  // 等 SPA 首屏渲染（最多 6s）
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`document.querySelectorAll('#main-content *').length`).catch(() => 0);
    if (n > 20) break;
    await sleep(150);
  }
  await sleep(250);
}

async function waitText(selector, substr, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await evaluate(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`).catch(() => '');
    if (t.includes(substr)) return true;
    await sleep(200);
  }
  return false;
}

// 等某个元素出现（工具表单是懒渲染的，靠文本等待容易在表单还没画出来时就往下走）
async function waitEl(selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hit = await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false);
    if (hit) return true;
    await sleep(150);
  }
  return false;
}

async function waitForFocus(id, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const cur = await evaluate(`document.activeElement && document.activeElement.id`).catch(() => '');
    if (cur === id) return true;
    await sleep(150);
  }
  return false;
}

// 等页面里某个选择器数到 N 个，而不是猜一个固定时长。
// v3.23 踩过：reload 之后 sleep(900) 再数卡片，机器空着够用；机器正忙（上一套测试刚退场）时
// 首屏还没把 tools.json 拉回来，数出 0 张——接着提示文案空、chip 0 个、最后 null.click 崩掉，
// 整串看着像产品坏了，实际只测到了「还没渲染」。首屏是脚本异步渲染的，只能等结果，不能等时长。
async function waitForCount(selector, want, timeout = 8000) {
  const sel = JSON.stringify(selector);
  const start = Date.now();
  let n = 0;
  while (Date.now() - start < timeout) {
    n = await evaluate(`document.querySelectorAll(${sel}).length`).catch(() => 0);
    if (n >= want) return n;
    await sleep(100);
  }
  return n;
}

async function fill(map) {
  await evaluate(`(() => {
    const vals = ${JSON.stringify(map)};
    for (const [id, v] of Object.entries(vals)) {
      const el = document.getElementById(id);
      if (!el) throw new Error('缺少字段 ' + id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
}

async function clickRun() {
  // 工具页是运行时渲染的：openTool 要依次等注册表、多语言、样式表、本篇教程四份资源。
  // v3.10 教程改成按 id 单篇取之后多了一次真实网络请求，goto 的固定等待偶尔不够，
  // 表现为「点运行按钮时它还不存在」的偶发失败。等元素出现比赌时间可靠。
  await waitEl('run-btn', 15000);
  await evaluate(`document.getElementById('run-btn').click()`);
}

// 真实按键：走 CDP 输入管线，和用户敲键盘等价（不是页面内 dispatch 假事件）
async function pressKey(key, { code = '', vk = 0, text = '', modifiers = 0 } = {}) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', text: text || undefined });
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  await sleep(160);
}

async function shot(name) {
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  } catch {}
}

// 用 DataTransfer 把内存里的图片塞进 file input（等价于用户选文件）
async function feedFile(selector, dataUrl, name, type) {
  return evaluate(`(async () => {
    const blob = await (await fetch(${JSON.stringify(dataUrl)})).blob();
    const file = new File([blob], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector(${JSON.stringify(selector)});
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files.length;
  })()`);
}

// ---------------- 主流程 ----------------
(async () => {
  mkdirSync(SHOTS, { recursive: true });
  console.log('\n🌐 真浏览器 E2E：' + BASE + '\n   ' + exe.split('/').pop() + '  headless / CDP:' + PORT);

  await waitForDevtools(PORT);
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
    // CSP 违规在控制台表现为 security 级别日志（"Refused to ..."），单独收集
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.source === 'security' || /Content Security Policy|Refused to/i.test(e.text || '')) {
        cspViolations.push(e.text);
      }
    }
    if (msg.method === 'Network.requestWillBeSent') netUrls.push(msg.params.request.url);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push('未捕获异常: ' + (d.exception?.description || d.text));
    }
    if (msg.method === 'Network.responseReceived') {
      const { status, url, type } = msg.params.response;
      if (status >= 400 && type !== 'Other' && !/favicon/.test(url)) {
        netFails.push(`${status} ${url.replace(BASE, '')}`);
      }
    }
  });

  // 性能观测必须在页面脚本之前注册，否则 LCP/CLS 的早期数据就丢了
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__perf = { lcp: 0, cls: 0, shifts: [] };
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = Math.max(window.__perf.lcp, e.startTime); })
          .observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__perf.cls += e.value;
            window.__perf.shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime),
              src: (e.sources || []).map((s) => s.node ? (s.node.tagName + (s.node.id ? '#' + s.node.id : '') + (typeof s.node.className === 'string' ? '.' + s.node.className.split(' ')[0] : '')) : '?') });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (e) {}`,
  });

  // ---- 1. 首页 ----
  await goto('/');
  // 先摘掉 Service Worker 与它留下的 Cache：否则改过的 index.html 会被旧缓存顶回来，
  // 出现「文件明明改了但页面还是老的」这种假失败（v2.6 A4 踩过一次）。
  const swDropped = await evaluate(`(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    return regs.length;
  })()`).catch(() => 0);
  await cdp.send('Page.reload');
  if (swDropped) console.log('   （已清掉 ' + swDropped + ' 个旧 Service Worker 注册）');
  // 等卡片真的出现再数（见 waitForCount 的注释：固定 sleep 在忙机器上会假红）
  const cards = await waitForCount('#grid [data-id]', 24);
  check('首页渲染工具卡片（一页 24）', cards === 24, cards + ' 张');
  check('首页无控制台错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  check('首页无 4xx 资源', netFails.length === 0, netFails.slice(0, 2).join(' | '));
  const heroText = await evaluate(`(document.querySelector('.hero-search-hint') || {}).textContent || ''`);
  // v3.20：首屏那句拆成「37 个在本机跑 · 99 个已收录」。
  // 断言跟着意图走而不是跟着某个数走：两个数都要在、都要对，且必须同时出现——
  // 只留总数会让访客把 62 条外链也算进「数据不出设备」，那正是要防的误读。
  check(
    '首页计数文案正确',
    heroText.includes(`${LOCAL_TOOLS} 个在本机跑`) && heroText.includes(`${TOTAL_TOOLS} 个已收录`),
    heroText.trim()
  );
  // v3.5：工具页样式拆成独立文件后，首页绝不能把它捎上——不然拆了个寂寞
  const homeHasToolCss = await evaluate(`!!document.querySelector('link[href="/assets/style.tool.css"]')`);
  check('首页不加载工具页样式', homeHasToolCss === false);
  await shot('01-home');

  // ---- 1.5 /?q= 搜索落地（v3.10）----
  // 首页 ld+json 里的 SearchAction 指向 /?q=。声明了站内搜索，这个 URL 就必须真能筛出结果——
  // 抓出来是空页会被 Search Console 判为无效结构化数据，比不声明更糟。
  await goto('/?q=pdf');
  const qValue = await evaluate(`(document.getElementById('search') || {}).value || ''`);
  const qCount = await evaluate(`document.querySelectorAll('#grid [data-id]').length`);
  check('/?q= 回填到搜索框', qValue === 'pdf', JSON.stringify(qValue));
  check('/?q= 真实筛出了结果', qCount > 0 && qCount < 24, qCount + ' 张');
  await goto('/');

  // ---- 1.55 分类二级页（v3.13）----
  // 分类以前只是首页的筛选参数，点完还停在首页；现在是带正文的独立页面。
  // 这里验的是「点下去真的换了页面」，而不是「首页筛了一下」。
  const CAT_N = JSON.parse(readFileSync(join(root, 'content', 'categories.json'), 'utf8')).categories.length;
  const chipHref = await evaluate(`(document.querySelector('#chips a.chip[href^="/categories/"]') || {getAttribute: () => ''}).getAttribute('href') || ''`);
  check('首页分类 chip 指向独立页面', /^\/categories\/[\w-]+\/$/.test(chipHref), chipHref);
  const chipCount = await evaluate(`document.querySelectorAll('#chips a.chip[href^="/categories/"]').length`);
  check('分类 chip 覆盖全部分类 + 总览', chipCount === CAT_N + 1, chipCount + ' 个');
  await evaluate(`document.querySelector('#chips a.chip[href="/categories/image/"]').click()`);
  await waitText('#page-body', '适合这些场景', 8000);
  const catPath = await evaluate(`location.pathname`);
  const catRows = await evaluate(`document.querySelectorAll('#page-body a.fl-row').length`);
  check('点分类进入二级页面', catPath === '/categories/image/', catPath);
  check('分类页列出同类工具', catRows >= 10, catRows + ' 行');
  check('分类页带挑选建议与常见问题', await evaluate(`document.querySelectorAll('#page-body .res-item').length >= 3`));
  await shot('14-category');
  await goto('/');

  // ---- 1.55b 全部工具页（v3.14）----
  // 导航「工具」和首页「99 个工具」入口卡以前都只是回首页、滚到工具区：点完地址栏没变，
  // 也没法把这一屏发给别人。这一页是它们的落地页，验的是「真换了页面、真的列全」。
  await goto('/');
  // v3.16：导航收敛成四栏，入口卡必须与之同序——两边顺序不一致是最容易悄悄发生的错位
  const navLabels = await evaluate(`[...document.querySelectorAll('#main-nav a')].map((a) => a.textContent.trim()).join('/')`);
  // v3.23：导航多了一栏「工作流」——工作流页需要入口，而顶部导航是唯一每页都在的位置。
  check('导航五栏且顺序为 工具/工作流/资源/教程/测评', navLabels === '工具/工作流/资源/教程/测评', navLabels);
  const cardOrder = await evaluate(`[...document.querySelectorAll('#route-cards .route-card')].map((a) => a.getAttribute('href')).join(',')`);
  check('入口卡与导航同序', cardOrder === '/tools/,/resources/,/guides/,/evaluations/', cardOrder);
  check(
    '信任区不再是卡片',
    await evaluate(`!!document.querySelector('.trust-strip') && !document.querySelector('.trust-item, .trust-grid')`)
  );

  // ---- 1.55b2 首页双语（v3.16）----
  // 语言按钮原来只翻了搜索框提示与工具卡片：导航、入口卡、信任区仍是中文。
  // 半套翻译比不翻更糟——读到第二屏突然换语言，读者会以为页面坏了。
  await evaluate(`document.querySelector('#lang-btn').click()`);
  let enHome = '';
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    enHome = await evaluate(`[...document.querySelectorAll('#main-nav a')].map((a) => a.textContent.trim()).join('/')`);
    if (enHome.startsWith('Tools/Workflows/Resources/Guides/Reviews')) break;
  }
  check('切英文后导航变英文', enHome === 'Tools/Workflows/Resources/Guides/Reviews', enHome);
  const enCard = await evaluate(`
    (document.querySelector('.rc--tools .rc-tag') || {}).textContent.trim() +
    '/' + [...document.querySelectorAll('.trust-strip span')].slice(1, 2).map((x) => x.textContent).join('')`);
  check('切英文后入口卡与信任区也是英文', /^Toolbox\//.test(enCard) && !/[\u4e00-\u9fa5]/.test(enCard), enCard);
  await shot('17-home-en');
  // 切回中文：后面的用例一律按中文文案断言，别把语言状态留给他们
  await evaluate(`document.querySelector('#lang-btn').click()`);
  await sleep(700);
  check('切回中文生效', (await evaluate(`document.querySelector('#main-nav a').textContent.trim()`)) === '工具');
  const toolsCardHref = await evaluate(`(document.querySelector('.route-card.rc--tools') || {getAttribute: () => ''}).getAttribute('href') || ''`);
  check('首页工具箱卡是真链接', toolsCardHref === '/tools/', toolsCardHref);
  await evaluate(`document.querySelector('.route-card.rc--tools').click()`);
  await waitText('#page-body', '全部工具', 8000);
  const allToolsPath = await evaluate(`location.pathname`);
  const allToolsRows = await evaluate(`document.querySelectorAll('#page-body a.fl-row').length`);
  const ALL_N =
    JSON.parse(readFileSync(join(root, 'tools/tools.json'), 'utf8')).tools.length +
    JSON.parse(readFileSync(join(root, 'tools/directory.json'), 'utf8')).tools.length;
  check('点工具箱卡进入全部工具页', allToolsPath === '/tools/', allToolsPath);
  check('全部工具页列全', allToolsRows === ALL_N, `${allToolsRows} / ${ALL_N}`);
  check('全部工具页按分类分组', (await evaluate(`document.querySelectorAll('#page-body .res-group-title').length`)) >= 9);
  await shot('16-all-tools');

  // ---- 1.55c 教程（v3.15；v3.16 改名）----
  // 第三层内容：和「点开即用」的工具分开，验的是「导航点得到、页面真的渲染出步骤与回退」。
  await goto('/');
  const guideNavHref = await evaluate(`(document.querySelector('#main-nav a[data-nav="guides"]') || {getAttribute: () => ''}).getAttribute('href') || ''`);
  check('导航有教程入口', guideNavHref === '/guides/', guideNavHref);
  await evaluate(`document.querySelector('#main-nav a[data-nav="guides"]').click()`);
  await waitText('#page-body', '教程', 8000);
  const guideIdxPath = await evaluate(`location.pathname`);
  const guideRows = await evaluate(`document.querySelectorAll('#page-body a.fl-row').length`);
  const GUIDE_N = JSON.parse(readFileSync(join(root, 'content/guides.json'), 'utf8')).guides.length;
  check('点导航进入教程总览', guideIdxPath === '/guides/', guideIdxPath);
  check('教程总览列全篇目', guideRows === GUIDE_N, guideRows + ' 篇');
  await evaluate(`document.querySelector('#page-body a.fl-row').click()`);
  await waitText('#page-body', '翻车了怎么办', 8000);
  const guidePath = await evaluate(`location.pathname`);
  const stepN = await evaluate(`document.querySelectorAll('#page-body .guide-steps > li').length`);
  check('教程详情页是真 URL', /^\/guides\/[\w-]+\/$/.test(guidePath), guidePath);
  check('教程详情页渲染全部步骤', stepN === 8, stepN + ' 步');
  check('教程页有风险提示与元信息条', await evaluate(`!!document.querySelector('.guide-risk') && !!document.querySelector('.guide-meta')`));
  check('教程页互链站内工具', (await evaluate(`document.querySelectorAll('#page-body .related-chip[href^="/tools/"]').length`)) >= 2);
  await shot('17-guide');
  await goto('/');

  // ---- 1.56 评测列表（v3.13 改为行式列表）----
  await goto('/evaluations/');
  await waitText('#page-body', '工具测评', 8000);
  const evRows = await evaluate(`document.querySelectorAll('#page-body a.list-row').length`);
  const evIndexN = JSON.parse(readFileSync(join(root, 'evaluations.json'), 'utf8')).evaluations.length;
  check('评测列表是行式列表', evRows === evIndexN, evRows + ' 行');
  check('评测行带摘要与日期', await evaluate(`!!document.querySelector('#page-body .list-row .lr-desc') && !!document.querySelector('#page-body .list-row .lr-meta')`));
  await shot('15-evaluations');
  // 回到首页：下一段（口语搜索）默认站在首页，别把上下文留给评测页
  await goto('/');

  // ---- 1.6 口语、多词、容错与意图直达（v3.11）----
  // 这组断言守的是三条链：口语词表 → 生成器 → 别名；分词 → 打分；规则表 → 直达条 → 表单回填。
  // 任何一环断了，用户看到的都是「搜不到」，而单看代码是看不出来的。
  const typeHero = (text) =>
    evaluate(`(() => {
      const el = document.getElementById('hero-search');
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`);

  await typeHero('瘦身');
  const slimming = await evaluate(`[...document.querySelectorAll('#grid [data-id]')].map((e) => e.dataset.id)`);
  check('口语词「瘦身」命中图片压缩', slimming.includes('image-compress'), slimming.slice(0, 3).join(',') || '（无结果）');

  await typeHero('图片 压缩');
  const multiHits = await evaluate(`[...document.querySelectorAll('#grid [data-id]')].map((e) => e.dataset.id)`);
  check('多词查询（空格分隔）不再是零结果', multiHits.includes('image-compress'), multiHits.length + ' 个结果');

  await typeHero('把图片压到 200KB');
  const intentShown = await waitEl('#hero-intent:not([hidden])', 8000);
  const intentText = await evaluate(`(document.getElementById('hero-intent') || {}).textContent || ''`);
  check(
    '句子输入浮出「也许你要」直达条',
    intentShown && intentText.includes('图片压缩'),
    intentText.replace(/\s+/g, ' ').trim().slice(0, 36)
  );
  await shot('08-intent');

  await evaluate(`document.getElementById('hero-intent').click()`);
  await waitEl('#f-quality', 8000);
  await sleep(300);
  const landPath = await evaluate(`location.pathname`);
  const landQuality = await evaluate(`(document.getElementById('f-quality') || {}).value || ''`);
  check(
    '直达条带着预填参数进工具页',
    landPath === '/tools/image-compress/' && landQuality === '60',
    landPath + ' quality=' + landQuality
  );

  await goto('/');
  await typeHero('图片压宿');
  const typoHint = await waitText('#grid', '是不是要找', 8000);
  check('打错字时给出「是不是要找」', typoHint);
  await goto('/');

  // ---- 1.7 数据边界上界面（v3.19）----
  // 守三件事：目录工具不能被标成「本地」、卡片要带数据边界、死路要给出口。
  // 第一条是这次真正修掉的 bug——runtime 从 'link' 扩成 web/desktop/… 之后，
  // 首页精选的 `runtime !== 'link'` 恒为真，Tesseract / ffmpeg.wasm / IT-Tools /
  // Excalidraw 四个第三方站全被标成了「🔒 本地」，跟首页信任区那句承诺直接矛盾。
  const dirCard = await evaluate(`(() => {
    const el = document.getElementById('hero-search');
    el.value = 'excalidraw';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise((r) => setTimeout(() => {
      const card = document.querySelector('#grid [data-id="excalidraw"]');
      r({ text: card ? card.textContent : '', badge: card && card.querySelector('.badge') ? card.querySelector('.badge').textContent : '' });
    }, 500));
  })()`);
  check(
    '目录工具卡片标「在线」而不是「本地」',
    /在线/.test(dirCard.text) && !/本地运行/.test(dirCard.text),
    dirCard.text.replace(/\s+/g, ' ').trim().slice(0, 40)
  );
  check('卡片带数据边界（本机处理 / 会上传…）', /本机处理|点对点|会上传|看用法|未核实/.test(dirCard.text), dirCard.badge.trim());
  await shot('09-dir-privacy');

  // ---- 1.7b 点对点必须与「本机处理」分开（v3.21）----
  // PairDrop / LocalSend / FilePizza 在 v3.17 一直被标成「本机处理」，而它们传的是文件：
  // 文件确实离开了这台电脑，只是去了另一台设备而不是厂商服务器。标错方向正好相反——
  // 「本机处理」是对用户说「没出去」，实际是「出去了，但没给第三方」。这类错比漏标更糟。
  const p2pCard = await evaluate(`(() => {
    const el = document.getElementById('hero-search');
    el.value = 'pairdrop';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise((r) => setTimeout(() => {
      const card = document.querySelector('#grid [data-id="pairdrop"]');
      r({ text: card ? card.textContent : '' });
    }, 500));
  })()`);
  check(
    '点对点工具标「点对点」而不是「本机处理」',
    /点对点/.test(p2pCard.text) && !/本机处理/.test(p2pCard.text),
    p2pCard.text.replace(/\s+/g, ' ').trim().slice(0, 40)
  );

  // 详情页要把「这条边界凭什么成立」写出来：核过的说核过，没核的说没核。
  await goto('/tools/pairdrop/');
  const pdBody = await evaluate(`(document.body.innerText || '')`);
  check('详情页写出证据来源（已核实 + 依据）', /证据：边界已核实/.test(pdBody) && /官方 FAQ/.test(pdBody));
  check('详情页写清点对点中继', /TURN/.test(pdBody));
  await goto('/tools/quicktype/');
  const qtBody = await evaluate(`(document.body.innerText || '')`);
  check('未核实的条目如实说「尚未核实」', /尚未核实/.test(qtBody) && !/边界已核实/.test(qtBody));
  await goto('/');

  // 纯乱码（连错别字建议都没有）也必须给出口，否则用户只能看到一句「没找到」
  await evaluate(`(() => {
    const el = document.getElementById('hero-search');
    el.value = 'zzzqqq';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const recs = await evaluate(`(async () => {
    for (let i = 0; i < 30; i++) {
      const row = document.querySelector('#grid .rec-row');
      if (row) return { n: row.querySelectorAll('a').length, title: (document.querySelector('#grid .rec-title') || {}).textContent || '' };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { n: 0, title: '' };
  })()`);
  check('无结果时给出热门推荐', recs.n >= 1, recs.n + ' 个');
  check('无结果推荐有引导语', /试试这些/.test(recs.title), recs.title.trim());

  // 静态详情页：桌面类工具不能说成「在线直达」——那正是 v3.17 才刚分开的两种东西
  await goto('/tools/localsend/');
  const lsBody = await evaluate(`(document.body.innerText || '')`);
  check('目录详情页有「数据边界」区块', /数据边界/.test(lsBody));
  check('桌面应用标「需安装客户端」而不是在线直达', /需安装客户端/.test(lsBody) && !/怎么用上：🌐 在线直达/.test(lsBody));
  await goto('/');

  // ---- 2. 键盘操作（真实键盘事件）----
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', text: '/', windowsVirtualKeyCode: 191 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
  await sleep(350);
  const slashFocus = await evaluate(`document.activeElement.id`);
  // v3.4：首页头部输入框已收起，/ 落到 hero 大框上
  check('按 / 聚焦搜索框', slashFocus === 'hero-search', String(slashFocus));

  // Ctrl+K 打开命令面板
  await evaluate(`document.activeElement.blur()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
  await sleep(400);
  const paletteOpen = await evaluate(`document.getElementById('palette').classList.contains('show')`);
  check('Ctrl+K 打开命令面板', paletteOpen);
  const ariaHidden = await evaluate(`document.getElementById('palette').getAttribute('aria-hidden')`);
  check('命令面板 aria-hidden 同步', ariaHidden === 'false', String(ariaHidden));
  // 面板里输入拼音应命中
  await evaluate(`(() => {
    const i = document.getElementById('palette-input');
    i.value = 'fdjsq';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  const paletteHit = await evaluate(`document.getElementById('palette-results').textContent.includes('房贷计算器')`);
  check('命令面板拼音命中', paletteHit === true);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);

  // ---- 3. Tab 焦点可达（skip link → 导航 → 卡片）----
  await goto('/');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(200);
  const firstFocus = await evaluate(`document.activeElement.className || document.activeElement.tagName`);
  check('首个 Tab 落到 skip link', String(firstFocus).includes('skip-link'), String(firstFocus));

  // ---- 4. 个税计算器 ----
  await goto('/tools/tax-calc/');
  check('个税页无控制台错误', pageErrors.length === 0, pageErrors.slice(0, 1).join(''));
  // v3.5：工具页样式是独立的 style.tool.css，整页加载时构建期就该写进 <head>。
  // 顺带用一条只在工具样式表里的规则（.tool-head h1 = 22px）证明它真的生效了，
  // 光有 <link> 不算——断网或路径写错时 link 在、样式不在。
  const toolCssState = await evaluate(`(() => {
    const l = document.querySelector('link[href="/assets/style.tool.css"]');
    const h1 = document.querySelector('.tool-head h1');
    return { link: !!l, href: l && l.getAttribute('href'), size: h1 ? getComputedStyle(h1).fontSize : '' };
  })()`);
  check('工具页构建期引入 style.tool.css', toolCssState.link && toolCssState.href === '/assets/style.tool.css', toolCssState.href || '缺 link');
  check('工具页专用样式已生效', toolCssState.size === '22px', `.tool-head h1 = ${toolCssState.size || '未渲染'}`);
  const formTop = await evaluate(`Math.round(document.getElementById('tool-form').getBoundingClientRect().top + window.scrollY)`);
  check('工具表单在首屏内（不被长文压在下面）', formTop < 760, formTop + 'px');
  const fieldTop = await evaluate(`Math.round(document.getElementById('f-salary').getBoundingClientRect().top + window.scrollY)`);
  check('首个输入框在首屏内', fieldTop < 900, fieldTop + 'px');
  await fill({ 'f-salary': 15000, 'f-month': 10, 'f-social': 2500, 'f-kids': 2000, 'f-toddlers': 0, 'f-elder': 0, 'f-housing': 1500, 'f-edu': 0, 'f-other': 0 });
  await clickRun();
  const taxOk = await waitText('#tool-result', '累计计算明细');
  const taxText = await evaluate(`document.getElementById('tool-result').textContent`);
  check('个税真实计算出结果', taxOk && /¥\s?400\.00/.test(taxText), (taxText.match(/本月[^\n]{0,24}/) || [''])[0].trim());
  await shot('02-tax');

  // ---- 4b. 输入草稿：刷新后自动恢复 ----
  await cdp.send('Page.reload');
  await sleep(1600);
  const restored = await evaluate(`(document.getElementById('f-salary') || {}).value`);
  const noteShown = await evaluate(`!!document.querySelector('.draft-note')`);
  check('刷新后恢复上次输入', restored === '15000' && noteShown, `${restored} / 提示=${noteShown}`);

  // ---- 4c. 分享链接带当前输入（拦截 clipboard 以免依赖权限）----
  await evaluate(`(() => {
    window.__clip = '';
    navigator.clipboard.writeText = async (t) => { window.__clip = t; };
    return true;
  })()`);
  await evaluate(`document.getElementById('share-btn').click()`);
  await sleep(400);
  const clip = await evaluate(`window.__clip || ''`);
  check('分享链接包含输入参数', String(clip).includes('salary=15000') && String(clip).includes('run=1'), String(clip).slice(0, 90));

  // ---- 5. 单位换算（下拉联动 + 计算）----
  await goto('/tools/unit-convert/');
  await fill({ 'f-cat': 'data' });
  await sleep(200);
  const optCount = await evaluate(`document.getElementById('f-from').options.length`);
  check('切换类型后单位下拉联动', optCount >= 6, optCount + ' 个单位');
  await fill({ 'f-value': 1, 'f-from': 'TB', 'f-to': 'GiB' });
  await clickRun();
  const unitOk = await waitText('#tool-result', '931');
  check('单位换算 1TB → 931GiB', unitOk);

  // ---- 5b. 带参数的深链：打开即算 ----
  await goto('/tools/unit-convert/?cat=mass&value=2&from=kg&to=lb&run=1');
  const deepRun = await waitText('#tool-result', '4.4', 25000);
  check('深链参数打开即出结果', deepRun);
  const deepVal = await evaluate(`document.getElementById('f-value').value`);
  check('深链参数已回填到表单', deepVal === '2', deepVal);

  // ---- 6. PDF 合并（onForm 显隐）----
  await goto('/tools/pdf-merge/');
  const pdfInit = await evaluate(`(() => {
    const mode = document.getElementById('f-mode');
    mode.value = 'merge';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const mergeHidden = await evaluate(`(() => {
    const p = document.getElementById('f-pages');
    return p ? getComputedStyle(p.closest('label, .field, div')).display !== 'none' : null;
  })()`).catch(() => null);
  await evaluate(`(() => {
    const mode = document.getElementById('f-mode');
    mode.value = 'split';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const el = document.getElementById('f-every');
    return !!el;
  })()`);
  check('PDF 模式切换不报错', pdfInit === true, mergeHidden === false ? '合并模式已隐藏页码' : '');
  const multi = await evaluate(`document.getElementById('f-files').multiple`);
  check('PDF 文件输入支持多选', multi === true);

  // ---- 7. 二维码解析（真实 jsQR 解码，文件走 DataTransfer）----
  let qrDataUrl = null;
  // 缺 Python / 缺 qrcode 只跳过这一节：这里要的是「参考实现造一张真二维码」，
  // 属于测试环境缺失，不该判成被测功能有问题。
  if (!PYTHON) console.log(`  ⚠️ 跳过二维码对拍：${PYTHON_HINT}`);
  else try {
    const out = join(tmpdir(), 'toolhub-qr-' + Date.now() + '.png');
    execFileSync(PYTHON, ['-c', `
import qrcode
qr = qrcode.QRCode(border=2, box_size=8)
qr.add_data('https://sitool.eu.org/browser-ok')
qr.make()
qr.make_image(fill_color='black', back_color='white').convert('RGB').save(${JSON.stringify(out)})
`], { stdio: 'pipe' });
    qrDataUrl = 'data:image/png;base64,' + readFileSync(out).toString('base64');
    rmSync(out, { force: true });
  } catch (e) {
    check('生成测试二维码', false, e.message);
  }
  if (qrDataUrl) {
    await goto('/tools/qr-decode/');
    const fed = await feedFile('#f-file', qrDataUrl, 'qr.png', 'image/png');
    check('图片可注入文件输入', fed === 1);
    await clickRun();
    const qrOk = await waitText('#tool-result', 'sitool.eu.org', 30000);
    check('真实 jsQR 解码成功', qrOk);
    await shot('03-qr');
  }

  // ---- 8. 图片格式转换（真实 Canvas 编码）----
  await goto('/tools/image-convert/');
  const png = await evaluate(`(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#2563eb'; g.fillRect(0, 0, 200, 120);
    g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText('ToolHub', 20, 70);
    return c.toDataURL('image/png');
  })()`);
  await feedFile('#f-file', png, 'test.png', 'image/png');
  await clickRun();
  const convOk = await waitText('#tool-result', '下载', 20000);
  check('图片转 WebP 生成可下载结果', convOk);
  const dl = await evaluate(`(document.querySelector('#tool-result a[download]') || {}).download || ''`);
  check('产物文件名正确', /\.webp$/.test(dl), dl);

  // ---- 9. 搜索 ----
  await goto('/');
  await evaluate(`(() => {
    const s = document.getElementById('search');
    s.focus();
    s.value = 'fdjsq';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const searchHit = await evaluate(`document.getElementById('grid').textContent.includes('房贷计算器')`);
  check('搜索 fdjsq 命中房贷', searchHit);

  // ---- 9.5 首页运行时筛选与排序（v2.6 A1）----
  await goto('/');
  const rtBtns = await evaluate(`document.querySelectorAll('#filterbar [data-rt]').length`);
  check('首页运行方式筛选 3 档', rtBtns === 3, rtBtns + ' 档');
  const sortBtns = await evaluate(`document.querySelectorAll('#filterbar [data-sort]').length`);
  check('首页排序 3 档', sortBtns === 3, sortBtns + ' 档');
  // v3.4 起列表分页：DOM 里只有当前页的卡，总命中数看 #grid.dataset.total
  const gridTotal = () => evaluate(`parseInt(document.getElementById('grid').dataset.total || '0', 10)`);
  const gridShown = () => evaluate(`parseInt(document.getElementById('grid').dataset.shown || '0', 10)`);
  const allNum = await gridTotal();
  const allShown = await gridShown();
  check('首页首屏只渲染一页', allShown === 24 && allNum > 24, `${allShown} / 全部 ${allNum}`);
  const pagerBtns = await evaluate(`document.querySelectorAll('#pager .pg-btn[data-page]').length`);
  check('分页条给出页码与上下页', pagerBtns >= 4, pagerBtns + ' 个按钮');
  await evaluate(`document.querySelector('#pager .pg-btn[data-page="2"]').click()`);
  await sleep(700);
  const page2Qs = await evaluate(`location.search`);
  const page2Shown = await gridShown();
  check('翻页写进 URL', page2Qs.includes('page=2'), page2Qs);
  check('第 2 页仍是满页 24 张', page2Shown === 24, page2Shown + ' 张');
  const page2First = await evaluate(
    `(document.querySelector('#grid .card') || {}).dataset ? document.querySelector('#grid .card').dataset.id : ''`
  );
  await evaluate(`document.querySelector('#pager .pg-btn[data-page="1"]').click()`);
  await sleep(600);
  const page1First = await evaluate(`document.querySelector('#grid .card').dataset.id`);
  check('翻页后首卡不同（真的换了内容）', page1First !== page2First, `${page1First} vs ${page2First}`);
  // v3.13 分页：信息要能看出「还剩多少」，键盘也要能翻
  const pgInfo = await evaluate(`(document.querySelector('#pager .pg-info') || {}).textContent || ''`);
  check('分页信息标明第几页/共几页', /第 \d+\/\d+ 页/.test(pgInfo), pgInfo.trim());
  await evaluate(`document.querySelector('#pager .pg-btn[data-page="1"]').click()`);
  await sleep(500);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await sleep(600);
  const kbPage = await evaluate(`document.getElementById('grid').dataset.page`);
  check('键盘 → 翻到下一页', kbPage === '2', 'page ' + kbPage);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
  await sleep(600);
  const kbPageBack = await evaluate(`document.getElementById('grid').dataset.page`);
  check('键盘 ← 回上一页', kbPageBack === '1', 'page ' + kbPageBack);
  // 搜索会把页码打回 1，URL 里的 page 也得跟着消失，否则刷新回来是空页
  await evaluate(`document.querySelector('#pager .pg-btn[data-page="2"]').click()`);
  await sleep(500);
  await evaluate(`(() => {
    const s = document.getElementById('search');
    s.focus(); s.value = 'pdf';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  const qsAfterSearch = await evaluate(`location.search`);
  check('搜索后 URL 不残留 page', !qsAfterSearch.includes('page='), qsAfterSearch || '(空)');
  await evaluate(`(() => {
    const s = document.getElementById('search');
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.blur();
    return true;
  })()`);
  await sleep(400);
  await evaluate(`document.querySelector('#filterbar [data-rt="local"]').click()`);
  await sleep(600);
  const localNum = await gridTotal();
  check(`仅本机执行筛出 ${LOCAL_TOOLS} 个`, localNum === LOCAL_TOOLS, `${localNum} / 全部 ${allNum}`);
  const backTo1 = await evaluate(`document.getElementById('grid').dataset.page`);
  check('改筛选回到第 1 页', backTo1 === '1', 'page ' + backTo1);
  const qs = await evaluate(`location.search`);
  check('筛选状态写入 URL', qs.includes('runtime=local'), qs);
  await evaluate(`document.querySelector('#filterbar [data-rt="offline"]').click()`);
  await sleep(600);
  const offNum = await gridTotal();
  check('断网也能用少于本机执行', offNum > 0 && offNum < localNum, `${offNum} 个`);
  await cdp.send('Page.reload');
  await sleep(1200);
  const kept = await evaluate(
    `(document.querySelector('#filterbar [data-rt="offline"]') || {}).className || ''`
  );
  const keptNum = await gridTotal();
  check('刷新后筛选保持', String(kept).includes('active') && keptNum === offNum, `${keptNum} 个 · ${kept.includes('active')}`);
  await evaluate(`document.querySelector('#filterbar [data-sort="used"]').click()`);
  await sleep(400);
  const sortQs = await evaluate(`location.search`);
  check('排序状态写入 URL', sortQs.includes('sort=used'), sortQs);
  await goto('/');

  // ---- 9.7 键盘全流程（v2.6 A4）----
  const KEY_J = { code: 'KeyJ', vk: 74, text: 'j' };
  const KEY_K = { code: 'KeyK', vk: 75, text: 'k' };
  const cardIds = await evaluate(`[...document.querySelectorAll('#grid > [data-id]')].map(e => e.dataset.id)`);
  await pressKey('j', KEY_J);
  const kb0 = await evaluate(
    `[...document.querySelectorAll('#grid > [data-id]')].findIndex(e => e.classList.contains('kb-focus'))`
  );
  check('j 选中第一张卡', kb0 === 0, `index ${kb0}`);
  await pressKey('j', KEY_J);
  await pressKey('j', KEY_J);
  const kb2 = await evaluate(
    `[...document.querySelectorAll('#grid > [data-id]')].findIndex(e => e.classList.contains('kb-focus'))`
  );
  check('连按 j 逐张下移', kb2 === 2, `index ${kb2}`);
  const kbFocused = await evaluate(`document.activeElement === document.querySelector('#grid .kb-focus')`);
  check('当前卡获得真实焦点', kbFocused === true);
  await pressKey('k', KEY_K);
  const kb1 = await evaluate(
    `[...document.querySelectorAll('#grid > [data-id]')].findIndex(e => e.classList.contains('kb-focus'))`
  );
  check('k 往回上移', kb1 === 1, `index ${kb1}`);
  await pressKey('Enter', { code: 'Enter', vk: 13 });
  await sleep(700);
  const opened = await evaluate(`location.pathname`);
  check('Enter 打开选中的工具', opened === '/tools/' + cardIds[1] + '/', opened);

  // v3.5：从首页点进工具是 SPA 路径，首页没带 style.tool.css，得靠 tool-page.js 现取。
  // 这条同时验两件事：link 补上了、并且是「拿到样式之后才画」——否则会闪一下裸结构。
  await sleep(400);
  const spaToolCss = await evaluate(`(() => {
    const l = document.querySelector('link[href="/assets/style.tool.css"]');
    const h1 = document.querySelector('#view-tool .tool-head h1');
    return { link: !!l, size: h1 ? getComputedStyle(h1).fontSize : '' };
  })()`);
  check('SPA 进工具页补上样式表', spaToolCss.link === true);
  check('SPA 进工具页样式已生效', spaToolCss.size === '22px', spaToolCss.size || '未渲染');

  // 结果出现后焦点自动落到结果区
  await goto('/tools/uuid-gen/');
  await clickRun();
  const resFocus = await waitForFocus('tool-result', 8000);
  check('运行后焦点移到结果区', resFocus === true);
  const flash = await evaluate(`document.getElementById('tool-result').classList.contains('result-flash')`);
  check('结果区有出现提示动画', flash === true);

  // ? 打开快捷键帮助，Esc 关闭
  await pressKey('?', { code: 'Slash', vk: 191, text: '?', modifiers: 8 });
  const helpOpen = await evaluate(
    `document.getElementById('kbd-help').classList.contains('show') && document.getElementById('kbd-help').getAttribute('aria-hidden') === 'false'`
  );
  check('? 打开快捷键帮助', helpOpen === true);
  const helpRows = await evaluate(`document.querySelectorAll('#kbd-help .kbd-table tr').length`);
  check('帮助面板列出 9 条快捷键', helpRows === 9, helpRows + ' 条');
  const helpFocus = await evaluate(`document.activeElement.id`);
  check('帮助面板焦点落在关闭键', helpFocus === 'kbd-close', String(helpFocus));
  await pressKey('Escape', { code: 'Escape', vk: 27 });
  const helpClosed = await evaluate(`document.getElementById('kbd-help').getAttribute('aria-hidden')`);
  check('Esc 关闭帮助面板', helpClosed === 'true', String(helpClosed));

  // t 切主题
  const themeBefore = await evaluate(`document.documentElement.dataset.theme`);
  await pressKey('t', { code: 'KeyT', vk: 84, text: 't' });
  const themeAfter = await evaluate(`document.documentElement.dataset.theme`);
  check('t 切换主题', themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);
  await pressKey('t', { code: 'KeyT', vk: 84, text: 't' });

  // 页脚入口存在（不靠记忆也能找到快捷键）
  await goto('/');
  const kbdBtn = await evaluate(`!!document.getElementById('kbd-btn')`);
  check('页脚有快捷键入口', kbdBtn === true);

  // ---- 9.8 结果统一出口（v2.6 A3）----
  await goto('/tools/uuid-gen/?run=1');
  const raCopy = await waitText('#tool-result', '复制结果', 8000);
  check('文本类结果出现统一操作条', raCopy);
  const raShare = await evaluate(`!!document.querySelector('#tool-result .result-actions [data-act="share"]')`);
  check('操作条含分享按钮', raShare === true);
  await goto('/tools/image-convert/');
  const png2 = await evaluate(`(() => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = '#16a34a'; g.fillRect(0, 0, 120, 80);
    return c.toDataURL('image/png');
  })()`);
  await feedFile('#f-file', png2, 'shot.png', 'image/png');
  await clickRun();
  const raDl = await waitText('#tool-result', '下载', 15000);
  check('文件类结果出现下载入口', raDl);
  const previewed = await evaluate(`document.querySelectorAll('#tool-result .result-preview img').length`);
  check('图片产物自动渲染预览', previewed >= 1, previewed + ' 张');

  // ---- 9.7 工具链接力（v2.6 A2）：转换结果直接送进「图片转 PDF」----
  const hasGo = await evaluate(`!!document.querySelector('#tool-result [data-go="img-to-pdf"]')`);
  check('结果区提供下游工具入口', hasGo === true);
  if (hasGo) {
    await evaluate(`document.querySelector('#tool-result [data-go="img-to-pdf"]').click()`);
    for (let i = 0; i < 30; i++) {
      const p = await evaluate(`location.pathname`).catch(() => '');
      if (p === '/tools/img-to-pdf/') break;
      await sleep(200);
    }
    const p1 = await evaluate(`location.pathname`);
    check('点接力按钮进入目标工具', p1 === '/tools/img-to-pdf/', p1);
    // 目标页 run.js 是动态 import，表单渲染晚于路由切换，这里轮询等文件注入
    let fed = -1;
    for (let i = 0; i < 25; i++) {
      fed = await evaluate(
        `(() => { const el = document.getElementById('f-files'); return el && el.files ? el.files.length : -1; })()`
      ).catch(() => -1);
      if (fed >= 1) break;
      await sleep(160);
    }
    check('接力把上一步产物填进文件输入', fed >= 1, fed + ' 个文件');
    check('接力后显示来源提示', (await evaluate(`!!document.querySelector('.pipe-note')`)) === true);
    await clickRun();
    const pdfDone = await waitText('#tool-result', 'PDF', 25000);
    const pdfTxt = await evaluate(`(document.getElementById('tool-result').textContent || '').slice(0, 120)`);
    check('接力后直接产出 PDF', pdfDone, pdfTxt.replace(/\s+/g, ' '));
  }

  // ---- 9.9 目录工具页正文（v2.7 B1）----
  await goto('/tools/excalidraw/');
  const docReady = await waitText('#tool-body', '它解决什么问题', 8000);
  check('目录工具页渲染正文', docReady === true);
  const docLen = await evaluate(
    `(() => { const el = document.querySelector('#tool-body .doc-body'); return el ? el.textContent.replace(/\\s+/g, '').length : 0; })()`
  );
  check('正文长度 ≥400 字', docLen >= 400, docLen + ' 字');
  const docLinks = await evaluate(`document.querySelectorAll('#tool-body .doc-body a[href^="/tools/"]').length`);
  check('正文含站内工具内链', docLinks >= 1, docLinks + ' 条');
  const docFaq = await evaluate(`document.querySelectorAll('#tool-body .doc-body h3').length`);
  check('正文含常见问题', docFaq >= 2, docFaq + ' 条');
  await shot('06-directory-doc');

  // ---- 9.10 新工具端到端：照片元数据剥离（v2.8）----
  {
    const { makeJpeg } = await import('file://' + join(root, 'scripts/lib/jpeg-fixture.mjs').replace(/\\/g, '/'));
    const jpgDataUrl = 'data:image/jpeg;base64,' + makeJpeg({ gps: true, xmp: true }).toString('base64');
    await goto('/tools/exif-strip/');
    await waitText('#tool-body', '照片', 12000);
    await feedFile('#f-files', jpgDataUrl, 'IMG_0001.jpg', 'image/jpeg');
    await clickRun();
    const exifTxt = await waitText('#tool-result', 'GPS', 15000);
    check('新工具在真浏览器里读出了 GPS', exifTxt === true);
    const exifWarn = await evaluate(`!!document.querySelector('#tool-result .msg-warn')`);
    check('含定位时给出风险提示', exifWarn === true);
    // 切到剥离模式，应当产出可下载的干净文件
    await evaluate(`(() => { const s = document.getElementById('f-mode'); s.value = 'strip'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await clickRun();
    const stripDone = await waitText('#tool-result', '已删除', 15000);
    check('剥离模式产出结果', stripDone === true);
    const dlName = await evaluate(`(() => { const a = document.querySelector('#tool-result .result-actions a[download]'); return a ? a.getAttribute('download') : ''; })()`);
    check('剥离结果给出干净文件下载', /-clean\.jpg$/.test(String(dlName)), String(dlName));
  }

  // ---- 9.11 提交页工具包生成器（v2.8 C3）----
  {
    await goto('/submit/');
    // v3.23：投稿页改成「先选类别，再出字段」。没点「工具」这一格，生成器不该挂载——
    // 这正是这一版要的行为，所以测试必须先点，再断言。
    await evaluate(`document.querySelector('[data-slot="tool"]').click()`);
    const gateTool = await evaluate(
      `JSON.stringify({ tool: !document.getElementById('su-tool').hidden, resource: document.getElementById('su-resource').hidden })`
    );
    check('选中「工具」后只展开工具那一类', gateTool === '{"tool":true,"resource":true}', gateTool);
    const mounted = await waitText('#tool-builder', '生成一个工具包', 12000);
    check('提交页加载出工具包生成器', mounted === true);
    // 先提交一份不合规的（id 含大写、介绍太短），必须被拦下
    await evaluate(`(() => {
      document.getElementById('b-id').value = 'Bad Id';
      document.getElementById('b-name').value = '演示工具';
      document.getElementById('b-desc').value = '太短';
      document.getElementById('b-check').click();
    })()`);
    const errText = await waitText('#b-out', '需要先修', 8000);
    check('不合规的清单被拦下并列出原因', errText === true);
    const errCount = await evaluate(`document.querySelectorAll('#b-out .builder-errs li').length`);
    check('错误逐条列出（含 id 与介绍长度）', errCount >= 2, errCount + ' 条');
    // 改成合规内容后应通过，并生成 run.js 预览
    await evaluate(`(() => {
      document.getElementById('b-id').value = 'csv-to-md';
      document.getElementById('b-name').value = 'CSV 转 Markdown';
      document.getElementById('b-desc').value = '把 CSV 粘贴进来，直接得到可粘贴到文档的 Markdown 表格';
      document.getElementById('b-check').click();
    })()`);
    const okText = await waitText('#b-out', '校验通过', 8000);
    const outText = await evaluate(`(document.getElementById('b-out').textContent || '').replace(/\\s+/g, ' ').slice(0, 160)`);
    check('合规清单通过校验', okText === true, okText ? '' : outText);
    const genRun = await evaluate(`(() => { const p = document.querySelector('#b-out .builder-pre'); return p ? p.textContent.slice(0, 1500) : ''; })()`);
    check('生成 run.js 且含 manifest/run 导出', /export const manifest/.test(genRun) && /export async function run/.test(genRun), genRun.slice(0, 40).replace(/\s+/g, ' '));
  }

  // ---- 9.12 投稿页资源表单（v3.18）----
  // 这一版的核心主张是「填完当场就知道行不行」，所以这里验的不是「表单渲染出来了」，
  // 而是三条真正的行为：空表单被拦、已收过的网址被认出来、合规内容产出可用的提交链接。
  {
    await goto('/submit/');
    // v3.23 的核心断言：一进页面，四类里一个都不展开，资源表单连挂载都没发生。
    // 这不是「藏起来」——DOM 里数不到任何一个 [data-path]，所以也不可能被抓成「页面上有 7 个字段」。
    const gate0 = await evaluate(`(() => {
      const panels = [...document.querySelectorAll('[data-panel]')];
      return JSON.stringify({
        total: panels.length,
        open: panels.filter((p) => !p.hidden).length,
        fields: document.querySelectorAll('#resource-submit [data-path]').length,
        picks: document.querySelectorAll('#su-nav [data-slot]').length,
      });
    })()`);
    check(
      '进页面时四类都不展开、资源表单未挂载',
      gate0 === '{"total":4,"open":0,"fields":0,"picks":4}',
      gate0
    );

    await evaluate(`document.querySelector('[data-slot="resource"]').click()`);
    const gateRes = await evaluate(
      `JSON.stringify({ resource: !document.getElementById('su-resource').hidden, tool: document.getElementById('su-tool').hidden, pressed: document.querySelector('[data-slot="resource"]').getAttribute('aria-pressed') })`
    );
    check('选中「资源」后只展开资源那一类，且按钮为按下态', gateRes === '{"resource":true,"tool":true,"pressed":"true"}', gateRes);

    const resMounted = await waitText('#resource-submit', '推荐一条资源', 12000);
    check('投稿页加载出资源投稿表单', resMounted === true);

    const fieldN = await evaluate(`document.querySelectorAll('#resource-submit [data-path]').length`);
    check('资源表单字段与规范一致', fieldN === 9, fieldN + ' 个');

    // 空表单直接点校验：必须被拦，不能放过去（否则「校验」两个字就是装饰）
    await evaluate(`document.getElementById('su-check').click()`);
    const emptyWarn = await waitText('#su-out', '要改', 8000);
    check('空表单被拦下', emptyWarn === true);

    // 填一条已经收过的网址：应识别为「已收录」而不是当成新资源
    await evaluate(`(() => {
      const el = document.querySelector('[data-path="item.url"]');
      el.value = 'https://lucide.dev';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    })()`);
    const dupHit = await waitText('#resource-submit [data-err="item.url"]', '已收录过', 8000);
    check('已收录的网址被当场认出来', dupHit === true);

    // 填完整的一条合规内容
    await evaluate(`(() => {
      const set = (p, v) => {
        const el = document.querySelector('[data-path="' + p + '"]');
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('collection', 'icons');
      set('item.name', '测试图标库');
      set('item.url', 'https://example.org/icons-test');
      set('item.license', 'MIT');
      set('item.note', '这是一个用于验证投稿表单的测试条目，走完整流程但不该进库。');
      set('item.tags', '线性, 开源');
      set('conflict', 'none');
      document.getElementById('su-check').click();
    })()`);
    const passed = await waitText('#su-out', '校验通过', 8000);
    check('合规内容通过校验', passed === true);

    const href = await evaluate(
      `(() => { const a = document.querySelector('#su-out a[href*="issues/new"]'); return a ? a.getAttribute('href') : ''; })()`
    );
    check(
      '产出可用的提交链接（标题与正文已预填）',
      /^https:\/\/github\.com\/[\w-]+\/[\w-]+\/issues\/new\?/.test(href) && href.includes('body=') && decodeURIComponent(href).includes('测试图标库'),
      href.slice(0, 60)
    );
    // 走的是无模板 new issue，所以 body 才不会被 issue form 吞掉
    check('提交链接不走 template（否则正文会被吞）', !href.includes('template='));

    await goto('/');
  }


  // ---- 9.13 工作流页（v3.23）----
  // 这一屏验三件事，都不是「页面能打开」：
  //   ① 从首页导航点得进来（v3.22.2 的教训：直达测试对链接一无所知）；
  //   ② 一条文本流程真的跑完两步、产物能拿走；
  //   ③ 输入坏了就停在第 1 步，不带着半成品往下跑。
  {
    await goto('/');
    const navHref = await evaluate(`(() => {
      const a = document.querySelector('#main-nav a[href="/workflows/"]');
      return a ? a.getAttribute('href') : '';
    })()`);
    check('首页导航里有「工作流」入口', navHref === '/workflows/', navHref || '（没有）');

    await evaluate(`document.querySelector('#main-nav a[href="/workflows/"]').click()`);
    await sleep(1000);
    const wfUrl = await evaluate(`location.pathname`);
    check('从导航点进来落在 /workflows/', wfUrl === '/workflows/', wfUrl);

    const cards = await waitText('.wf-picker', '图片发布包', 12000);
    const cardN = await evaluate(`document.querySelectorAll('.wf-picker [data-flow]').length`);
    check('工作流页列出流程卡片', cards === true && cardN === 6, cardN + ' 条');

    // ② 文本流程：Base64 → JSON
    await evaluate(`document.querySelector('[data-flow="b64-to-json"]').click()`);
    await waitEl('#wf-text', 8000);
    const b64 = Buffer.from(JSON.stringify({ name: '张三', city: '南京' })).toString('base64');
    await evaluate(`(() => {
      const el = document.getElementById('wf-text');
      el.value = ${JSON.stringify(b64)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate(`document.getElementById('wf-run').click()`);
    const textDone = await waitText('#wf-out', '跑完', 15000);
    check('文本流程跑完两步', textDone === true);
    const outText = await evaluate(`(document.querySelector('#wf-out pre') || {}).textContent || ''`);
    check('产物是缩进好的 JSON', outText.includes('"name": "张三"'), outText.slice(0, 40).replace(/\n/g, ' '));
    const stepsDone = await evaluate(`document.querySelectorAll('.wf-step[data-state="done"]').length`);
    check('两步都标成完成', stepsDone === 2, stepsDone + ' 步');

    // ③ 坏输入：必须停在第 1 步，并说出原因
    await evaluate(`document.querySelector('[data-flow="b64-to-json"]').click()`);
    await waitEl('#wf-text', 8000);
    await evaluate(`(() => {
      const el = document.getElementById('wf-text');
      el.value = '这不是 base64!!';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate(`document.getElementById('wf-run').click()`);
    const stopped = await waitText('#wf-out', '停在第 1 步', 15000);
    check('坏输入停在第 1 步，不继续往下跑', stopped === true);
    const failedN = await evaluate(`document.querySelectorAll('.wf-step[data-state="fail"]').length`);
    check('失败的步骤被标出来', failedN === 1, failedN + ' 步');
    const step2State = await evaluate(`(document.querySelector('.wf-step[data-step="1"]') || {}).dataset?.state || ''`);
    check('第 2 步没有被执行', step2State === 'idle', step2State);

    // ④ 图片流程：带 GPS 的 JPEG 进去，WebP 出来。
    // 这里踩了一个坑值得记下来：jpeg-fixture 生成的是 570 字节的**合成** JPEG——够读元数据，
    // 但扫描数据是桩，浏览器解不开。只验元数据的测试察觉不到，工作流一接到「图片缩放」就炸了
    // （The source image could not be decoded）。所以这里拿 canvas 编一张真 JPEG，
    // 再把夹具里的 APP1 Exif 段插到 SOI 之后：既带 GPS，又能解码，两个前提都成立。
    const { makeJpeg } = await import('file://' + join(root, 'scripts/lib/jpeg-fixture.mjs').replace(/\\/g, '/'));
    const jpgDataUrl = 'data:image/jpeg;base64,' + makeJpeg({ gps: true, xmp: true }).toString('base64');
    await evaluate(`document.querySelector('[data-flow="image-publish"]').click()`);
    await waitEl('#wf-file', 8000);
    const exifSegs = await evaluate(`(async () => {
      const fix = new Uint8Array(await (await fetch(${JSON.stringify(jpgDataUrl)})).arrayBuffer());
      const app = [];
      let i = 2;
      while (i + 3 < fix.length && fix[i] === 0xff && fix[i + 1] !== 0xda) {
        const m = fix[i + 1], len = (fix[i + 2] << 8) | fix[i + 3];
        if (m === 0xe1 && String.fromCharCode(...fix.subarray(i + 4, i + 8)) === 'Exif') app.push(fix.subarray(i, i + 2 + len));
        i += 2 + len;
      }
      const c = document.createElement('canvas'); c.width = 900; c.height = 700;
      const g = c.getContext('2d'); g.fillStyle = '#357'; g.fillRect(0, 0, 900, 700);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      const real = new Uint8Array(await blob.arrayBuffer());
      const parts = [real.subarray(0, 2), ...app, real.subarray(2)];
      const total = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
      let o = 0; for (const x of parts) { total.set(x, o); o += x.length; }
      const dt = new DataTransfer();
      dt.items.add(new File([total], 'IMG_9001.jpg', { type: 'image/jpeg' }));
      const input = document.getElementById('wf-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return app.length;
    })()`);
    check('测试用的 JPEG 既带 EXIF 又能解码', exifSegs === 1, exifSegs + ' 段 Exif');
    await evaluate(`document.getElementById('wf-run').click()`);
    const imgDone = await waitText('#wf-out', '跑完', 30000);
    const imgOut = await evaluate(`((document.getElementById('wf-out') || {}).innerText || '').replace(/\\s+/g, ' ').slice(0, 140)`);
    check('图片流程跑完三步', imgDone === true, imgDone ? '' : imgOut);
    const firstStep = await evaluate(`(document.querySelector('.wf-step[data-step="0"]') || {}).dataset?.state || ''`);
    check('第 1 步真的删了元数据（不是「沿用上一段」）', firstStep === 'done', firstStep);
    const dl = await evaluate(`(() => {
      const a = document.querySelector('#wf-out .wf-files a[download]');
      return a ? JSON.stringify({ name: a.getAttribute('download'), href: a.getAttribute('href') }) : '';
    })()`);
    check('产物是 webp 且给了下载链接', /\.webp"/.test(dl) && dl.includes('blob:'), dl.slice(0, 80));
    await shot('09-workflows');
    await goto('/');
  }

  // ---- 9.14 v3.24 三条新流程 ----
  // 这一段专治「流程能跑完，但跑的是工具自带的示例数据」。
  // 三条流程的第一步都吃用户粘贴的文本，而这些工具的输入框都带示例默认值——
  // 一旦漏写 bind，planStep 会安静地走 default：页面显示「跑完」，产出却是示例。
  // 所以断言不能只看「跑完」，必须看产物里是不是用户那几行字。
  {
    await goto('/workflows/');
    const picked = await waitText('.wf-picker', '表格提列转 JSON', 12000);
    check('六条流程都渲染出来', picked === true);

    const runText = async (flow, value, expect) => {
      await evaluate(`document.querySelector('[data-flow="${flow}"]').click()`);
      await waitEl('#wf-text', 8000);
      await evaluate(`(() => {
        const el = document.getElementById('wf-text');
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await evaluate(`document.getElementById('wf-run').click()`);
      const ok = await waitText('#wf-out', expect, 20000);
      return { ok, out: await evaluate(`((document.getElementById('wf-out') || {}).innerText || '')`) };
    };

    // ① 表格提列转 JSON：贴两行订单，出来必须是 JSON 数组，且用的是我这三列
    const csv = '订单号,客户,金额\nA001,张三,128\nA002,李四,340';
    const r1 = await runText('csv-pick-to-json', csv, '跑完');
    check('提列流程跑完两步', r1.ok === true, r1.out.slice(0, 80).replace(/\n/g, ' '));
    const jsonText = await evaluate(`(document.querySelector('#wf-out pre') || {}).textContent || ''`);
    let parsed = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch {}
    check('产物是能直接解析的 JSON 数组', Array.isArray(parsed), jsonText.slice(0, 40).replace(/\n/g, ' '));
    check('表头变成了 key（订单号/客户/金额）', !!parsed && Object.keys(parsed[0] || {}).join(',') === '订单号,客户,金额', parsed ? Object.keys(parsed[0]).join(',') : '');
    check('值来自用户粘贴的内容，不是示例', !!parsed && parsed[0]['客户'] === '张三' && parsed[1]['金额'] === '340', parsed ? JSON.stringify(parsed[0]) : '');
    check('没有混进示例表的列（id/amount）', !/"(id|amount)"/.test(jsonText));

    // 只有表头、没有数据行：第 1 步能过（它只是选列），第 2 步转 JSON 时才发现没数据。
    // 这比「空输入」更能验到停在第几步——空输入会被引擎自己挡在运行之前。
    const r1bad = await runText('csv-pick-to-json', '订单号,客户,金额', '停在第 2 步');
    check('只有表头时停在第 2 步', r1bad.ok === true, r1bad.out.slice(0, 80).replace(/\n/g, ' '));
    const csvStep1 = await evaluate(`(document.querySelector('.wf-step[data-step="0"]') || {}).dataset?.state || ''`);
    const csvStep2 = await evaluate(`(document.querySelector('.wf-step[data-step="1"]') || {}).dataset?.state || ''`);
    check('第 1 步完成了，第 2 步才失败', csvStep1 === 'done' && csvStep2 === 'fail', csvStep1 + '/' + csvStep2);

    // ② 名单去重计数：重复项要真的被去掉，统计的是去重后的 3 条
    const list = 'apple\nBanana\napple\n  banana  \ncherry\n\ncherry';
    const r2 = await runText('dedupe-count', list, '跑完');
    check('去重计数流程跑完两步', r2.ok === true, r2.out.slice(0, 80).replace(/\n/g, ' '));
    const counted = await evaluate(`(document.querySelector('#wf-out pre') || {}).textContent || ''`);
    check('统计的是去重后的 3 行', /行数：3/.test(counted), counted.split('\n').slice(0, 2).join(' '));
    check('英文单词数是 3（apple/Banana/cherry）', /英文单词数：3/.test(counted), counted.split('\n').slice(0, 3).join(' '));
    check('不是那段示例介绍（ToolHub…/82 字）', !/ToolHub/.test(counted) && !/字符数（含空格）：82/.test(counted), counted.slice(0, 60).replace(/\n/g, ' '));

    // 这个流程没有「跑一半失败」的路径：text-dedupe 什么文本都收，word-count 也不会抛。
    // 但它有一条更前面的守卫值得验：空输入根本不该启动执行——一步都不许跑，更不许标失败。
    const r2bad = await runText('dedupe-count', '   ', '先把内容粘进来再运行');
    check('空名单在运行前就被挡住', r2bad.ok === true, r2bad.out.slice(0, 60).replace(/\n/g, ' '));
    const anyRan = await evaluate(
      `document.querySelectorAll('.wf-step[data-state="done"], .wf-step[data-state="fail"], .wf-step[data-state="warn"]').length`
    );
    check('被挡住时没有任何一步被执行', anyRan === 0, anyRan + ' 步');

    // ③ 二维码嵌码：文本 → PNG → Data URI
    const r3 = await runText('qr-embed', 'https://toolhub.bot.cd/', '跑完');
    check('二维码流程跑完两步', r3.ok === true, r3.out.slice(0, 80).replace(/\n/g, ' '));
    const uri = await evaluate(`(document.querySelector('#wf-out pre') || {}).textContent || ''`);
    check('产物是 PNG 的 Data URI', /^data:image\/png;base64,[A-Za-z0-9+/=]{200,}/.test(uri.trim()), '长度 ' + uri.trim().length);
    check('产物不是二维码原文（没被自动接错口）', !uri.includes('toolhub.bot.cd/'), uri.trim().slice(0, 40));
    const png = await evaluate(`(() => {
      const a = document.querySelector('#wf-out .wf-files a[download]');
      return a ? a.getAttribute('download') + '|' + a.getAttribute('href') : '';
    })()`);
    check('同时给了 PNG 下载链接', /\.png\|blob:/.test(png), png.slice(0, 60));

    // 内容超出二维码容量（4000 字符 > 容错级别 M 的上限）：第 1 步就该停，别把半成品传给转码
    const r3bad = await runText('qr-embed', 'A'.repeat(4000), '停在第 1 步');
    check('内容超容量时停在第 1 步', r3bad.ok === true, r3bad.out.slice(0, 100).replace(/\n/g, ' '));
    check('失败原因说得像人话（不是库内部报错）', /内容太长/.test(r3bad.out), r3bad.out.slice(0, 100).replace(/\n/g, ' '));
    const qrStep2 = await evaluate(`(document.querySelector('.wf-step[data-step="1"]') || {}).dataset?.state || ''`);
    check('二维码生成失败后第 2 步仍是 idle', qrStep2 === 'idle', qrStep2);

    await shot('09b-v324-flows');
    await goto('/');
  }

  // ---- 9.15 资源正文按需加载（v3.24）----
  // 「页面好看」不等于「拆对了」。这一段盯两件事，缺一件这次拆分就是白做：
  //   ① 首页**不许**请求 resources-notes.json —— 拆出去的全部意义就在这一条；
  //   ② 合集页**必须**请求它，并且正文真的渲染出来 —— 否则等于把正文删了。
  // 只测第 ② 条最容易被骗：正文文件自己加载成功、页面却渲染空段落时，页面照样「打开」。
  {
    await goto('/');
    await waitForCount('.res-preview-card', 3);
    const onHome = netUrls.filter((u) => u.includes('resources-notes.json')).length;
    check('首页不请求资源正文', onHome === 0, onHome + ' 次');
    check('首页仍然拿条目骨架（来源数量靠它算）', netUrls.some((u) => /\/resources\.json$/.test(u)) === true);
    const cnt = await evaluate(`(document.querySelector('.res-preview-card .rp-count') || {}).textContent || ''`);
    check('首页合集卡仍显示来源数量', /\d+\s*个来源/.test(cnt), cnt.trim());

    await goto('/resources/icons/');
    await waitText('#page-body', '个来源', 12000);
    const onPage = netUrls.filter((u) => u.includes('resources-notes.json')).length;
    check('合集页请求了正文文件', onPage >= 1, onPage + ' 次');
    const rows = await waitForCount('.res-item', 8);
    check('合集页条目都渲染了', rows >= 8, rows + ' 条');
    const ns = await evaluate(`(() => {
      const xs = [...document.querySelectorAll('.res-item-note')].map((n) => n.textContent.trim());
      return { total: xs.length, empty: xs.filter((x) => x.length < 15).length, uniq: new Set(xs).size };
    })()`);
    check('每条都有正文，不是空段落', ns.empty === 0 && ns.total >= 8, `${ns.total} 条 / 空 ${ns.empty}`);
    check('正文不是同一段复读（说明按条目取到了）', ns.uniq >= 6, ns.uniq + ' 种');
    await shot('19-resources-notes');
    await goto('/');
  }

  // ---- 10. 刷新深链 + 返回按钮 ----
  await goto('/tools/mortgage-calc/');
  await cdp.send('Page.reload');
  await sleep(1200);
  const deepOk = await evaluate(`document.getElementById('tool-body') && document.getElementById('tool-body').textContent.includes('贷款金额')`);
  check('工具深链刷新后仍正常', deepOk === true);

  // ---- 11. Service Worker ----
  await sleep(1200);
  const sw = await evaluate(`navigator.serviceWorker.getRegistrations().then(r => r.length)`);
  check('Service Worker 已注册', sw >= 1, sw + ' 个');

  // ---- 12. 移动端视口 ----
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto('/');
  const overflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('移动端无横向溢出', overflow <= 1, 'overflow ' + overflow + 'px');
  const ph = await evaluate(`document.getElementById('search').placeholder`);
  const heroPh = await evaluate(`document.getElementById('hero-search').placeholder`);
  check('窄屏占位文案已缩短', ph === '搜索工具…' && heroPh === '搜索工具或资源…', `${ph} | ${heroPh}`);
  await shot('04-mobile');
  // v3.15：导航从 5 项变 6 项。这一行在 375px 最紧——它是横向布局里唯一会随内容变长的东西，
  // 后面加任何入口都要先过这一关，否则会用「多了一个字」把整站顶出横向滚动条。
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
  await goto('/');
  const navFit = await evaluate(`document.querySelector('#main-nav').scrollWidth - document.querySelector('#main-nav').clientWidth`);
  check('375px 导航一行放得下', navFit <= 1, '溢出 ' + navFit + 'px');
  const overflow375 = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('375px 无横向溢出', overflow375 <= 1, 'overflow ' + overflow375 + 'px');
  // 步骤列带序号圆点与 40px 缩进，长段落最容易在这里把版心挤出去
  await goto('/guides/tv-box-server/');
  await waitText('#page-body', '翻车了怎么办', 8000);
  const guideOverflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('教程页窄屏无横向溢出', guideOverflow <= 1, 'overflow ' + guideOverflow + 'px');
  await shot('17b-guide-mobile');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto('/');
  // v3.11：直达条是首屏最新的浮动块，窄屏最容易把它撑破——单独量一次
  await typeHero('把图片压到 200KB');
  await waitEl('#hero-intent:not([hidden])', 8000);
  const intentOverflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('移动端直达条不撑破布局', intentOverflow <= 1, 'overflow ' + intentOverflow + 'px');
  await shot('04b-intent-mobile');
  // v3.12：评测页的使用说明里塞了命令行与安装包文件名（photocraft-0.19.0-windows-x64.msi 这类
  // 中间没空格的串），窄屏最容易把 ol 撑破。首页不溢出不代表这里不溢出，单独量。
  await goto('/evaluations/filee-review/');
  await waitText('#page-body', '怎么用', 8000);
  const revOverflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('评测页窄屏无横向溢出', revOverflow <= 1, 'overflow ' + revOverflow + 'px');
  const stepGroups = await evaluate(`document.querySelectorAll('#page-body ol').length`);
  check('评测页使用说明分组渲染', stepGroups >= 4, stepGroups + ' 组');
  await shot('12-review-mobile');
  // v3.13：分类页是新模板，工具行右侧带「n 本地 / m 在线」，窄屏最容易挤破
  await goto('/categories/image/');
  await waitText('#page-body', '适合这些场景', 8000);
  const catOverflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('分类页窄屏无横向溢出', catOverflow <= 1, 'overflow ' + catOverflow + 'px');
  // v3.14：全部工具页行数最多（99 行），右侧还有「本地/在线」徽章，窄屏最容易挤破
  await goto('/tools/');
  await waitText('#page-body', '全部工具', 8000);
  const allToolsOverflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('全部工具页窄屏无横向溢出', allToolsOverflow <= 1, 'overflow ' + allToolsOverflow + 'px');
  await goto('/evaluations/');
  await waitText('#page-body', '工具测评', 8000);
  const evOverflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('评测列表窄屏无横向溢出', evOverflow <= 1, 'overflow ' + evOverflow + 'px');
  await shot('13b-evaluations-mobile');
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  // ---- 13. 深色主题：无 app.js 时也必须是深色（验证首帧无白闪）----
  await evaluate(`localStorage.setItem('toolhub:theme', 'dark')`);
  await cdp.send('Network.setBlockedURLs', { urls: ['*/assets/app.js'] });
  await goto('/');
  const preTheme = await evaluate(`document.documentElement.dataset.theme`);
  const preBg = await evaluate(`getComputedStyle(document.body).backgroundColor`);
  const lum = (String(preBg).match(/\d+/g) || []).slice(0, 3).reduce((a, b) => a + +b, 0);
  check('深色首帧不闪白（禁用 app.js 仍为深色）', preTheme === 'dark' && lum < 200, `${preTheme} / ${preBg}`);
  await cdp.send('Network.setBlockedURLs', { urls: [] });

  await goto('/');
  const darkBg = await evaluate(`getComputedStyle(document.body).backgroundColor`);
  check('深色主题完整生效', lum > 0 && /^rgb\(1[0-9],/.test(String(darkBg)), String(darkBg));
  await shot('05-dark');
  await evaluate(`localStorage.setItem('toolhub:theme', 'light')`);

  // ---- 14. 安全头、CSP、性能与统计（v2.9 D）----
  await goto('/');
  const hdr = await evaluate(`(async () => {
    const r = await fetch('/', { cache: 'no-store' });
    const o = {};
    for (const k of ['content-security-policy','strict-transport-security','x-content-type-options','referrer-policy','permissions-policy']) o[k] = r.headers.get(k) || '';
    return o;
  })()`);
  check('首页返回 CSP', /wasm-unsafe-eval/.test(hdr['content-security-policy']) && /blob:/.test(hdr['content-security-policy']), hdr['content-security-policy'].slice(0, 60) + '…');
  check('首页 frame-ancestors 限同源', /frame-ancestors 'self'/.test(hdr['content-security-policy']));
  check('HSTS 与 nosniff 已下发', /max-age=31536000/.test(hdr['strict-transport-security']) && hdr['x-content-type-options'] === 'nosniff');
  check('未发送 X-Frame-Options（避免锁死嵌入）', !('x-frame-options' in hdr));

  const toolHdr = await evaluate(`(async () => {
    const r = await fetch('/tools/json-format/', { cache: 'no-store' });
    return r.headers.get('content-security-policy') || '';
  })()`);
  check('工具页允许被嵌入', /frame-ancestors \*/.test(toolHdr), toolHdr.split(';').pop().trim());

  const perf = await evaluate(`window.__perf || { lcp: 0, cls: 0 }`);
  check('LCP 在预算内', perf.lcp > 0 && perf.lcp < 2500, Math.round(perf.lcp) + 'ms');
  check('CLS 在预算内', perf.cls < 0.1, perf.cls.toFixed(3) + (perf.shifts && perf.shifts.length ? ' ← ' + JSON.stringify(perf.shifts.slice(0, 3)) : ''));
  check('无 CSP 违规', cspViolations.length === 0, cspViolations[0] || '干净');

  const thirdParty = netUrls.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check('默认零第三方请求（统计关闭）', thirdParty.length === 0 && !(await evaluate(`window.__TOOLHUB_ANALYTICS__`)), thirdParty.slice(0, 2).join(', '));

  await goto('/privacy/');
  // v3.3：内容页模板改为按需加载（pages.js），#page-body 的渲染比静态正文晚一步。
  // 单次采样会偶发「还没渲染完就判定失败」，改为等正文真正出现再断言（同 v3.2 的轮询教训）。
  await waitText('#page-body', '不会离开这台设备', 8000);
  const pvText = await evaluate(`document.body.textContent`);
  check('隐私页说明数据流向', pvText.includes('不会离开这台设备') && pvText.includes('AES-GCM'));
  // v3.20：SPA 渲染出来的这份清单，必须覆盖代码里实际在用的每个存储键。
  // 静态正文那份由构建期闸门（check-storage-keys.mjs）盯着；两条渲染路径都要对，
  // 否则「断网时看的是静态页、联网时看的是 SPA」就会给出两种说法。
  {
    const keys = KEYS.map((k) => k.id);
    const shown = await evaluate(`document.getElementById('page-body').textContent`);
    const absent = keys.filter((k) => !shown.includes(k));
    check('隐私页键清单与代码一致', absent.length === 0, absent.length ? '漏写 ' + absent.join(',') : `${keys.length} 个键`);
  }
  const toggled = await evaluate(`(() => {
    const b = document.getElementById('analytics-optout');
    if (!b) return 'missing';
    b.click();
    return localStorage.getItem('toolhub:no-analytics');
  })()`);
  // v3.22 起统计开关存 JSON 布尔（'true'），之前是字符串 '1'。断言跟着存储格式走，
  // 判的是「按钮写进去了」，不是「写进去的是哪种字面量」——但必须写清现在是哪种。
  check('可在本机关闭统计', toggled === 'true', 'localStorage=' + toggled);
  await evaluate(`localStorage.removeItem('toolhub:no-analytics')`);

  // ---- 15. v3.0：加密分享 / 批量 / 意图 / 离线包 ----
  // 15a. 结果区多出「加密分享」，且只有多文件时才出现「打包下载」
  {
    await goto('/tools/json-format/');
    await waitEl('#f-json');
    await fill({ 'f-json': '{"a":1}' });
    await clickRun();
    await waitText('#tool-result', 'a', 8000);
    const shareBtn = await evaluate(`!!document.querySelector('#tool-result [data-act="share-enc"]')`);
    check('结果区有「加密分享」入口', shareBtn === true);
    const zipBtn = await evaluate(`!!document.querySelector('#tool-result [data-act="download-zip"]')`);
    check('单结果时不显示打包下载', zipBtn === false);
    // v3.20：跑成功要在本机留一条事件（只含工具 id / 结果 / 时间，不含输入）。
    // 这是「任务完成率」唯一的数据来源——没有服务端统计，指标只能本机算。
    const evs = await evaluate(`JSON.parse(localStorage.getItem('toolhub:events') || '[]')`);
    const hit = evs.filter((e) => e.tool === 'json-format' && e.event === 'ok');
    check('本机事件记下「跑成了」', hit.length >= 1, `${evs.length} 条事件`);
    check(
      '事件不含输入内容',
      evs.every((e) => Object.keys(e).sort().join(',') === 'event,tool,ts'),
      evs.length ? Object.keys(evs[0]).join(',') : '空'
    );
  }

  // 15b. 收到加密链接 → 自动解密回填 → 直接出结果（片段不随请求发送，所以只能由页面自己处理）
  {
    const env = await evaluate(`(async () => {
      const m = await import('/assets/lib/secure-share.js');
      return await m.createShare({ id: 'json-format', values: { json: '{"secret":42}' } }, 'pw123');
    })()`);
    await goto('/tools/json-format/');
    // 把密文放进片段再刷新，模拟「别人把链接发给你」
    await evaluate(`location.hash = ${JSON.stringify('#' + env)}`);
    await cdp.send('Page.reload');
    const modal = await waitText('.enc-modal', '加密', 8000);
    check('带口令的链接弹出领取口令', modal === true);
    await evaluate(`(() => { document.getElementById('enc-pass').value = 'pw123'; document.getElementById('enc-ok').click(); })()`);
    const okNote = await waitText('.enc-note-ok', '已解密', 10000);
    check('口令正确后解密并提示', okNote === true);
    const restored = await evaluate(`document.getElementById('f-json') ? document.getElementById('f-json').value : ''`);
    check('解密内容回填到表单', /secret/.test(String(restored)), String(restored).slice(0, 40));
    const hashCleared = await evaluate(`location.hash`);
    check('解密后清掉地址栏密文', hashCleared === '', 'hash=' + hashCleared);
    const autoRan = await waitText('#tool-result', 'secret', 8000);
    check('解密后自动出结果（不用再点运行）', autoRan === true);
  }

  // 15c. 口令错误必须失败，而不是给出一份错内容
  {
    const env = await evaluate(`(async () => {
      const m = await import('/assets/lib/secure-share.js');
      return await m.createShare({ id: 'json-format', values: { json: '{"x":1}' } }, 'right-pass');
    })()`);
    // 先清掉本机草稿：否则解密失败后会回落到上一次的草稿，让「有没有回填」这件事测不准
    await evaluate(`localStorage.removeItem('toolhub:draft:json-format')`);
    await goto('/tools/json-format/');
    await evaluate(`location.hash = ${JSON.stringify('#' + env)}`);
    await cdp.send('Page.reload');
    await waitText('.enc-modal', '加密', 8000);
    await evaluate(`(() => { document.getElementById('enc-pass').value = 'wrong-pass'; document.getElementById('enc-ok').click(); })()`);
    const badNote = await waitText('.enc-note-bad', '口令', 8000);
    check('口令错误时明确报错', badNote === true);
    const noFill = await evaluate(`document.getElementById('f-json') ? document.getElementById('f-json').value : 'EMPTY'`);
    // 关键是不能出现这条链接的明文（"x"），空着或回落到本机草稿都算合理
    check('口令错误时不泄露链接内容', !/"x"/.test(String(noFill)), 'field=' + String(noFill).slice(0, 30));
  }

  // 15d. 命令面板：一句中文直接给出工具并带上参数
  {
    await goto('/');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await sleep(400);
    await evaluate(`(() => { const i = document.getElementById('palette-input'); i.value = '帮我把这张图压到 200KB'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const intentReady = await waitText('#palette-results', '也许你要', 8000);
    check('命令面板识别自然语言', intentReady === true);
    const firstItem = await evaluate(`(() => { const el = document.querySelector('#palette-results .pal-item'); return el ? el.textContent.replace(/\\s+/g, ' ') : ''; })()`);
    check('意图项排在第一位且带参数', /图片压缩/.test(firstItem) && /quality=60/.test(firstItem), firstItem.slice(0, 50));
    // 回车直接进工具，且参数已预填
    await evaluate(`(() => { const i = document.getElementById('palette-input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    const landed = await waitEl('#f-quality', 12000);
    check('回车跳转到意图指向的工具', landed === true);
    const q = await evaluate(`document.getElementById('f-quality') ? document.getElementById('f-quality').value : ''`);
    check('跳转后参数已预填', String(q) === '60', 'quality=' + q);
  }

  // 15e. 批量处理页与离线页在真浏览器里挂载成功
  {
    await goto('/batch/');
    const dropZone = await waitText('#batch-app', '拖', 12000);
    check('批量页挂载拖拽区', dropZone === true);
    const batchBtns = await evaluate(`document.querySelectorAll('#batch-app select, #batch-app input[type="range"]').length`);
    check('批量页有格式与质量参数', batchBtns >= 2, batchBtns + ' 个控件');

    await goto('/offline/');
    // 离线页的卡片是 mountOffline() 动态挂载的（要先 import /assets/offline.js），
    // 直接取值会在 import 还没回来时数到 0——那是等待不足，不是功能坏了
    let offCards = 0;
    for (let i = 0; i < 50; i++) {
      offCards = await evaluate(`document.querySelectorAll('#offline-app .off-card').length`).catch(() => 0);
      if (offCards >= 3) break;
      await sleep(150);
    }
    check('离线页挂载三张状态卡', offCards >= 3, offCards + ' 张');
    const metaShown = await evaluate(`(document.querySelector('#offline-app') || {}).textContent || ''`);
    check('离线页显示离线包规模', /\d+ 个地址/.test(metaShown), (metaShown.match(/\d+ 个地址[^。]*/) || [''])[0]);
    await shot('07-offline');
  }

  // 15f. 真断网：下载离线包 → 断网 → 工具仍可打开并出结果（这是 E1 的全部意义）
  {
    await goto('/offline/');
    await sleep(600);
    const ctl = await evaluate(`navigator.serviceWorker.controller ? 'yes' : 'no'`);
    // 首次访问可能还没有 controller，刷新一次让它接管
    if (ctl !== 'yes') {
      await cdp.send('Page.reload');
      await sleep(1200);
    }
    const started = await evaluate(`(() => {
      const b = document.getElementById('off-download');
      if (!b) return 'no-btn';
      b.click();
      return 'ok';
    })()`);
    check('离线页可触发下载离线包', started === 'ok', String(started));
    const done = await waitText('#off-progress', '离线包已就绪', 90000);
    const progText = await evaluate(`(document.getElementById('off-progress') || {}).textContent || ''`);
    check('离线包下载完成', done === true, progText.slice(0, 60));
    const cached = await evaluate(`(async () => { const k = await caches.keys(); if (!k.length) return 0; const c = await caches.open(k[0]); return (await c.keys()).length; })()`);
    check('缓存里真的有整包', cached >= 90, cached + ' 个文件');

    // 断网：本地工具页必须来自缓存，run.js 必须还能执行
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await cdp.send('Page.navigate', { url: BASE + '/tools/json-format/' });
    await sleep(1500);
    const offForm = await waitEl('#run-btn', 10000);
    check('断网后本地工具页仍能打开', offForm === true);
    if (offForm) {
      await fill({ 'f-json': '{"offline":true}' });
      await clickRun();
      const offResult = await waitText('#tool-result', 'offline', 10000);
      check('断网后工具仍能出结果', offResult === true);
    }
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check('断网期间无 CSP 违规', cspViolations.length === 0, cspViolations[0] || '干净');
  }

  // =============== 16. 拖进来 / 粘进来（v3.1） ===============
  // 这一节测的是「入口」：文件拖到窗口任意位置、内容粘进搜索框，
  // 能不能落到对的工具，并且文件真的带过去。
  console.log('\n🧭 拖放与粘贴入口');
  {
    await goto('/');

    // 拖入一个 PNG：先出「松手」浮层，松手后出候选面板
    const dragState = await evaluate(`(async () => {
      const mk = () => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'shot.png', { type: 'image/png' }));
        return dt;
      };
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: mk(), bubbles: true, cancelable: true }));
      // drop.js 是按需加载的：第一次拖拽会现场 import，给它一点时间
      for (let i = 0; i < 30; i++) {
        if (document.querySelector('.drop-mask.show')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const mask = document.querySelector('.drop-mask');
      return { hasMask: !!mask, shown: !!(mask && mask.classList.contains('show')), text: mask ? mask.textContent : '' };
    })()`);
    check('拖入文件时出现「松手」浮层', dragState.shown === true, JSON.stringify(dragState).slice(0, 80));
    check('浮层说明文件不上传', /不上传|不离开|不会离开/.test(dragState.text || ''), dragState.text.trim().slice(0, 40));

    const panelState = await evaluate(`(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'shot.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      for (let i = 0; i < 40; i++) {
        const b = document.querySelector('.drop-panel-mask[data-open]');
        if (b) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const box = document.querySelector('.drop-panel-mask');
      const mask = document.querySelector('.drop-mask');
      return {
        open: !!(box && box.hasAttribute('data-open')),
        overlayGone: !(mask && mask.classList.contains('show')),
        head: box ? box.querySelector('.dp-head b').textContent : '',
        items: box ? [...box.querySelectorAll('.dp-item b')].map((e) => e.textContent) : [],
      };
    })()`);
    check('松手后浮层收起', panelState.overlayGone === true);
    check('给出候选工具面板', panelState.open === true);
    check('候选里第一个是图片压缩', (panelState.items[0] || '') === '图片压缩', panelState.items.join(' / '));
    check('面板标题说明已识别到 1 张图', /1 个图片/.test(panelState.head || ''), panelState.head);

    // 点第一个候选：应当带着文件跳到图片压缩，并且文件真的进了 input
    await evaluate(`(() => { const b = document.querySelector('.dp-item'); if (b) b.click(); })()`);
    await sleep(700);
    const landed = await waitEl('#f-file', 12000);
    check('点击候选跳到对应工具', landed === true, await evaluate('location.pathname'));
    const fileIn = await evaluate(`(() => {
      const el = document.getElementById('f-file');
      return el && el.files ? { n: el.files.length, name: el.files[0] && el.files[0].name } : null;
    })()`);
    check('文件已带入 input（未重新选择）', fileIn && fileIn.n === 1 && fileIn.name === 'shot.png', JSON.stringify(fileIn));
    const note = await waitText('#tool-fields', '已放入你拖进来的文件', 6000);
    check('表单里说明文件来源', note === true);

    // 粘一段 JSON 进首页搜索框：不该被当成关键词，而是一条「格式化这段 JSON」
    await goto('/');
    const pasteHint = await evaluate(`(async () => {
      const inp = document.getElementById('hero-search');
      inp.focus();
      const dt = new DataTransfer();
      dt.setData('text', '{"a":1,"b":[2,3]}');
      inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      for (let i = 0; i < 25; i++) {
        if (document.querySelector('.paste-hint')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const h = document.querySelector('.paste-hint');
      return { text: h ? h.textContent : '', inputValue: inp.value };
    })()`);
    check('粘贴 JSON 出现识别条', /JSON/.test(pasteHint.text), pasteHint.text.trim().slice(0, 40));
    check('识别条给出可点的动作', /格式化/.test(pasteHint.text), pasteHint.text.trim().slice(0, 40));
    check('长文本没有被塞进搜索框', !pasteHint.inputValue || pasteHint.inputValue.length < 20, pasteHint.inputValue);

    await evaluate(`(() => { const b = document.querySelector('.paste-hint .ph-go'); if (b) b.click(); })()`);
    await sleep(900);
    const pasteLanded = await waitEl('#f-json', 12000);
    check('点识别条直达工具并预填', pasteLanded === true, await evaluate('location.pathname'));
    const prefilled = await evaluate(`(document.getElementById('f-json') || {}).value || ''`);
    check('预填内容就是粘进去的 JSON', prefilled.includes('"b":[2,3]'), prefilled.slice(0, 40));
  }

  // ---- 16. 存储层与「我的数据」页（v3.22）----
  // 这一组测的是「统一存储层」到底有没有效果，不是「页面好不好看」。
  // 四件事各自对应一类真实故障：脏数据打挂页面、格式迁移丢偏好、清除按钮不生效、首帧闪白。
  {
    // 16a. 脏数据不能打挂首页。
    // 这是 store 层存在的第一理由：过去 favs() 直接 JSON.parse，存储里若是半截 JSON，
    // 首页渲染当场中断——用户看到的是白屏，而不是「收藏丢了」。
    await evaluate(`localStorage.setItem('toolhub:favs', '{broken')`);
    await goto('/');
    const cardsN = await evaluate(`document.querySelectorAll('#main-content .card[data-id]').length`);
    check('存储里是坏 JSON 时首页照常渲染', cardsN > 10, `${cardsN} 张卡片`);
    check('坏 JSON 不产生未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    await evaluate(`localStorage.removeItem('toolhub:favs')`);

    // 16b. 迁移：v3.22 之前 theme 存的是裸字符串 `dark`，之后是 JSON `"dark"`。
    // 不迁移的话 get() 会把它当脏数据，退回默认值——深浅色偏好在升级当天静默丢失。
    await evaluate(`localStorage.setItem('toolhub:theme', 'dark')`);
    await goto('/');
    const migrated = await evaluate(`localStorage.getItem('toolhub:theme')`);
    const themeAfter = await evaluate(`document.documentElement.dataset.theme`);
    check('裸字符串偏好被迁移成 JSON', migrated === '"dark"', String(migrated));
    check('迁移后偏好没丢（仍是深色）', themeAfter === 'dark', String(themeAfter));

    // 16c. 首帧防闪白要同时认两种格式。
    // 第 13 组测的是裸字符串那条路；这里测已迁移的 JSON 那条——两条都得绿，
    // 否则升级当天深色用户会看到一次白闪，而截图里看不出来。
    await cdp.send('Network.setBlockedURLs', { urls: ['*/assets/app.js'] });
    await goto('/');
    const preJson = await evaluate(`document.documentElement.dataset.theme`);
    check('已迁移的 JSON 偏好首帧也是深色', preJson === 'dark', String(preJson));
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await evaluate(`localStorage.setItem('toolhub:theme', '"light"')`);

    // 16d. /my/ 面板：四格概览 + 存储明细行数 = 清单键数 + 清除按钮由清单生成。
    await evaluate(`localStorage.setItem('toolhub:favs', JSON.stringify(['json-format','qr-code']))`);
    await evaluate(`localStorage.setItem('toolhub:usage', JSON.stringify({'json-format':3}))`);
    await goto('/my/');
    const myOk = await waitText('#my-app', '存了什么', 10000);
    const myInfo = await evaluate(`(() => {
      const rows = document.querySelectorAll('.my-table tbody tr, .my-table tr').length;
      return {
        rows,
        cards: document.querySelectorAll('.my-card').length,
        wipes: document.querySelectorAll('.my-wipe').length,
        keys: [...document.querySelectorAll('.my-table code')].map((e) => e.textContent),
        total: (document.querySelector('.my-total td.my-num') || {}).textContent || '',
      };
    })()`);
    check('我的数据页渲染出面板', myOk === true);
    check('四格概览齐全', myInfo.cards === 4, `${myInfo.cards} 格`);
    // 表头 1 行 + 11 个键 + 合计 1 行 = 13
    check('存储明细行数 = 清单键数', myInfo.rows === 13, `${myInfo.rows} 行（含表头与合计）`);
    check('清单里的键全在面板上', myInfo.keys.length === 11 && myInfo.keys.includes('toolhub:draft:<工具 id>'), myInfo.keys.join(','));
    check('按类清除按钮由清单生成', myInfo.wipes === 4, `${myInfo.wipes} 个`);
    check('合计占用有实测值', /KB|B/.test(myInfo.total), myInfo.total);
    await shot('16-my-panel');

    // 16e. 单删：点某一行「清除」只清那一项，别的键不受影响
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('[data-wipe]')].find((x) => x.dataset.wipe === 'favs');
      if (b) b.click();
    })()`);
    await sleep(300);
    const afterOne = await evaluate(`({ favs: localStorage.getItem('toolhub:favs'), usage: localStorage.getItem('toolhub:usage') })`);
    check('单删只清那一个键', afterOne.favs === null, 'favs=' + String(afterOne.favs));
    check('单删不误伤同类键', afterOne.usage !== null, 'usage=' + String(afterOne.usage));

    // 16f. 按类清除：清「我的工具」要清掉 favs/recent/compare/sets，但不能动 usage/events
    await evaluate(`(() => {
      localStorage.setItem('toolhub:favs', JSON.stringify(['json-format']));
      localStorage.setItem('toolhub:recent', JSON.stringify(['json-format']));
      localStorage.setItem('toolhub:compare', JSON.stringify(['json-format']));
      localStorage.setItem('toolhub:sets', JSON.stringify({ x: { name: 't', tools: [], at: 1 } }));
    })()`);
    await goto('/my/');
    await waitText('#my-app', '存了什么', 10000);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('[data-group]')].find((x) => x.dataset.group === 'library');
      if (b) b.click();
    })()`);
    await sleep(400);
    const afterGroup = await evaluate(`({
      favs: localStorage.getItem('toolhub:favs'),
      recent: localStorage.getItem('toolhub:recent'),
      compare: localStorage.getItem('toolhub:compare'),
      sets: localStorage.getItem('toolhub:sets'),
      usage: localStorage.getItem('toolhub:usage'),
    })`);
    check(
      '按类清除清掉整组',
      afterGroup.favs === null && afterGroup.recent === null && afterGroup.compare === null && afterGroup.sets === null,
      JSON.stringify(afterGroup)
    );
    check('按类清除不越界（统计还在）', afterGroup.usage !== null, 'usage=' + String(afterGroup.usage));

    // 16g. 自定义集合：新建 → 落进 sets 键
    await goto('/my/');
    await waitText('#my-app', '存了什么', 10000);
    await evaluate(`(() => {
      const i = document.getElementById('my-set-name');
      if (i) { i.value = '测试集合'; }
      const b = document.getElementById('my-set-create');
      if (b) b.click();
    })()`);
    await sleep(300);
    const setShown = await waitText('.my-set', '测试集合', 5000);
    const setStored = await evaluate(`(() => {
      const v = JSON.parse(localStorage.getItem('toolhub:sets') || '{}');
      return Object.values(v).map((s) => s.name);
    })()`);
    check('能新建自定义集合并显示', setShown === true, String(setStored));
    check('集合写进 sets 键', setStored.includes('测试集合'), JSON.stringify(setStored));

    // 16h. 首页入口：这个功能当初做出来没有入口，用户反馈「主页上看不出来」。
    // 这条不测「页面能不能开」（16d 已经直达过了），只测「从首页点得到」——
    // 两者差一个链接，而缺那个链接时所有直达测试都是绿的。
    await goto('/');
    await waitText('body', '为什么本地执行更放心', 10000);
    const entryBox = await evaluate(`(() => {
      const a = document.querySelector('a.ts-link[href="/my/"]');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { text: a.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    check('首页信任区有「我的数据」入口', !!entryBox && /在哪、怎么删/.test(entryBox.text), JSON.stringify(entryBox));
    check('入口可点（面积不为零、不小于 24px 高）', !!entryBox && entryBox.w > 24 && entryBox.h >= 24, JSON.stringify(entryBox));
    await evaluate(`document.querySelector('a.ts-link[href="/my/"]').click()`);
    await sleep(1200);
    const landed = await evaluate(`location.pathname`);
    check('点入口能进 /my/', landed === '/my/', String(landed));
    const panelFromHome = await waitText('#my-app', '存了什么', 10000);
    check('从首页进来面板也渲染', panelFromHome === true);
    await shot('16-my-from-home');

    // 收尾：把测试造的数据清掉，别影响后面依赖空存储的用例
    await evaluate(`['favs','recent','compare','sets','usage','events'].forEach((k) => localStorage.removeItem('toolhub:' + k))`);
  }

  // ---- 汇总 ----
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${bad.length ? '❌' : '✅'} 浏览器测试 ${results.length - bad.length}/${results.length}`);
  if (bad.length) {
    console.log('   失败项：' + bad.map((b) => b.name).join('、'));
  }
  console.log('   截图：' + SHOTS);
  ws.close();
  cleanup();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error('❌ 浏览器测试异常：', e.message);
  cleanup();
  process.exit(1);
});
