#!/usr/bin/env node
// SPA 渲染测试：用最小 DOM 桩加载 app.js，驱动路由并检查关键输出
// 用法：node scripts/spa-render-test.mjs [BASE_URL]
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8899').replace(/\/$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 把 app.js 里的动态 import('/tools/xxx/run.js')（根相对路径或 http URL）映射到本地文件
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(BASE + '/')) {
      const rel = specifier.slice(BASE.length + 1);
      return next('file://' + join(root, rel).replace(/\\/g, '/'), context);
    }
    if (specifier.startsWith('/') && !specifier.startsWith('//')) {
      return next('file://' + join(root, specifier.slice(1)).replace(/\\/g, '/'), context);
    }
    return next(specifier, context);
  },
});

const elements = new Map();
function makeEl(id) {
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    placeholder: '',
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      (this._h = this._h || {})[type] = (this._h[type] || []).concat(fn);
    },
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    offsetWidth: 0,
    isContentEditable: false,
    querySelector: (sel) => (typeof sel === 'string' && sel.startsWith('#') ? document.getElementById(sel.slice(1)) : null),
    querySelectorAll: () => [],
    scrollIntoView() {},
    focus() {},
    closest: () => null,
    insertAdjacentHTML() {},
    appendChild(child) {
      this.children.push(child);
      this.innerHTML += (child && child.innerHTML) || '';
      return child;
    },
    remove() {},
    onclick: null,
  };
  return el;
}
const document = {
  documentElement: { dataset: {}, lang: '' },
  body: makeEl('body'),
  head: makeEl('head'),
  title: '',
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  querySelector: (sel) => (typeof sel === 'string' && sel.startsWith('#') ? document.getElementById(sel.slice(1)) : null),
  querySelectorAll: () => [],
  addEventListener() {},
  // v3.5：工具页样式改成按需 <link> 加载，openTool 会 await 它的 onload。
  // 桩里没人会发网络请求，所以挂上去就立刻「加载完成」——否则那个 await 永远悬着。
  createElement: (tag) => {
    const el = makeEl(tag || 'div');
    if (tag === 'link') setTimeout(() => el.onload && el.onload(), 0);
    return el;
  },
};
const listeners = {};
// href 必须是会跟着 pathname/search 变的 getter：syncUrlState 用 new URL(location.href)
// 读写查询参数，桩里给它一个定值会让「翻页写进 URL」永远测不出来
const location = {
  pathname: '/',
  hash: '',
  search: '',
  origin: 'http://localhost',
  get href() {
    return this.origin + this.pathname + this.search + this.hash;
  },
};
const window = {
  location,
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  matchMedia: () => ({ matches: false }),
  scrollTo() {},
};
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const navigator = { language: 'zh-CN', serviceWorker: { register: () => Promise.resolve() } };

// v3.3：app.js 把工具页拆到独立模块，动态 import 的模块访问的是 globalThis，
// 不再是 new Function 的形参。把同一批桩挂到全局，二者共享同一份 DOM 桩。
// 用 defineProperty 而不是直接赋值：Node 里 navigator / localStorage 可能是只读 getter。
for (const [k, v] of Object.entries({ document, window, location, localStorage, navigator })) {
  try {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  } catch {}
}
try {
  Object.defineProperty(globalThis, 'history', { value: { pushState() {}, replaceState() {} }, configurable: true, writable: true });
} catch {}

