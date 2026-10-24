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
    querySelector: (sel) => (typeof sel === 'string' && sel.startsWith('#') ? document.getElementById(sel.slice(1)) : null),
    querySelectorAll: () => [],
    scrollIntoView() {},
    focus() {},
    closest: () => null,
    insertAdjacentHTML() {},
    remove() {},
    onclick: null,
  };
  return el;
}
const document = {
  documentElement: { dataset: {}, lang: '' },
  body: makeEl('body'),
  title: '',
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  querySelector: (sel) => (typeof sel === 'string' && sel.startsWith('#') ? document.getElementById(sel.slice(1)) : null),
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => makeEl('div'),
};
const listeners = {};
const location = { pathname: '/', hash: '', search: '' };
const window = {
  location,
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  matchMedia: () => ({ matches: false }),
  scrollTo() {},
};
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const navigator = { language: 'zh-CN', serviceWorker: { register: () => Promise.resolve() } };

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
const fn = new Function('document', 'window', 'location', 'localStorage', 'navigator', 'fetch', 'URLSearchParams', 'history', 'AbortSignal', 'setTimeout', srcWithStubs);
await fn(document, window, location, localStorage, navigator, relFetch, URLSearchParams, { pushState() {} }, AbortSignal, setTimeout);

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
  routeFn && routeFn();
  // 等异步渲染完成（fetch + 微任务）
  for (let i = 0; i < 40; i++) {
    await sleep(50);
    const el = document.getElementById('page-body');
    if (el && el.innerHTML && el.innerHTML.length > 200) break;
  }
  await sleep(150);
}
// 1) 评测列表页
await go('/evaluations');
const listHtml = document.getElementById('page-body').innerHTML;
check('评测列表页渲染', listHtml.includes('工具评测') && listHtml.includes('topic-card'), `#page-body ${listHtml.length} 字符`);
check('列表含 5 篇评测卡', (listHtml.match(/topic-card/g) || []).length === 5, `${(listHtml.match(/topic-card/g) || []).length} 张卡`);
check('列表含日期', listHtml.includes('2026-10-24'));

// 2) 评测详情页
await go('/evaluations/pdf-tools');
const detailHtml = document.getElementById('page-body').innerHTML;
check('详情页渲染标题', detailHtml.includes('PDF 工具横评'), `#page-body ${detailHtml.length} 字符`);
check('详情页含结论框', detailHtml.includes('eval-verdict'));
check('详情页含隐私徽章', detailHtml.includes('pv-badge') && detailHtml.includes('pv-warn'));
check('详情页含优势/短板', detailHtml.includes('eval-pros') && detailHtml.includes('eval-cons'));
check('详情页含相关工具', detailHtml.includes('related-chip'));
check('详情页外链 target=_blank', detailHtml.includes('target="_blank"'));

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

// 6) 本地工具页教程板块
await go('/tools/json-format/');
await sleep(400); // 等 run.js 动态 import
const toolHtml = document.getElementById('tool-form') ? document.getElementById('tool-form').innerHTML : '';
check('工具页含使用步骤', toolHtml.includes('使用步骤') && toolHtml.includes('tut-steps'), `#tool-form ${toolHtml.length} 字符`);
check('工具页含常见错误', toolHtml.includes('常见错误') && toolHtml.includes('pitfall-item'));

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

// 汇总
let pass = 0;
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
  if (r.ok) pass++;
}
console.log(`\n${pass === results.length ? '✅' : '❌'} SPA 渲染测试 ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
