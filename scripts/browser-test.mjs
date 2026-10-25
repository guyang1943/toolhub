#!/usr/bin/env node
// 真浏览器端到端测试：驱动本机 Edge/Chrome 无头实例（CDP），
// 验证真实 DOM 交互、控制台错误、资源 4xx、文件上传链路。
// 用法：node scripts/browser-test.mjs [http://127.0.0.1:8766]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:8766').replace(/\/$/, '');
const PORT = 9333 + Math.floor(Math.random() * 200);
const PROFILE = join(tmpdir(), 'toolhub-btest-' + Date.now());
const SHOTS = join(root, '.tmp-shots');

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
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
  '--hide-scrollbars',
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' });

let cdp = null;
let pageErrors = [];
let netFails = [];

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

  cdp.on((msg) => {
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

  // ---- 1. 首页 ----
  await goto('/');
  const cards = await evaluate(`document.querySelectorAll('#grid [data-id]').length`);
  check('首页渲染工具卡片', cards >= 30, cards + ' 张');
  check('首页无控制台错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  check('首页无 4xx 资源', netFails.length === 0, netFails.slice(0, 2).join(' | '));
  const heroText = await evaluate(`(document.querySelector('.hero-search-hint') || {}).textContent || ''`);
  check('首页计数文案正确', heroText.includes('93 个工具'), heroText.trim());
  await shot('01-home');

  // ---- 2. 键盘操作（真实键盘事件）----
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', text: '/', windowsVirtualKeyCode: 191 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
  await sleep(350);
  const slashFocus = await evaluate(`document.activeElement.id`);
  check('按 / 聚焦搜索框', slashFocus === 'search', String(slashFocus));

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
  try {
    const py = 'C:/Users/huwei/.workbuddy/binaries/python/versions/3.13.12/python.exe';
    const out = join(tmpdir(), 'toolhub-qr-' + Date.now() + '.png');
    execFileSync(py, ['-c', `
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
  const allNum = await evaluate(`document.querySelectorAll('#grid .card').length`);
  await evaluate(`document.querySelector('#filterbar [data-rt="local"]').click()`);
  await sleep(500);
  const localNum = await evaluate(`document.querySelectorAll('#grid .card').length`);
  check('仅本机执行筛出 33 个', localNum === 33, `${localNum} / 全部 ${allNum}`);
  const qs = await evaluate(`location.search`);
  check('筛选状态写入 URL', qs.includes('runtime=local'), qs);
  await evaluate(`document.querySelector('#filterbar [data-rt="offline"]').click()`);
  await sleep(500);
  const offNum = await evaluate(`document.querySelectorAll('#grid .card').length`);
  check('断网也能用少于本机执行', offNum > 0 && offNum < localNum, `${offNum} 个`);
  await cdp.send('Page.reload');
  await sleep(1200);
  const kept = await evaluate(
    `(document.querySelector('#filterbar [data-rt="offline"]') || {}).className || ''`
  );
  const keptNum = await evaluate(`document.querySelectorAll('#grid .card').length`);
  check('刷新后筛选保持', String(kept).includes('active') && keptNum === offNum, `${keptNum} 个 · ${kept.includes('active')}`);
  await evaluate(`document.querySelector('#filterbar [data-sort="used"]').click()`);
  await sleep(400);
  const sortQs = await evaluate(`location.search`);
  check('排序状态写入 URL', sortQs.includes('sort=used'), sortQs);
  await goto('/');

  // ---- 9.6 结果统一出口（v2.6 A3）----
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
    const fed = await evaluate(`(() => { const el = document.getElementById('f-files'); return el && el.files ? el.files.length : -1; })()`);
    check('接力把上一步产物填进文件输入', fed >= 1, fed + ' 个文件');
    check('接力后显示来源提示', (await evaluate(`!!document.querySelector('.pipe-note')`)) === true);
    await clickRun();
    const pdfDone = await waitText('#tool-result', 'PDF', 25000);
    const pdfTxt = await evaluate(`(document.getElementById('tool-result').textContent || '').slice(0, 120)`);
    check('接力后直接产出 PDF', pdfDone, pdfTxt.replace(/\s+/g, ' '));
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
