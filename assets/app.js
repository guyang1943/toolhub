// ToolHub 主逻辑 v0.6：注册表 → 渲染 → hash 路由（Manifest 驱动表单）
// 新增：深色模式 / 收藏 / URL 分类状态 / 关于与提交页 / 快捷键 / 回顶
import { setProgressHandler } from '/assets/pyodide-runtime.js';
let REGISTRY = null;
let I18N = null;
let D18N = null; // 工具详情页英文内容
let LANG = localStorage.getItem('toolhub:lang') || 'zh';
let activeCategory = '全部';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SITE = 'ToolHub · 开源工具，打开即用';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  $('#search').placeholder = ph;
  $('#foot-note').innerHTML = t(
    '🔒 本地工具的数据仅在您的浏览器中处理，不会上传 · 🌐 目录工具均为第三方开源项目，版权与内容归各项目所有，来源仓库见工具卡片',
    'footerNote'
  );
}
$('#lang-btn') && $('#lang-btn').addEventListener('click', switchLang);
if (LANG === 'en') {
  document.documentElement.lang = 'en';
  $('#lang-btn').textContent = '🌐 中';
  document.title = 'ToolHub · Open-source tools, ready to use';
}

/* ---------- 主题 ---------- */
/* ---------- Cloudflare Web Analytics ---------- */
// 统计开关：编辑根目录 analytics.json 填入 token 即启用；留空则零统计脚本
async function initAnalytics() {
  try {
    const cfg = await (await fetch('/analytics.json')).json();
    if (!cfg || !cfg.token) return;
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: cfg.token }));
    document.head.appendChild(s);
  } catch {
    /* 配置缺失时静默跳过，不影响站点功能 */
  }
}

function initTheme() {
  const saved = localStorage.getItem('toolhub:theme');
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (sysDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  $('#theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
}
$('#theme-btn') && $('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('toolhub:theme', next);
  $('#theme-btn').textContent = next === 'dark' ? '☀️' : '🌙';
});
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
// 静态页面里为爬虫准备的正文，脚本接管后移除
const seoStatic = document.getElementById('seo-static');
if (seoStatic) seoStatic.remove();

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
      const url = new URL(location.href);
      url.searchParams.set('cat', activeCategory);
      history.replaceState(null, '', url);
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

function bindCards(container) {
  // 注意：普通卡片用 .card，推荐区用 .featured-card，统一按 [data-id] 绑定
  container.querySelectorAll('[data-id]').forEach((el) => {
    el.onclick = (ev) => {
      if (ev.target.dataset.fav || ev.target.classList.contains('go-btn')) return; // 星标与外链单独处理
      navigate('/tools/' + el.dataset.id + '/');
    };
  });
  container.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      toggleFav(btn.dataset.fav, btn);
    };
  });
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
  const ids = (REGISTRY.featured || []).filter((id) => tools.some((t) => t.id === id));
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
      return `<div class="featured-card" data-id="${tool.id}" data-link="${tool.runtime !== 'link' ? '' : esc(tool.url)}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <div class="f-body">
          <div class="f-name">${m.name}</div>
          <div class="f-desc">${m.desc}</div>
          <div class="f-meta">${tool.runtime !== 'link' ? t('🔒 本地运行', 'badgeLocal') : t('🌐 在线直达', 'badgeLink')} · ${catName(tool.category)}</div>
        </div>
      </div>`;
    })
    .join('');
  bindCards($('#featured-grid'));
}

