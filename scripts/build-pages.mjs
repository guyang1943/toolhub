#!/usr/bin/env node
// 构建 SEO 静态页：工具页（含长尾正文 + FAQ + JSON-LD）、关于/提交/反馈页，以及 sitemap/robots
// 用法：node scripts/build-pages.mjs [BASE_URL]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lintAll } from './lib/tool-lint.mjs';
import { buildToolsJson } from './sync-tools.mjs';
import { buildSw } from './gen-sw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'https://toolhub.guyang1966.workers.dev').replace(/\/$/, '');

// 0) 构建闸门（v2.8 C1）：先由分片派生 tools/tools.json，再校验所有 manifest。
//    清单不合规就直接失败——不能等到用户打开页面才看到"工具缺少 manifest 或 run 定义"。
{
  const { payload } = buildToolsJson();
  writeFileSync(join(root, 'tools', 'tools.json'), JSON.stringify(payload, null, 2), 'utf8');
  const schema = JSON.parse(readFileSync(join(root, 'tools', 'schema.json'), 'utf8'));
  const reg = JSON.parse(readFileSync(join(root, 'tools', 'registry.json'), 'utf8'));
  const { errors, ids } = lintAll(root, schema, reg.categories || []);
  if (errors.length) {
    console.error(`\n❌ 工具清单校验失败（${errors.length} 个问题），构建中止：\n`);
    for (const e of errors) console.error(`   ${e.file}:${e.line}  [${e.path}] ${e.message}`);
    console.error('\n   规范见 tools/schema.json，自查：node scripts/lint-tools.mjs <id>\n');
    process.exit(1);
  }
  console.log(`✅ 清单闸门：${ids.length} 个工具通过 schema + 语义校验`);
}

