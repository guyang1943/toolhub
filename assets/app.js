// ToolHub 主逻辑 v0.6：注册表 → 渲染 → hash 路由（Manifest 驱动表单）
// 新增：深色模式 / 收藏 / URL 分类状态 / 关于与提交页 / 快捷键 / 回顶
import { setProgressHandler } from '/assets/pyodide-runtime.js';
import { CHAINS, setHandoff, takeHandoff } from '/assets/pipeline.js';
import * as store from '/assets/lib/store.js';
let REGISTRY = null;
let I18N = null;
let D18N = null; // 工具详情页英文内容
// v3.22：存储统一走 store（脏数据兜错 + 版本迁移）。迁移必须在任何读取之前跑完——
// 老用户的 theme/lang 存的是裸字符串，晚一步就会被 JSON.parse 判成脏数据，静默退回默认值。
store.migrate();
let LANG = store.get('lang', 'zh');
let activeCategory = '全部';
// 运行时筛选与排序：状态同步到 URL，刷新/分享后保持
const QS0 = new URLSearchParams(location.search);
let activeRuntime = ['local', 'offline'].includes(QS0.get('runtime')) ? QS0.get('runtime') : 'all';
let activeSort = ['used', 'new'].includes(QS0.get('sort')) ? QS0.get('sort') : 'default';
// v3.4：分类也读回 URL。之前只写不读，?cat=图片 刷新后会被丢回「全部」
activeCategory = QS0.get('cat') || '全部';
// v3.4 分页：每页 24 个（宽屏 5 列 × 5 行，窄屏 4 列 × 6 行都不留孤行）。
// 94 个工具一次性铺开是 20 多行、页面 7000px，页脚的信任说明与「更多」全被埋了。
const PAGE_SIZE = 24;
const FEATURED_MAX = 10;
let curPage = Math.max(1, parseInt(QS0.get('page') || '1', 10) || 1);
// 需要运行时下载大依赖的工具（首次访问联网后即可离线）
const NEEDS_FIRST_FETCH = new Set(['pdf-merge', 'img-to-pdf', 'qr-decode', 'python-run', 'py-stats', 'pandas-csv']);
const isLocalTool = (tool) => tool.runtime !== 'link';
const isOfflineTool = (tool) => tool.runtime === 'browser' && !NEEDS_FIRST_FETCH.has(tool.id);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SITE = 'ToolHub · 本地执行的开源在线工具';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- 统一状态块（v3.3）----------
   空态 / 加载态 / 错误态以前各写各的（div.empty、div.msg-err 混用），
   留白、字重、语义都不一致。这里收敛成一个函数，工具页、页面不存在、
   模块加载失败都调用它，视觉与语义由 .state 一套 CSS 决定。 */
function stateHTML(kind, { title = '', detail = '', icon = '', inline = false } = {}) {
  const ic = icon || (kind === 'error' ? '⚠️' : kind === 'loading' ? '' : '📭');
  const head =
    kind === 'loading'
      ? '<span class="state-spinner" aria-hidden="true"></span>'
      : `<span class="state-icon" aria-hidden="true">${ic}</span>`;
  const t = title ? `<div class="state-title">${esc(title)}</div>` : '';
  const d = detail ? `<div class="state-detail">${esc(detail)}</div>` : '';
  const cls = 'state' + (kind === 'error' ? ' state--error' : '') + (inline ? ' state--inline' : '');
  return `<div class="${cls}" role="${kind === 'error' ? 'alert' : 'status'}">${head}${t}${d}</div>`;
}

/* ---------- i18n ---------- */
async function loadI18n() {
  if (LANG !== 'en') return;
  if (!I18N) {
    try {
      I18N = (await (await fetch('/i18n.json')).json()).en;
    } catch {
      I18N = { ui: {}, cats: {}, tasks: [], tools: {} };
    }
  }
  if (!D18N) {
    try {
      D18N = (await (await fetch('/i18n-detail.json')).json()).en;
    } catch {
      D18N = {};
    }
  }
  // 头部导航、页脚、logo 副标这些每页都有的静态文案走 data-zh / data-en 双写。
  // 放在这里统一刷一遍：任何页面进到 loadI18n 都能拿到英文导航，不用每页各记一次。
  applyBilingual();
}
// UI 文案：传中文原文，英文模式取翻译
function t(zh, key) {
  if (LANG !== 'en' || !I18N) return zh;
  return (I18N.ui && I18N.ui[key]) || zh;
}
function catName(c) {
  if (LANG !== 'en' || !I18N) return c;
  return (I18N.cats && I18N.cats[c]) || c;
}
function toolMeta(tool) {
  if (LANG !== 'en' || !I18N) return { name: tool.name, desc: tool.desc };
  const ov = I18N.tools && I18N.tools[tool.id];
  return { name: (ov && ov.name) || tool.name, desc: (ov && ov.desc) || tool.desc };
}
function taskList() {
  if (LANG !== 'en' || !I18N || !I18N.tasks.length) {
    return [
      { label: '🖼️ 图片处理', kw: '图片' }, { label: '📄 PDF 与文档', kw: 'pdf' },
      { label: '🔐 编解码与加密', kw: '编码' }, { label: '🧪 调试接口', kw: 'jwt' },
      { label: '📊 数据转换', kw: 'json' }, { label: '✍️ 写文档', kw: 'markdown' },
      { label: '🎨 画图设计', kw: '颜色' }, { label: '🧠 跑代码', kw: 'python' },
    ];
  }
  return I18N.tasks;
}
async function switchLang() {
  LANG = LANG === 'en' ? 'zh' : 'en';
  store.set('lang', LANG);
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';  $('#lang-btn').textContent = LANG === 'en' ? '🌐 中' : '🌐 EN';
  document.title = LANG === 'en' ? 'ToolHub · Open-source tools, ready to use' : SITE;
  await loadI18n();
  applyStaticText();
  route();
}
function applyStaticText() {
  const ph = t('搜索工具…（按 / 快速聚焦）', 'searchPlaceholder');
  // 窄屏放不下括号提示，截断会在半个括号处断开，直接去掉
  const cut = Math.min(...[ph.indexOf('（'), ph.indexOf('(')].filter((i) => i > 0));
  const short = Number.isFinite(cut) ? ph.slice(0, cut).trim() : ph;
  $('#search').placeholder = window.innerWidth < 600 ? short : ph;
  $('#foot-note').innerHTML = t(
    '🔒 本地工具的数据仅在您的浏览器中处理，不会上传 · 🌐 目录工具均为第三方开源项目，版权与内容归各项目所有，来源仓库见工具卡片',
    'footerNote'
  );
  applyBilingual();
}

// 纯静态区块（快捷键帮助等）走 data-zh / data-en 双写，切语言时批量替换
function applyBilingual() {
  const en = LANG === 'en';
  document.querySelectorAll('[data-zh]').forEach((el) => {
    const v = en ? el.dataset.en : el.dataset.zh;
    if (v) el.textContent = v;
  });
  document.querySelectorAll('[data-zh-aria]').forEach((el) => {
    const v = en ? el.dataset.enAria : el.dataset.zhAria;
    if (v) el.setAttribute('aria-label', v);
  });
}
$('#lang-btn') && $('#lang-btn').addEventListener('click', switchLang);
if (LANG === 'en') {
  document.documentElement.lang = 'en';
  $('#lang-btn').textContent = '🌐 中';
  document.title = 'ToolHub · Open-source tools, ready to use';
}

/* ---------- 主题 ---------- */
/* ---------- 访问统计（v2.9 D3：多后端 + 可退出） ---------- */
// 默认 provider=none，页面零第三方请求。开启后也只加载一个脚本，无 cookie、不跨站跟踪。
function analyticsOptedOut() {
  return store.get('no-analytics', false) === true;
}

async function initAnalytics() {
  // 断网 / 用户主动退出 / DNT：三种情况都直接返回，连配置都不读了
  if (navigator.onLine === false || analyticsOptedOut()) return;
  let cfg;
  try {
    cfg = await (await fetch('/analytics.json', { cache: 'no-store' })).json();
  } catch {
    return; // 配置缺失时静默跳过，不影响站点功能
  }
  const provider = cfg && cfg.provider;
  if (!provider || provider === 'none') return;
  if (cfg.honorDNT !== false && (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1')) return;

  const add = (src, attrs = {}) => {
    const s = document.createElement('script');
    s.defer = true;
    s.src = src;
    s.setAttribute('data-toolhub-analytics', provider);
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    document.head.appendChild(s);
  };

  try {
    if (provider === 'cloudflare' && cfg.token) {
      add('https://static.cloudflareinsights.com/beacon.min.js', {
        'data-cf-beacon': JSON.stringify({ token: cfg.token }),
      });
    } else if (provider === 'plausible' && cfg.domain) {
      add(cfg.scriptUrl || 'https://plausible.io/js/script.js', { 'data-domain': cfg.domain });
    } else if (provider === 'umami' && cfg.scriptUrl && cfg.token) {
      add(cfg.scriptUrl, { 'data-website-id': cfg.token });
    } else {
      return; // 配置不完整：宁可不统计，也不要发出半残请求
    }
    window.__TOOLHUB_ANALYTICS__ = provider;
  } catch {
    /* 统计失败绝不能影响工具本身 */
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1219' : '#2563eb');
  const btn = $('#theme-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = store.get('theme');
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (sysDark ? 'dark' : 'light'));
}
$('#theme-btn') && $('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store.set('theme', next);
});
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store.set('theme', next);
}
initTheme();
initAnalytics();

/* ---------- 收藏 ---------- */
const favs = () => store.get('favs', []);
function toggleFav(id, btn) {
  const list = favs();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  store.set('favs', list);
  btn.classList.toggle('on', i < 0);
  btn.textContent = i < 0 ? '★' : '☆';
  renderChips(REGISTRY.categories);
}

/* ---------- 注册表 ---------- */
// 静态页面里为爬虫准备的正文：取出「它解决什么问题 … 常见问题」这一段留给 SPA 复用，
// 目录工具页正文较长，删掉可惜；其余（来源、官网地址、返回链接）交给 SPA 自己渲染。
let SEO_BODY = '';
const seoStatic = document.getElementById('seo-static');
if (seoStatic) {
  const html = seoStatic.innerHTML;
  const from = html.indexOf('<h2>它解决什么问题</h2>');
  const to = html.indexOf('<h2>相关阅读</h2>');
  if (from >= 0) SEO_BODY = html.slice(from, to > from ? to : undefined);
  seoStatic.remove();
}

async function loadRegistry() {
  if (REGISTRY) return REGISTRY;
  const local = await (await fetch('/tools/tools.json')).json();
  let dir = { tools: [] };
  try {
    // v3.32：取启动副本（证据字段只有构建期读，见 scripts/lib/directory-boot.mjs）。
    dir = await (await fetch('/tools/directory-boot.json')).json();
  } catch (e) {
    /* 目录可选，缺失不阻塞 */
  }
  REGISTRY = {
    ...local,
    categories: [...new Set([...local.categories, ...dir.tools.map((t) => t.category)])],
    // v3.25：目录工具保留真实运行位置（runsOn），卡片不能一律叫「在线直达」——
    // Ollama 要装客户端、Dify 要自己部署，写成在线直达就是新的口径错误
    // （v3.17 在详情页已经分开了，卡片一直没跟上）。
    tools: [...local.tools, ...dir.tools.map((t) => ({ ...t, runsOn: t.runtime, runtime: 'link' }))],
    counts: { local: local.tools.length, dir: dir.tools.length },
  };
  return REGISTRY;
}

/* ---------- 搜索别名：按需加载（v3.30，还 v3.27 欠下的那 2.1 KB） ----------
   别名（拼音全拼 / 首字母 / 英文词）不再压首屏，搬进 /tools/aliases.json；第一次「要搜」时才取，
   取完补触发一次筛选——不补的话，第一次搜拼音会先看到空结果，用户以为搜不到。 */
let ALIAS_PROMISE = null;
let ALIAS_READY = false; // 到货（含失败）就置真：空态据此区分「还没有」和「没有」
function loadAliases() {
  if (!ALIAS_PROMISE) {
    ALIAS_PROMISE = fetch('/tools/aliases.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((map) => {
        // haystack() 把结果缓存在 __hay 上，换别名必须一起清掉
        for (const t of REGISTRY ? REGISTRY.tools : []) if (map[t.id]) (t.aliases = map[t.id]), (t.__hay = null);
        ALIAS_READY = true;
        return true;
      })
      .catch(() => ((ALIAS_READY = true), false)); // 失败也置真：空态不再显示「加载中」，也别每次按键都打一轮请求
  }
  return ALIAS_PROMISE;
}
function ensureAliases() {
  if (ALIAS_PROMISE) return; // 已取过（或在路上）：只触发一次
  loadAliases().then((ok) => {
    if (!ok || !REGISTRY) return;
    if (RES) PALETTE.items = buildPaletteItems(REGISTRY, RES, EVALDATA); // 面板条目里也带别名
    const q = (($('#search') || {}).value || (document.getElementById('hero-search') || {}).value || '').trim();
    if (q) {
      curPage = 1;
      renderFeatured(REGISTRY.tools);
      renderGrid(REGISTRY.tools, q);
    }
  });
}