function renderGrid(tools, keyword) {
  const kw = (keyword || '').trim().toLowerCase();
  const favList = favs();
  const usage = usageMap();
  const list = tools
    .map((tool) => {
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
      if (activeCategory === '🔥 最常用') return (usage[b[0].id] || 0) - (usage[a[0].id] || 0);
      return (
        (b[0].runtime === 'browser') - (a[0].runtime === 'browser') ||
        (b[0].hot ? 1 : 0) - (a[0].hot ? 1 : 0)
      );
    })
    .map((x) => x[0]);

  if (!list.length) {
    const emptyMsg =
      activeCategory === '⭐ 收藏' ? t('收藏夹是空的，点卡片右上角 ☆ 添加', 'emptyFav')
      : activeCategory === '🔥 最常用' ? t('还没有使用记录，运行任意工具后这里会自动统计', 'emptyUsed')
      : t('没有匹配的工具，换个关键词试试', 'emptyAll');
    $('#grid').innerHTML = `
      <div class="empty">
        <div style="font-size:32px;margin-bottom:8px">🔍</div>
        ${emptyMsg}
        <div style="margin-top:14px"><button class="btn ghost" id="reset-filter">${t('查看全部工具', 'viewAll')}</button></div>
      </div>`;
    const rb = $('#reset-filter');
    if (rb) rb.onclick = () => { activeCategory = '全部'; $('#search').value = ''; renderHome(); };
    return;
  }
  $('#grid').innerHTML = list.map((tool) => cardHTML(tool)).join('');
  bindCards($('#grid'));
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
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
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
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
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
    el.onclick = () => navigate('/tools/' + el.dataset.id + '/');
  });
}