// 注入全局并加载 app.js
const rawSrc = await (await import('node:fs')).readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
// 静态 import 在 new Function 体里不合法：剥离 import 行，用空实现桩替代（仅测试环境）
const importRe = /^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm;
const stubLines = [];
const src = rawSrc.replace(importRe, (_m, named) => {
  named
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .forEach((n) => stubLines.push(`const ${n} = () => {};`));
  return '';
});
const srcWithStubs = stubLines.join('\n') + src;
// fetch 桩：直接从本地文件系统读取（根相对路径 → root/ 下同名文件），无需起静态服务器
const relFetch = (url) => {
  const rel = url.startsWith(BASE + '/') ? url.slice(BASE.length + 1) : url.startsWith('/') ? url.slice(1) : null;
  if (!rel) return Promise.reject(new Error('test fetch: 不支持的 URL ' + url));
  try {
    const body = readFileSync(join(root, rel), 'utf8');
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body });
  } catch {
    return Promise.reject(new Error('test fetch 404: ' + url));
  }
};
// content-pages.js / tool-page.js 这些子模块是真的 ESM，拿不到上面注入的 fetch 参数，
// 只能改全局这份；否则它们会去请求真实的 /evaluations/x.json 然后 404。
globalThis.fetch = relFetch;
const fn = new Function('document', 'window', 'location', 'localStorage', 'navigator', 'fetch', 'URLSearchParams', 'history', 'AbortSignal', 'setTimeout', srcWithStubs);
await fn(document, window, location, localStorage, navigator, relFetch, URLSearchParams, { pushState() {}, replaceState() {} }, AbortSignal, setTimeout);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fire(el, type, ev = {}) {
  ((el && el._h && el._h[type]) || []).forEach((fn) => fn(ev));
}
async function waitFor(cond, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await sleep(50);
    if (cond()) return true;
  }
  return false;
}
const routeFn = listeners['popstate']?.[0];
async function go(path) {
  location.pathname = path;
  location.hash = '';
  location.search = '';
  // 先清掉上一页的 DOM：子模块是异步 import + fetch，不清的话「上一页还有内容」
  // 会让下面的等待循环立刻退出，断言读到的是前一页
  const pb = document.getElementById('page-body');
  if (pb) pb.innerHTML = '';
  routeFn && routeFn();
  // 等渲染稳定：连续两次读到相同内容才算完成。只判「非空」不够——内容页要动态
  // import 子模块，上一页的异步渲染可能比这一页晚落地，读到的是别人的内容。
  let last = '';
  for (let i = 0; i < 80; i++) {
    await sleep(50);
    const el = document.getElementById('page-body');
    const h = (el && el.innerHTML) || '';
    if (h.length > 200 && h === last) break;
    last = h;
  }
  await sleep(50);
}
// 1) 评测列表页（v3.13 起是列表行，不再是卡片网格）
await go('/evaluations');
const listHtml = document.getElementById('page-body').innerHTML;
check('评测列表页渲染', listHtml.includes('工具评测') && listHtml.includes('list-row'), `#page-body ${listHtml.length} 字符`);
// 数量跟索引比，不写死。写死的话每加一篇评测都要改测试，改的人图省事就会顺手放宽成 ≥N，
// 断言也就废了。
const evIndexCount = JSON.parse(readFileSync(join(root, 'evaluations.json'), 'utf8')).evaluations.length;
const evCards = (listHtml.match(/class="list-row"/g) || []).length;
check('评测列表行数与索引一致', evCards === evIndexCount, `${evCards} 行 / 索引 ${evIndexCount} 篇`);
check('列表含日期', listHtml.includes('2026-10-24'));