const tools = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools;
const dirTools = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8')).tools;
const i18n = JSON.parse(readFileSync(join(root, 'i18n.json'), 'utf8')).en;
const articles = JSON.parse(readFileSync(join(root, 'articles.json'), 'utf8'));
const evaluations = JSON.parse(readFileSync(join(root, 'evaluations.json'), 'utf8'));
const resources = JSON.parse(readFileSync(join(root, 'resources.json'), 'utf8'));
const topics = JSON.parse(readFileSync(join(root, 'topics.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
// 目录工具正文（人工撰写，每篇 ≥400 字）：与目录数据分离，改文案不用碰代码
const dirCopyPath = join(root, 'content', 'directory-copy.json');
const DIR_COPY = existsSync(dirCopyPath) ? JSON.parse(readFileSync(dirCopyPath, 'utf8')) : {};
// 计数归一：模板里的工具数/资源数一律由数据推导，避免每加一个工具就要手改多处 meta
const TOTAL_TOOLS = tools.length + dirTools.length;
const TOTAL_RES = resources.collections.reduce((n, c) => n + c.items.length, 0);
// v3.9：8 → 10。上限不是「越多越好」的旋钮，而是「多少条还算精选」的判断：
// 两列五行仍然是一屏之内能扫完的量，再多就和下方网格抢同一份注意力了。
// 这个数字必须与 assets/app.js 的 FEATURED_MAX 一致。
const FEATURED_MAX = 10;

// v3.5：工具页专用样式拆到独立文件，首页不为它付字节。
// 工具页在构建期就把这张表引进 <head>（整页加载无闪烁）；从首页点卡片进工具的
// SPA 路径由 app.js 的 ensureCss() 先取到再画——两条路径都靠「rel + href」认亲。
const TOOL_CSS_LINK = '  <link rel="stylesheet" href="/assets/style.tool.css" />';
const rawTpl = readFileSync(join(root, 'index.html'), 'utf8');
const tpl = rawTpl
  .replace(/\d+(?= 个精选开源工具)/g, TOTAL_TOOLS)
  .replace(/\d+(?= 个开源工具)/g, TOTAL_TOOLS)
  .replace(/\d+(?= 个工具 ·)/g, TOTAL_TOOLS)
  .replace(/\d+(?= 条资源)/g, TOTAL_RES);
// 模板计数归一后暂不落盘：首页还要注入静态内容，统一在构建末尾写一次（见 6)）

function fillMeta(html, { title, desc, url, botInject, jsonld }) {
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${desc}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${desc}" />`)
    .replace(
      /<meta property="og:type" content="website" \/>/,
      `<meta property="og:type" content="website" />\n  <meta property="og:url" content="${url}" />\n  <link rel="canonical" href="${url}" />`
    );
  // og:image 用绝对地址，社交平台才能抓取
  out = out.replace('content="/assets/og.png"', `content="${BASE}/assets/og.png"`);
  // v3.4：首页把头部搜索框收起换成按钮，靠 body[data-view] 判断。首帧就得是对的，
  // 否则静态 HTML 先画出一个搜索框、脚本跑起来又收掉，会顶一下布局（CLS）。
  // 非首页统一先标 page；工具页由 tool-page.js 运行时改成 tool。
  out = out.replace('<body data-view="home">', '<body data-view="page">');
  if (jsonld) out = out.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n</head>`);
  return out.replace(
    '<script type="module" src="/assets/app.js"></script>',
    `<script>${botInject}</script>\n  <script type="module" src="/assets/app.js"></script>`
  );
}

// 爬虫可见正文（JS 接管后会被移除）
function seoBlock({ h1, desc, article, extra = '' }) {
  let body = `<h1>${h1}</h1><p>${desc}</p>`;
  if (article) {
    body += `<h2>关于${h1}</h2><p>${article.intro}</p>`;
    if (article.steps?.length) {
      body += `<h2>使用步骤</h2><ol>${article.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
    }
    if (article.pitfalls?.length) {
      body += `<h2>常见错误</h2>`;
      for (const p of article.pitfalls) body += `<h3>${p.title}</h3><p>${p.body}</p>`;
    }
    body += `<h2>常见问题</h2>`;
    for (const f of article.faq) body += `<h3>${f.q}</h3><p>${f.a}</p>`;
  }
  body += extra;
  return `<div id="seo-static" style="max-width:760px;margin:40px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.8">${body}</div>`;
}

let count = 0;

// v3.10：教程正文从每篇 2 条 FAQ 补到 5 条后，整份 articles.json 涨到 112 KB（gzip 44 KB），
// 而工具页只用到自己那一篇（raw 平均 1.2 KB）。SPA 进工具页时整份 fetch 是纯浪费，
// 所以按 id 拆成单篇——加载量降两个数量级。整份 articles.json 保留，作为兜底。
mkdirSync(join(root, 'articles'), { recursive: true });

// 1) 工具页
for (const tool of tools) {
  const dir = join(root, 'tools', tool.id);
  if (!existsSync(dir)) continue;
  const article = articles[tool.id];
  // v3.10：title / description 只留中文。原来拼成「JSON 格式化 / JSON Formatter · ToolHub」，
  // 搜索引擎不会因为写了两个词就给两份排名，只会把权重摊薄，页面语言也会被判定得不清楚。
  // 英文词条仍留在 i18n.json，等真正做 hreflang 双语站（两套 URL + 互指）时再用。
  const title = `${tool.name} · ToolHub`;
  const desc = tool.desc.replace(/"/g, '&quot;');
  const url = `${BASE}/tools/${tool.id}/`;

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: tool.name,
    description: tool.desc,
    url,
    applicationCategory: 'WebApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    license: tool.license,
  };
  const faqLd = article
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: article.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }
    : null;

  let html = fillMeta(tpl, {
    title,
    desc,
    url,
    botInject: `window.__TOOL__=${JSON.stringify(tool.id)};`,
    jsonld,
  });
  if (faqLd) html = html.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(faqLd)}</script>\n</head>`);
  // B2：有操作步骤的教程页补 HowTo，让「怎么做 X」类查询能进富结果
  if (article && article.steps && article.steps.length) {
    const howTo = {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: `怎么用${tool.name}`,
      description: tool.desc,
      totalTime: 'PT3M',
      tool: [{ '@type': 'HowToTool', name: tool.name }],
      step: article.steps.map((st, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: st.length > 40 ? st.slice(0, 38) + '…' : st,
        text: st,
        url: `${url}#step${i + 1}`,
      })),
    };
    html = html.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(howTo)}</script>\n</head>`);
  }

  // B3：本地工具页的相关阅读——同类本地工具 + 同类目录工具 + 收录它的专题/评测
  const kinLocal = tools.filter((x) => x.id !== tool.id && x.category === tool.category).slice(0, 3);
  const kinDir = dirTools.filter((x) => x.category === tool.category).slice(0, 2);
  const kinTopics = (topics.topics || []).filter((tp) => (tp.tools || []).includes(tool.id));
  const kinEvals = (evaluations.evaluations || []).filter((ev) =>
    (ev.items || []).some((it) => (it.url || '').includes(`/tools/${tool.id}/`))
  );
  const related =
    `<h2>相关阅读</h2><ul>` +
    kinLocal.map((x) => `<li><a href="/tools/${x.id}/">${x.name}</a> —— ${x.desc}</li>`).join('') +
    kinDir.map((x) => `<li><a href="/tools/${x.id}/">${x.name}</a> —— 同类第三方工具（官方在线版）</li>`).join('') +
    kinTopics.map((tp) => `<li><a href="/topics/${tp.slug}/">${tp.title}</a> —— 专题工具包</li>`).join('') +
    kinEvals.map((ev) => `<li><a href="/evaluations/${ev.slug}/">${ev.title}</a> —— 横评对比</li>`).join('') +
    `<li><a href="/?cat=${encodeURIComponent(tool.category)}">全部${tool.category}类工具</a> —— 按分类浏览</li>` +
    `</ul>`;

  html = html.replace(
    /<main class="container"[^>]*>/,
    `<main class="container" id="main-content" tabindex="-1">${seoBlock({
      h1: tool.name,
      desc: tool.desc,
      article: article || null,
      extra:
        `<p>来源：${tool.source} · License: ${tool.license} · 分类：<a href="/?cat=${encodeURIComponent(
          tool.category
        )}">${tool.category}</a></p>` +
        related +
        `<p><a href="/">← 返回 ToolHub 全部工具</a></p>`,
    })}`
  );
  html = html.replace('</head>', TOOL_CSS_LINK + '\n</head>');
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  // 单篇教程 JSON：只有这个工具自己的内容，工具页按需取这一份
  if (article) writeFileSync(join(root, 'articles', tool.id + '.json'), JSON.stringify(article), 'utf8');
  count++;
}

// 2) 目录工具页（第三方开源项目的官方在线版说明页）
// B1 正文：content/directory-copy.json 里每个工具一段人工撰写的 intro / 场景 / 配合 / 局限
// B2 结构化数据：SoftwareApplication + FAQPage
// B3 内链图谱：配合的本地工具 + 同类目录工具 + 收录该工具的专题与评测
const localById = new Map(tools.map((t) => [t.id, t]));
const dirById = new Map(dirTools.map((t) => [t.id, t]));
const nameOf = (id) => (localById.get(id) || dirById.get(id) || {}).name || id;
const linkTo = (id, label) =>
  localById.has(id) || dirById.has(id) ? `<a href="/tools/${id}/">${label || nameOf(id)}</a>` : label || id;
// 专题/评测里提到过这个工具的，直接算成「相关阅读」，不用手维护
const topicsByTool = new Map();
for (const tp of topics.topics || []) {
  for (const id of tp.tools || []) {
    if (!topicsByTool.has(id)) topicsByTool.set(id, []);
    topicsByTool.get(id).push({ href: `/topics/${tp.slug}/`, label: tp.title });
  }
}
const evalsByTool = new Map();
for (const ev of evaluations.evaluations || []) {
  for (const it of ev.items || []) {
    const m = /\/tools\/([^/]+)\//.exec(it.url || '');
    if (!m) continue;
    if (!evalsByTool.has(m[1])) evalsByTool.set(m[1], []);
    evalsByTool.get(m[1]).push({ href: `/evaluations/${ev.slug}/`, label: ev.title });
  }
}
const CAT_QUERY = (c) => `/?cat=${encodeURIComponent(c)}`;
const plain = (h) => h.replace(/<[^>]+>/g, '');
const shortCopy = [];

for (const tool of dirTools) {
  const dir = join(root, 'tools', tool.id);
  mkdirSync(dir, { recursive: true });
  const title = `${tool.name} · 官方在线版 · ToolHub`;
  const desc = tool.desc.replace(/"/g, '&quot;');
  const url = `${BASE}/tools/${tool.id}/`;
  let host = tool.url;
  try {
    host = new URL(tool.url).hostname;
  } catch {}

  const copy = DIR_COPY[tool.id] || {
    intro: tool.desc,
    scenes: [],
    pairs: [],
    caveat: '使用前请确认项目的许可证与数据政策，重要数据建议先备份。',
  };

  // 同分类的兄弟工具（目录内），最多 3 个
  const siblings = dirTools.filter((x) => x.id !== tool.id && x.category === tool.category).slice(0, 3);
  // 同分类的本地工具（能在浏览器里直接跑），最多 3 个
  const localKin = tools.filter((x) => x.category === tool.category).slice(0, 3);
  const topicLinks = topicsByTool.get(tool.id) || [];
  const evalLinks = evalsByTool.get(tool.id) || [];

  const sceneList = copy.scenes.length
    ? `<ol>${copy.scenes.map((x) => `<li>${x}</li>`).join('')}</ol>`
    : '';
  const pairParas = copy.pairs
    .map(
      (pr) =>
        `<p><b>${linkTo(pr.id)}</b>：${pr.why}${
          localById.has(pr.id) ? '（本地工具，文件不上传）' : ''
        }</p>`
    )
    .join('');
  const sibList = siblings.length
    ? `<ul>${siblings.map((x) => `<li>${linkTo(x.id)} —— ${x.desc}</li>`).join('')}</ul>`
    : '';
  const kinList = localKin.length
    ? `<ul>${localKin
        .map((x) => `<li>${linkTo(x.id)} —— ${x.desc}（在浏览器内执行，不联网也能用）</li>`)
        .join('')}</ul>`
    : '';

  // FAQ 只从上面已经写定的事实里取，避免编造未经验证的功能
  const faq = [
    {
      q: `${tool.name} 是免费的吗？`,
      a: `${tool.name} 是开源项目，采用 ${tool.license} 许可证，官方在线版可以免费使用，不需要为基本功能付费。ToolHub 只做收录与说明，不代管你的数据，也不提供账号或存储服务。`,
    },
    {
      q: `${tool.name} 适合什么场景？`,
      a: copy.scenes.length
        ? `最常见的是这几种：${copy.scenes.join('；')}。判断标准很简单——如果你现在正为了这件事装一个几百 MB 的桌面软件，先用它试一次。`
        : `${tool.desc}。适合临时处理、不想安装桌面软件的场景。`,
    },
    {
      q: `它和 ToolHub 的本地工具有什么区别？`,
      a: `ToolHub 的本地工具把代码放在你的浏览器里执行（WebAssembly 或原生 JS），文件不经过服务器；${
        tool.name
      } 由项目作者维护，数据在其服务器或你的浏览器中处理，具体取决于项目实现，使用前建议先看对方的数据政策。需要「绝对不上传」时可以改用站内同类工具。`,
    },
    {
      q: `用 ${tool.name} 有什么限制？`,
      a: copy.caveat,
    },
  ];

  const body =
    `<h2>它解决什么问题</h2><p>${copy.intro}</p>` +
    (tool.blurb ? `<p>${tool.blurb}</p>` : '') +
    (sceneList ? `<h2>三个典型使用场景</h2>${sceneList}` : '') +
    (pairParas ? `<h2>和 ToolHub 本地工具怎么配合</h2>${pairParas}` : '') +
    (sibList ? `<h2>同类可替代方案</h2>${sibList}` : '') +
    `<h2>使用时要注意什么</h2><p>${copy.caveat}</p>` +
    `<h2>常见问题</h2>${faq.map((f) => `<h3>${f.q}</h3><p>${f.a}</p>`).join('')}` +
    `<h2>相关阅读</h2><ul>` +
    `${
      kinList ||
      `<li><a href="/">ToolHub 全部 93 个工具</a> —— 33 个在浏览器本地执行，数据不上传</li>`
    }` +
    `<li><a href="${CAT_QUERY(tool.category)}">全部${tool.category}类工具</a> —— 按分类筛选，含本地执行与目录直达</li>` +
    `${topicLinks.map((l) => `<li><a href="${l.href}">${l.label}</a> —— 专题工具包</li>`).join('')}` +
    `${evalLinks.map((l) => `<li><a href="${l.href}">${l.label}</a> —— 横评对比</li>`).join('')}` +
    `${siblings.length ? `<li><a href="/tools/${siblings[0].id}/">${siblings[0].name}</a> —— 同类别另一个选择</li>` : ''}` +
    `</ul>`;

  const extra =
    body +
    `<p>项目来源：${tool.source} · License: ${tool.license} · 分类：${linkTo(tool.id) === tool.id ? tool.category : `<a href="${CAT_QUERY(tool.category)}">${tool.category}</a>`}</p>` +
    `<p>官网地址：<a href="${tool.url}" target="_blank" rel="noopener">${tool.url}</a>（新标签页打开 ${host}）</p>` +
    `<p>说明：本页是 ToolHub 对该开源项目的整理与推荐，工具由项目作者维护，版权与数据归原作者所有。官网无法访问时可能是临时故障或网络限制。</p>` +
    `<p><a href="/">← 返回 ToolHub 全部工具</a></p>`;

  // 正文长度守卫：低于 400 字说明文案没写够，直接让构建报出来
  const words = plain(body).replace(/\s+/g, '').length;
  if (words < 400) shortCopy.push(`${tool.id}(${words})`);

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: tool.name,
    description: tool.desc,
    url,
    sameAs: tool.url,
    applicationCategory: 'WebApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    license: tool.license,
  };
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  let html = fillMeta(tpl, {
    title,
    desc,
    url,
    botInject: `window.__TOOL__=${JSON.stringify(tool.id)};`,
    jsonld,
  });
  html = html.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(faqLd)}</script>\n</head>`);
  html = html.replace('</head>', TOOL_CSS_LINK + '\n</head>');
  html = html.replace(
    /<main class="container"[^>]*>/,
    `<main class="container" id="main-content" tabindex="-1">${seoBlock({
      h1: `${tool.name} · 官方在线版`,
      desc: tool.desc,
      extra,
    })}`
  );
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;
}
if (shortCopy.length) {
  console.log(`   ⚠️ 目录工具正文不足 400 字：${shortCopy.join('、')}`);
}