/* ---------- 内容路由卡（首页三类内容） ---------- */
function renderRouteCards(reg, res, evals) {
  const box = document.getElementById('route-cards');
  if (!box) return;
  box.innerHTML = `
    <a class="route-card" href="#tools-anchor" data-scroll="grid">
      <span class="rc-icon">🧰</span>
      <b>${reg.counts.local + reg.counts.dir} 个工具</b>
      <span>按任务或分类找工具，能本地跑的都在本地跑</span>
      <em>浏览工具 →</em>
    </a>
    <a class="route-card" href="/resources/">
      <span class="rc-icon">📚</span>
      <b>${(res.collections || []).length} 个合集 · ${(res.collections || []).reduce((a, c) => a + c.items.length, 0)} 条资源</b>
      <span>图标、字体、配色、学习路线——拿来就能用</span>
      <em>逛资源库 →</em>
    </a>
    <a class="route-card" href="/compare/">
      <span class="rc-icon">⇄</span>
      <b>工具对比</b>
      <span>同类工具并排看：是否上传数据、能否离线、协议与来源</span>
      <em>开始对比 →</em>
    </a>
    <a class="route-card" href="/evaluations/">
      <span class="rc-icon">🔬</span>
      <b>${(evals?.evaluations || []).length} 篇评测</b>
      <span>同类工具横向实测：隐私、速度、功能边界一次讲清</span>
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

function openPalette() {
  const el = document.getElementById('palette');
  if (!el) return;
  el.classList.add('show');
  PALETTE.open = true;
  const input = el.querySelector('#palette-input');
  input.value = '';
  PALETTE.idx = 0;
  renderPaletteResults('');
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  const el = document.getElementById('palette');
  if (!el) return;
  el.classList.remove('show');
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
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
  document.title = `专题合集 · ${SITE}`;
  renderNavActive('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:1000px">
      <h1>🧩 专题合集</h1>
      <p class="lead">按「要完成的事」打包好的工具组合，不用自己从 84 个工具里挑。每个专题都包含使用顺序、关联资源与常见问题。</p>
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
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
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
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
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
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
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
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
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

  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
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
    el.onclick = () => navigate('/tools/' + el.dataset.id + '/');
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
  $('#view-home').style.display = '';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = 'none';
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
  renderGrid(reg.tools, $('#search').value);
  renderCompareBar();
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
  const el = $('#hero-stats');
  const total = reg.counts.local + reg.counts.dir;
  // Hero 标题与副标题（双语）
  const h1 = document.querySelector('.hero h1');
  if (h1 && LANG === 'en') {
    h1.innerHTML = `${t('Great open-source tools from GitHub,', 'heroTitle1')}<br /><span class="grad">${t('ready to use', 'heroTitle2')}</span>`;
  } else if (h1) {
    h1.innerHTML = `把 GitHub 上好用的开源工具<br /><span class="grad">变成打开就能用</span>`;
  }
  const hp = document.querySelector('.hero p');
  if (hp) hp.textContent = t('无需安装、无需注册、无需命令行 —— 挑一个工具，填参数，出结果。', 'heroDesc');

  el.innerHTML = `
    <div class="stat"><b>${total}</b><span>${t('精选工具', 'statTools')}</span></div>
    <div class="stat"><b>${reg.counts.local}</b><span>${t('本地执行', 'statLocal')}</span></div>
    <div class="stat"><b>${reg.categories.length}</b><span>${t('分类', 'statCats')}</span></div>
    <div class="stat"><b>0</b><span>${t('数据上传', 'statUpload')}</span></div>
    <button class="random-btn" id="random-btn" title="${t('随机发现一个工具', 'random')}">${t('🎲 随便看看', 'random')}</button>`;
  $('#random-btn').onclick = () => {
    const pool = reg.tools.filter((x) => x.runtime !== 'link');
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) navigate('/tools/' + pick.id + '/');
  };
}

/* ---------- 工具页 ---------- */
function fieldHTML(inp) {
  const ph = inp.placeholder ? `placeholder="${esc(inp.placeholder)}"` : '';
  const dv = inp.default != null ? esc(inp.default) : '';
  switch (inp.type) {
    case 'textarea':
      return `<textarea id="f-${inp.name}" ${ph}>${dv}</textarea>`;
    case 'select':
      return `<select id="f-${inp.name}">${inp.options
        .map((o) => `<option value="${esc(o.value)}" ${o.value === inp.default ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>`;
    case 'range':
      return `<input type="range" id="f-${inp.name}" min="${inp.min}" max="${inp.max}" value="${dv || 75}" style="width:100%">`;
    case 'file':
      return `<input type="file" id="f-${inp.name}" accept="${esc(inp.accept || '*')}" />`;
    case 'number':
      return `<input type="number" id="f-${inp.name}" value="${dv}" ${ph} />`;
    default:
      return `<input type="text" id="f-${inp.name}" value="${dv}" ${ph} />`;
  }
}

async function openTool(id) {
  const reg = await loadRegistry();
  await loadI18n();
  const meta = reg.tools.find((tool) => tool.id === id);
  $('#view-home').style.display = 'none';
  $('#view-page').style.display = 'none';
  $('#view-tool').style.display = '';
  if (!meta) {
    $('#tool-body').innerHTML = '<div class="empty">工具不存在，可能已下线</div>';
    return;
  }
  document.title = LANG === 'en' ? `${toolMeta(meta).name} · ToolHub` : `${meta.name} · ${SITE}`;
  renderNavActive('/');

  // 目录工具：站内详情页 + 跳转官网（页面本身可用于搜索引擎收录）
  if (meta.runtime === 'link') {
    const m = toolMeta(meta);
    const icon2 = CAT_ICONS[meta.category] || '🧰';
    const relLocal = REGISTRY.tools.filter((x) => x.runtime !== 'link' && x.category === meta.category).slice(0, 4);
    const relDir = REGISTRY.tools.filter((x) => x.runtime === 'link' && x.id !== meta.id && x.category === meta.category).slice(0, 4);
    $('#tool-body').innerHTML = `
      <div class="panel">
        <div class="tool-head">
          <h1><span class="h-icon">${icon2}</span>${m.name}<button class="share-btn" id="share-btn" title="复制链接">🔗</button></h1>
          <p class="desc">${m.desc}</p>
          <p class="src">✦ ${t('来源', 'sourceLabel')}：${esc(meta.source)} · License: ${meta.license} · ${t('分类', 'categoryLabel')}：${catName(meta.category)}</p>
        </div>
        <div class="dir-cta">
          <div class="dir-cta-text">
            <b>${t('官方在线版', '') || '官方在线版'}</b>
            <div style="font-size:13px;color:var(--muted);margin-top:4px">
              这是第三方开源项目的官方在线版，点击将在新标签页打开 <code>${esc(new URL(meta.url).hostname)}</code>
            </div>
          </div>
          <a class="btn" href="${esc(meta.url)}" target="_blank" rel="noopener">打开官网 ↗</a>
        </div>
        <div class="panel usage" style="margin-top:16px">
          📘 <b>说明</b>　本页是 ToolHub 对该开源项目的整理与推荐，工具本体由项目作者维护，版权与数据均归原作者所有。
          如果官网无法访问，可能是临时故障或网络限制，可稍后重试或在项目仓库反馈。
        </div>
        ${
          meta.blurb
            ? `<div class="panel tips" style="margin-top:12px">✍️ <b>编辑推荐</b>　${meta.blurb}</div>`
            : ''
        }
      </div>
      ${
        relLocal.length || relDir.length
          ? `<div class="section-title" style="margin-top:22px">🔗 <span>${t('相关工具', 'relatedLocal')}</span></div>
             <div class="related-row">
               ${relLocal
                 .map((x) => `<div class="related-chip" data-id="${x.id}">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div>`)
                 .join('')}
               ${relDir
                 .map((x) => `<div class="related-chip" data-id="${x.id}">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div>`)
                 .join('')}
             </div>`
          : ''
      }`;
    $('#tool-body').querySelectorAll('.related-chip[data-id]').forEach((el) => {
      el.onclick = () => navigate('/tools/' + el.dataset.id + '/');
    });
    const sb2 = $('#share-btn');
    if (sb2) {
      sb2.onclick = async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          sb2.textContent = '✅';
          setTimeout(() => (sb2.textContent = '🔗'), 1600);
        } catch {
          sb2.textContent = '❌';
          setTimeout(() => (sb2.textContent = '🔗'), 1600);
        }
      };
    }
    return;
  }

  pushRecent(meta.id);
  $('#tool-body').innerHTML = `
    <div class="panel" id="tool-form"></div>
    <div class="panel result" id="tool-result" style="display:none"></div>
    <div id="related-panel"></div>`;

  let mod;
  try {
    mod = await import(`/tools/${id}/run.js`);
  } catch (e) {
    $('#tool-body').innerHTML = `<div class="empty">工具加载失败：${esc(e.message)}</div>`;
    return;
  }
  if (!mod.manifest || !mod.run) {
    $('#tool-body').innerHTML = '<div class="empty">该工具缺少 manifest 或 run 定义</div>';
    return;
  }
  const manifest = mod.manifest;
  const icon = CAT_ICONS[meta.category] || '🧰';
  const used = usageMap()[meta.id] || 0;
  const usedNote = used
    ? LANG === 'en'
      ? ` · ${used} ${t('次', 'usedLocal')}`
      : ` · 本机用过 ${used} 次`
    : '';
  // 英译覆盖（缺失时回退中文）
  const d = LANG === 'en' && D18N ? D18N[meta.id] : null;
  const usageText = (d && d.usage) || manifest.usage;
  const tipList = (d && d.tips) || manifest.tips;
  const scenarioList = (d && d.scenarios) || manifest.scenarios;
  const labelOf = (inp) => (d && d.labels && d.labels[inp.name]) || inp.label;
  const runLabel = (d && d.runLabel) || manifest.runLabel || t('运行', 'runDefault');

  let blocks = '';
  if (usageText) blocks += `<div class="panel usage">📘 <b>${t('使用说明', 'detailUsage')}</b>　${usageText}</div>`;
  if (scenarioList && scenarioList.length) {
    blocks += `<details class="panel scenarios" open>
      <summary>📖 ${t('使用场景', 'detailScenarios')}（${scenarioList.length}）</summary>
      <div class="scenario-list">${scenarioList
        .map(
          (s, i) => `<div class="scenario-item">
            <div class="sc-title"><span class="sc-num">${i + 1}</span>${s.scene}</div>
            <div class="sc-flow">${t('做法', 'how')}：${s.how}</div>
            <div class="sc-result">${t('结果', 'result')}：${s.result}</div>
          </div>`
        )
        .join('')}</div>
    </details>`;
  }
  if (tipList && tipList.length)
    blocks += `<div class="panel tips">💡 <b>${t('小贴士', 'detailTips')}</b><ul>${tipList.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;

  // 长尾教程（步骤 + 常见错误，中文模式展示；英文详情见 i18n-detail）
  const article = (await loadArticles())[meta.id];
  if (article && LANG !== 'en') {
    if (article.steps && article.steps.length)
      blocks += `<div class="panel tutorial"><b>📝 使用步骤</b><ol class="tut-steps">${article.steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`;
    if (article.pitfalls && article.pitfalls.length)
      blocks += `<div class="panel tutorial"><b>⚠️ 常见错误</b><div class="pitfall-list">${article.pitfalls
        .map((p) => `<div class="pitfall-item"><b>${p.title}</b><span>${p.body}</span></div>`)
        .join('')}</div></div>`;
  }

  $('#tool-form').innerHTML =
    `<div class="tool-head">
      <h1><span class="h-icon">${icon}</span>${toolMeta(meta).name}<button class="share-btn" id="share-btn" title="复制工具链接">🔗</button><button class="share-btn" id="cmp-btn" title="加入对比">⇄ 加入对比</button><button class="share-btn" id="eg-btn" title="填入示例数据">⌨ 示例</button><button class="share-btn" id="embed-btn" title="复制嵌入代码">&lt;/&gt; 嵌入</button></h1>
      <p class="desc">${toolMeta(meta).desc}</p>
      <p class="src">✦ ${t('来源', 'sourceLabel')}：${meta.source} · License: ${meta.license} · ${t('分类', 'categoryLabel')}：${catName(meta.category)}${usedNote}</p>
      ${LANG === 'en' && !d ? '<p class="src" style="color:#c2570a">⚠️ Detailed instructions are currently available in Chinese only.</p>' : ''}
    </div>` +
    blocks +
    `<div class="panel">${manifest.inputs.map((inp) => `<div class="field"><label>${labelOf(inp)}</label>${fieldHTML(inp)}</div>`).join('')}
      <div class="row"><button class="btn" id="run-btn">${runLabel}</button></div></div>`;

  $('#run-btn').onclick = async () => {
    await doRun();
  };

  async function doRun() {
    const values = {};
    for (const inp of manifest.inputs) {
      const el = document.getElementById('f-' + inp.name);
      values[inp.name] = inp.type === 'file' ? el.files[0] : el.value;
    }
    const box = $('#tool-result');
    box.style.display = '';
    if (meta.runtime === 'pyodide') {
      // Python 工具：首次需下载自托管运行时，展示确定性进度条
      box.innerHTML = `<div class="py-load"><div class="py-load-bar"><div class="py-load-fill" id="py-fill"></div></div><div class="py-load-txt" id="py-txt">正在准备 Python 运行时…</div></div>`;
      setProgressHandler((loaded, total, phase) => {
        const fill = document.getElementById('py-fill');
        const txt = document.getElementById('py-txt');
        if (!fill || !txt) return;
        const mb = (n) => (n / 1048576).toFixed(1);
        if (phase === 'init') {
          fill.style.width = '100%';
          txt.textContent = '正在初始化 Python 环境…';
          return;
        }
        fill.style.width = (total ? Math.min(100, Math.round((loaded / total) * 100)) : 0) + '%';
        const label = total > 20000000 ? 'pandas 数据处理库' : 'Python 运行时';
        txt.textContent = `正在下载${label} ${mb(loaded)} / ${mb(total)} MB（仅首次，之后可离线使用）`;
      });
    } else {
      box.innerHTML = `<div class="empty">${t('处理中…', 'processing')}</div>`;
    }
    try {
      const out = await mod.run(values);
      box.innerHTML = out.html;
      if (out.after) out.after(box);
      pushUsage(meta.id); // 仅本机计数
    } catch (e) {
      box.innerHTML = `<div class="msg-err">${t('出错了：', 'errorPrefix')}${esc(e.message)}</div>`;
    } finally {
      setProgressHandler(null);
    }
  }

  // Ctrl/⌘ + Enter 快捷执行（textarea 内）
  $('#tool-form').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.tagName === 'TEXTAREA') {
      e.preventDefault();
      doRun();
    }
  });

  // 填入示例数据
  const eg = $('#eg-btn');
  if (eg) {
    eg.onclick = () => {
      for (const inp of manifest.inputs) {
        const el = document.getElementById('f-' + inp.name);
        if (!el || inp.type === 'file') continue;
        const v = (manifest.example && manifest.example[inp.name] !== undefined) ? manifest.example[inp.name] : inp.default;
        if (v !== undefined && v !== null && v !== '') el.value = v;
      }
      eg.textContent = '✓ 已填入';
      setTimeout(() => (eg.textContent = '⌨ 示例'), 1500);
    };
  }

  // 复制嵌入代码
  const eb = $('#embed-btn');
  if (eb) {
    eb.onclick = async () => {
      const code = `<iframe src="${location.origin}/tools/${meta.id}/?embed=1" width="100%" height="680" style="border:1px solid #e3e6ea;border-radius:12px" title="${meta.name} · ToolHub" loading="lazy"></iframe>`;
      try {
        await navigator.clipboard.writeText(code);
        eb.textContent = '✓ 已复制';
        setTimeout(() => (eb.textContent = '</> 嵌入'), 1600);
      } catch {
        eb.textContent = '复制失败';
        setTimeout(() => (eb.textContent = '</> 嵌入'), 1600);
      }
    };
  }

  // 加入对比
  const cb = $('#cmp-btn');
  if (cb) {
    const on = cmpList().includes(meta.id);
    cb.textContent = on ? '✓ 已加入对比' : '⇄ 加入对比';
    cb.classList.toggle('on', on);
    cb.dataset.cmpId = meta.id;
    cb.onclick = () => toggleCompare(meta.id);
  }

  // 复制分享链接
  const sb = $('#share-btn');
  if (sb) {
    sb.onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        sb.textContent = '✅';
        setTimeout(() => (sb.textContent = '🔗'), 1600);
      } catch {
        sb.textContent = '❌';
        setTimeout(() => (sb.textContent = '🔗'), 1600);
      }
    };
  }

  const related = REGISTRY.tools
    .filter((t) => t.id !== meta.id && (t.category === meta.category || t.hot) && t.runtime !== 'link')
    .slice(0, 4);
  const relatedDir = REGISTRY.tools
    .filter((t) => t.id !== meta.id && t.runtime === 'link' && t.category === meta.category)
    .slice(0, 4);
  const rp = $('#related-panel');
  let relHTML = '';
  if (related.length) {
    relHTML += `<div class="section-title">🔗 <span>${t('相关工具', 'relatedLocal')}</span></div>
      <div class="related-row">${related
        .map((x) => `<div class="related-chip" data-id="${x.id}">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div>`)
        .join('')}</div>`;
  }
  if (relatedDir.length) {
    relHTML += `<div class="section-title">🌐 <span>${t('同类在线工具', 'relatedDir')}</span><em>${t('第三方开源项目官网', 'relatedDirSub')}</em></div>
      <div class="related-row">${relatedDir
        .map(
          (x) =>
            `<a class="related-chip" href="${esc(x.url)}" target="_blank" rel="noopener">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name} ↗</a>`
        )
        .join('')}</div>`;
  }
  rp.innerHTML = relHTML;
  rp.querySelectorAll('.related-chip[data-id]').forEach((el) => {
    el.onclick = () => navigate('/tools/' + el.dataset.id + '/');
  });
}

/* ---------- 静态内容页 ---------- */
const PAGES = {
  about: () => `
    <div class="page">
      <h1>ℹ️ 关于 ToolHub</h1>
      <p class="lead">把 GitHub 上好用的开源工具，变成"打开网页就能用"的形态——不用装环境、不用敲命令、不用注册。</p>
      <h2>✦ 两种工具类型</h2>
      <ul>
        <li><b>🔒 本地运行</b>：直接在浏览器里计算（JS / WebAssembly），数据<b>不会离开你的设备</b>，可放心处理敏感内容。</li>
        <li><b>🌐 在线直达</b>：精选知名开源项目的官方在线版，点击跳转。版权与内容归各项目所有。</li>
      </ul>
      <h2>✦ 技术架构</h2>
      <ul>
        <li>纯静态站点 + 无构建步骤，托管于 Cloudflare 全球网络</li>
        <li>工具由 <b>Manifest 规范</b>驱动：新增工具 = 写一份清单 + 一个执行文件，平台代码零改动</li>
        <li>Python 工具通过 Pyodide（WASM）在浏览器内沙箱执行</li>
      </ul>
      <h2>✦ 为什么本地执行更放心</h2>
      <table class="cmp-table">
        <tr><th></th><th>ToolHub 本地工具</th><th>普通在线工具站</th><th>自己装环境</th></tr>
        <tr><td>数据是否上传</td><td class="yes">不上传</td><td class="no">上传到对方服务器</td><td class="yes">不上传</td></tr>
        <tr><td>是否需要注册</td><td class="yes">不需要</td><td class="no">常常需要</td><td class="yes">不需要</td></tr>
        <tr><td>上手成本</td><td class="yes">打开即用</td><td>打开即用</td><td class="no">装依赖、配环境</td></tr>
        <tr><td>能否离线</td><td class="yes">可以（PWA）</td><td class="no">不行</td><td>可以</td></tr>
      </table>
      <h2>✦ 数据与隐私</h2>
      <ul>
        <li>平台<b>没有后端数据库</b>，不收集你的输入内容</li>
        <li>「最近使用」「我的收藏」「本机使用次数」都只保存在你浏览器的 localStorage 中，可随时清除</li>
        <li>站点若启用访问量统计（Cloudflare Web Analytics），仅统计页面访问次数，不使用 Cookie、不追踪个人身份</li>
      </ul>
      <h2>✦ 开源与致谢</h2>
      <p>每个工具页均标注来源仓库与 License。已收录 ${REGISTRY ? REGISTRY.counts.local + REGISTRY.counts.dir : ''} 个工具，其中本地工具的开源依赖包括 qrcodejs、marked、DOMPurify、Pyodide，均以原始协议使用。</p>
    </div>`,
  submit: () => `
    <div class="page">
      <h1>➕ 推荐一个工具</h1>
      <p class="lead">发现了好用的开源项目？欢迎推荐给我们，审核后会加入 ToolHub。</p>
      <h2>✦ 收录标准</h2>
      <ul>
        <li>开源项目（有明确 License），优先 MIT / Apache / BSD</li>
        <li>能在浏览器中使用，或可被工具化为网页形态</li>
        <li>有实际使用价值、站点可正常访问</li>
      </ul>
      <h2>✦ 推荐模板</h2>
      <p>请把下面内容发送到项目维护者邮箱（或提交 Issue）：</p>
      <pre>项目名称：
GitHub 仓库：
官网/在线地址：
一句话介绍：
License：
推荐理由（它解决什么问题）：</pre>
      <h2>✦ 目前不收录</h2>
      <ul>
        <li>需要注册账号才能使用的服务</li>
        <li>含明显广告、追踪脚本或闭源的服务</li>
        <li>无法长期稳定访问的站点</li>
      </ul>
    </div>`,
  feedback: () => {
    const tpl = `【ToolHub 反馈】
类型：报错 / 需求 / 收录推荐（三选一）
工具名或页面：
具体描述：
复现步骤（如为报错）：
浏览器与系统：`;
    return `
    <div class="page">
      <h1>💬 意见反馈与工具需求</h1>
      <p class="lead">这个平台没有后端数据库，所以我们用最朴素也最透明的方式收集反馈：复制模板发给我们。高频需求会排进开发计划。</p>
      <h2>✦ 可以反馈什么</h2>
      <ul>
        <li>某个工具报错、结果不对、加载失败</li>
        <li>希望新增的工具（尤其是你在 GitHub 上看到的好项目）</li>
        <li>界面、文案、翻译问题</li>
        <li>想收录某个开源项目的官方在线版</li>
      </ul>
      <h2>✦ 反馈模板（复制后发送）</h2>
      <pre id="fb-tpl">${tpl}</pre>
      <div class="row">
        <button class="btn" id="fb-copy">复制模板</button>
        <a class="btn ghost" id="fb-mail" href="mailto:guyang1966@hotmail.com?subject=${encodeURIComponent('【ToolHub 反馈】')}&body=${encodeURIComponent(tpl)}">用邮件发送</a>
      </div>
      <h2>✦ 我们怎么处理</h2>
      <ul>
        <li>报错类问题优先修，会在版本更新说明里注明</li>
        <li>工具需求按被提到的次数排序，不承诺时间但会公开排期</li>
        <li>不收集你的任何使用数据——反馈内容只来自你主动发送的部分</li>
      </ul>
    </div>`;
  },
};

async function openPage(name) {
  const reg = await loadRegistry();
  await loadI18n();
  const fn = PAGES[name];
  $('#view-home').style.display = 'none';
  $('#view-tool').style.display = 'none';
  $('#view-page').style.display = '';
  const titles = { about: '关于', submit: '推荐工具', feedback: '意见反馈' };
  document.title = `${titles[name] || '页面'} · ${SITE}`;
  $('#page-body').innerHTML = fn ? fn() : '<div class="empty">页面不存在</div>';

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
  const page = p.match(/^\/(about|submit|feedback)$/);
  if (page) return openPage(page[1]);
  return renderHome();
}

$('#search').addEventListener('input', () => {
  if (REGISTRY) {
    renderFeatured(REGISTRY.tools);
    renderGrid(REGISTRY.tools, $('#search').value);
  }
});
$('#home-btn').onclick = () => navigate('/');
$('#crumb').onclick = () => navigate('/');
$('#page-crumb').onclick = () => navigate('/');
window.addEventListener('popstate', route);
window.addEventListener('hashchange', route);

// 快捷键：/ 聚焦搜索，Esc 清空
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    $('#search').focus();
  }
  if (e.key === 'Escape' && document.activeElement === $('#search')) {
    $('#search').value = '';
    $('#search').blur();
    if (REGISTRY) { renderFeatured(REGISTRY.tools); renderGrid(REGISTRY.tools, ''); }
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
initPalette();
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
        renderFeatured(REGISTRY.tools);
        renderGrid(REGISTRY.tools, v);
      }
    });
    heroInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
})();

// 初始分类来自 URL
const catParam = new URLSearchParams(location.search).get('cat');
if (catParam) activeCategory = catParam;

// 注册 Service Worker（离线可用 + 可安装为桌面应用）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 离线能力可选，注册失败不影响正常使用 */
    });
  });
}

route();