// 1.5) 工具分类页（v3.13 新增：分类从首页筛选参数升级成独立页面）
const catCopy = JSON.parse(readFileSync(join(root, 'content/categories.json'), 'utf8')).categories;
const allTools = [
  ...JSON.parse(readFileSync(join(root, 'tools/tools.json'), 'utf8')).tools,
  ...JSON.parse(readFileSync(join(root, 'tools/directory.json'), 'utf8')).tools,
];
await go('/categories');
const catIndexHtml = document.getElementById('page-body').innerHTML;
check('分类总览渲染', catIndexHtml.includes('工具分类') && catIndexHtml.includes('image'), `#page-body ${catIndexHtml.length} 字符`);
check('分类总览一行一类', (catIndexHtml.match(/class="fl-row"/g) || []).length === catCopy.length, `${catCopy.length} 个分类`);
await go('/categories/image');
const catHtml = document.getElementById('page-body').innerHTML;
const imgCount = allTools.filter((t) => t.category === '图片').length;
check('分类页渲染标题与导语', catHtml.includes('图片工具') && catHtml.includes('适合这些场景'));
check('分类页列出全部同类工具', (catHtml.match(/class="fl-row"/g) || []).length === imgCount, `${imgCount} 个`);
check('分类页含挑选建议与常见问题', catHtml.includes('怎么挑') && catHtml.includes('res-item-note'));
check('分类页互链其余分类', (catHtml.match(/\/categories\//g) || []).length >= catCopy.length);

// 1b) 全部工具页（v3.14）：导航「工具」与首页入口卡的落地页
await go('/tools');
const allHtml = document.getElementById('page-body').innerHTML;
check('全部工具页列全', (allHtml.match(/class="fl-row"/g) || []).length === allTools.length, `${allTools.length} 个`);
check(
  '全部工具页按分类分组',
  (allHtml.match(/class="res-group-title"/g) || []).length >= catCopy.length,
  `${(allHtml.match(/class="res-group-title"/g) || []).length} 组`
);
// 序号全局连续，最后一个必须是总数的两位数 —— 分组渲染最容易在这里错位
check('全部工具页序号连续', allHtml.includes(`>${String(allTools.length).padStart(2, '0')}<`), `末位 ${String(allTools.length).padStart(2, '0')}`);

// 1c) 折腾指南（v3.15）：第三层内容。它和工具页的区别必须在页面上看得出来，
// 否则用户点进来会以为「又是一个工具清单」。
const guideData = JSON.parse(readFileSync(join(root, 'content/guides.json'), 'utf8')).guides;
await go('/guides');
const gIdxHtml = document.getElementById('page-body').innerHTML;
check('指南总览列出全部篇目', (gIdxHtml.match(/class="fl-row"/g) || []).length === guideData.length, `${guideData.length} 篇`);
check('指南总览讲清与工具页的区别', gIdxHtml.includes('门槛完全不同'));

const g0 = guideData[0];
await go('/guides/' + g0.slug);
const gHtml = document.getElementById('page-body').innerHTML;
check('指南页渲染全部步骤', (gHtml.match(/<li><b>/g) || []).length === g0.steps.length, `${g0.steps.length} 步`);
check('指南页含元信息条', gHtml.includes('guide-meta') && gHtml.includes('最后核对'));
check('高风险指南有风险提示块', g0.risk !== 'high' || gHtml.includes('guide-risk'));
check('指南页含回退章节', gHtml.includes('翻车了怎么办'));
check('指南页互链站内工具', (g0.tools || []).every((id) => gHtml.includes('/tools/' + id + '/')));

// 2) 评测详情页
await go('/evaluations/pdf-tools');
const detailHtml = document.getElementById('page-body').innerHTML;
check('详情页渲染标题', detailHtml.includes('PDF 工具横评'), `#page-body ${detailHtml.length} 字符`);
check('详情页含结论框', detailHtml.includes('eval-verdict'));
check('详情页含隐私徽章', detailHtml.includes('pv-badge') && detailHtml.includes('pv-warn'));
check('详情页含优势/短板', detailHtml.includes('eval-pros') && detailHtml.includes('eval-cons'));
check('详情页含相关工具', detailHtml.includes('related-chip'));
check('详情页外链 target=_blank', detailHtml.includes('target="_blank"'));

// 2b) 单款深度测评（v3.12）：正文按篇取 + 使用说明与测试方式都要真的渲染出来
await go('/evaluations/filee-review');
const revHtml = document.getElementById('page-body').innerHTML;
check('单款测评页取到按篇正文', revHtml.includes('Filee 测评') && revHtml.includes('拖拽转换器'), `#page-body ${revHtml.length} 字符`);
check('单款测评标注测试方式', revHtml.includes('怎么测的'));
check('单款测评渲染使用说明', revHtml.includes('怎么用') && (revHtml.match(/<ol/g) || []).length >= 3, `${(revHtml.match(/<ol/g) || []).length} 个步骤组`);

// 3) 新专题页（含目录工具混合引用）
await go('/topics/open-source-alternatives');
const topicHtml = document.getElementById('page-body').innerHTML;
check('开源替代专题渲染', topicHtml.includes('开源替代品清单'), `#page-body ${topicHtml.length} 字符`);
check('专题含 8 个步骤', (topicHtml.match(/class="topic-step"/g) || []).length === 8, `${(topicHtml.match(/class="topic-step"/g) || []).length} 步`);
check('专题目录工具显示「官网」徽章', topicHtml.includes('>官网<'));

// 4) 专题列表页
await go('/topics');
const topicsHtml = document.getElementById('page-body').innerHTML;
check('专题列表渲染 10 个', (topicsHtml.match(/topic-card/g) || []).length === 10, `${(topicsHtml.match(/topic-card/g) || []).length} 个`);

// 5) 首页路由卡（4 张）
await go('/');
const cardsHtml = document.getElementById('route-cards').innerHTML;
check('首页路由卡 4 张', (cardsHtml.match(/route-card/g) || []).length === 4, `${(cardsHtml.match(/route-card/g) || []).length} 张`);
check('首页含评测卡', cardsHtml.includes('/evaluations/'));
// v3.14：工具箱那张卡原来 href="#tools-anchor" 加 onclick 抢默认行为，点了只是滚一下。
// 现在它是真链接——链接语义、右键新开、cmd+点击才都还在。
check('工具箱卡指向 /tools/', /class="route-card rc--tools" href="\/tools\/"[^>]*data-spa/.test(cardsHtml), '入口卡是真链接');
check('入口卡不再只滚动', !cardsHtml.includes('data-scroll'));

// 6) 本地工具页教程板块
await go('/tools/json-format/');
await sleep(400); // 等 run.js 动态 import
// 交互区（#tool-form）在前，教程正文（#tool-docs）在后：先能用，再解释
const formHtml = document.getElementById('tool-form') ? document.getElementById('tool-form').innerHTML : '';
const docsHtml = document.getElementById('tool-docs') ? document.getElementById('tool-docs').innerHTML : '';
check('工具页含使用步骤', docsHtml.includes('使用步骤') && docsHtml.includes('tut-steps'), `#tool-docs ${docsHtml.length} 字符`);
check('工具页含常见错误', docsHtml.includes('常见错误') && docsHtml.includes('pitfall-item'));
check('教程正文排在输入区之后', formHtml.indexOf('run-btn') > -1 && !formHtml.includes('tut-steps'));

// 7) 站内搜索增强：拼音首字母 / 全拼 / 英文别名 / 权重排序 / 命令面板
const searchEl = document.getElementById('search');
searchEl.value = 'qmmsc';
await go('/');
await waitFor(() => document.getElementById('grid').innerHTML.includes('强密码生成'));
let gridHtml = document.getElementById('grid').innerHTML;
check('拼音首字母 qmmsc 搜到强密码生成', gridHtml.includes('强密码生成'));
check('首字母不误中无关工具', !gridHtml.includes('JSON 格式化'));

searchEl.value = 'ewmsc';
await go('/');
await waitFor(() => document.getElementById('grid').innerHTML.includes('二维码生成'));
check('拼音首字母 ewmsc 搜到二维码生成', document.getElementById('grid').innerHTML.includes('二维码生成'));

searchEl.value = 'compress';
await go('/');
await waitFor(() => document.getElementById('grid').innerHTML.includes('图片压缩'));
check('英文别名 compress 搜到图片压缩', document.getElementById('grid').innerHTML.includes('图片压缩'));

searchEl.value = 'json';
await go('/');
await waitFor(() => document.getElementById('grid').innerHTML.includes('JSON 格式化'));
gridHtml = document.getElementById('grid').innerHTML;
const iJson = gridHtml.indexOf('JSON 格式化');
const iCsv = gridHtml.indexOf('CSV ↔ JSON');
check('名称匹配权重最高（搜 json 时 JSON 格式化排最前）', iJson >= 0 && (iCsv < 0 || iJson < iCsv), `格式化@${iJson} CSV@${iCsv}`);

// 命令面板：aliases 进入 keywords
searchEl.value = '';
await go('/');
await waitFor(() => (document.getElementById('palette-results').innerHTML || '').length >= 0);
const palInput = document.getElementById('palette-input');
palInput.value = 'hxjs';
fire(palInput, 'input');
await sleep(120);
const palHtml = document.getElementById('palette-results').innerHTML;
check('命令面板支持拼音首字母', palHtml.includes('哈希计算'), `${palHtml.length} 字符`);
searchEl.value = '';

// 8) 新工具：页面渲染 + onForm 联动 + 多文件输入 + 端到端运行链路
// 8a. 个税计算器页渲染（10 个输入）
await go('/tools/tax-calc/');
await sleep(400);
let taxForm = document.getElementById('tool-form') ? document.getElementById('tool-form').innerHTML : '';
check('个税计算器页渲染', taxForm.includes('税前月薪') && taxForm.includes('累计预扣'), `#tool-form ${taxForm.length} 字符`);
check('个税页含专项附加扣除选项', taxForm.includes('子女教育') && taxForm.includes('赡养老人'));

// 8b. 单位换算 onForm 钩子：类型 → 单位下拉联动
const unitMod = await import('/tools/unit-convert/run.js');
{
  const mk = () => {
    const el = makeEl('x');
    el.closest = () => ({ style: {} });
    return el;
  };
  const catEl = mk();
  const fromEl = mk();
  const toEl = mk();
  catEl.value = 'length';
  const form = { querySelector: (sel) => ({ '#f-cat': catEl, '#f-from': fromEl, '#f-to': toEl })[sel] || null };
  unitMod.onForm(form);
  check('onForm 填充长度单位下拉', fromEl.innerHTML.includes('米 m') && fromEl.innerHTML.includes('英尺 ft'), `${fromEl.innerHTML.length} 字符`);
  check('onForm 默认选中米/英尺', fromEl.value === 'm' && toEl.value === 'ft');
  catEl.value = 'temperature';
  fire(catEl, 'change');
  check('切换类型后联动温度单位', toEl.innerHTML.includes('摄氏度') && toEl.innerHTML.includes('开尔文'));

  // 8c. 单位换算端到端：填值 → 点运行 → 结果
  await go('/tools/unit-convert/');
  await sleep(400);
  document.getElementById('f-cat').value = 'length';
  document.getElementById('f-value').value = '1';
  document.getElementById('f-from').value = 'm';
  document.getElementById('f-to').value = 'ft';
  await document.getElementById('run-btn').onclick();
  await waitFor(() => (document.getElementById('tool-result').innerHTML || '').includes('3.2808399'));
  check('单位换算端到端出结果', document.getElementById('tool-result').innerHTML.includes('3.2808399'));
}

// 8d. PDF 工具 onForm：按模式显隐字段
const pdfMod = await import('/tools/pdf-merge/run.js');
{
  const mk = () => {
    const el = makeEl('x');
    el._field = { style: {} };
    el.closest = () => el._field;
    return el;
  };
  const modeEl = mk();
  const pagesEl = mk();
  const everyEl = mk();
  modeEl.value = 'merge';
  const form = { querySelector: (sel) => ({ '#f-mode': modeEl, '#f-pages': pagesEl, '#f-every': everyEl })[sel] || null };
  pdfMod.onForm(form);
  check('PDF 合并模式隐藏页码/每份页数', pagesEl._field.style.display === 'none' && everyEl._field.style.display === 'none');
  modeEl.value = 'extract';
  fire(modeEl, 'change');
  check('提取模式显示页码范围', pagesEl._field.style.display === '' && everyEl._field.style.display === 'none');
  modeEl.value = 'split';
  fire(modeEl, 'change');
  check('拆分模式显示每份页数', everyEl._field.style.display === '');
  check('PDF 页含多选文件输入', (await import('node:fs')).readFileSync(new URL('../tools/pdf-merge/run.js', import.meta.url), 'utf8').includes('multiple: true'));
}

// 8e. 个税端到端：填值 → 点运行 → 结果含计算明细
await go('/tools/tax-calc/');
await sleep(400);
document.getElementById('f-salary').value = '15000';
document.getElementById('f-month').value = '10';
document.getElementById('f-social').value = '2500';
document.getElementById('f-kids').value = '2000';
document.getElementById('f-toddlers').value = '0';
document.getElementById('f-elder').value = '0';
document.getElementById('f-housing').value = '1500';
document.getElementById('f-edu').value = '0';
document.getElementById('f-other').value = '0';
await document.getElementById('run-btn').onclick();
await waitFor(() => (document.getElementById('tool-result').innerHTML || '').includes('累计计算明细'));
check('个税端到端出结果', document.getElementById('tool-result').innerHTML.includes('¥400.00'), '本月个税 400');

// 8f. 房贷端到端 + 时区端到端
await go('/tools/mortgage-calc/');
await sleep(400);
document.getElementById('f-amount').value = '100';
document.getElementById('f-rate').value = '3.5';
document.getElementById('f-years').value = '30';
document.getElementById('f-mode').value = 'equal-payment';
await document.getElementById('run-btn').onclick();
await waitFor(() => (document.getElementById('tool-result').innerHTML || '').includes('每月还款额'));
check('房贷端到端出月供', document.getElementById('tool-result').innerHTML.includes('¥4,490.45'), '100 万 / 3.5% / 30 年');

await go('/tools/timezone-convert/');
await sleep(400);
document.getElementById('f-datetime').value = '2026-10-25 20:00';
document.getElementById('f-zone').value = 'Asia/Shanghai';
await document.getElementById('run-btn').onclick();
await waitFor(() => (document.getElementById('tool-result').innerHTML || '').includes('当地时间'));
check('时区端到端出对照表', document.getElementById('tool-result').innerHTML.includes('2026-10-25 08:00'), '纽约 08:00');

// 8g. 新工具的搜索别名
const search2 = document.getElementById('search');
search2.value = 'fdjsq';
await go('/');
await waitFor(() => document.getElementById('grid').innerHTML.includes('房贷计算器'));
check('搜索 fdjsq 命中房贷计算器', document.getElementById('grid').innerHTML.includes('房贷计算器'));
search2.value = 'shiqu';
await go('/');
await waitFor(() => document.getElementById('grid').innerHTML.includes('时区转换'));
check('搜索 shiqu 命中时区转换', document.getElementById('grid').innerHTML.includes('时区转换'));
search2.value = '';

// 9) v3.0：两个新说明页 + 自然语言入口
// 9a. /offline/ 页：说明文字必须把「安装」与「离线」的区别讲清楚，别让用户以为装了应用就能断网
await go('/offline/');
await sleep(300);
{
  const offHtml = document.getElementById('page-body').innerHTML;
  check('/offline/ 页渲染', offHtml.includes('离线包与安装') && offHtml.includes('包含与不包含'), `#page-body ${offHtml.length} 字符`);
  check('/offline/ 页区分安装与离线', offHtml.includes('两个概念别混淆') && offHtml.includes('缓存优先'));
  check('/offline/ 页声明不含 Python 运行时', offHtml.includes('Python 运行时') && /不包含<\/b>：Python/.test(offHtml));
  check('/offline/ 页有挂载点', offHtml.includes('id="offline-app"'));
}

// 9b. /batch/ 页
await go('/batch/');
await sleep(300);
{
  const batchHtml = document.getElementById('page-body').innerHTML;
  check('/batch/ 页渲染', batchHtml.includes('批量处理图片') && batchHtml.includes('batch-app'), `#page-body ${batchHtml.length} 字符`);
  check('/batch/ 页链接到单图工具', batchHtml.includes('/tools/image-compress/') && batchHtml.includes('/tools/image-resize/'));
}

// 9c. 命令面板：一句中文 → 「也许你要」+ 预填参数
await go('/');
searchEl.value = '';
const palIn = document.getElementById('palette-input');
palIn.value = '把这张图压到 200KB';
fire(palIn, 'input');
await waitFor(() => (document.getElementById('palette-results').innerHTML || '').includes('也许你要'), 20);
{
  const ip = document.getElementById('palette-results').innerHTML;
  check('命令面板给出「也许你要」', ip.includes('也许你要') && ip.includes('图片压缩'), `${ip.length} 字符`);
  check('意图项带出预填参数', ip.includes('quality=60'), '压到 200KB → 质量 60');
  // 第一条必须是意图项，而不是被普通搜索结果淹没
  check('意图项排在最前', ip.indexOf('也许你要') < (ip.indexOf('pal-name') || 1e9) || ip.indexOf('也许你要') < ip.indexOf('图片压缩'));
}

// 9d. 不像句子的输入不该硬套意图（避免每次搜索都多出一行噪音）
palIn.value = 'json';
fire(palIn, 'input');
await sleep(150);
check('短关键词不触发意图', !(document.getElementById('palette-results').innerHTML || '').includes('也许你要'));
palIn.value = '';
await go('/');

// 汇总
let pass = 0;
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
  if (r.ok) pass++;
}
console.log(`\n${pass === results.length ? '✅' : '❌'} SPA 渲染测试 ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