// 3) 静态页
const staticPages = [
  {
    path: 'about',
    title: '关于 ToolHub · 开源工具平台',
    desc: 'ToolHub 把 GitHub 上优质开源工具变成打开即用的在线工具，本地执行保护隐私，无需安装注册。',
    h1: '关于 ToolHub',
    content:
      '<h2>为什么做这个平台</h2><p>GitHub 上有大量优秀的开源小工具，但要用起来得装环境、敲命令。ToolHub 把它们做成了打开网页就能用的形态。</p>' +
      '<h2>与普通在线工具站的区别</h2><p>普通工具站把你的数据传到它的服务器；ToolHub 的本地工具在浏览器内用 WebAssembly 执行，服务端全程不接触你的输入。</p>',
  },
  {
    path: 'batch',
    title: '批量处理图片 · 限制边长、统一格式、打包下载 · ToolHub',
    desc: '一次拖入多张图片，统一限制最大边长、转 WebP/JPEG、压缩质量，最后打包成一个 zip。全部在浏览器内完成，图片不上传。',
    h1: '批量处理图片',
    extraCss: '/assets/style.batch.css',
    content:
      '<h2>它解决什么问题</h2><p>单张处理十几张截图是重复劳动：打开工具、选一张、下载、再来一张。批量模式把这些合成一步——先统一边长与格式，再按统一质量编码，最后打包成一个压缩包下载。</p>' +
      '<h2>与站内单图工具的关系</h2><p>批量页用的是同一套浏览器 canvas 编码管线，与「图片压缩」「图片改尺寸」「图片格式转换」一致；区别是一次处理多个文件并直接打包，适合成批的截图、相机照片与素材整理。</p>' +
      '<h2>隐私</h2><p>所有图片在浏览器内存中解码与编码，不上传、不写入本地磁盘，处理完即随页面释放。断网也可使用（缓存过离线包之后）。</p>' +
      '<h2>已知边界</h2><p>PNG 是无损格式，质量参数对它无效；转 JPEG 会丢失透明背景；一次处理几十张大图会占用较多内存，建议分批。</p>',
  },
  {
    path: 'offline',
    title: '离线包与安装 · 断网也能用的在线工具 · ToolHub',
    desc: '把 ToolHub 的本地工具全部缓存到浏览器：断网、飞行模式、内网隔离环境都能继续用，也可以安装到桌面像本地应用一样打开。',
    h1: '离线包与安装',
    extraCss: '/assets/style.offline.css',
    // 真实数字要等 sw.js 生成后才知道（它要统计刚写出的 /offline/ 页），先占位、末尾回填
    offlineMeta: true,
    content:
      '<h2>为什么需要离线包</h2><p>「本地执行」已经保证输入不上传，但页面本身还要从服务器取。离线包把全部本地工具页与执行脚本缓存进浏览器，于是断网、飞行模式、隔离内网里都能照常打开并运算——此时它才真正等同于一个装在电脑上的工具。</p>' +
      '<h2>两个概念别混淆</h2><p>安装成应用（PWA）只解决「从桌面图标直接打开」；离线包解决「没有网络也能打开」。两者独立：不安装也能离线，装了应用但没缓存离线包，断网时仍然打不开具体工具页。</p>' +
      '<h2>包含与不包含</h2><p>包含首页、全部分类页、全部本地工具页与其执行脚本、界面样式与脚本、工具注册表与多语言文件。不包含第三方官网（目录工具属于他人站点），也不包含 Python 运行时——它 13MB 起、还有可选的数据科学包，会在第一次使用 Python 工具时单独下载并缓存，不拖慢装包。</p>' +
      '<h2>更新机制</h2><p>页面导航采用「缓存优先 + 后台更新」：先给你秒开的旧版本，同时在后台取新版本存入缓存，下次打开即为新版。注册表与界面脚本采用「网络优先」，因此新增工具、调整文案在部署后立即生效，不需要等缓存过期。</p>' +
      '<h2>如何验证真的离线可用</h2><p>点「下载离线包」等进度走完，然后在开发者工具 Network 面板切成 Offline（或直接关掉 Wi-Fi）刷新页面，本地工具应照常打开与计算；此时 Network 面板不应出现任何失败的上传请求——因为本来就没有上传接口。</p>',
  },
  {
    path: 'privacy',
    title: '隐私说明 · 你的输入不会离开这台设备 · ToolHub',
    desc: 'ToolHub 的数据流向逐条说明：本地工具在浏览器内执行、不上传输入、无后端数据库；浏览器里存了什么、如何清除、访问统计口径与关闭方式。',
    h1: '隐私说明',
    content:
      '<h2>一句话结论</h2><p>本地工具的输入只存在于你浏览器的内存里，处理完即随页面释放；本站没有后端数据库，也没有上传接口，这不是承诺而是架构上就不存在。</p>' +
      '<h2>三类工具，三种数据流向</h2><p>本地执行类工具（含 Pyodide 驱动的 Python 工具）全部在浏览器内完成，服务端不接触输入；目录类工具是第三方开源项目的官方在线版，点击「打开官网」后进入对方站点，适用对方的隐私政策。</p>' +
      '<h2>浏览器里存了什么</h2><p>主题偏好、收藏、最近使用、本机使用次数、输入草稿与离线缓存，全部保存在 localStorage 与 Cache Storage 中，可随时通过清除站点数据一次清空。这些数据不会上传，也不会跨设备同步。</p>' +
      '<h2>访问统计</h2><p>本站默认不加载任何统计脚本。若启用统计，只采集聚合访问量，不使用 Cookie、不记录输入内容、不跨站追踪；浏览器发出 Do Not Track 时自动跳过，也可在本页一键关闭。</p>' +
      '<h2>加密分享</h2><p>分享结果时可选择加密：内容经 AES-GCM 在本地加密后放入链接的井号片段，该片段不会随请求发送到服务器，因此服务器与 CDN 日志中不会出现明文。设置口令时，拿到链接的人还需口令才能解开。</p>' +
      '<h2>如何自行验证</h2><p>打开开发者工具的 Network 面板运行任意本地工具，不会出现上传请求；缓存过离线包后断网刷新，本地工具仍可使用。</p>',
  },
  {
    path: 'submit',
    title: '开发并通过提交页发布一个工具 · ToolHub',
    desc: '两种贡献方式：推荐一个现成的开源项目加入目录，或者用页面上的生成器写一个能在浏览器本地跑的新工具，一次拿到可提交的工具包。',
    h1: '推荐开源项目，或自己造一个工具',
    extraCss: '/assets/style.submit.css',
    content:
      '<h2>方式一：推荐现成的开源项目</h2><p>开源且有明确 License，优先 MIT/Apache/BSD；能在浏览器中使用或可被工具化；站点长期可访问。需要注册才能用、含广告追踪、无法稳定访问的站点不收录。</p>' +
      '<h2>方式二：写一个本地工具</h2><p>ToolHub 的工具由 Manifest 驱动，新增一个工具只需要三样东西：<code>tool.json</code>（身份与收录信息）、<code>run.js</code>（表单清单 + 执行函数）、以及一份长尾正文。页面上的生成器会把这些骨架直接生成为可下载的压缩包，同时用与构建期相同的规范做校验。</p>' +
      '<h2>接入约定</h2><p>执行函数返回 <code>{ html, text, files }</code>；<b>禁止任何网络请求</b>（fetch / XHR / WebSocket / sendBeacon），本地工具必须断网可跑；单个体积不超过 200KB。违反约定的清单会在构建阶段被拒绝，不会流到线上。</p>' +
      '<h2>本地验收</h2><p>把工具目录放进仓库后，依次运行 <code>node scripts/lint-tools.mjs &lt;id&gt;</code>、<code>node scripts/build-pages.mjs</code>、<code>node scripts/verify.mjs</code>，三条都通过就可以提交 PR。</p>',
  },
  {
    path: 'compare',
    title: '工具对比 · ToolHub',
    desc: '把同类开源工具放在一起对比：数据是否上传、能否离线、是否需要注册、开源协议与来源，帮你在几个相似工具里做选择。',
    h1: '工具对比',
    content:
      '<h2>为什么需要对比同类工具</h2><p>同一个需求往往有好几个工具可选，差别在于数据处理方式、是否要装环境、协议与维护状况。把关键属性并排放，比逐个打开试要快得多。</p>' +
      '<h2>对比维度</h2><p>运行方式（浏览器内执行 / 第三方官网）、数据流向（是否上传）、离线可用性、是否需要注册、输入输出、开源协议与来源。</p>',
  },
  {
    path: 'feedback',
    title: '意见反馈与工具需求 · ToolHub',
    desc: '反馈使用问题、提交工具需求，帮助 ToolHub 变得更好用。',
    h1: '意见反馈与工具需求',
    content:
      '<h2>你可以反馈什么</h2><p>工具报错、想加的功能、希望收录的开源项目、界面与文案问题，都欢迎。</p>' +
      '<h2>怎么反馈</h2><p>复制页面上的模板，通过邮件或社区帖子发给我们。我们会把高频需求排进开发计划。</p>',
  },
];

