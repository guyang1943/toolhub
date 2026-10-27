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
  await sleep(900);
  if (swDropped) console.log('   （已清掉 ' + swDropped + ' 个旧 Service Worker 注册）');
  const cards = await evaluate(`document.querySelectorAll('#grid [data-id]').length`);
  check('首页渲染工具卡片（一页 24）', cards === 24, cards + ' 张');
  check('首页无控制台错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  check('首页无 4xx 资源', netFails.length === 0, netFails.slice(0, 2).join(' | '));
  const heroText = await evaluate(`(document.querySelector('.hero-search-hint') || {}).textContent || ''`);
  check('首页计数文案正确', heroText.includes(`${TOTAL_TOOLS} 个工具`), heroText.trim());
  // v3.5：工具页样式拆成独立文件后，首页绝不能把它捎上——不然拆了个寂寞
  const homeHasToolCss = await evaluate(`!!document.querySelector('link[href="/assets/style.tool.css"]')`);
  check('首页不加载工具页样式', homeHasToolCss === false);
  await shot('01-home');

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
  const toggled = await evaluate(`(() => {
    const b = document.getElementById('analytics-optout');
    if (!b) return 'missing';
    b.click();
    return localStorage.getItem('toolhub:no-analytics');
  })()`);
  check('可在本机关闭统计', toggled === '1', 'localStorage=' + toggled);
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
