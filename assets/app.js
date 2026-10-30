// ToolHub 主逻辑 v0.6：注册表 → 渲染 → hash 路由（Manifest 驱动表单）
// 新增：深色模式 / 收藏 / URL 分类状态 / 关于与提交页 / 快捷键 / 回顶
import { setProgressHandler } from '/assets/pyodide-runtime.js';
import { CHAINS, setHandoff, takeHandoff } from '/assets/pipeline.js';
let REGISTRY = null;
let I18N = null;
let D18N = null; // 工具详情页英文内容
let LANG = localStorage.getItem('toolhub:lang') || 'zh';
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
const SITE = 'ToolHub · 开源工具，打开即用';

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
  localStorage.setItem('toolhub:lang', LANG);
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
  $('#lang-btn').textContent = LANG === 'en' ? '🌐 中' : '🌐 EN';
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
const ANALYTICS_OPT_OUT = 'toolhub:no-analytics';

function analyticsOptedOut() {
  try {
    return localStorage.getItem(ANALYTICS_OPT_OUT) === '1';
  } catch {
    return false;
  }
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
  const saved = localStorage.getItem('toolhub:theme');
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (sysDark ? 'dark' : 'light'));
}
$('#theme-btn') && $('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('toolhub:theme', next);
});
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('toolhub:theme', next);
}
initTheme();
initAnalytics();

/* ---------- 收藏 ---------- */
const favs = () => JSON.parse(localStorage.getItem('toolhub:favs') || '[]');
function toggleFav(id, btn) {
  const list = favs();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  localStorage.setItem('toolhub:favs', JSON.stringify(list));
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
    dir = await (await fetch('/tools/directory.json')).json();
  } catch (e) {
    /* 目录可选，缺失不阻塞 */
  }
  REGISTRY = {
    ...local,
    categories: [...new Set([...local.categories, ...dir.tools.map((t) => t.category)])],
    tools: [...local.tools, ...dir.tools.map((t) => ({ ...t, runtime: 'link' }))],
    counts: { local: local.tools.length, dir: dir.tools.length },
  };
  return REGISTRY;
}

const CAT_ICONS = { 文本: '📝', 图片: '🖼️', 文档: '📄', 数据: '📊', 开发: '⚙️', 设计: '🎨', 音视频: '🎵', 效率: '⚡', 网络: '🌐' };