const CAT_ICONS = { 文本: '📝', 图片: '🖼️', 文档: '📄', 数据: '📊', 开发: '⚙️', 设计: '🎨', 音视频: '🎵', 效率: '⚡', 网络: '🌐', AI: '🤖' };

// 目录工具的数据边界标注。键名须与 scripts/lib/tool-meta.mjs 的 PRIVACY_KINDS 一致。
// v3.21 加 p2p：文件在两台设备之间直传，和「本机处理」不是一回事——东西确实出了这台机器。
const PV = { local: ['本机处理', 'privacyLocal'], p2p: ['点对点', 'privacyP2P'], upload: ['会上传', 'privacyUpload'], optional: ['看用法', 'privacyOptional'], unknown: ['未核实', 'privacyUnknown'] };
const privBadge = (x) => { const p = PV[x.privacy] || PV.unknown; return t(p[0], p[1]); };

// 目录工具的位置徽标（v3.25）。文字与形状区分，不靠颜色——色觉障碍用户靠的也是这几个字。
// 键名与 scripts/lib/tool-meta.mjs 的 RUNTIME_KINDS 一致，多出来的档位会落到 web。
const RUNS = {
  web: ['🌐 在线直达', 'badgeLink'],
  desktop: ['💻 需安装客户端', 'badgeClient'],
  selfhost: ['🐳 需自行部署', 'badgeSelfhost'],
  cli: ['⌨️ 需安装命令行', 'badgeCli'],
  extension: ['🧩 编辑器扩展', 'badgeExt'],
  mobile: ['📱 需安装 App', 'badgeMobile'],
};
// 「需 API Key」是第二个维度：Cline 装在编辑器里，但仍要你自备模型凭据。
// 压成一个徽标就会丢掉「程序在本地」这个事实。
const accessText = (x) => {
  const r = RUNS[x.runsOn] || RUNS.web;
  return t(r[0], r[1]) + (x.keyRequired ? ' · ' + t('🔑 需 API Key', 'badgeKey') : '');
};

/* ---------- 首页 ---------- */
// 分类页地址。取不到 slug 时退回旧的 ?cat= 筛选（tools.json 没更新也不会给出死链）
function catUrl(c) {
  const slug = REGISTRY && REGISTRY.categorySlugs && REGISTRY.categorySlugs[c];
  return slug ? '/categories/' + slug + '/' : '/?cat=' + encodeURIComponent(c);
}

function renderChips(categories) {
  const hasFav = favs().length > 0;
  const hasUsage = Object.keys(usageMap()).length > 0;
  // v3.13：左边三个是「筛选状态」，右边九个分类是「去哪一页」——分类已经有独立页面，
  // 再做成筛选按钮，用户永远不知道那张清单可以被单独分享或被搜到。
  const filters = [
    { key: '全部', label: t('全部', 'all') },
    ...(hasUsage ? [{ key: '🔥 最常用', label: t('🔥 最常用', 'mostUsed') }] : []),
    ...(hasFav ? [{ key: '⭐ 收藏', label: t('⭐ 收藏', 'favorites') }] : []),
  ];
  $('#chips').innerHTML =
    filters
      .map((c) => `<button class="chip ${c.key === activeCategory ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`)
      .join('') +
    categories
      .map((c) => `<a class="chip ${c === activeCategory ? 'active' : ''}" data-spa href="${catUrl(c)}">${CAT_ICONS[c] || ''} ${catName(c)}</a>`)
      .join('') +
    // 收尾给一个总览入口，否则 /categories/ 只有分类页之间互链才到得了
    `<a class="chip" data-spa href="/categories/">${t('🗂️ 分类总览 →', 'catAll')}</a>`;
  $$('#chips .chip[data-cat]').forEach((el) => {
    el.onclick = () => {
      activeCategory = el.dataset.cat;
      curPage = 1; // 换分类回到第一页，否则可能停在已不存在的第 4 页
      syncUrlState();
      renderHome();
    };
  });
  // 走 SPA 跳转：整页刷新会白屏一次，而分类页的正文本来就在内存里能拼出来
  bindSpaLinks('#chips');
}

// 筛选、排序、分类、页码一并写入 URL（不产生历史记录，刷新/分享后保持）
function syncUrlState() {
  const url = new URL(location.href);
  if (activeRuntime === 'all') url.searchParams.delete('runtime');
  else url.searchParams.set('runtime', activeRuntime);
  if (activeSort === 'default') url.searchParams.delete('sort');
  else url.searchParams.set('sort', activeSort);
  if (activeCategory === '全部') url.searchParams.delete('cat');
  else url.searchParams.set('cat', activeCategory);
  if (curPage <= 1) url.searchParams.delete('page');
  else url.searchParams.set('page', String(curPage));
  history.replaceState(null, '', url);
}

function renderFilterbar() {
  const bar = $('#filterbar');
  if (!bar) return;
  const rts = [
    { key: 'all', label: t('全部', 'filterAll') },
    { key: 'local', label: t('🔒 仅本机执行', 'filterLocal') },
    { key: 'offline', label: t('📴 断网也能用', 'filterOffline') },
  ];
  const sorts = [
    { key: 'default', label: t('默认', 'sortDefault') },
    { key: 'used', label: t('🔥 最常用', 'sortUsed') },
    { key: 'new', label: t('🆕 最近收录', 'sortUpdated') },
  ];
  bar.innerHTML =
    `<span class="fb-label">${t('运行方式', 'filterRuntime')}</span>` +
    rts.map((x) => `<button type="button" class="chip ${activeRuntime === x.key ? 'active' : ''}" data-rt="${x.key}">${x.label}</button>`).join('') +
    `<span class="fb-sep"></span><span class="fb-label">${t('排序', 'sortBy')}</span>` +
    sorts.map((x) => `<button type="button" class="chip ${activeSort === x.key ? 'active' : ''}" data-sort="${x.key}">${x.label}</button>`).join('') +
    `<span class="fb-count" id="fb-count"></span>`;
  bar.querySelectorAll('[data-rt]').forEach((el) => {
    el.onclick = () => {
      activeRuntime = el.dataset.rt;
      curPage = 1;
      syncUrlState();
      renderHome();
    };
  });
  bar.querySelectorAll('[data-sort]').forEach((el) => {
    el.onclick = () => {
      activeSort = el.dataset.sort;
      curPage = 1;
      syncUrlState();
      renderHome();
    };
  });
}

function cardHTML(tool) {
  const isLocal = tool.runtime !== 'link';
  const badge = isLocal
    ? `<span class="badge local">${t('🔒 本地运行', 'badgeLocal')}</span>`
    : `<span class="badge link">${accessText(tool)} · ${privBadge(tool)}</span>`;
  const icon = CAT_ICONS[tool.category] || '🧰';
  const hot = tool.hot ? '<span class="badge hot">🔥</span>' : '';
  const isFav = favs().includes(tool.id);
  const used = usageMap()[tool.id] || 0;
  const usedTag = used ? `<span class="used-tag">${t('用过', 'used')} ${used} ${t('次', 'times')}</span>` : '';
  const m = toolMeta(tool);
  const star = isLocal
    ? `<button class="star ${isFav ? 'on' : ''}" data-fav="${tool.id}" title="收藏">${isFav ? '★' : '☆'}</button>`
    : '';
  // 目录工具：卡片点击进站内页（利于收录），右侧 ↗ 直接打开官网
  const go = isLocal ? '' : `<a class="go-btn" href="${esc(tool.url)}" target="_blank" rel="noopener" title="直接打开官网">↗</a>`;
  return `
  <div class="card" data-id="${tool.id}">
    ${star}${go}
    <div class="card-top"><span class="cat-icon">${icon}</span><span class="card-name">${m.name} ${hot}</span></div>
    <div class="desc">${m.desc}</div>
    <div class="meta"><span class="badge">${catName(tool.category)}</span>${badge}${usedTag}</div>
  </div>`;
}

// 让 div 之类的非交互元素变成键盘可达的「链接」（Enter / Space 触发）
function kbLink(el, handler) {
  el.onclick = handler;
  if (!el.hasAttribute('tabindex')) {
    el.tabIndex = 0;
    el.setAttribute('role', 'link');
  }
  el.addEventListener('keydown', (ev) => {
    if (ev.target !== el) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      handler();
    }
  });
  return el;
}