for (const p of staticPages) {
  const dir = join(root, p.path);
  mkdirSync(dir, { recursive: true });
  const url = `${BASE}/${p.path}/`;
  let html = fillMeta(tpl, {
    title: p.title,
    desc: p.desc,
    url,
    botInject:
      `window.__PAGE__=${JSON.stringify(p.path)};` +
      (p.offlineMeta ? 'window.__OFFLINE_META__={"version":"__SW_VERSION__","files":__SW_FILES__,"bytes":__SW_BYTES__};' : ''),
    jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: p.title, description: p.desc, url },
  });
  // 页面分片 CSS：批量 / 离线 / 提交三页各自带一份，首页不为它们付样式体积
  if (p.extraCss) html = html.replace('</head>', `  <link rel="stylesheet" href="${p.extraCss}" />\n</head>`);
  html = html.replace(
    /<main class="container"[^>]*>/,
    `<main class="container" id="main-content" tabindex="-1">${seoBlock({ h1: p.h1, desc: p.desc, extra: p.content })}`
  );
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;
}

// 3.5) 资源库：索引页 + 各合集页
{
  const dir = join(root, 'resources');
  mkdirSync(dir, { recursive: true });
  const url = `${BASE}/resources/`;
  const list = resources.collections
    .map((c) => `<h2>${c.icon} ${c.title}</h2><p>${c.desc}</p><p><a href="/resources/${c.slug}/">查看 ${c.items.length} 个来源 →</a></p>`)
    .join('');
  let html = fillMeta(tpl, {
    title: '资源库 · 免费可用的设计素材与开发资源 · ToolHub',
    desc: '精选免费可用的资源：图标库、免费商用字体、配色方案与调色板，每条标注授权方式与来源站点。',
    url,
    botInject: `window.__PAGE__='resources';`,
    jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'ToolHub 资源库', description: '免费可用的设计素材与开发资源合集', url },
  });
  html = html.replace(
    /<main class="container"[^>]*>/,
    `<main class="container" id="main-content" tabindex="-1">${seoBlock({ h1: '资源库', desc: '精选免费可用的资源：图标库、免费商用字体、配色方案。与工具的区别是——工具用来做事，资源用来拿来用。', extra: list + `<p>${resources.policy}</p><p><a href="/">← 返回 ToolHub 全部工具</a></p>` })}`
  );
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;

  for (const c of resources.collections) {
    const cdir = join(root, 'resources', c.slug);
    mkdirSync(cdir, { recursive: true });
    const curl = `${BASE}/resources/${c.slug}/`;
    const items = c.items
      .map((it) => `<h3>${it.name}</h3><p>${it.note}</p><p>授权：${it.license} · 来源：${it.source} · <a href="${it.url}" target="_blank" rel="noopener">访问 ↗</a></p>`)
      .join('');
    let chtml = fillMeta(tpl, {
      title: `${c.title} · 资源库 · ToolHub`,
      desc: c.desc,
      url: curl,
      botInject: `window.__RES__=${JSON.stringify(c.slug)};`,
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: c.title,
        description: c.desc,
        url: curl,
        numberOfItems: c.items.length,
        itemListElement: c.items.map((it, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: it.name,
          url: it.url,
        })),
      },
    });
    chtml = chtml.replace(
      /<main class="container"[^>]*>/,
      `<main class="container" id="main-content" tabindex="-1">${seoBlock({
        h1: `${c.title}`,
        desc: c.desc,
        extra:
          `<h2>合集导语</h2><p>${c.intro}</p>` +
          (c.choices?.length ? `<h2>怎么选</h2><ul>${c.choices.map((x) => `<li>${x}</li>`).join('')}</ul>` : '') +
          `<h2>全部来源</h2>${items}` +
          `<p>${resources.policy}</p><p><a href="/resources/">← 返回资源库</a></p>`,
      })}`
    );
    writeFileSync(join(cdir, 'index.html'), chtml, 'utf8');
    count++;
  }
}