/* ---------- 首页 ---------- */
function renderChips(categories) {
  const hasFav = favs().length > 0;
  const hasUsage = Object.keys(usageMap()).length > 0;
  const labels = [
    { key: '全部', label: t('全部', 'all') },
    ...(hasUsage ? [{ key: '🔥 最常用', label: t('🔥 最常用', 'mostUsed') }] : []),
    ...(hasFav ? [{ key: '⭐ 收藏', label: t('⭐ 收藏', 'favorites') }] : []),
    ...categories.map((c) => ({ key: c, label: catName(c) })),
  ];
  $('#chips').innerHTML = labels
    .map((c) => `<button class="chip ${c.key === activeCategory ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`)
    .join('');
  $$('#chips .chip').forEach((el) => {
    el.onclick = () => {
      activeCategory = el.dataset.cat;
      curPage = 1; // 换分类回到第一页，否则可能停在已不存在的第 4 页
      syncUrlState();
      renderHome();
    };
  });
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
    : `<span class="badge link">${t('🌐 在线直达', 'badgeLink')}</span>`;
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
function toolScore(tool, kw) {
  if (!kw) return 1;
  const m = toolMeta(tool);
  const name = (tool.name + ' ' + m.name).toLowerCase();
  const tags = ((tool.tags || []).join(' ') + ' ' + tool.name).toLowerCase();
  const alias = (tool.aliases || []).join(' ').toLowerCase();
  const desc = (tool.desc + ' ' + m.desc).toLowerCase();
  let s = 0;
  if (name.includes(kw)) s += name.startsWith(kw) ? 100 : 60;
  if (tags.includes(kw)) s += 40;
  if (alias.includes(kw)) s += 30;
  if (desc.includes(kw)) s += 10;
  return s;
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
  const titleEl = sec.querySelector('.section-title');
  if (titleEl) titleEl.innerHTML = `⚡ <span>${t('高频推荐', 'featured')}</span><em>${t('大家都在用 · 优先试试这些', 'featuredSub')}</em>`;
  $('#featured-grid').innerHTML = ids
    .map((id, i) => {
      const tool = tools.find((x) => x.id === id);
      const m = toolMeta(tool);
      return `<div class="fl-row" data-id="${tool.id}" data-link="${tool.runtime !== 'link' ? '' : esc(tool.url)}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <div class="f-body"><div class="f-name">${m.name}</div><div class="f-desc">${m.desc}</div></div>
        <span class="f-meta">${tool.runtime !== 'link' ? t('🔒 本地运行', 'badgeLocal') : t('🌐 在线直达', 'badgeLink')} · ${catName(tool.category)}</span>
      </div>`;
    })
    .join('');
  bindCards($('#featured-grid'));
}

function renderGrid(tools, keyword) {
  const kw = (keyword || '').trim().toLowerCase();
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
    const emptyMsg =
      activeCategory === '⭐ 收藏' ? t('收藏夹是空的，点卡片右上角 ☆ 添加', 'emptyFav')
      : activeCategory === '🔥 最常用' ? t('还没有使用记录，运行任意工具后这里会自动统计', 'emptyUsed')
      : activeRuntime !== 'all' ? t('当前筛选下没有工具，试试切回「全部」', 'emptyRuntime')
      : t('没有匹配的工具，换个关键词试试', 'emptyAll');
    gridEl.innerHTML = `
      <div class="empty">
        <div style="font-size:32px;margin-bottom:8px">🔍</div>
        ${emptyMsg}
        <div style="margin-top:14px"><button class="btn ghost" id="reset-filter">${t('查看全部工具', 'viewAll')}</button></div>
      </div>`;
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
  const info = LANG === 'en' ? `${shownFrom}–${shownTo} of ${total}` : `第 ${shownFrom}–${shownTo} 个，共 ${total} 个`;
  box.innerHTML =
    `<button type="button" class="pg-btn" data-page="${curPage - 1}"${curPage === 1 ? ' disabled' : ''} aria-label="${prevLabel}">‹</button>` +
    nums.join('') +
    `<button type="button" class="pg-btn" data-page="${curPage + 1}"${curPage === pages ? ' disabled' : ''} aria-label="${nextLabel}">›</button>` +
    `<span class="pg-info">${info}</span>`;
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

/* ---------- 资源库 ---------- */
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

function resCard(c) {
  return `<a class="res-card" href="/resources/${c.slug}/">
    <div class="res-card-icon">${c.icon || '📚'}</div>
    <div class="res-card-body">
      <b>${c.title}</b>
      <span>${c.desc}</span>
      <em>${c.items.length} 个来源</em>
    </div>
  </a>`;
}

async function openResources() {
  const res = await loadResources();
  await loadI18n();
  setView('page');
  document.title = `资源库 · ${SITE}`;
  renderNavActive('/resources');
  const groups = res.groups || [];
  const sections = groups
    .map((g) => {
      const list = res.collections.filter((c) => c.group === g.key);
      if (!list.length) return '';
      return `<h2 class="res-group-title">${g.label}</h2><div class="res-grid">${list.map(resCard).join('')}</div>`;
    })
    .join('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:1000px">
      <h1>📚 资源库</h1>
      <p class="lead">精选的免费可用资源：图标、字体、配色、学习路线。与工具的区别是——工具用来「做事」，资源用来「拿来用、下载或参考」。</p>
      <div class="res-policy">⚖️ <b>授权说明</b>　${res.policy}</div>
      ${sections}
      <p class="cmp-tip">收录标准：免费可用 · 授权清晰（每条都标注） · 长期可访问。不收需要注册才能看内容、授权不明或带诱导广告的站点。</p>
    </div>`;
}

async function openResourceCollection(slug) {
  const res = await loadResources();
  await loadI18n();
  const c = res.collections.find((x) => x.slug === slug);
  if (!c) {
    $('#page-body').innerHTML = '<div class="empty">合集不存在</div>';
    return;
  }
  setView('page');
  document.title = `${c.title} · 资源库 · ToolHub`;
  renderNavActive('/resources');

  const rec = c.items.filter((x) => x.recommended);
  const others = c.items.filter((x) => !x.recommended);
  const itemRow = (it) => `
    <div class="res-item">
      <div class="res-item-head">
        <a href="${esc(it.url)}" target="_blank" rel="noopener" class="res-item-name">${it.name} ↗</a>
        <span class="res-license">${it.license}</span>
      </div>
      <div class="res-item-note">${it.note}</div>
      <div class="res-item-meta">${(it.tags || []).map((x) => `<span class="badge">${x}</span>`).join('')}<span class="res-src">${it.source}</span></div>
    </div>`;

  // 相关工具
  const reg = await loadRegistry();
  const relTools = (c.relatedTools || [])
    .map((id) => reg.tools.find((x) => x.id === id))
    .filter(Boolean);

  $('#page-body').innerHTML = `
    <div class="page" style="max-width:1000px">
      <div class="crumb" style="margin-bottom:10px"><a href="/resources/">← 资源库</a></div>
      <h1>${c.icon || '📚'} ${c.title}</h1>
      <p class="lead">${c.desc}</p>
      <div class="res-intro">${c.intro}</div>

      ${rec.length ? `<h2 class="res-group-title">✦ 编辑精选</h2><div class="res-list">${rec.map(itemRow).join('')}</div>` : ''}

      <h2 class="res-group-title">全部来源（${c.items.length}）</h2>
      <div class="res-list">${(rec.length ? others : c.items).map(itemRow).join('')}</div>

      ${
        c.choices?.length
          ? `<h2 class="res-group-title">怎么选</h2><ul class="res-choices">${c.choices.map((x) => `<li>${x}</li>`).join('')}</ul>`
          : ''
      }

      ${
        relTools.length
          ? `<h2 class="res-group-title">配套工具</h2><div class="related-row">${relTools
              .map((x) => `<div class="related-chip" data-id="${x.id}">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div>`)
              .join('')}</div>`
          : ''
      }

      <div class="res-policy">⚖️ <b>授权说明</b>　${res.policy}</div>
    </div>`;

  $('#page-body').querySelectorAll('.related-chip[data-id]').forEach((el) => {
    kbLink(el, () => navigate('/tools/' + el.dataset.id + '/'));
  });
}

/* ---------- 内容路由卡（首页三类内容） ---------- */
function renderRouteCards(reg, res, evals) {
  const box = document.getElementById('route-cards');
  if (!box) return;
  // v3.4：四个板块并成一行，每块一个徽章 + 一个标签（颜色靠 rc--* 区分，不用再靠文字分辨）
  // v3.9：每张卡以数字打头，原来单独一行的六项统计（工具/本地/分类/资源/上传/评测）全并进来。
  //       这四个板块本来就是中文硬编码（没走 i18n），保持原状，别在这里引入半套翻译。
  box.innerHTML = `
    <a class="route-card rc--tools" href="#tools-anchor" data-scroll="grid">
      <span class="rc-badge" aria-hidden="true">🧰</span><span class="rc-tag">工具箱</span>
      <b><span class="rc-num">${reg.counts.local + reg.counts.dir}</span>个工具</b>
      <span class="rc-desc">${reg.counts.local} 个纯本地执行 · ${reg.categories.length} 个分类</span>
      <em>浏览工具 →</em>
    </a>
    <a class="route-card rc--res" href="/resources/">
      <span class="rc-badge" aria-hidden="true">📚</span><span class="rc-tag">资源库</span>
      <b><span class="rc-num">${(res.collections || []).reduce((a, c) => a + c.items.length, 0)}</span>条资源</b>
      <span class="rc-desc">${(res.collections || []).length} 个合集：图标、字体、配色、学习路线</span>
      <em>逛资源库 →</em>
    </a>
    <a class="route-card rc--compare" href="/compare/">
      <span class="rc-badge" aria-hidden="true">⇄</span><span class="rc-tag">对比台</span>
      <b><span class="rc-num">0</span>数据上传</b>
      <span class="rc-desc">同类并排看：是否上传数据、能否离线、协议与来源</span>
      <em>开始对比 →</em>
    </a>
    <a class="route-card rc--eval" href="/evaluations/">
      <span class="rc-badge" aria-hidden="true">🔬</span><span class="rc-tag">评测室</span>
      <b><span class="rc-num">${(evals?.evaluations || []).length}</span>篇评测</b>
      <span class="rc-desc">横向实测：隐私、速度、功能边界一次讲清</span>
      <em>读评测 →</em>
    </a>`;
  const scrollCard = box.querySelector('[data-scroll]');
  if (scrollCard) {
    scrollCard.onclick = (e) => {
      e.preventDefault();
      document.getElementById('grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
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

/* ---------- 专题合集 ---------- */
let TOPICS = null;
async function loadTopics() {
  if (TOPICS) return TOPICS;
  try {
    TOPICS = await (await fetch('/topics.json')).json();
  } catch {
    TOPICS = { topics: [] };
  }
  return TOPICS;
}

async function openTopics() {
  const data = await loadTopics();
  const reg = await loadRegistry();
  await loadI18n();
  setView('page');
  document.title = `专题合集 · ${SITE}`;
  renderNavActive('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:1000px">
      <h1>🧩 专题合集</h1>
      <p class="lead">按「要完成的事」打包好的工具组合，不用自己从 ${reg.tools.length} 个工具里挑。每个专题都包含使用顺序、关联资源与常见问题。</p>
      <div class="topic-grid">
        ${data.topics
          .map(
            (t) => `<a class="topic-card" href="/topics/${t.slug}/">
              <span class="tp-icon">${t.icon}</span>
              <b>${t.title}</b>
              <span>${t.desc}</span>
              <em>${t.tools.length} 个工具${t.resources?.length ? ' · ' + t.resources.length + ' 个资源合集' : ''} →</em>
            </a>`
          )
          .join('')}
      </div>
    </div>`;
}

async function openTopic(slug) {
  const data = await loadTopics();
  const reg = await loadRegistry();
  await loadI18n();
  const tp = data.topics.find((x) => x.slug === slug);
  if (!tp) {
    $('#page-body').innerHTML = '<div class="empty">专题不存在</div>';
    return;
  }
  const res = await loadResources();
  setView('page');
  document.title = `${tp.title} · 专题 · ToolHub`;
  renderNavActive('');
  const tools = tp.tools.map((id) => reg.tools.find((x) => x.id === id)).filter(Boolean);
  const cols = (tp.resources || []).map((s) => res.collections.find((c) => c.slug === s)).filter(Boolean);
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:1000px">
      <div class="crumb" style="margin-bottom:10px"><a href="/topics/">← 全部专题</a></div>
      <h1>${tp.icon} ${tp.title}</h1>
      <p class="lead">${tp.desc}</p>
      <div class="res-intro">${tp.intro}</div>

      <h2 class="res-group-title">按顺序用</h2>
      <div class="topic-steps">
        ${tools
          .map(
            (x, i) => `<a class="topic-step" href="/tools/${x.id}/">
              <span class="ts-num">${i + 1}</span>
              <span class="ts-body"><b>${toolMeta(x).name}</b><em>${toolMeta(x).desc}</em></span>
              <span class="ts-badge">${x.runtime === 'link' ? '官网' : '本地'}</span>
            </a>`
          )
          .join('')}
      </div>

      ${
        cols.length
          ? `<h2 class="res-group-title">配套资源</h2><div class="related-row">${cols
              .map((c) => `<a class="related-chip" href="/resources/${c.slug}/">${c.icon || '📚'} ${c.title}</a>`)
              .join('')}</div>`
          : ''
      }

      ${
        tp.guides?.length
          ? `<h2 class="res-group-title">常见问题</h2>${tp.guides
              .map((g) => `<div class="res-item"><div class="res-item-head"><b>${g.title}</b></div><div class="res-item-note">${g.body}</div></div>`)
              .join('')}`
          : ''
      }
    </div>`;
}

/* ---------- 工具评测 ---------- */
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

async function openEvaluations() {
  const data = await loadEvaluations();
  await loadI18n();
  setView('page');
  document.title = `工具评测 · ${SITE}`;
  renderNavActive('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:1000px">
      <h1>🔬 工具评测</h1>
      <p class="lead">同类工具横向实测：不吹不黑，把隐私边界、速度体验和功能取舍讲清楚。每篇都标注测试日期，结论会随工具版本变化。</p>
      <div class="topic-grid">
        ${data.evaluations
          .map(
            (ev) => `<a class="topic-card" href="/evaluations/${ev.slug}/">
              <span class="tp-icon">${ev.icon}</span>
              <b>${ev.title}</b>
              <span>${ev.summary}</span>
              <em>${ev.date} · ${ev.items.length} 款对比 →</em>
            </a>`
          )
          .join('')}
      </div>
    </div>`;
}

async function openEvaluation(slug) {
  const data = await loadEvaluations();
  const ev = data.evaluations.find((x) => x.slug === slug);
  if (!ev) {
    $('#page-body').innerHTML = '<div class="empty">评测不存在</div>';
    return;
  }
  await loadI18n();
  const reg = await loadRegistry();
  setView('page');
  document.title = `${ev.title} · 工具评测 · ${SITE}`;
  renderNavActive('');
  const pvClass = (p) => {
    if (p === '完全本地' || p === '本地优先') return 'ok';
    if (p === '需上传' || p === '服务器' || p === '部分上传') return 'warn';
    return 'mid';
  };
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <div class="crumb" style="margin-bottom:10px"><a href="/evaluations/">← 全部评测</a></div>
      <h1>${ev.icon} ${ev.title}</h1>
      <p class="lead">${ev.summary}</p>
      <div class="res-intro" style="font-size:13px;color:var(--muted)">实测日期：${ev.date} · 对比 ${ev.items.length} 款工具</div>
      <div class="eval-verdict"><b>结论</b><p>${ev.verdict}</p></div>

      <h2 class="res-group-title">逐项对比</h2>
      <div class="eval-grid">
        ${ev.items
          .map(
            (it) => `<div class="eval-card">
            <div class="eval-card-head">
              ${it.url ? `<a href="${it.url}"${it.url.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}><b>${it.name}</b></a>` : `<b>${it.name}</b>`}
              <span class="eval-type">${it.type}</span>
            </div>
            <div class="eval-meta"><span class="pv-badge pv-${pvClass(it.privacy)}">隐私：${it.privacy}</span></div>
            <div class="eval-pc">
              <div class="eval-pros"><b>✓ 优势</b><ul>${it.pros.map((x) => `<li>${x}</li>`).join('')}</ul></div>
              <div class="eval-cons"><b>✗ 短板</b><ul>${it.cons.map((x) => `<li>${x}</li>`).join('')}</ul></div>
            </div>
          </div>`
          )
          .join('')}
      </div>

      <h2 class="res-group-title">详细解读</h2>
      ${ev.body.map((p) => `<p class="res-intro">${p}</p>`).join('')}

      ${
        ev.relatedTools?.length
          ? `<h2 class="res-group-title">文中提到的工具</h2><div class="related-row">${ev.relatedTools
              .map((id) => {
                const tool = reg.tools.find((x) => x.id === id);
                if (!tool) return '';
                return `<a class="related-chip" href="/tools/${id}/">${toolMeta(tool).name}</a>`;
              })
              .join('')}</div>`
          : ''
      }
      <div class="crumb" style="margin-top:24px"><a href="/evaluations/">← 全部评测</a></div>
    </div>`;
}

/* ---------- 更新日志 ---------- */
let LOGDATA = null;
async function loadLog() {
  if (LOGDATA) return LOGDATA;
  try {
    LOGDATA = await (await fetch('/changelog.json')).json();
  } catch {
    LOGDATA = { entries: [] };
  }
  return LOGDATA;
}

async function openChangelog() {
  const data = await loadLog();
  setView('page');
  document.title = `更新日志 · ${SITE}`;
  renderNavActive('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:820px">
      <h1>📝 更新日志</h1>
      <p class="lead">这个平台在持续迭代。每一步改动都记录在这里，也提供 <a href="/feed.xml">RSS 订阅</a>。</p>
      ${data.entries
        .map(
          (e) => `<div class="log-entry">
            <div class="log-head"><b>${e.version}</b><span>${e.date}</span></div>
            <div class="log-title">${e.title}</div>
            <ul>${e.items.map((x) => `<li>${x}</li>`).join('')}</ul>
          </div>`
        )
        .join('')}
    </div>`;
}

/* ---------- 工具对比 ---------- */
const CMP_KEY = 'toolhub:compare';
const cmpList = () => JSON.parse(localStorage.getItem(CMP_KEY) || '[]');
const cmpSet = (ids) => localStorage.setItem(CMP_KEY, JSON.stringify(ids.slice(0, 4)));

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
  return JSON.parse(localStorage.getItem('toolhub:recent') || '[]');
}
function pushRecent(id) {
  const list = recentIds().filter((x) => x !== id);
  list.unshift(id);
  localStorage.setItem('toolhub:recent', JSON.stringify(list.slice(0, 8)));
}
// 使用计数：仅存本机 localStorage，不上报任何服务器
function usageMap() {
  return JSON.parse(localStorage.getItem('toolhub:usage') || '{}');
}
function pushUsage(id) {
  const m = usageMap();
  m[id] = (m[id] || 0) + 1;
  localStorage.setItem('toolhub:usage', JSON.stringify(m));
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
  document.title = LANG === 'en' ? 'ToolHub · Open-source tools, ready to use' : SITE;
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
function renderNavActive(path) {
  const map = { '/': 'tools', '/resources': 'resources', '/compare': 'compare', '/about': 'about' };
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
  document.getElementById('res-preview-grid').innerHTML = list
    .map(
      (c) => `<a class="res-preview-card" href="/resources/${c.slug}/">
        <span class="rp-icon">${c.icon || '📚'}</span>
        <span class="rp-title">${c.title}</span>
        <span class="rp-desc">${c.desc}</span>
        <span class="rp-count">${c.items.length} 个来源 →</span>
      </a>`
    )
    .join('');
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
    $, $$, esc, t, toolMeta, catName, navigate, loadRegistry, loadI18n, loadArticles,
    kbLink, pushRecent, usageMap, pushUsage, cmpList, toggleCompare, CAT_ICONS, SITE, renderNavActive,
    getRegistry: () => REGISTRY,
    getLang: () => LANG,
    getD18N: () => D18N,
    getSeoBody: () => SEO_BODY,
    stateHTML,
    CHAINS, setHandoff, takeHandoff, setProgressHandler,
    ensureCss,
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
  offline: '/assets/style.offline.css',
  submit: '/assets/style.submit.css',
};

async function openPage(name) {
  const reg = await loadRegistry();
  await loadI18n();
  const { makePages } = await import('/assets/lib/pages.js');
  // 隐私页需要知道「本机是否已关闭统计」以及那个 localStorage 键名，随调用注入
  const PAGES = makePages(reg, { analyticsOptedOut, ANALYTICS_OPT_OUT });
  if (PAGE_CSS[name]) ensureCss(PAGE_CSS[name]);
  const fn = PAGES[name];
  setView('page');
  const titles = { about: '关于', submit: '推荐工具', feedback: '意见反馈', privacy: '隐私说明', batch: '批量处理', offline: '离线包与安装' };
  document.title = `${titles[name] || '页面'} · ${SITE}`;
  $('#page-body').innerHTML = fn ? fn() : stateHTML('empty', { title: '页面不存在', detail: '看看地址是否拼错，或回到首页重新找。' });

  // 反馈页的复制模板
  const copyBtn = document.getElementById('fb-copy');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const text = document.getElementById('fb-tpl').textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => (copyBtn.textContent = '复制模板'), 1600);
      } catch {
        copyBtn.textContent = '复制失败，请手动选中复制';
      }
    };
  }

  // 隐私页：本机统计开关（只写 localStorage，不上传）
  const optOut = document.getElementById('analytics-optout');
  if (optOut) {
    optOut.onclick = () => {
      const next = optOut.dataset.off !== '1';
      try {
        localStorage.setItem(ANALYTICS_OPT_OUT, next ? '1' : '0');
      } catch {
        /* 隐私模式禁写：按钮状态仍然反映本次意图 */
      }
      optOut.dataset.off = next ? '1' : '0';
      optOut.textContent = next ? '恢复统计' : '在本机关闭统计';
    };
  }

  // 批量处理页：按需加载（不进首屏包）
  const batchBox = document.getElementById('batch-app');
  if (batchBox) {
    try {
      const { mountBatch } = await import('/assets/batch.js');
      mountBatch(batchBox);
    } catch (e) {
      batchBox.innerHTML = stateHTML('error', { title: '批量模块加载失败', detail: e.message });
    }
  }

  // 离线包页：按需加载（不进首屏包）
  const offBox = document.getElementById('offline-app');
  if (offBox) {
    try {
      const { mountOffline } = await import('/assets/offline.js');
      await mountOffline(offBox);
    } catch (e) {
      offBox.innerHTML = stateHTML('error', { title: '离线模块加载失败', detail: e.message });
    }
  }

  // 提交页的工具包生成器：按需加载（不进首屏包）
  const builderBox = document.getElementById('tool-builder');
  if (builderBox) {
    try {
      const { mountToolBuilder } = await import('/assets/toolbuilder.js');
      await mountToolBuilder(builderBox);
    } catch (e) {
      builderBox.innerHTML = stateHTML('error', {
        title: '生成器加载失败',
        detail: `${e.message}。可直接参考仓库里的 docs/TOOL-CONTRACT.md 手写。`,
      });
    }
  }
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
  if (p === '/changelog') return openChangelog();
  if (p === '/evaluations') return openEvaluations();
  const evalSlug = p.match(/^\/evaluations\/([\w-]+)$/);
  if (evalSlug) return openEvaluation(evalSlug[1]);
  if (p === '/topics') return openTopics();
  const topicSlug = p.match(/^\/topics\/([\w-]+)$/);
  if (topicSlug) return openTopic(topicSlug[1]);
  if (p === '/resources') return openResources();
  const resSlug = p.match(/^\/resources\/([\w-]+)$/);
  if (resSlug) return openResourceCollection(resSlug[1]);
  if (p === '/compare') {
    const ids = new URLSearchParams(location.search).get('ids');
    return openCompare(ids ? ids.split(',').filter(Boolean) : null);
  }
  const page = p.match(/^\/(about|submit|feedback|privacy|batch|offline)$/);
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
(function bindHeroSearch() {
  const heroInput = document.getElementById('hero-search');
  if (heroInput) {
    heroInput.addEventListener('input', () => {
      const v = heroInput.value;
      $('#search').value = v;
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