// 只接管标了 data-spa 的站内链接。不做全站 a 拦截：外部链接、下载链接、
// target=_blank 都在同一个文档里，一个粗暴的委托很容易把不该拦的也拦掉。
function bindSpaLinks(scope) {
  $$(scope + ' a[data-spa]').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      navigate(el.getAttribute('href'));
    };
  });
}

function bindCards(container) {
  // 注意：普通卡片用 .card，推荐区用 .featured-card，统一按 [data-id] 绑定
  container.querySelectorAll('[data-id]').forEach((el) => {
    const open = () => navigate('/tools/' + el.dataset.id + '/');
    el.onclick = (ev) => {
      if (ev.target.dataset.fav || ev.target.classList.contains('go-btn')) return; // 星标与外链单独处理
      open();
    };
    // 卡片是 div：补 tabindex + role，键盘（Tab / Enter / Space）与读屏才能用
    if (!el.hasAttribute('tabindex')) {
      el.tabIndex = 0;
      el.setAttribute('role', 'link');
    }
    el.addEventListener('keydown', (ev) => {
      if (ev.target !== el) return; // 卡片内的收藏按钮/外链自己处理键盘
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  });
  container.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      toggleFav(btn.dataset.fav, btn);
    };
  });
  if (container.id === 'grid') KB.idx = -1; // 列表重绘后选中项作废
}

/* ---------- 键盘选卡（j / k + Enter） ---------- */
// 只在首页网格可用：每次移动都聚焦目标卡片，让 Tab 顺序也跟上，读屏能念出卡片名。
const KB = { idx: -1 };
function kbCards() {
  return Array.from(document.querySelectorAll('#grid > [data-id]'));
}
function kbMove(delta) {
  const cards = kbCards();
  if (!cards.length) return false;
  let next = KB.idx + delta;
  if (KB.idx < 0) next = delta > 0 ? 0 : cards.length - 1;
  next = Math.max(0, Math.min(cards.length - 1, next));
  cards.forEach((c) => c.classList.remove('kb-focus'));
  const el = cards[next];
  KB.idx = next;
  el.classList.add('kb-focus');
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}
function kbClear() {
  KB.idx = -1;
  document.querySelectorAll('#grid > .kb-focus').forEach((c) => c.classList.remove('kb-focus'));
}
function kbOpen() {
  const cards = kbCards();
  const el = cards[KB.idx];
  if (el && el.dataset.id) navigate('/tools/' + el.dataset.id + '/');
}

/* ---------- 站内搜索：权重评分 ---------- */
// 匹配优先级：名称（前缀 > 包含）> 标签 > 别名（拼音全拼/首字母/英文关键词）> 描述
// 别名词条由 scripts/gen-search-aliases.mjs 在构建期写入 tools.json / directory.json
// v3.11：可搜索文本缓存到工具上（跟 LANG 走）。99 个工具时每次按键重算四次拼接太浪费。
function haystack(tool) {
  const c = tool.__hay;
  if (c && c.lang === LANG) return c;
  const m = toolMeta(tool);
  const h = {
    lang: LANG,
    name: (tool.name + ' ' + m.name).toLowerCase(),
    tags: ((tool.tags || []).join(' ') + ' ' + tool.name).toLowerCase(),
    alias: (tool.aliases || []).join(' ').toLowerCase(),
    desc: (tool.desc + ' ' + m.desc).toLowerCase(),
  };
  tool.__hay = h;
  return h;
}

function scoreOne(tool, kw) {
  const h = haystack(tool);
  let s = 0;
  if (h.name.includes(kw)) s += h.name.startsWith(kw) ? 100 : 60;
  if (h.tags.includes(kw)) s += 40;
  if (h.alias.includes(kw)) s += 30;
  if (h.desc.includes(kw)) s += 10;
  return s;
}

function toolScore(tool, kw) {
  if (!kw) return 1;
  const toks = kw.split(/\s+/).filter(Boolean);
  if (toks.length === 1) return scoreOne(tool, toks[0]);
  // v3.11：多词按 AND 收窄、分数累加。以前整串当一个子串比，
  // 「图片 压缩」这种中间带空格的输入一个结果都搜不到。
  let sum = 0;
  for (const tk of toks) {
    const s = scoreOne(tool, tk);
    if (!s) return 0;
    sum += s;
  }
  return sum;
}

