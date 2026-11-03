/* 内容型页面的渲染：专题 / 评测 / 资源库 / 工具分类 / 更新日志。
   v3.13 从 app.js 整体搬出来。理由很直接：这五类页面占了近 400 行，
   而首页一个都不渲染——每个访客却要把它们下载并解析一遍。
   依赖由 bindContentPages 注入（与 tool-page.js 同一套做法），
   避免子模块反过来 import 主模块造成循环引用。 */
let $, esc, t, catName, toolMeta, CAT_ICONS, isLocalTool, stateHTML, kbLink, navigate, bindSpaLinks, setView, renderNavActive, loadI18n, loadRegistry, loadResources, loadEvaluations, SITE;

export function bindContentPages(deps) {
  ({ $, esc, t, catName, toolMeta, CAT_ICONS, isLocalTool, stateHTML, kbLink, navigate, bindSpaLinks, setView, renderNavActive, loadI18n, loadRegistry, loadResources, loadEvaluations, SITE } = deps);
  return {
    tools: openTools,
    guides: openGuides,
    guide: openGuide,
    categories: openCategories,
    category: openCategory,
    topics: openTopics,
    topic: openTopic,
    evaluations: openEvaluations,
    evaluation: openEvaluation,
    resources: openResources,
    resource: openResourceCollection,
    changelog: openChangelog,
  };
}

/* ---------- 工具分类页（v3.13）---------- */
// 文案在构建期按类拆成 /categories/<slug>.json（单类 ~2 KB），列表页只需要轻量索引。
// 这样从首页点进「图片」，不会为了三个数字把另外八类的正文也拉下来。
let CAT_INDEX = null;
async function loadCatIndex() {
  if (CAT_INDEX) return CAT_INDEX;
  try {
    CAT_INDEX = (await (await fetch('/categories/index.json')).json()).categories || [];
  } catch {
    CAT_INDEX = [];
  }
  return CAT_INDEX;
}
const CAT_COPY = new Map();
async function loadCatCopy(slug) {
  if (CAT_COPY.has(slug)) return CAT_COPY.get(slug);
  let d = null;
  try {
    const r = await fetch('/categories/' + slug + '.json');
    if (r.ok) d = await r.json();
  } catch {
    d = null;
  }
  CAT_COPY.set(slug, d);
  return d;
}