// 3.6) 专题合集（索引 + 各专题）
{
  const dir = join(root, 'topics');
  mkdirSync(dir, { recursive: true });
  const url = `${BASE}/topics/`;
  const list = topics.topics
    .map((t) => `<h2>${t.icon} ${t.title}</h2><p>${t.desc}</p><p><a href="/topics/${t.slug}/">查看专题 →</a></p>`)
    .join('');
  let html = fillMeta(tpl, {
    title: '专题合集 · 按场景打包的工具组合 · ToolHub',
    desc: '把工具按「要完成的事」打包：前端调试、图片处理、数据清洗、写作、接口联调、开源替代。每个专题含使用顺序、配套资源与常见问题。',
    url,
    botInject: `window.__PAGE__='topics';`,
    jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'ToolHub 专题合集', url },
  });
  html = html.replace(/<main class="container"[^>]*>/, `<main class="container" id="main-content" tabindex="-1">${seoBlock({ h1: '专题合集', desc: '按场景打包好的工具组合，不用自己从一堆工具里挑。', extra: list + '<p><a href="/">← 返回首页</a></p>' })}`);
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;

  for (const t of topics.topics) {
    const tdir = join(root, 'topics', t.slug);
    mkdirSync(tdir, { recursive: true });
    const turl = `${BASE}/topics/${t.slug}/`;
    const toolNames = t.tools.map((id) => (tools.find((x) => x.id === id) || dirTools.find((x) => x.id === id) || {}).name).filter(Boolean);
    let thtml = fillMeta(tpl, {
      title: `${t.title} · 专题 · ToolHub`,
      desc: t.desc,
      url: turl,
      botInject: `window.__TOPIC__=${JSON.stringify(t.slug)};`,
      jsonld: { '@context': 'https://schema.org', '@type': 'ItemList', name: t.title, description: t.desc, url: turl, numberOfItems: toolNames.length },
    });
    thtml = thtml.replace(/<main class="container"[^>]*>/, `<main class="container" id="main-content" tabindex="-1">${seoBlock({
      h1: t.title,
      desc: t.desc,
      extra:
        `<h2>专题说明</h2><p>${t.intro}</p>` +
        `<h2>包含工具（按建议顺序）</h2><ol>${toolNames.map((n) => `<li>${n}</li>`).join('')}</ol>` +
        (t.guides?.length ? `<h2>常见问题</h2>${t.guides.map((g) => `<h3>${g.title}</h3><p>${g.body}</p>`).join('')}` : '') +
        `<p><a href="/topics/">← 全部专题</a></p>`,
    })}`);
    writeFileSync(join(tdir, 'index.html'), thtml, 'utf8');
    count++;
  }
}