// v3.11：打错字的兜底，只在「一条都搜不到」时跑，算错也不影响正常结果。
function lev(a, b) {
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function suggestFix(kw) {
  // 三个字符以内不猜：「js」和「jc」距离是 1，但那是两个不同的缩写
  if (kw.length < 3) return null;
  const limit = kw.length <= 5 ? 1 : 2;
  let best = null;
  let bestD = limit + 1;
  for (const tool of REGISTRY.tools) {
    for (const c of [tool.name.toLowerCase()].concat(tool.name.toLowerCase().split(/[\s/·]+/))) {
      if (!c || Math.abs(c.length - kw.length) > limit) continue;
      const d = lev(kw, c);
      if (d && d < bestD) {
        bestD = d;
        best = toolMeta(tool).name;
      }
    }
  }
  return best;
}

function renderFeatured(tools) {
  const sec = $('#featured-section');
  const searching = !!$('#search').value.trim();
  // v3.4：最多 8 条。超过 8 条它就不是「精选」而是第二份工具列表了
  const ids = (REGISTRY.featured || []).filter((id) => tools.some((t) => t.id === id)).slice(0, FEATURED_MAX);
  if (!ids.length || searching || activeCategory !== '全部') {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';
  // v3.33：这一区变成左右两栏（工具 | 教程），工具栏是 .fc--tools。
  // 标题必须按栏定位——原来选的是区里第一个 .section-title，现在恰好还是它，
  // 但「恰好」不是理由：改成右栏在前、或再加一栏，就会把工具栏的标题写进教程栏。
  const titleEl = sec.querySelector('.fc--tools .section-title');
  if (titleEl) titleEl.innerHTML = `⚡ <span>${t('高频推荐', 'featured')}</span><em>${t('大家都在用 · 优先试试这些', 'featuredSub')}</em>`;
  $('#featured-grid').innerHTML = ids
    .map((id, i) => {
      const tool = tools.find((x) => x.id === id);
      const m = toolMeta(tool);
      return `<div class="fl-row" data-id="${tool.id}" data-link="${tool.runtime !== 'link' ? '' : esc(tool.url)}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <div class="f-body"><div class="f-name">${m.name}</div><div class="f-desc">${m.desc}</div></div>
        <span class="f-meta">${tool.runtime !== 'link' ? t('🔒 本地运行', 'badgeLocal') : `${accessText(tool)} · ${privBadge(tool)}`} · ${catName(tool.category)}</span>
      </div>`;
    })
    .join('');
  bindCards($('#featured-grid'));
}

function renderGrid(tools, keyword) {
  const raw = (keyword || '').trim();
  if (raw) ensureAliases(); // 有搜索词才需要别名；到货后 ensureAliases 会重画一次
  const kw = raw.toLowerCase();
  const favList = favs();
  const usage = usageMap();
  const idxOf = new Map((REGISTRY ? REGISTRY.tools : tools).map((x, i) => [x.id, i]));
  // 最近收录：本地工具按新增顺序倒排（新工具追加在 tools.json 末尾），目录工具保持原序垫后
  const newOrder = (tool) => (tool.runtime === 'link' ? 10000 + (idxOf.get(tool.id) || 0) : -(idxOf.get(tool.id) || 0));
  const runtimeOk = (tool) => activeRuntime === 'all' || (activeRuntime === 'local' ? isLocalTool(tool) : isOfflineTool(tool));
  const list = tools
    .map((tool) => {
      if (!runtimeOk(tool)) return null;
      if (activeCategory === '⭐ 收藏' && !favList.includes(tool.id)) return null;
      if (activeCategory === '🔥 最常用' && !usage[tool.id]) return null;
      const catOk =
        activeCategory === '全部' || activeCategory === '⭐ 收藏' || activeCategory === '🔥 最常用' || tool.category === activeCategory;
      if (!catOk) return null;
      const score = kw ? toolScore(tool, kw) : 0;
      if (kw && score <= 0) return null;
      return [tool, score];
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (kw) {
        return (
          b[1] - a[1] ||
          (b[0].runtime === 'browser') - (a[0].runtime === 'browser') ||
          (b[0].hot ? 1 : 0) - (a[0].hot ? 1 : 0)
        );
      }
      if (activeSort === 'used') {
        const d = (usage[b[0].id] || 0) - (usage[a[0].id] || 0);
        if (d) return d;
      }
      if (activeSort === 'new') {
        const d = newOrder(a[0]) - newOrder(b[0]);
        if (d) return d;
      }
      if (activeCategory === '🔥 最常用') return (usage[b[0].id] || 0) - (usage[a[0].id] || 0);
      return (
        (b[0].runtime === 'browser') - (a[0].runtime === 'browser') ||
        (b[0].hot ? 1 : 0) - (a[0].hot ? 1 : 0)
      );
    })
    .map((x) => x[0]);

  // v3.4 分页：先算出完整结果集，再切当前页。总命中数始终如实报出，
  // 否则「筛选只剩 3 个」和「第 1 页只放得下 24 个」会分不清。
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (curPage > pages) curPage = pages; // 切换筛选后页数变少，别停在空页
  if (curPage < 1) curPage = 1;
  const start = (curPage - 1) * PAGE_SIZE;
  const pageList = list.slice(start, start + PAGE_SIZE);

  const gridEl = $('#grid');
  gridEl.dataset.total = String(total);
  gridEl.dataset.shown = String(pageList.length);
  gridEl.dataset.page = String(curPage);

  const countEl = $('#fb-count');
  if (countEl) countEl.textContent = LANG === 'en' ? `${total} tool${total === 1 ? '' : 's'}` : `共 ${total} 个`;

  if (!list.length) {
    // 别名是按需加载的：第一次搜拼音/口语词时它可能还在路上。这时候说「没有匹配」是错的，
    // 用户会以为搜不到就退出；等它到货后 ensureAliases 会重画一次，结果自己就出来了。
    const loadingAlias = kw && ALIAS_PROMISE && !ALIAS_READY;
    const emptyMsg = loadingAlias
      ? LANG === 'en'
        ? 'Loading the search index…'
        : '正在加载搜索词库…'
      :
      activeCategory === '⭐ 收藏' ? t('收藏夹是空的，点卡片右上角 ☆ 添加', 'emptyFav')
      : activeCategory === '🔥 最常用' ? t('还没有使用记录，运行任意工具后这里会自动统计', 'emptyUsed')
      : activeRuntime !== 'all' ? t('当前筛选下没有工具，试试切回「全部」', 'emptyRuntime')
      : t('没有匹配的工具，换个关键词试试', 'emptyAll');
    // 只在「关键词没命中」这种空态猜错别字、给热门出口：收藏夹空、筛选空都不是打字问题
    const kwMiss = kw && activeCategory === '全部' && activeRuntime === 'all';
    const fix = kwMiss ? suggestFix(kw) : null;
    // 热门共 33 个，够取 6 个；乱码也要给出口，所以挂 kwMiss 而不是挂 fix
    const recs = kwMiss ? REGISTRY.tools.filter((x) => x.hot).slice(0, 6) : [];
    gridEl.innerHTML = `
      <div class="empty">
        <div style="font-size:32px;margin-bottom:8px">🔍</div>
        ${emptyMsg}
        ${fix ? `<div style="margin-top:12px;font-size:13px">${t('没有找到', 'fixNo')}「${esc(kw)}」，${t('是不是要找', 'fixAsk')}：<button class="btn ghost" id="fix-kw" data-kw="${esc(fix)}">${esc(fix)}</button></div>` : ''}
        ${recs.length ? `<div class="rec-title">${t('试试这些热门工具：', 'tryThese')}</div><div class="rec-row">${recs.map((r) => `<a class="btn ghost" href="/tools/${r.id}/">${esc(r.name)}</a>`).join('')}</div>` : ''}
        <div style="margin-top:14px"><button class="btn ghost" id="reset-filter">${t('查看全部工具', 'viewAll')}</button></div>
      </div>`;
    const fixBtn = gridEl.querySelector('#fix-kw');
    if (fixBtn) fixBtn.onclick = () => {
      const v = fixBtn.dataset.kw;
      $('#search').value = v;
      const hero = document.getElementById('hero-search');
      if (hero) hero.value = v;
      curPage = 1;
      renderGrid(REGISTRY.tools, v);
    };
    renderPager(0, 1, 0);
    const rb = $('#reset-filter');
    if (rb) rb.onclick = () => {
      activeCategory = '全部';
      activeRuntime = 'all';
      curPage = 1;
      syncUrlState();
      $('#search').value = '';
      renderHome();
    };
    return;
  }
  gridEl.innerHTML = pageList.map((tool) => cardHTML(tool)).join('');
  bindCards(gridEl);
  renderPager(total, pages, start);
  // 页码也要跟着写回 URL：以前只有分类/筛选会写，搜索把 curPage 打回 1 却不写，
  // 于是「第 3 页 → 输入关键词 → 刷新」会回到第 3 页的空结果。
  syncUrlState();
}

// 分页条：页码窗口最多 7 个（1 … 3 4 5 … 12），两头留「跳到首/末页」
function renderPager(total, pages, start) {
  const box = $('#pager');
  if (!box) return;
  if (total <= PAGE_SIZE) {
    box.innerHTML = '';
    return;
  }
  const nums = [];
  const push = (n) => nums.push(`<button type="button" class="pg-btn ${n === curPage ? 'active' : ''}" data-page="${n}"${n === curPage ? ' aria-current="page"' : ''}>${n}</button>`);
  const gap = '<span class="pg-gap">…</span>';
  if (pages <= 7) {
    for (let n = 1; n <= pages; n++) push(n);
  } else {
    push(1);
    if (curPage > 3) nums.push(gap);
    for (let n = Math.max(2, curPage - 1); n <= Math.min(pages - 1, curPage + 1); n++) push(n);
    if (curPage < pages - 2) nums.push(gap);
    push(pages);
  }
  const shownFrom = start + 1;
  const shownTo = Math.min(start + PAGE_SIZE, total);
  const prevLabel = LANG === 'en' ? 'Previous page' : '上一页';
  const nextLabel = LANG === 'en' ? 'Next page' : '下一页';
  // 带上「第几页 / 共几页」：只给「1–24 个」看不出还剩多少，读者不敢按下一条
  const info =
    LANG === 'en'
      ? `Page ${curPage}/${pages} · ${shownFrom}–${shownTo} of ${total}`
      : `第 ${curPage}/${pages} 页 · ${shownFrom}–${shownTo}，共 ${total} 个`;
  box.innerHTML =
    `<button type="button" class="pg-btn" data-page="${curPage - 1}"${curPage === 1 ? ' disabled' : ''} aria-label="${prevLabel}">‹</button>` +
    nums.join('') +
    `<button type="button" class="pg-btn" data-page="${curPage + 1}"${curPage === pages ? ' disabled' : ''} aria-label="${nextLabel}">›</button>` +
    `<span class="pg-info" role="status" aria-live="polite">${info}</span>`;
  $$('#pager .pg-btn[data-page]').forEach((el) => {
    el.onclick = () => goPage(parseInt(el.dataset.page, 10));
  });
}

function goPage(n) {
  if (!Number.isFinite(n)) return;
  const box = $('#grid');
  const total = parseInt(box?.dataset.total || '0', 10) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  curPage = Math.min(Math.max(1, n), pages);
  syncUrlState();
  renderGrid(REGISTRY.tools, $('#search').value);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 内容路由卡（首页四类内容） ---------- */
function renderRouteCards(reg, res, evals) {
  const box = document.getElementById('route-cards');
  if (!box) return;
  // v3.16：导航收敛成「工具 / 资源 / 教程 / 测评」四栏，这一排卡跟着同序，
  //        对比台让位给教程 —— 对比不再是一个独立入口，而是测评页第一屏的那个入口。
  // 教程的篇数与步数是构建期写进 DOM 的（首页不为了两个数字多取一份 JSON），这里读回来沿用。
  // v3.33：卡面主数字从「步数」改成「篇数」——步数说的是篇幅，篇数才是「有多少条路可走」；
  // 步数没有丢，挪到下面那行说明里。所以两个数都得读回来，只读一个就会渲染成 0。
  const gBox = box.querySelector('.rc--guide');
  const gCount = gBox?.dataset.guides || '0';
  const gSteps = gBox?.dataset.steps || '0';
  box.innerHTML = `
    <a class="route-card rc--tools" href="/tools/" data-spa>
      <span class="rc-badge" aria-hidden="true">🧰</span><span class="rc-tag" data-zh="工具箱" data-en="Toolbox">工具箱</span>
      <b><span class="rc-num">${reg.counts.local + reg.counts.dir}</span><span data-zh="个工具" data-en="tools">个工具</span></b>
      <span class="rc-desc" data-zh="${reg.counts.local} 个纯本地执行 · ${reg.categories.length} 个分类" data-en="${reg.counts.local} run fully in-browser · ${reg.categories.length} categories">${reg.counts.local} 个纯本地执行 · ${reg.categories.length} 个分类</span>
      <em data-zh="浏览工具 →" data-en="Browse tools →">浏览工具 →</em>
    </a>
    <a class="route-card rc--res" href="/resources/">
      <span class="rc-badge" aria-hidden="true">📚</span><span class="rc-tag" data-zh="资源库" data-en="Library">资源库</span>
      <b><span class="rc-num">${(res.collections || []).reduce((a, c) => a + c.items.length, 0)}</span><span data-zh="条资源" data-en="links">条资源</span></b>
      <span class="rc-desc" data-zh="${(res.collections || []).length} 个合集：图标、字体、配色、学习路线" data-en="${(res.collections || []).length} collections: icons, fonts, palettes, learning paths">${(res.collections || []).length} 个合集：图标、字体、配色、学习路线</span>
      <em data-zh="逛资源库 →" data-en="Open the library →">逛资源库 →</em>
    </a>
    <a class="route-card rc--guide" href="/guides/" data-spa data-guides="${gCount}" data-steps="${gSteps}">
      <span class="rc-badge" aria-hidden="true">📖</span><span class="rc-tag" data-zh="教程" data-en="Guides">教程</span>
      <b><span class="rc-num">${gCount}</span><span data-zh="篇教程" data-en="guides">篇教程</span></b>
      <span class="rc-desc" data-zh="${gSteps} 个步骤 · 前置条件、风险标注、回退路径" data-en="${gSteps} steps · prerequisites, risk labels and a way back">${gSteps} 个步骤 · 前置条件、风险标注、回退路径</span>
      <em data-zh="看教程 →" data-en="Read the guide →">看教程 →</em>
    </a>
    <a class="route-card rc--eval" href="/evaluations/" data-spa>
      <span class="rc-badge" aria-hidden="true">🔬</span><span class="rc-tag" data-zh="测评室" data-en="Reviews">测评室</span>
      <b><span class="rc-num">${(evals?.evaluations || []).length}</span><span data-zh="篇测评" data-en="reviews">篇测评</span></b>
      <span class="rc-desc" data-zh="横向实测 + 同类并排对比：隐私、速度、功能边界一次讲清" data-en="Hands-on tests and side-by-side comparisons: privacy, speed, limits">横向实测 + 同类并排对比：隐私、速度、功能边界一次讲清</span>
      <em data-zh="读测评 →" data-en="Read reviews →">读测评 →</em>
    </a>`;
  // v3.14：工具箱那张卡改成真链接（/tools/）。原来它 onclick 抢掉默认行为，
  // 只把页面滚到 #grid —— 用户点完还停在首页，也分享不出去。
  bindSpaLinks('#route-cards');
  applyBilingual(); // 上面的 data-zh/data-en 要立刻生效，否则切到英文后重新渲染又变回中文
}

/* ---------- 命令面板（⌘K / Ctrl+K） ---------- */
let PALETTE = { items: [], idx: 0, open: false };

function buildPaletteItems(reg, res, evals) {
  const items = [];
  // 页面
  items.push({ type: '页面', name: '资源库', desc: '图标 / 字体 / 配色 / 学习资源', url: '/resources/' });
  items.push({ type: '页面', name: '工具对比', desc: '同类工具并排比较', url: '/compare/' });
  items.push({ type: '页面', name: '更新日志', desc: '看看最近改了什么', url: '/changelog/' });
  items.push({ type: '页面', name: '专题合集', desc: '按场景打包好的工具组合', url: '/topics/' });
  items.push({ type: '页面', name: '工具评测', desc: '同类工具横向实测', url: '/evaluations/' });
  // 评测文章
  for (const ev of evals?.evaluations || []) {
    items.push({ type: '评测', name: ev.title, desc: ev.summary, url: '/evaluations/' + ev.slug + '/' });
  }
  // 工具
  for (const tool of reg.tools) {
    const m = toolMeta(tool);
    items.push({
      type: tool.runtime === 'link' ? '在线工具' : '本地工具',
      name: m.name,
      desc: m.desc,
      url: '/tools/' + tool.id + '/',
      external: false,
      keywords: (tool.tags || []).join(' ') + ' ' + tool.name + ' ' + (tool.aliases || []).join(' '),
    });
  }
  // 资源合集
  for (const c of res.collections || []) {
    items.push({ type: '资源', name: c.title, desc: c.desc, url: '/resources/' + c.slug + '/' });
  }
  return items;
}

/* ---------- 浮层兜底 ----------
   /tools/<id>/ 这类静态页是构建产物，构建滞后时会缺刚加的弹层（命令面板、快捷键帮助）。
   这里按需补齐，避免「首页有、工具页没有」这种半残状态。 */
const OVERLAY_HTML = {
  palette: `<div id="palette" role="dialog" aria-modal="true" aria-label="命令面板" aria-hidden="true">
    <div class="pal-box">
      <input id="palette-input" type="text" placeholder="搜索工具、资源、页面…" autocomplete="off" aria-label="搜索工具、资源、页面" />
      <div id="palette-results"></div>
      <div class="pal-foot">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
    </div>
  </div>`,
  kbd: `<div id="kbd-help" role="dialog" aria-modal="true" aria-label="键盘快捷键" aria-hidden="true">
    <div class="kbd-box">
      <div class="kbd-head">
        <b data-zh="⌨ 键盘快捷键" data-en="⌨ Keyboard shortcuts">⌨ 键盘快捷键</b>
        <button type="button" class="kbd-close" id="kbd-close" aria-label="关闭快捷键帮助" data-zh-aria="关闭快捷键帮助" data-en-aria="Close shortcuts help">✕</button>
      </div>
      <table class="kbd-table"><tbody>
        <tr><td><kbd>/</kbd></td><td data-zh="聚焦搜索框" data-en="Focus the search box">聚焦搜索框</td></tr>
        <tr><td><kbd>⌘</kbd> / <kbd>Ctrl</kbd> + <kbd>K</kbd></td><td data-zh="打开命令面板（搜索工具、资源、页面）" data-en="Open the command palette (tools, resources, pages)">打开命令面板（搜索工具、资源、页面）</td></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td data-zh="在首页工具列表中向下 / 向上移动选中项" data-en="Move the selection down / up in the tool grid">在首页工具列表中向下 / 向上移动选中项</td></tr>
        <tr><td><kbd>Enter</kbd></td><td data-zh="打开当前选中的工具" data-en="Open the selected tool">打开当前选中的工具</td></tr>
        <tr><td><kbd>g</kbd> <kbd>h</kbd></td><td data-zh="回到首页" data-en="Go back home">回到首页</td></tr>
        <tr><td><kbd>⌘</kbd> / <kbd>Ctrl</kbd> + <kbd>Enter</kbd></td><td data-zh="在工具表单里运行（多行输入框内）" data-en="Run from inside a multi-line field">在工具表单里运行（多行输入框内）</td></tr>
        <tr><td><kbd>t</kbd></td><td data-zh="切换浅色 / 深色主题" data-en="Toggle light / dark theme">切换浅色 / 深色主题</td></tr>
        <tr><td><kbd>Esc</kbd></td><td data-zh="关闭弹层、清空搜索、取消选中" data-en="Close overlays, clear search, drop selection">关闭弹层、清空搜索、取消选中</td></tr>
        <tr><td><kbd>?</kbd></td><td data-zh="打开这个帮助面板" data-en="Open this help panel">打开这个帮助面板</td></tr>
      </tbody></table>
      <p class="kbd-note" data-zh="全部功能都能用键盘完成：搜索 → 进入工具 → 填参数 → 运行 → 复制结果。" data-en="Everything works from the keyboard: search → open a tool → fill in the form → run → copy the result.">全部功能都能用键盘完成：搜索 → 进入工具 → 填参数 → 运行 → 复制结果。</p>
    </div>
  </div>`,
};
function ensureOverlays() {
  const add = (id, html) => {
    if (document.getElementById(id)) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
  };
  add('palette', OVERLAY_HTML.palette);
  add('kbd-help', OVERLAY_HTML.kbd);
}

/* 意图解析模块按需加载：只有真的打开命令面板 / 在搜索框回车时才拉 6KB 规则表 */
let INTENT_MOD = null;
let INTENT_PROMISE = null;
let INTENT_RETRY_DONE = false;
function ensureIntent() {
  if (!INTENT_PROMISE)
    INTENT_PROMISE = import('/assets/lib/intent.js')
      .then((m) => (INTENT_MOD = m))
      .catch(() => null);
  return INTENT_PROMISE;
}

function openPalette() {
  const el = document.getElementById('palette');
  if (!el) return;
  ensureAliases(); // 面板搜的是全站条目，同样吃别名
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false'); // 面板可见后必须对辅助技术开放
  PALETTE.open = true;
  const input = el.querySelector('#palette-input');
  input.value = '';
  PALETTE.idx = 0;
  renderPaletteResults('');
  ensureIntent().then(() => renderPaletteResults(input.value)); // 规则表就绪后补一次
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  const el = document.getElementById('palette');
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  PALETTE.open = false;
}

function paletteScore(x, kw) {
  const name = (x.name || '').toLowerCase();
  let s = 0;
  if (name.includes(kw)) s += name.startsWith(kw) ? 100 : 60;
  if ((x.keywords || '').toLowerCase().includes(kw)) s += 40;
  if ((x.desc || '').toLowerCase().includes(kw)) s += 10;
  return s;
}

function renderPaletteResults(q) {
  const kw = (q || '').trim().toLowerCase();
  const list = PALETTE.items
    .map((x) => [x, kw ? paletteScore(x, kw) : 1])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([x]) => x);

  // 自然语言意图（v3.0 E4）：像句子的输入优先给一条「也许你要」
  let intentItem = null;
  const sentence = kw.length >= 4 && /[\u4e00-\u9fa5]/.test(kw);
  if (!INTENT_MOD && sentence && !INTENT_RETRY_DONE) {
    // 规则表还在路上（首次打开面板时才开始下载）：先给普通结果，到货后自动补上「也许你要」。
    // 用一次性开关避免加载失败时反复自我触发。
    INTENT_RETRY_DONE = true;
    ensureIntent().then(() => renderPaletteResults(q));
  }
  if (INTENT_MOD && sentence) {
    const hit = INTENT_MOD.parseIntent(kw);
    if (hit) {
      const reg = REGISTRY && REGISTRY.tools.find((x) => x.id === hit.id);
      // 只推荐确实存在的本地工具，避免规则表与工具列表脱节
      if (reg && reg.runtime !== 'link') {
        const p = Object.entries(hit.params || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(' · ');
        intentItem = {
          type: '💡 也许你要',
          name: toolMeta(reg).name,
          desc: (p ? p + ' · ' : '') + '识别自「' + hit.matched.slice(0, 18) + '」',
          url: INTENT_MOD.intentUrl(hit),
        };
      }
    }
  }
  if (intentItem) list.unshift(intentItem);

  PALETTE.filtered = list;
  PALETTE.idx = Math.min(PALETTE.idx, Math.max(0, list.length - 1));
  const box = document.getElementById('palette-results');
  box.innerHTML = list.length
    ? list
        .map(
          (x, i) => `<div class="pal-item ${i === PALETTE.idx ? 'active' : ''}" data-i="${i}">
            <span class="pal-type">${x.type}</span>
            <span class="pal-name">${x.name}</span>
            <span class="pal-desc">${x.desc || ''}</span>
          </div>`
        )
        .join('')
    : '<div class="pal-empty">没有匹配项</div>';
  box.querySelectorAll('.pal-item').forEach((el) => {
    el.onmouseenter = () => {
      PALETTE.idx = Number(el.dataset.i);
      box.querySelectorAll('.pal-item').forEach((p) => p.classList.toggle('active', p === el));
    };
    el.onclick = () => goPalette(Number(el.dataset.i));
  });
}

function goPalette(i) {
  const target = (PALETTE.filtered || [])[i];
  if (!target) return;
  closePalette();
  navigate(target.url);
}

function initPalette() {
  const el = document.getElementById('palette');
  if (!el) return;
  const input = el.querySelector('#palette-input');
  input.addEventListener('input', () => renderPaletteResults(input.value));
  input.addEventListener('keydown', (e) => {
    const list = PALETTE.filtered || [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      PALETTE.idx = Math.min(list.length - 1, PALETTE.idx + 1);
      renderPaletteResults(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      PALETTE.idx = Math.max(0, PALETTE.idx - 1);
      renderPaletteResults(input.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      goPalette(PALETTE.idx);
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });
  el.addEventListener('click', (e) => {
    if (e.target === el) closePalette();
  });
}

/* ---------- 快捷键帮助面板 ---------- */
let KBD_OPEN = false;
let kbdReturnFocus = null;
function openKbdHelp() {
  const el = $('#kbd-help');
  if (!el) return;
  kbdReturnFocus = document.activeElement;
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  KBD_OPEN = true;
  const close = el.querySelector('#kbd-close');
  if (close) close.focus();
}
function closeKbdHelp() {
  const el = $('#kbd-help');
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  KBD_OPEN = false;
  if (kbdReturnFocus && kbdReturnFocus.focus) kbdReturnFocus.focus();
  kbdReturnFocus = null;
}
function initKbdHelp() {
  const el = $('#kbd-help');
  if (!el) return;
  const closeBtn = el.querySelector('#kbd-close');
  if (closeBtn) closeBtn.onclick = closeKbdHelp;
  el.onclick = (e) => {
    if (e.target === el) closeKbdHelp();
  };
  const btn = $('#kbd-btn');
  if (btn) btn.onclick = openKbdHelp;
}

/* ---------- 全局快捷键：j/k 选卡、Enter 打开、t 主题、g h 回首页、? 帮助 ---------- */
// 输入状态下一律不拦截，避免抢走打字；弹层打开时只放行 Esc。
function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
let gPending = 0;
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (KBD_OPEN) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeKbdHelp();
    }
    return;
  }
  if (PALETTE.open || isTyping(e.target)) return;

  if (e.key === '?') {
    e.preventDefault();
    openKbdHelp();
    return;
  }
  if (e.key === 't') {
    e.preventDefault();
    toggleTheme();
    return;
  }

  const onHome = $('#view-home') && $('#view-home').style.display !== 'none';
  if (!onHome) return;

  if (e.key === 'j' || e.key === 'k') {
    // 网格未渲染（工具页/静态页）时不拦截，保留浏览器默认滚动
    if (!kbCards().length) return;
    e.preventDefault();
    kbMove(e.key === 'j' ? 1 : -1);
    return;
  }
  // 左右翻页：只在列表真的分了页时接管，否则会抢掉浏览器的横向滚动
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const total = parseInt(($('#grid') || {}).dataset?.total || '0', 10) || 0;
    if (total <= PAGE_SIZE) return;
    e.preventDefault();
    goPage(curPage + (e.key === 'ArrowRight' ? 1 : -1));
    return;
  }
  if (e.key === 'Enter' && KB.idx >= 0 && document.activeElement) {
    const cur = document.activeElement;
    if (cur.dataset && cur.dataset.id) {
      e.preventDefault();
      kbOpen();
    }
    return;
  }
  if (e.key === 'Escape' && KB.idx >= 0) {
    kbClear();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return;
  }
  if (e.key === 'g') {
    gPending = Date.now();
    return;
  }
  if (e.key === 'h' && gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    e.preventDefault();
    if (location.pathname !== '/') navigate('/');
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

let EVALDATA = null;
async function loadEvaluations() {
  if (EVALDATA) return EVALDATA;
  try {
    EVALDATA = await (await fetch('/evaluations.json')).json();
  } catch {
    EVALDATA = { evaluations: [] };
  }
  return EVALDATA;
}
// 资源库数据：首页的入口卡与命令面板都要用它，所以留在主模块（渲染在 content-pages.js）
let RES = null;
async function loadResources() {
  if (RES) return RES;
  try {
    RES = await (await fetch('/resources.json')).json();
  } catch {
    RES = { collections: [], groups: [], policy: '' };
  }
  return RES;
}

/* 内容页渲染已搬到 assets/content-pages.js（v3.13 按需加载）：
   专题、评测、资源库、分类、更新日志。这里只留一个统一入口 openContent。
   搬走的理由是体积：这五类页面占了近 400 行，首页一个都不渲染，
   但每个访客都要下载并解析它们——首屏脚本因此从 31.2 降到约 27 KB。 */
let CONTENT_PAGES = null;
async function openContent(kind, arg) {
  if (!CONTENT_PAGES) {
    try {
      CONTENT_PAGES = (await import('/assets/content-pages.js')).bindContentPages({
        $, esc, t, catName, toolMeta, CAT_ICONS, isLocalTool, stateHTML, kbLink, navigate,
        bindSpaLinks, setView, renderNavActive, loadI18n, loadRegistry, loadResources,
        loadEvaluations, SITE,
      });
    } catch (e) {
      // 模块取不到（老版本缓存 / 网络断）时给出明确提示，不要留白屏
      $('#page-body').innerHTML = stateHTML('error', { title: '内容模块加载失败', detail: e.message });
      return;
    }
  }
  const fn = CONTENT_PAGES[kind];
  if (fn) return fn(arg);
}

/* ---------- 工具教程（长尾正文：步骤 + 常见错误） ---------- */
let ARTICLES = null;
async function loadArticles() {
  if (ARTICLES) return ARTICLES;
  try {
    ARTICLES = await (await fetch('/articles.json')).json();
  } catch {
    ARTICLES = {};
  }
  return ARTICLES;
}
// v3.10：教程正文加厚后整份 articles.json 到 112 KB（gzip 44 KB），
// 而单个工具页只用到自己那篇（raw 平均 1.2 KB）。所以构建期按 id 拆了单篇，
// 这里按需取。取不到（老部署 / 新增工具还没文章）再退回整份。
const ARTICLE_CACHE = new Map();
async function loadArticle(id) {
  if (!id) return null;
  if (ARTICLE_CACHE.has(id)) return ARTICLE_CACHE.get(id);
  let art = null;
  try {
    const r = await fetch('/articles/' + id + '.json');
    if (r.ok) art = await r.json();
  } catch {
    art = null;
  }
  if (!art) art = (await loadArticles())[id] || null;
  ARTICLE_CACHE.set(id, art);
  return art;
}

/* ---------- 工具对比 ---------- */
const cmpList = () => store.get('compare', []);
const cmpSet = (ids) => store.set('compare', ids.slice(0, 4));

function toggleCompare(id) {
  const list = cmpList();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else {
    if (list.length >= 4) {
      alert(t('最多同时对比 4 个工具', 'cmpMax'));
      return;
    }
    list.push(id);
  }
  cmpSet(list);
  renderCompareBar();
  // 同步按钮状态
  const btn = document.getElementById('cmp-btn');
  if (btn) {
    const on = list.includes(id);
    btn.textContent = on ? '✓ 已加入对比' : '⇄ 加入对比';
    btn.classList.toggle('on', on);
  }
}

function renderCompareBar() {
  const bar = document.getElementById('cmp-bar');
  if (!bar) return;
  const list = cmpList();
  const tools = REGISTRY ? REGISTRY.tools.filter((x) => list.includes(x.id)) : [];
  if (!tools.length) {
    bar.classList.remove('show');
    return;
  }
  bar.classList.add('show');
  bar.innerHTML = `
    <div class="cmp-bar-inner">
      <span class="cmp-bar-label">⇄ ${t('已选', 'cmpSelected')} ${tools.length} ${t('个工具', 'cmpUnit')}</span>
      <span class="cmp-bar-names">${tools.map((x) => toolMeta(x).name).join(' · ')}</span>
      <button class="btn" id="cmp-go">${t('开始对比', 'cmpGo')}</button>
      <button class="btn ghost" id="cmp-clear">${t('清空', 'cmpClear')}</button>
    </div>`;
  bar.querySelector('#cmp-go').onclick = () => navigate('/compare/');
  bar.querySelector('#cmp-clear').onclick = () => {
    cmpSet([]);
    renderCompareBar();
  };
}

// 读取本地工具的输入定义（用于对比表）
const manifestCache = new Map();
async function getManifest(id) {
  if (manifestCache.has(id)) return manifestCache.get(id);
  try {
    const mod = await import(`/tools/${id}/run.js`);
    manifestCache.set(id, mod.manifest);
    return mod.manifest;
  } catch {
    manifestCache.set(id, null);
    return null;
  }
}

const INPUT_LABEL = { text: '单行文本', textarea: '多行文本', number: '数字', select: '选项', range: '滑杆', file: '文件上传' };

async function openCompare(queryIds) {
  const reg = await loadRegistry();
  await loadI18n();
  let ids = queryIds && queryIds.length ? queryIds : cmpList();
  ids = ids.filter((id) => reg.tools.some((x) => x.id === id)).slice(0, 4);
  // 没选够就默认给 3 个同类可比工具（图片类）
  if (!ids.length) {
    ids = ['image-compress', 'squoosh', 'image-resize'];
  }
  const picked = ids.map((id) => reg.tools.find((x) => x.id === id));

  setView('page');
  document.title = `${t('工具对比', 'cmpTitle')} · ${SITE}`;
  renderNavActive('/compare');
  ensureCss(PAGE_CSS.compare); // 对比页样式自 v3.16 起按需加载，不等它也能画，但别漏

  const manifests = await Promise.all(picked.map((x) => (x.runtime === 'link' ? null : getManifest(x.id))));

  const row = (label, fn) =>
    `<tr><th>${label}</th>${picked
      .map((x, i) => {
        const m = manifests[i];
        const v = fn(x, m, i);
        return `<td class="${v && v.cls ? v.cls : ''}">${v && v.text !== undefined ? v.text : v}</td>`;
      })
      .join('')}</tr>`;

  const table = `
    <table class="cmp-table cmp-page-table">
      <thead><tr><th></th>${picked
        .map((x) => `<th><div class="cmp-head">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div></th>`)
        .join('')}</tr></thead>
      <tbody>
        ${row(t('运行方式', 'cmpRuntime'), (x) =>
          x.runtime === 'link'
            ? { text: t('第三方官网', 'cmpThirdParty'), cls: 'no' }
            : { text: x.runtime === 'pyodide' ? 'Python (WASM)' : t('浏览器内执行', 'cmpInBrowser'), cls: 'yes' }
        )}
        ${row(t('数据流向', 'cmpData'), (x) =>
          x.runtime === 'link'
            ? { text: t('由第三方处理', 'cmpDataThird'), cls: 'no' }
            : { text: t('不上传，留在本机', 'cmpDataLocal'), cls: 'yes' }
        )}
        ${row(t('离线可用', 'cmpOffline'), (x) => (x.runtime === 'link' ? { text: t('否', 'cmpNo'), cls: 'no' } : { text: t('是', 'cmpYes'), cls: 'yes' }))}
        ${row(t('是否需要注册', 'cmpSignup'), (x) =>
          x.runtime === 'link' ? t('以官网为准', 'cmpDepends') : { text: t('不需要', 'cmpNoSignup'), cls: 'yes' }
        )}
        ${row(t('输入形式', 'cmpInput'), (x, m) => (m && m.inputs ? [...new Set(m.inputs.map((i) => INPUT_LABEL[i.type] || i.type))].join('、') : '—'))}
        ${row(t('主要输出', 'cmpOutput'), (x, m) => (m ? (m.outputHint || t('处理结果 / 可下载文件', 'cmpOutputDefault')) : '—'))}
        ${row(t('开源协议', 'cmpLicense'), (x) => x.license || '—')}
        ${row(t('来源', 'cmpSource'), (x) => (x.runtime === 'link' ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.source)} ↗</a>` : esc(x.source)))}
        ${row(t('分类', 'cmpCategory'), (x) => catName(x.category))}
        ${row(t('打开', 'cmpOpen'), (x) =>
          x.runtime === 'link'
            ? `<a class="cmp-link" href="${esc(x.url)}" target="_blank" rel="noopener">${t('访问官网', 'cmpVisit')} ↗</a>`
            : `<a class="cmp-link" href="/tools/${x.id}/">${t('打开工具', 'cmpOpenTool')} →</a>`
        )}
      </tbody>
    </table>`;

  const options = reg.tools
    .map((x) => `<option value="${x.id}">${catName(x.category)} · ${toolMeta(x).name}</option>`)
    .join('');
  const pickers = [0, 1, 2, 3]
    .map(
      (i) => `<select class="cmp-pick" data-i="${i}">
        <option value="">${i < 2 ? t('选择工具…', 'cmpPick') : t('（可选）', 'cmpOptional')}</option>
        ${options}
      </select>`
    )
    .join('');

  $('#page-body').innerHTML = `
    <div class="page" style="max-width:1000px">
      <h1>⇄ ${t('工具对比', 'cmpTitle')}</h1>
      <p class="lead">${t('把同类工具放在一起看：数据是否上传、能否离线、是否需要注册、协议与来源。最多同时对比 4 个。', 'cmpLead')}</p>
      <div class="cmp-pickers">${pickers}</div>
      <div id="cmp-table-wrap">${table}</div>
      <p class="cmp-tip">${t('提示：目录工具的运行与数据处理发生在第三方官网，本站只做整理与推荐。', 'cmpTip')}</p>
    </div>`;

  // 初始化选择器
  $$('.cmp-pick').forEach((sel, i) => {
    sel.value = ids[i] || '';
    sel.onchange = () => {
      const next = $$('.cmp-pick').map((s) => s.value).filter(Boolean);
      const uniq = [...new Set(next)];
      navigate('/compare/?ids=' + uniq.join(','), true);
    };
  });
}

/* ---------- 最近使用 / 本地使用统计 ---------- */
function recentIds() {
  return store.get('recent', []);
}
function pushRecent(id) {
  const list = recentIds().filter((x) => x !== id);
  list.unshift(id);
  store.set('recent', list.slice(0, 8));
}
// 使用计数：仅存本机 localStorage，不上报任何服务器
function usageMap() {
  return store.get('usage', {});
}
function pushUsage(id) {
  const m = usageMap();
  m[id] = (m[id] || 0) + 1;
  store.set('usage', m);
}
function renderRecent(tools) {
  const row = $('#recent-row');
  const ids = recentIds().filter((id) => tools.some((t) => t.id === id && t.runtime !== 'link'));
  if (!ids.length) {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  row.innerHTML = `<span class="recent-label">${t('🕘 最近使用', 'recent')}</span>` +
    ids
      .slice(0, 6)
      .map((id) => {
        const t = tools.find((x) => x.id === id);
        return `<div class="related-chip" data-id="${t.id}">${CAT_ICONS[t.category] || '🧰'} ${t.name}</div>`;
      })
      .join('');
  row.querySelectorAll('.related-chip').forEach((el) => {
    kbLink(el, () => navigate('/tools/' + el.dataset.id + '/'));
  });
}

/* 任务导向入口：普通用户不知道"分类"，但知道自己想干什么 */
function renderTasks() {
  const list = taskList();
  $('#task-row').innerHTML =
    `<span class="task-label">${t('我想…', 'taskLabel')}</span>` +
    list.map((x) => `<button class="task-chip" data-kw="${x.kw}">${x.label}</button>`).join('');
  $$('#task-row .task-chip').forEach((el) => {
    el.onclick = () => {
      $('#search').value = el.dataset.kw;
      activeCategory = '全部';
      curPage = 1;
      renderFeatured(REGISTRY.tools);
      renderGrid(REGISTRY.tools, el.dataset.kw);
      document.querySelector('#grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

async function renderHome() {
  const reg = await loadRegistry();
  await loadI18n();
  applyStaticText();
  setView('home');
  document.title = LANG === 'en' ? 'ToolHub · Local-first open-source tools' : SITE;
  // v3.10：/?q=关键词 直接带出筛选结果。首页 SearchAction 的落地入口就是它，
  // 所以这个参数必须真的生效——结构化数据里写一个抓不出内容的 URL，是会被判负的。
  // 复用 input 事件的同一份筛选逻辑：填进两个框，末尾的 renderGrid 自然会读到。
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) {
    $('#search').value = q0;
    const heroBox = document.getElementById('hero-search');
    if (heroBox) heroBox.value = q0;
  }
  $('#foot-count').textContent =
    LANG === 'en'
      ? `${reg.counts.local + reg.counts.dir} ${t('tools curated', 'footerCount')}`
      : `已收录 ${reg.counts.local + reg.counts.dir} 个工具`;
  renderHeroStats(reg);
  renderNavActive('/');
  const res = await loadResources();
  const evals = await loadEvaluations();
  renderRouteCards(reg, res, evals);
  PALETTE.items = buildPaletteItems(reg, res, evals);
  await renderResPreview();
  renderTasks();
  renderFeatured(reg.tools);
  // 教程栏是构建期写死的（与左栏工具列表同一份静态化产物），app.js 不重画它，
  // 但链接的 SPA 拦截必须补绑一次：这里是直接写 onclick，没有事件委托，
  // 不绑就变成整页刷新——点一条教程回首页，滚动位置与筛选状态全丢。
  // 范围取整个推荐区而不是 #home-guides：右栏标题上的「全部 16 篇教程 →」也在外面那层。
  bindSpaLinks('#featured-section');
  renderRecent(reg.tools);
  renderChips(reg.categories);
  renderFilterbar();
  renderGrid(reg.tools, $('#search').value);
  renderCompareBar();
}

// 视图切换：三块只显示一块，同时把当前视图写到 body 上。
// v3.4 需要它是因为首页要把头部搜索框收起来（首屏已经有 hero 大框），
// 而工具页 / 内容页没有 hero 框，头部那个才是唯一入口 —— 判断依据就是 body[data-view]。
function setView(name) {
  document.body.dataset.view = name;
  ['home', 'tool', 'page'].forEach((v) => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === name ? '' : 'none';
  });
}

// 导航高亮（按当前路径标记）
// v3.16：导航只有四栏，/compare 归到「测评」名下、/categories 归到「工具」名下 ——
// 它们还是能独立访问的页面，只是不再各占一个顶级入口。
function renderNavActive(path) {
  const map = {
    '/': 'tools',
    '/tools': 'tools',
    '/categories': 'tools',
    '/resources': 'resources',
    '/guides': 'guides',
    '/evaluations': 'evaluations',
    '/compare': 'evaluations',
    '/workflows': 'workflows',
  };
  const key = map[path] || '';
  $$('#main-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}

// 首页资源精选（3 个合集卡片）
async function renderResPreview() {
  const box = document.getElementById('res-preview');
  if (!box) return;
  const res = await loadResources();
  const list = (res.collections || []).slice(0, 3);
  if (!list.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  // 合集的标题与说明只有 6 条，英文放在 i18n.json 的 res 里，不往 resources.json 里塞第二份正文
  const resEn = (I18N && I18N.res) || {};
  document.getElementById('res-preview-grid').innerHTML = list
    .map((c) => {
      const loc = LANG === 'en' && resEn[c.slug] ? resEn[c.slug] : c;
      return `<a class="res-preview-card" href="/resources/${c.slug}/">
        <span class="rp-icon">${c.icon || '📚'}</span>
        <span class="rp-title">${loc.title}</span>
        <span class="rp-desc">${loc.desc}</span>
        <span class="rp-count">${c.items.length} ${t('个来源 →', 'sourcesUnit')}</span>
      </a>`;
    })
    .join('');
  applyBilingual();
}

function renderHeroStats(reg) {
  // Hero 标题与副标题（双语）。v3.9：标题从两行长句压成一行短语，
  // 数字不再单独占一行统计条，而是并进入口卡（见 renderRouteCards）。
  const h1 = document.querySelector('.hero h1');
  if (h1 && LANG === 'en') {
    h1.innerHTML = `Safe, fast, <span class="grad">${t('open-source tools & resources', 'heroTitle2')}</span>`;
  } else if (h1) {
    h1.innerHTML = `安全、快捷、<span class="grad">开源工具及资源</span>`;
  }
  const hp = document.querySelector('.hero p');
  if (hp) hp.textContent = t('无需安装、无需注册、无需命令行 —— 挑一个工具，填参数，出结果。', 'heroDesc');

  const btn = $('#random-btn');
  if (btn) {
    btn.title = t('随机发现一个工具', 'random');
    btn.textContent = t('🎲 随便看看', 'random');
    btn.onclick = () => {
      const pool = reg.tools.filter((x) => x.runtime !== 'link');
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) navigate('/tools/' + pick.id + '/');
    };
  }
}

/* ---------- 工具页（v3.3 拆为独立模块，按需加载） ----------
   工具页含表单渲染、结果区、分享/草稿/加密分享，只有 /tools/* 用到。
   拆出去后首页不为它付字节；依赖由这里注入，避免主模块与子模块循环引用。 */
async function openTool(id) {
  let m;
  try {
    m = await import('/assets/tool-page.js');
  } catch (e) {
    $('#tool-body').innerHTML = stateHTML('error', { title: '工具模块加载失败', detail: e.message });
    return;
  }
  m.bindToolPage({
    $, $$, esc, t, toolMeta, catName, navigate, loadRegistry, loadI18n, loadArticles, loadArticle,
    kbLink, pushRecent, usageMap, pushUsage, cmpList, toggleCompare, CAT_ICONS, SITE, renderNavActive,
    getRegistry: () => REGISTRY,
    getLang: () => LANG,
    getD18N: () => D18N,
    getSeoBody: () => SEO_BODY,
    stateHTML,
    CHAINS, setHandoff, takeHandoff, setProgressHandler,
    ensureCss,
    // v3.25：外链详情页也要说清「跑在哪 / 提示词去哪」，口径直接复用首页那两枚徽标，
    // 否则静态页与 SPA 视图会各写一套，迟早分叉
    privBadge, accessText,
  });
  return m.openTool(id);
}

/* ---------- 按需样式表（v3.3 起，v3.5 扩到工具页） ----------
   批量 / 离线 / 提交三页 + 工具页的样式都已从 style.css 拆出。静态页自带 <link>；
   SPA 内跳转时由这里补一份，避免「路由过来了但样式没加载」。
   返回 Promise：内容页的样式少几处不影响用，调用方 fire-and-forget；
   工具页要等它到位再画，否则会闪一下没有样式的裸结构。 */
const LOADED_CSS = new Map();
function ensureCss(href) {
  const hit = LOADED_CSS.get(href);
  if (hit) return hit;
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
    const done = Promise.resolve();
    LOADED_CSS.set(href, done);
    return done;
  }
  const pending = new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    // 加载失败也要放行：少几处样式，总比整页卡住打不开强
    l.onload = resolve;
    l.onerror = resolve;
    document.head.appendChild(l);
  });
  LOADED_CSS.set(href, pending);
  return pending;
}
const PAGE_CSS = {
  batch: '/assets/style.batch.css',
  my: '/assets/style.my.css',
  offline: '/assets/style.offline.css',
  submit: '/assets/style.submit.css',
  compare: '/assets/style.compare.css',
  workflows: '/assets/style.workflows.css',
};

// v3.32：页面型路由整段搬到 /assets/open-page.js，首屏只留这个薄壳。
// 依赖显式传入而不是让模块去读全局——少一个就是「点开隐私页白屏」，首页测不出来。
function openPage(name) {
  return import('/assets/open-page.js')
    .then((m) =>
      m.openPage(name, { loadRegistry, loadI18n, store, SITE, $, setView, stateHTML, loadResources, analyticsOptedOut, ensureCss, PAGE_CSS })
    )
    .catch((e) => {
      setView('page');
      $('#page-body').innerHTML = stateHTML('error', { title: '页面加载失败', detail: e.message });
    });
}

/* ---------- 路由（History API，SEO 友好；兼容旧 #/ 链接）---------- */
function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  window.scrollTo({ top: 0, behavior: 'instant' });
  route();
}

function route() {
  // 旧 hash 链接自动跳转到新路径
  if (location.hash.startsWith('#/')) {
    const oldTool = location.hash.match(/^#\/tool\/([\w-]+)/);
    const oldPage = location.hash.match(/^#\/(about|submit|feedback)/);
    if (oldTool) return navigate('/tools/' + oldTool[1] + '/', true);
    if (oldPage) return navigate('/' + oldPage[1] + '/', true);
    return navigate('/', true);
  }
  const p = location.pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return renderHome();
  const tool = p.match(/^\/tools\/([\w-]+)$/);
  if (tool) return openTool(tool[1]);
  // /tools 是全部工具清单页（v3.14）。它是导航「工具」与首页入口卡的落地页，
  // 跟上面那条详情页正则不冲突：详情页必须带 id。
  if (p === '/tools') return openContent('tools');
  if (p === '/categories') return openContent('categories');
  const catSlug = p.match(/^\/categories\/([\w-]+)$/);
  if (catSlug) return openContent('category', catSlug[1]);
  // 折腾指南（v3.15）：第三层内容，和「点开即用」的工具清单分开
  if (p === '/guides') return openContent('guides');
  const guideSlug = p.match(/^\/guides\/([\w-]+)$/);
  if (guideSlug) return openContent('guide', guideSlug[1]);
  if (p === '/changelog') return openContent('changelog');
  if (p === '/evaluations') return openContent('evaluations');
  const evalSlug = p.match(/^\/evaluations\/([\w-]+)$/);
  if (evalSlug) return openContent('evaluation', evalSlug[1]);
  if (p === '/topics') return openContent('topics');
  const topicSlug = p.match(/^\/topics\/([\w-]+)$/);
  if (topicSlug) return openContent('topic', topicSlug[1]);
  if (p === '/resources') return openContent('resources');
  const resSlug = p.match(/^\/resources\/([\w-]+)$/);
  if (resSlug) return openContent('resource', resSlug[1]);
  if (p === '/compare') {
    const ids = new URLSearchParams(location.search).get('ids');
    return openCompare(ids ? ids.split(',').filter(Boolean) : null);
  }
  const page = p.match(/^\/(about|submit|feedback|privacy|batch|offline|my|workflows)$/);
  if (page) return openPage(page[1]);
  return renderHome();
}

$('#search').addEventListener('input', () => {
  if (REGISTRY) {
    curPage = 1; // 改了关键词就从第一页看起
    renderFeatured(REGISTRY.tools);
    renderGrid(REGISTRY.tools, $('#search').value);
  }
});
// 首页头部把输入框收起来后，这里换成「打开命令面板」——它搜的是全站，不是又一份同样的筛选
$('#search-open').onclick = () => openPalette();
$('#home-btn').onclick = () => navigate('/');
// role="link" 的 div 需要手动响应键盘激活
$('#home-btn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    navigate('/');
  }
});
$('#crumb').onclick = () => navigate('/');
$('#page-crumb').onclick = () => navigate('/');
window.addEventListener('popstate', route);
window.addEventListener('hashchange', route);

// 快捷键：/ 聚焦搜索，Esc 清空
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    // 首页头部输入框是隐藏的（v3.4），聚焦它等于把光标丢进虚空 —— 首页要落到 hero 框上
    const target = document.body.dataset.view === 'home' ? $('#hero-search') : $('#search');
    if (target && target.offsetParent !== null) target.focus();
    else openPalette();
  }
  if (e.key === 'Escape' && (document.activeElement === $('#search') || document.activeElement === $('#hero-search'))) {
    // 两个框共用一份筛选状态（hero 会镜像进 #search），清的时候一起清，否则会剩下一半
    ['#search', '#hero-search'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (REGISTRY) { curPage = 1; renderFeatured(REGISTRY.tools); renderGrid(REGISTRY.tools, ''); }
  }
});

// 回到顶部
const toTop = $('#to-top');
window.addEventListener('scroll', () => {
  toTop.classList.toggle('show', window.scrollY > 480);
});
toTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// 嵌入模式（?embed=1）：只保留工具本体
if (new URLSearchParams(location.search).get('embed') === '1') {
  document.body.classList.add('embed-mode');
}

// 命令面板与 hero 搜索
ensureOverlays();
initPalette();
initKbdHelp();

/* ---------- 拖进来就能用（v3.1） ----------
   模块按需加载：首屏不该为一个「可能用不到」的拖放浮层付字节。
   空闲时预热一次；如果用户拖拽时还没到货，import 完成后仍然能接住这次拖拽
   （drop.js 的 dragover 会在模块就绪后补显浮层）。 */
let DROP_PROMISE = null;
function ensureDrop() {
  if (!DROP_PROMISE) {
    DROP_PROMISE = import('/assets/drop.js')
      .then((m) => {
        m.initDropRoute({
          getTools: async () => (await loadRegistry()).tools,
          onPick: (id, files) => {
            // 同一个 File 对象在 SPA 内直接接力，不读盘、不上传、不转存
            setHandoff({ from: 'drop', files: files.map((f) => ({ name: f.name, blob: f })), text: '' });
            navigate('/tools/' + id + '/');
          },
        });
        return m;
      })
      .catch(() => null);
  }
  return DROP_PROMISE;
}
window.addEventListener(
  'dragenter',
  (e) => {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    if (types.includes('Files')) ensureDrop();
  },
  true
);
if ('requestIdleCallback' in window) requestIdleCallback(() => ensureDrop(), { timeout: 4000 });
else setTimeout(() => ensureDrop(), 2500);

/* ---------- 粘贴即问（v3.1） ----------
   往搜索框里粘一段 JSON / JWT / CSV，不要把它塞进搜索框当关键词，
   而是直接给一条「这看起来是什么，去哪个工具」。 */
let ROUTE_MOD = null;
function ensureRoute() {
  if (!ROUTE_MOD) {
    ROUTE_MOD = import('/assets/lib/drop-route.js').catch(() => null);
  }
  return ROUTE_MOD;
}

function bindPasteRoute(input, host) {
  if (!input || !host) return;
  input.addEventListener('paste', async (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (text.trim().length < 8) return;
    const mod = await ensureRoute();
    const hit = mod && mod.routePaste(text);
    if (!hit) return; // 认不出来就按普通粘贴处理，绝不拦截
    e.preventDefault(); // 4000 字的 JSON 塞进搜索框既看不清也搜不到
    let box = host.querySelector('.paste-hint');
    if (!box) {
      box = document.createElement('div');
      box.className = 'paste-hint';
      input.insertAdjacentElement('afterend', box);
    }
    box.style.display = '';
    box.innerHTML = `<span>🔎 检测到${esc(hit.kind)}</span><button type="button" class="ph-go">${esc(
      hit.label
    )}</button><button type="button" class="ph-x" aria-label="关闭">×</button>`;
    const go = box.querySelector('.ph-go');
    go.onclick = () => navigate(mod.routeUrl(hit));
    box.querySelector('.ph-x').onclick = () => {
      box.style.display = 'none';
    };
    go.focus();
  });
  // 用户重新开始输入就收起来，避免提示一直挂在那儿
  input.addEventListener('input', () => {
    const box = host.querySelector('.paste-hint');
    if (box) box.style.display = 'none';
  });
}
bindPasteRoute(document.getElementById('hero-search'), document.querySelector('.hero-search-wrap'));
bindPasteRoute(document.getElementById('palette-input'), document.querySelector('#palette .pal-box'));

// 占位文案按视口宽度取舍：窄屏放不下长提示，会被截成半个括号
// 顶部搜索框的文案由 applyStaticText() 负责（要跟语言切换联动），这里只处理首页大搜索框
(function adaptPlaceholders() {
  const hero = document.getElementById('hero-search');
  if (!hero) return;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  hero.placeholder =
    window.innerWidth < 600
      ? '搜索工具或资源…'
      : `搜索工具或资源…（${isMac ? '⌘' : 'Ctrl'} K 打开命令面板）`;
})();
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    PALETTE.open ? closePalette() : openPalette();
  }
});
/* ---------- 首页搜索框的「也许你要」直达条（v3.11） ---------- */
// 命令面板早就会做意图识别（E4），但首页大框只在按回车时用一次——用户既不知道要回车，
// 也不知道打完一句话能直接进工具。这里改成边打边认，规则表仍按需加载，不进首屏。
let heroIntentBox = null;
let heroIntentTimer = 0;

function hideHeroIntent() {
  if (heroIntentBox) heroIntentBox.hidden = true;
}

function ensureHeroIntentBox() {
  if (heroIntentBox) return heroIntentBox;
  const field = document.querySelector('.hs-field');
  if (!field) return null;
  heroIntentBox = document.createElement('div');
  heroIntentBox.className = 'hero-intent';
  heroIntentBox.id = 'hero-intent';
  heroIntentBox.hidden = true;
  field.after(heroIntentBox);
  return heroIntentBox;
}

async function showHeroIntent(q) {
  const box = ensureHeroIntentBox();
  if (!box) return;
  const mod = await ensureIntent();
  const ctx = await mod.loadContext();
  // 等待期间用户可能已经改了输入或换了页面，回来先确认还是同一句话
  const live = document.getElementById('hero-search');
  if (!mod || !live || live.value.trim() !== q) return;
  // 命中工具是某条流程的后半段时推整条流程（理由见 intent.js 的 recommend）
  const nameOf = (id) => {
    const x = REGISTRY && REGISTRY.tools.find((r) => r.id === id);
    return x && isLocalTool(x) ? toolMeta(x).name : null;
  };
  const sug = mod.recommend(q, { ...ctx, nameOf, t });
  if (!sug) return hideHeroIntent();
  box.innerHTML = `<span class="hi-tag">${esc(sug.tag)}</span>
    <b>${esc(sug.name)}</b>
    ${sug.desc ? `<span class="hi-params">${esc(sug.desc)}</span>` : ''}
    <span class="hi-go">${esc(sug.go)}</span>`;
  box.hidden = false;
  box.onclick = () => navigate(sug.url);
}

// 只有「像句子」的输入才值得拉规则表：太短（≤3 字）或纯英文/拼音的，交给普通搜索
function scheduleHeroIntent(raw) {
  clearTimeout(heroIntentTimer);
  const q = (raw || '').trim();
  if (q.length < 4 || !/[\u4e00-\u9fa5]/.test(q)) return hideHeroIntent();
  heroIntentTimer = setTimeout(() => showHeroIntent(q), 180);
}

(function bindHeroSearch() {
  const heroInput = document.getElementById('hero-search');
  if (heroInput) {
    heroInput.addEventListener('input', () => {
      const v = heroInput.value;
      $('#search').value = v;
      scheduleHeroIntent(v);
      if (REGISTRY) {
        curPage = 1; // 首页唯一输入框：改字就回第一页
        renderFeatured(REGISTRY.tools);
        renderGrid(REGISTRY.tools, v);
      }
    });
    heroInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      // 像句子就按意图直达工具（参数已预填），否则回到列表继续浏览
      const q = heroInput.value.trim();
      if (q.length >= 4) {
        const mod = await ensureIntent();
        const hit = mod && mod.parseIntent(q);
        if (hit) {
          hideHeroIntent();
          navigate(mod.intentUrl(hit));
          return;
        }
      }
      document.getElementById('grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
})();

// 注册 Service Worker（离线可用 + 可安装为桌面应用）
// 装成应用（PWA）：beforeinstallprompt 必须在页面极早期捕获，否则会被浏览器丢弃，
// 存到全局量上，/offline/ 页的「安装到桌面」按钮直接消费它。
window.__INSTALL_PROMPT__ = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__INSTALL_PROMPT__ = e;
});
window.addEventListener('appinstalled', () => {
  window.__INSTALL_PROMPT__ = null;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 离线能力可选，注册失败不影响正常使用 */
    });
  });
}

route();