async function openCategories() {
  const reg = await loadRegistry();
  await loadI18n();
  const idx = await loadCatIndex();
  setView('page');
  document.title = `工具分类 · ${SITE}`;
  renderNavActive('');
  const rows = idx
    .map((c) => {
      const xs = reg.tools.filter((t) => t.category === c.name);
      const nLocal = xs.filter(isLocalTool).length;
      return `<a class="fl-row" data-spa href="/categories/${c.slug}/">
        <span class="rank">${c.icon}</span>
        <div class="f-body"><div class="f-name">${esc(c.title)}</div><div class="f-desc">${esc(c.tagline)}</div></div>
        <span class="f-meta">${nLocal} 本地 / ${xs.length - nLocal} 在线</span>
      </a>`;
    })
    .join('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <h1>工具分类</h1>
      <p class="lead">按用途把 ${reg.tools.length} 个工具分成 ${idx.length} 类。每一类都标明了典型场景、本地执行与在线版的区别，以及挑选时该看哪几项。</p>
      ${rows}
      <div class="crumb" style="margin-top:24px"><a data-spa href="/">← 返回首页</a></div>
    </div>`;
  bindSpaLinks('#page-body');
}

async function openCategory(slug) {
  const [reg, copy, idx] = await Promise.all([loadRegistry(), loadCatCopy(slug), loadCatIndex()]);
  await loadI18n();
  if (!copy) {
    setView('page');
    $('#page-body').innerHTML = stateHTML('empty', { title: '分类不存在', detail: '地址里的分类名可能拼错了，回分类总览重新选一个。' });
    return;
  }
  const xs = reg.tools.filter((t) => t.category === copy.name);
  const localXs = xs.filter(isLocalTool);
  const linkXs = xs.filter((t) => !isLocalTool(t));
  const row = (t, i) => `<a class="fl-row" data-spa href="/tools/${t.id}/">
      <span class="rank">${String(i + 1).padStart(2, '0')}</span>
      <div class="f-body"><div class="f-name">${esc(toolMeta(t).name)}</div><div class="f-desc">${esc(toolMeta(t).desc)}</div></div>
      <span class="f-meta">${isLocalTool(t) ? '🔒 本地' : '🌐 在线'}</span>
    </a>`;
  const topicsData = await loadTopics();
  const ids = new Set(xs.map((t) => t.id));
  // 至少引用两个本类工具才算「相关」，引用一个多半是巧合
  const relTopics = (topicsData.topics || []).filter((tp) => tp.tools.filter((id) => ids.has(id)).length >= 2);
  setView('page');
  document.title = `${copy.title} · ${SITE}`;
  renderNavActive('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <div class="crumb" style="margin-bottom:10px"><a data-spa href="/categories/">工具分类</a> / ${copy.name}</div>
      <h1>${copy.icon} ${copy.title}</h1>
      <p class="lead">${esc(copy.tagline)}</p>
      <div class="res-intro">${copy.intro}</div>

      <h2 class="res-group-title">适合这些场景</h2>
      <ul>${copy.scenarios.map((s) => `<li>${s}</li>`).join('')}</ul>

      ${
        localXs.length
          ? `<h2 class="res-group-title">浏览器内执行 · ${localXs.length} 个</h2>${localXs.map((t, i) => row(t, i)).join('')}`
          : ''
      }
      ${
        linkXs.length
          ? `<h2 class="res-group-title">第三方官方在线版 · ${linkXs.length} 个</h2>${linkXs.map((t, i) => row(t, i + localXs.length)).join('')}`
          : ''
      }

      <h2 class="res-group-title">怎么挑</h2>
      <ul>${copy.howto.map((s) => `<li>${s}</li>`).join('')}</ul>

      <h2 class="res-group-title">常见问题</h2>
      ${copy.faq
        .map((f) => `<div class="res-item"><div class="res-item-head"><b>${f.q}</b></div><div class="res-item-note">${f.a}</div></div>`)
        .join('')}

      ${
        relTopics.length
          ? `<h2 class="res-group-title">相关专题</h2><div class="related-row">${relTopics
              .map((tp) => `<a class="related-chip" data-spa href="/topics/${tp.slug}/">${tp.icon} ${tp.title}</a>`)
              .join('')}</div>`
          : ''
      }

      <h2 class="res-group-title">其他分类</h2>
      <div class="chips">${idx
        .map((c) => `<a class="chip${c.slug === slug ? ' active' : ''}" data-spa href="/categories/${c.slug}/">${c.icon} ${c.name}</a>`)
        .join('')}</div>
      <div class="crumb" style="margin-top:24px"><a data-spa href="/categories/">← 全部分类</a> · <a data-spa href="/">返回首页</a></div>
    </div>`;
  bindSpaLinks('#page-body');
}

/* ---------- 全部工具页（v3.14）---------- */
// 导航「工具」原来指回首页、首页入口卡只滚动到锚点，两个入口都停在首页。
// 这一页就是它们的落地页：按分类分组列全，序号全局连续，不依赖首页的筛选状态。
async function openTools() {
  const [reg, idx] = await Promise.all([loadRegistry(), loadCatIndex()]);
  await loadI18n();
  const groups = idx.map((c) => ({ c, xs: reg.tools.filter((t) => t.category === c.name) })).filter((g) => g.xs.length);
  // 万一某个工具的 category 还没写进分类文案（构建期会拦，但别让页面在这里断），
  // 单独列一组，也不要静默少几个工具。
  const known = new Set(idx.map((c) => c.name));
  const rest = reg.tools.filter((t) => !known.has(t.category));
  if (rest.length) groups.push({ c: { name: '其他', icon: '📦', title: '其他工具', slug: '' }, xs: rest });
  let n = 0;
  const row = (t) => `<a class="fl-row" data-spa href="/tools/${t.id}/">
      <span class="rank">${String(++n).padStart(2, '0')}</span>
      <div class="f-body"><div class="f-name">${esc(toolMeta(t).name)}</div><div class="f-desc">${esc(toolMeta(t).desc)}</div></div>
      <span class="f-meta">${isLocalTool(t) ? '🔒 本地' : '🌐 在线'}</span>
    </a>`;
  setView('page');
  document.title = `全部工具 · ${SITE}`;
  renderNavActive('/tools');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <div class="crumb" style="margin-bottom:10px"><a data-spa href="/">首页</a> / 全部工具</div>
      <h1>全部工具</h1>
      <p class="lead">${reg.tools.length} 个工具，按用途分成 ${groups.length} 类。标「本地」的在浏览器里执行，文件不出你的电脑。</p>
      <div class="chips">${idx
        .map((c) => `<a class="chip" data-spa href="/categories/${c.slug}/">${c.icon} ${c.name}</a>`)
        .join('')}<a class="chip" data-spa href="/categories/">🗂️ 分类总览 →</a></div>
      ${groups
        .map(
          ({ c, xs }) =>
            `<h2 class="res-group-title">${
              c.slug ? `<a data-spa href="/categories/${c.slug}/">${c.icon} ${c.title}</a>` : `${c.icon} ${c.title}`
            } · ${xs.length} 个</h2>${xs.map(row).join('')}`
        )
        .join('')}
      <div class="crumb" style="margin-top:24px"><a data-spa href="/categories/">按分类浏览</a> · <a data-spa href="/">← 返回首页</a></div>
    </div>`;
  bindSpaLinks('#page-body');
}

/* ---------- 折腾指南（v3.15）---------- */
// 和工具分类同一套取数方式：总览只拉轻量索引，进具体一篇才取正文。
// 指南正文比分类文案大一个量级（步骤 + 坑 + 回退），整份下发会让总览页白白多拉几十 KB。
let GUIDE_INDEX = null;
async function loadGuideIndex() {
  if (GUIDE_INDEX) return GUIDE_INDEX;
  try {
    GUIDE_INDEX = (await (await fetch('/guides/index.json')).json()).guides || [];
  } catch {
    GUIDE_INDEX = [];
  }
  return GUIDE_INDEX;
}
const GUIDE_COPY = new Map();
async function loadGuide(slug) {
  if (GUIDE_COPY.has(slug)) return GUIDE_COPY.get(slug);
  let d = null;
  try {
    const r = await fetch('/guides/' + slug + '.json');
    if (r.ok) d = await r.json();
  } catch {
    d = null;
  }
  GUIDE_COPY.set(slug, d);
  return d;
}
const GUIDE_RISK = { low: ['低', 'ok'], mid: ['中', 'warn'], high: ['高', 'danger'] };

async function openGuides() {
  await loadI18n();
  const idx = await loadGuideIndex();
  setView('page');
  document.title = `教程 · ${SITE}`;
  renderNavActive('/guides');
  const rows = idx
    .map(
      (g) => `<a class="fl-row" data-spa href="/guides/${g.slug}/">
        <span class="rank">${g.icon}</span>
        <div class="f-body"><div class="f-name">${esc(g.title)}</div><div class="f-desc">${esc(g.tagline)}</div></div>
        <span class="f-meta">${esc(g.difficulty)} · ${g.minutes} 分钟</span>
      </a>`
    )
    .join('');
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <h1>📖 教程</h1>
      <p class="lead">要先装、先刷、先配才能用起来的东西。和工具清单分开，是因为门槛完全不同：工具是打开网页就能用，教程是一条要走完的路。</p>
      ${rows}
      <h2 class="res-group-title">这一类内容的三条纪律</h2>
      <ul>
        <li><b>先写前置条件。</b>芯片型号对不上、U 盘容量不够、没有网线——这些没写清楚，人会在第三步才发现白忙一场。</li>
        <li><b>风险要写在动作前面。</b>「会覆盖原系统」这句话放在最后一段，等于没写。</li>
        <li><b>必须有回退路径。</b>只讲怎么往前冲、不讲怎么退回来的教程，是在催人做不可逆的事。</li>
      </ul>
      <div class="crumb" style="margin-top:24px"><a data-spa href="/tools/">← 全部工具</a> · <a data-spa href="/">返回首页</a></div>
    </div>`;
  bindSpaLinks('#page-body');
}

async function openGuide(slug) {
  const [g, reg] = await Promise.all([loadGuide(slug), loadRegistry()]);
  await loadI18n();
  setView('page');
  if (!g) {
    document.title = `教程不存在 · ${SITE}`;
    $('#page-body').innerHTML = stateHTML('empty', { title: '这篇教程不存在', detail: '地址可能拼错了，回教程总览重新选一篇。' });
    return;
  }
  document.title = `${g.title} · 教程 · ${SITE}`;
  renderNavActive('/guides');
  const [label, cls] = GUIDE_RISK[g.risk] || GUIDE_RISK.mid;
  const nameOf = (id) => {
    const t = reg.tools.find((x) => x.id === id);
    return t ? toolMeta(t).name : id;
  };
  const ans = (f) => f.a || f.body;
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <div class="crumb" style="margin-bottom:10px"><a data-spa href="/guides/">教程</a> / ${esc(g.title)}</div>
      <h1>${g.icon} ${esc(g.title)}</h1>
      <div class="guide-meta">
        <span>难度 <b>${esc(g.difficulty)}</b></span>
        <span>约 <b>${g.minutes}</b> 分钟</span>
        <span class="gm-risk gm-${cls}">风险 <b>${label}</b></span>
        <span>最后核对 <b>${esc(g.lastChecked)}</b></span>
      </div>
      ${g.risk === 'high' ? `<div class="guide-risk"><b>动手之前先看这段。</b>${esc(g.riskNote)}</div>` : ''}
      <div class="res-intro">${esc(g.intro)}</div>
      <h2 class="res-group-title">为什么值得折腾</h2><ul>${g.why.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <h2 class="res-group-title">开工前要有的</h2><ul>${g.prereqs.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <h2 class="res-group-title">步骤</h2><ol class="guide-steps">${g.steps
        .map((s) => `<li><b>${esc(s.title)}</b><p>${esc(s.body)}</p></li>`)
        .join('')}</ol>
      <h2 class="res-group-title">翻车了怎么办</h2><ul class="guide-fallback">${g.fallback.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <h2 class="res-group-title">容易踩的坑</h2>${g.pitfalls
        .map((p) => `<div class="res-item"><div class="res-item-head"><b>${esc(p.title)}</b></div><div class="res-item-note">${esc(p.body)}</div></div>`)
        .join('')}
      ${
        g.tools?.length
          ? `<h2 class="res-group-title">这篇里用到的站内工具</h2><div class="related-row">${g.tools
              .map((id) => `<a class="related-chip" data-spa href="/tools/${id}/">${esc(nameOf(id))} →</a>`)
              .join('')}</div>`
          : ''
      }
      ${
        g.links?.length
          ? `<h2 class="res-group-title">参考链接</h2>${g.links
              .map(
                (l) =>
                  `<div class="res-item"><div class="res-item-head"><a class="guide-link" href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.name)}</a></div><div class="res-item-note">${esc(l.note)}</div></div>`
              )
              .join('')}`
          : ''
      }
      <h2 class="res-group-title">常见问题</h2>${g.faq
        .map((f) => `<div class="res-item"><div class="res-item-head"><b>${esc(f.q)}</b></div><div class="res-item-note">${esc(ans(f))}</div></div>`)
        .join('')}
      <div class="crumb" style="margin-top:24px"><a data-spa href="/guides/">← 全部教程</a> · <a data-spa href="/">返回首页</a></div>
    </div>`;
  bindSpaLinks('#page-body');
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
// v3.12：评测正文按篇取。索引只有标题与摘要，列表页不用为八篇正文买单。
const EVAL_BODY = new Map();
async function loadEvalBody(slug) {
  if (EVAL_BODY.has(slug)) return EVAL_BODY.get(slug);
  try {
    const r = await fetch(`/evaluations/${slug}.json`);
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    EVAL_BODY.set(slug, d);
    return d;
  } catch {
    return null;
  }
}

async function openEvaluations() {
  const data = await loadEvaluations();
  await loadI18n();
  setView('page');
  document.title = `工具测评 · ${SITE}`;
  renderNavActive('/evaluations');
  // v3.16：对比从顶级导航撤下来，改在这一页第一屏给出入口。
  // 理由：对比本身就是「平行比较」，和测评回答的是同一个问题；单独占一栏，
  // 反而让人以为它是一份独立的数据库。放在这里，读过一篇测评正好顺手下场自己比。
  const cmpCta = `<a class="cmp-cta" data-spa href="/compare/">
      <span aria-hidden="true">⇄</span>
      <div><b>同类工具并排对比</b><span>挑 2–4 款放在一起看：要不要上传数据、能不能离线用、协议开不开源、来源在哪。</span></div>
      <em>开始对比 →</em>
    </a>`;
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <h1>🔬 工具测评</h1>
      <p class="lead">横向实测加单款深挖：不吹不黑，把隐私边界、速度体验和功能取舍讲清楚，该给使用说明的地方就给到能照着做的程度。每篇都标注测试方式与日期，结论会随工具版本变化。</p>
      ${cmpCta}
      ${data.evaluations
        .map(
          (ev) => `<a class="list-row" data-spa href="/evaluations/${ev.slug}/">
            <span class="lr-ico">${ev.icon}</span>
            <div>
              <h2 class="lr-title">${ev.title}${ev.hasUsage ? '<span class="badge">含使用说明</span>' : ''}</h2>
              <div class="lr-desc">${ev.summary}</div>
            </div>
            <span class="lr-meta">${ev.date}<br>${ev.itemCount} 款对比</span>
          </a>`
        )
        .join('')}
    </div>`;
  bindSpaLinks('#page-body');
}

async function openEvaluation(slug) {
  const data = await loadEvaluations();
  const idx = data.evaluations.find((x) => x.slug === slug);
  const body = idx && (await loadEvalBody(slug));
  const ev = idx && body ? { ...idx, ...body } : null;
  if (!ev) {
    $('#page-body').innerHTML = '<div class="empty">评测不存在</div>';
    return;
  }
  await loadI18n();
  const reg = await loadRegistry();
  setView('page');
  document.title = `${ev.title} · 工具测评 · ${SITE}`;
  renderNavActive('/evaluations');
  const pvClass = (p) => {
    if (p === '完全本地' || p === '本地优先') return 'ok';
    if (p === '需上传' || p === '服务器' || p === '部分上传') return 'warn';
    return 'mid';
  };
  $('#page-body').innerHTML = `
    <div class="page" style="max-width:880px">
      <h1>${ev.icon} ${ev.title}</h1>
      <p class="lead">${ev.summary}</p>
      <div class="res-intro" style="font-size:13px;color:var(--muted)">实测日期：${ev.date} · 对比 ${ev.items.length} 款工具</div>
      <div class="eval-verdict"><b>结论</b><p>${ev.verdict}</p></div>
      ${ev.method ? `<p style="font-size:13px;color:var(--muted)"><b>怎么测的：</b>${ev.method}</p>` : ''}

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

      ${
        ev.usage?.length
          ? `<h2 class="res-group-title">怎么用</h2><div style="font-size:14px;line-height:1.9">${ev.usage
              .map(
                (u) =>
                  `<h3 style="font-size:15px;margin:18px 0 6px">${u.name}</h3><ol style="margin:0 0 0 20px;padding:0">${u.steps
                    .map((s) => `<li>${s}</li>`)
                    .join('')}</ol>`
              )
              .join('')}</div>`
          : ''
      }

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
      <div class="crumb" style="margin-top:24px"><a href="/evaluations/">← 全部测评</a></div>
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

/* ---------- 资源库 ---------- */

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