// 3.6c) 工具评测页（列表 + 每篇详情）
{
  const dir = join(root, 'evaluations');
  mkdirSync(dir, { recursive: true });
  const url = `${BASE}/evaluations/`;
  const list = evaluations.evaluations
    .map(
      (ev) =>
        `<h2>${ev.icon} ${ev.title}</h2><p>${ev.summary}</p><p>实测日期：${ev.date} · <a href="/evaluations/${ev.slug}/">阅读全文 →</a></p>`
    )
    .join('');
  let html = fillMeta(tpl, {
    title: '工具评测 · 同类工具横向实测 · ToolHub',
    desc: '同类开源工具横向实测对比：隐私边界、速度体验、功能取舍，每篇标注测试日期，结论随版本更新。',
    url,
    botInject: `window.__PAGE__='evaluations';`,
    jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'ToolHub 工具评测', url },
  });
  html = html.replace(
    /<main class="container"[^>]*>/,
    `<main class="container" id="main-content" tabindex="-1">${seoBlock({
      h1: '工具评测',
      desc: '同类工具横向实测：不吹不黑，把隐私边界、速度体验和功能取舍讲清楚。',
      extra: list + '<p><a href="/">← 返回首页</a></p>',
    })}`
  );
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;

  for (const ev of evaluations.evaluations) {
    const edir = join(root, 'evaluations', ev.slug);
    mkdirSync(edir, { recursive: true });
    const eurl = `${BASE}/evaluations/${ev.slug}/`;
    let ehtml = fillMeta(tpl, {
      title: `${ev.title} · 工具评测 · ToolHub`,
      desc: ev.summary,
      url: eurl,
      botInject: `window.__EVAL__=${JSON.stringify(ev.slug)};`,
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'Review',
        name: ev.title,
        description: ev.summary,
        url: eurl,
        datePublished: ev.date,
        itemReviewed: ev.items.filter((x) => x.url).map((x) => ({ '@type': 'SoftwareApplication', name: x.name, url: x.url })),
      },
    });
    ehtml = ehtml.replace(
      /<main class="container"[^>]*>/,
      `<main class="container" id="main-content" tabindex="-1">${seoBlock({
        h1: ev.title,
        desc: ev.summary,
        extra:
          `<p><b>结论：</b>${ev.verdict}</p>` +
          `<h2>对比项</h2><ul>${ev.items.map((x) => `<li><b>${x.name}</b>（${x.type} · 隐私：${x.privacy}）</li>`).join('')}</ul>` +
          `<h2>详细解读</h2>${ev.body.map((p) => `<p>${p}</p>`).join('')}` +
          `<p><a href="/evaluations/">← 全部评测</a></p>`,
      })}`
    );
    writeFileSync(join(edir, 'index.html'), ehtml, 'utf8');
    count++;
  }
}

// 3.7) 更新日志页
{
  const dir = join(root, 'changelog');
  mkdirSync(dir, { recursive: true });
  const url = `${BASE}/changelog/`;
  const body = changelog.entries
    .map((e) => `<h2>${e.version} · ${e.title}</h2><p>${e.date}</p><ul>${e.items.map((x) => `<li>${x}</li>`).join('')}</ul>`)
    .join('');
  let html = fillMeta(tpl, {
    title: '更新日志 · ToolHub',
    desc: 'ToolHub 的版本更新记录：新增工具、资源合集、功能改进与修复。',
    url,
    botInject: `window.__PAGE__='changelog';`,
    jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'ToolHub 更新日志', url },
  });
  html = html.replace(/<main class="container"[^>]*>/, `<main class="container" id="main-content" tabindex="-1">${seoBlock({ h1: '更新日志', desc: '这个平台在持续迭代，每次改动都记录在这里。', extra: body })}`);
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;
}

// 3.8) 公开 API（供其他站点调用工具清单）
{
  const dir = join(root, 'api');
  mkdirSync(dir, { recursive: true });
  const payload = {
    site: 'ToolHub',
    version: 1,
    updated: new Date().toISOString().slice(0, 10),
    total: tools.length + dirTools.length,
    tools: [...tools, ...dirTools.map((x) => ({ ...x, runtime: 'link' }))].map((x) => ({
      id: x.id,
      name: x.name,
      desc: x.desc,
      category: x.category,
      runtime: x.runtime,
      url: x.url || `${BASE}/tools/${x.id}/`,
      source: x.source,
      license: x.license,
      tags: x.tags || [],
    })),
  };
  writeFileSync(join(dir, 'tools.json'), JSON.stringify(payload, null, 2), 'utf8');
}

// 3.9) RSS 订阅（最新工具与资源）
{
  const recent = [...tools.slice(-12)].reverse();
  const items = recent
    .map(
      (t) => `    <item>
      <title>${escapeXml(t.name)}</title>
      <link>${BASE}/tools/${t.id}/</link>
      <guid>${BASE}/tools/${t.id}/</guid>
      <description>${escapeXml(t.desc)}</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>`
    )
    .join('\n');
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ToolHub · 开源工具，打开即用</title>
    <link>${BASE}/</link>
    <description>精选开源工具与免费资源，本地执行保护隐私。</description>
    <language>zh-CN</language>
    <atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  writeFileSync(join(root, 'feed.xml'), feed, 'utf8');
}

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// 4) sitemap
const urls = [
  { loc: `${BASE}/`, pri: '1.0', freq: 'daily' },
  ...[...tools, ...dirTools].map((t) => ({ loc: `${BASE}/tools/${t.id}/`, pri: '0.8', freq: 'weekly' })),
  ...staticPages.map((p) => ({ loc: `${BASE}/${p.path}/`, pri: '0.4', freq: 'monthly' })),
  { loc: `${BASE}/resources/`, pri: '0.7', freq: 'weekly' },
  ...resources.collections.map((c) => ({ loc: `${BASE}/resources/${c.slug}/`, pri: '0.7', freq: 'weekly' })),
  { loc: `${BASE}/topics/`, pri: '0.7', freq: 'weekly' },
  ...topics.topics.map((t) => ({ loc: `${BASE}/topics/${t.slug}/`, pri: '0.7', freq: 'weekly' })),
  { loc: `${BASE}/evaluations/`, pri: '0.7', freq: 'weekly' },
  ...evaluations.evaluations.map((ev) => ({ loc: `${BASE}/evaluations/${ev.slug}/`, pri: '0.6', freq: 'monthly' })),
  { loc: `${BASE}/changelog/`, pri: '0.5', freq: 'weekly' },
];
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(root, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.pri}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`,
  'utf8'
);

writeFileSync(join(root, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`, 'utf8');


// 6) 首页静态化（v3.0 E/D4）
// 背景：首页内容一直由 JS 渲染，route-cards / featured / res-preview 在首帧后才插入，
// 把它们下面的 trust-section 与 footer 整体下推，实测 CLS 0.249（预算 0.05）。
// 做法：把这四块 + 分类芯片 + 筛选栏在构建期直接写进 index.html。
// v3.9：原来单独注入的 hero 统计条已撤销，六个数并进入口卡（见 routeCards）。
// 收益：首帧即最终布局（CLS≈0），首页对爬虫可见，且只有首页背这份体积（工具页仍用模板生成）。
// 注意：这里的 HTML 必须与 assets/app.js 里对应渲染函数输出一致，否则 JS 重新渲染时又会位移一次。
{
  const registry = JSON.parse(readFileSync(join(root, 'tools', 'registry.json'), 'utf8'));
  const cats = registry.categories || [];
  const allTools = [...tools, ...dirTools];
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICONS = { 文本: '📝', 图片: '🖼️', 文档: '📄', 数据: '📊', 开发: '⚙️', 设计: '🎨', 音视频: '🎵', 效率: '⚡', 网络: '🌐' };

  // --- 各区块 HTML（与 app.js 输出保持同构） ---
  // v3.9：原来的「一行统计数字 + 一行入口卡」是两块说同一件事的皮（97 出现两次），
  // 现在合成一行：每张卡以一个数字打头，精选工具/本地执行/分类/资源/数据上传/评测
  // 六个数全部落进卡片，不再单独占一行。
  const routeCards = `
    <a class="route-card rc--tools" href="#tools-anchor" data-scroll="grid">
      <span class="rc-badge" aria-hidden="true">🧰</span><span class="rc-tag">工具箱</span>
      <b><span class="rc-num">${TOTAL_TOOLS}</span>个工具</b>
      <span class="rc-desc">${tools.length} 个纯本地执行 · ${cats.length} 个分类</span>
      <em>浏览工具 →</em>
    </a>
    <a class="route-card rc--res" href="/resources/">
      <span class="rc-badge" aria-hidden="true">📚</span><span class="rc-tag">资源库</span>
      <b><span class="rc-num">${TOTAL_RES}</span>条资源</b>
      <span class="rc-desc">${resources.collections.length} 个合集：图标、字体、配色、学习路线</span>
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
      <b><span class="rc-num">${evaluations.evaluations.length}</span>篇评测</b>
      <span class="rc-desc">横向实测：隐私、速度、功能边界一次讲清</span>
      <em>读评测 →</em>
    </a>`;

  // v3.4：13 → 8 条，并改成行式列表（卡片形式与下方工具网格太像，会被误认成同一份列表）
  const featuredIds = (registry.featured || [])
    .filter((id) => allTools.some((x) => x.id === id))
    .slice(0, FEATURED_MAX);
  const featuredHTML = featuredIds
    .map((id, i) => {
      const tool = allTools.find((x) => x.id === id);
      const isLocal = tool.runtime !== 'link';
      return `<div class="fl-row" data-id="${tool.id}" data-link="${isLocal ? '' : esc(tool.url)}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <div class="f-body"><div class="f-name">${esc(tool.name)}</div><div class="f-desc">${esc(tool.desc)}</div></div>
        <span class="f-meta">${isLocal ? '🔒 本地' : '🌐 在线'} · ${tool.category}</span>
      </div>`;
    })
    .join('');

  const resPreview = resources.collections
    .slice(0, 3)
    .map(
      (c) => `<a class="res-preview-card" href="/resources/${c.slug}/">
        <span class="rp-icon">${c.icon || '📚'}</span>
        <span class="rp-title">${esc(c.title)}</span>
        <span class="rp-desc">${esc(c.desc)}</span>
        <span class="rp-count">${c.items.length} 个来源 →</span>
      </a>`
    )
    .join('');

  const chips = [{ key: '全部', label: '全部' }, ...cats.map((c) => ({ key: c, label: c }))]
    .map((c) => `<button class="chip ${c.key === '全部' ? 'active' : ''}" data-cat="${esc(c.key)}">${esc(c.label)}</button>`)
    .join('');

  const filterbar =
    `<span class="fb-label">运行方式</span>` +
    ['全部', '🔒 仅本机执行', '📴 断网也能用']
      .map((x, i) => `<button type="button" class="chip ${i === 0 ? 'active' : ''}" data-rt="${['all', 'local', 'offline'][i]}">${x}</button>`)
      .join('') +
    `<span class="fb-sep"></span><span class="fb-label">排序</span>` +
    ['默认', '🔥 最常用', '🆕 最近收录']
      .map((x, i) => `<button type="button" class="chip ${i === 0 ? 'active' : ''}" data-sort="${['default', 'used', 'new'][i]}">${x}</button>`)
      .join('') +
    `<span class="fb-count" id="fb-count">共 ${TOTAL_TOOLS} 个</span>`;

  // --- 注入 ---
  let html = tpl;
  // 先清掉上一次注入的内容，保证反复构建结果一致
  html = html.replace(/<!--hs:[\w-]+-->[\s\S]*?<!--\/hs:[\w-]+-->/g, '');
  // 两个默认隐藏的区块复位，避免上一次的 display:'' 残留
  html = html.replace(/(<div class="featured-section" id="featured-section" style=")[^"]*(")/, '$1display:none$2');
  html = html.replace(/(<div class="res-preview" id="res-preview" style=")[^"]*(")/, '$1display:none$2');

  const put = (cls, id, tag, inner) => {
    const from = `<${tag} class="${cls}" id="${id}"></${tag}>`;
    if (!html.includes(from)) throw new Error(`首页静态化失败：找不到空容器 ${tag}#${id}`);
    html = html.replace(from, `<${tag} class="${cls}" id="${id}"><!--hs:${id}-->${inner}<!--/hs:${id}--></${tag}>`);
  };
  put('route-cards', 'route-cards', 'div', routeCards);
  put('featured-list', 'featured-grid', 'div', featuredHTML);
  put('res-preview-grid', 'res-preview-grid', 'div', resPreview);
  put('chips', 'chips', 'div', chips);
  put('filterbar', 'filterbar', 'div', filterbar);

  if (featuredIds.length) html = html.replace(/(<div class="featured-section" id="featured-section" style=")[^"]*(")/, '$1$2');
  html = html.replace(/(<div class="res-preview" id="res-preview" style=")[^"]*(")/, '$1$2');

  // v3.10：首页补结构化数据。全站 131 页里唯独首页是 0 个 ld+json——工具页早有
  // SoftwareApplication / FAQPage / HowTo，首页却什么都没有，所以「ToolHub」这个
  // 品牌词拿不到 sitelinks，也拿不到搜索结果里的站内搜索框。
  // SearchAction 指向 /?q=，这个参数在 app.js 的 renderHome 里真的会筛出结果；
  // 先让功能存在再声明——写一个抓出来是空页的 URL，Search Console 会判无效。
  // 用 <!--hs:--> 包住，复用上面的清理逻辑，保证反复构建不叠加。
  const homeLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${BASE}/#website`,
        name: 'ToolHub',
        alternateName: 'ToolHub 开源工具',
        url: `${BASE}/`,
        description: '收录开源在线工具，能在本地跑的都在浏览器里跑，文件不上传服务器。',
        inLanguage: 'zh-CN',
        publisher: { '@id': `${BASE}/#org` },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${BASE}/?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        '@id': `${BASE}/#org`,
        name: 'ToolHub',
        url: `${BASE}/`,
        logo: {
          '@type': 'ImageObject',
          url: `${BASE}/assets/icon-512.png`,
          width: 512,
          height: 512,
        },
      },
    ],
  };
  html = html.replace(
    '</head>',
    `  <!--hs:home-ld--><script type="application/ld+json">${JSON.stringify(homeLd)}</script><!--/hs:home-ld-->\n</head>`
  );

  writeFileSync(join(root, 'index.html'), html, 'utf8');
  console.log(`   ↻ 首页静态化：${featuredIds.length} 个推荐 / ${cats.length} 个分类 / ${resources.collections.length} 个合集（CLS 由 0.25 → ~0）`);
}

// 7) 生成 Service Worker（v3.0 E1），并把离线包的真实规模回填到 /offline/ 页。
//    顺序不能提前：/offline/ 页必须先落盘，否则它自己不在预缓存清单里，
//    会出现「装了应用、点离线下载全绿，但离线时打不开这个说明页」的怪事。
{
  const info = buildSw();
  const offFile = join(root, 'offline', 'index.html');
  if (existsSync(offFile)) {
    const h = readFileSync(offFile, 'utf8')
      .replace('"__SW_VERSION__"', JSON.stringify(info.version))
      .replace('__SW_FILES__', String(info.files.length))
      .replace('__SW_BYTES__', String(info.bytes));
    writeFileSync(offFile, h, 'utf8');
    if (!h.includes('__SW_')) console.log(`   ↻ /offline/ 统计已回填：${info.files.length} 个地址 · ${(info.bytes / 1048576).toFixed(1)} MB`);
    else console.log('   ⚠️ /offline/ 统计回填失败，页面仍显示占位符');
  } else {
    console.log('   ⚠️ 找不到 offline/index.html，离线包统计未回填');
  }
}

if (tpl !== rawTpl) console.log(`   ↻ 模板计数已归一：${TOTAL_TOOLS} 个工具 / ${TOTAL_RES} 条资源`);
console.log(`✅ 生成 ${count} 个静态页面、${urls.length} 条 sitemap 记录（含长尾正文与 JSON-LD）`);
console.log(`   BASE_URL = ${BASE}`);
console.log(`   域名绑定后请重新运行：node scripts/build-pages.mjs https://你的域名`);
