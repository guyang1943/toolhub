#!/usr/bin/env node
// 构建 SEO 静态页：工具页（含长尾正文 + FAQ + JSON-LD）、关于/提交/反馈页，以及 sitemap/robots
// 用法：node scripts/build-pages.mjs [BASE_URL]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'https://toolhub.guyang1966.workers.dev').replace(/\/$/, '');

const tools = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools;
const dirTools = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8')).tools;
const i18n = JSON.parse(readFileSync(join(root, 'i18n.json'), 'utf8')).en;
const articles = JSON.parse(readFileSync(join(root, 'articles.json'), 'utf8'));
const evaluations = JSON.parse(readFileSync(join(root, 'evaluations.json'), 'utf8'));
const resources = JSON.parse(readFileSync(join(root, 'resources.json'), 'utf8'));
const topics = JSON.parse(readFileSync(join(root, 'topics.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
// 计数归一：模板里的工具数/资源数一律由数据推导，避免每加一个工具就要手改多处 meta
const TOTAL_TOOLS = tools.length + dirTools.length;
const TOTAL_RES = resources.collections.reduce((n, c) => n + c.items.length, 0);
const rawTpl = readFileSync(join(root, 'index.html'), 'utf8');
const tpl = rawTpl
  .replace(/\d+(?= 个精选开源工具)/g, TOTAL_TOOLS)
  .replace(/\d+(?= 个开源工具)/g, TOTAL_TOOLS)
  .replace(/\d+(?= 个工具 ·)/g, TOTAL_TOOLS)
  .replace(/\d+(?= 条资源)/g, TOTAL_RES);
// 模板本身也回写（幂等），保证根页面直接访问时计数正确
if (tpl !== rawTpl) {
  writeFileSync(join(root, 'index.html'), tpl, 'utf8');
  console.log(`   ↻ 模板计数已归一：${TOTAL_TOOLS} 个工具 / ${TOTAL_RES} 条资源`);
}

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

// 1) 工具页
for (const tool of tools) {
  const dir = join(root, 'tools', tool.id);
  if (!existsSync(dir)) continue;
  const en = (i18n.tools && i18n.tools[tool.id]) || {};
  const article = articles[tool.id];
  const title = `${tool.name}${en.name ? ' / ' + en.name : ''} · ToolHub`;
  const desc = (tool.desc + (en.desc ? ' ' + en.desc : '')).replace(/"/g, '&quot;');
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

  html = html.replace(
    /<main class="container">/,
    `<main class="container">${seoBlock({
      h1: tool.name,
      desc: tool.desc,
      article: article || null,
      extra: `<p>来源：${tool.source} · License: ${tool.license} · 分类：${tool.category}</p><p><a href="/">← 返回 ToolHub 全部工具</a></p>`,
    })}`
  );
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;
}

// 2) 目录工具页（第三方开源项目的官方在线版说明页）
for (const tool of dirTools) {
  const dir = join(root, 'tools', tool.id);
  mkdirSync(dir, { recursive: true });
  const en = (i18n.tools && i18n.tools[tool.id]) || {};
  const title = `${tool.name}${en.name ? ' / ' + en.name : ''} · 官方在线版 · ToolHub`;
  const desc = (tool.desc + (en.desc ? ' ' + en.desc : '')).replace(/"/g, '&quot;');
  const url = `${BASE}/tools/${tool.id}/`;
  let host = tool.url;
  try {
    host = new URL(tool.url).hostname;
  } catch {}

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

  let html = fillMeta(tpl, {
    title,
    desc,
    url,
    botInject: `window.__TOOL__=${JSON.stringify(tool.id)};`,
    jsonld,
  });
  html = html.replace(
    /<main class="container">/,
    `<main class="container">${seoBlock({
      h1: `${tool.name} · 官方在线版`,
      desc: tool.desc,
      extra:
        (tool.blurb ? `<h2>编辑推荐</h2><p>${tool.blurb}</p>` : '') +
        `<p>项目来源：${tool.source} · License: ${tool.license} · 分类：${tool.category}</p>` +
        `<p>官网地址：<a href="${tool.url}" target="_blank" rel="noopener">${tool.url}</a>（新标签页打开）</p>` +
        `<p>说明：本页是 ToolHub 对该开源项目的整理与推荐，工具由项目作者维护，版权与数据归原作者所有。官网无法访问时可能是临时故障或网络限制。</p>` +
        `<p><a href="/">← 返回 ToolHub 全部工具</a></p>`,
    })}`
  );
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  count++;
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
    path: 'submit',
    title: '推荐一个开源工具 · ToolHub',
    desc: '向 ToolHub 推荐好用的开源项目：收录标准、推荐模板与不收录清单。',
    h1: '推荐一个开源工具',
    content:
      '<h2>收录标准</h2><p>开源且有明确 License，优先 MIT/Apache/BSD；能在浏览器中使用或可被工具化；站点长期可访问。</p>' +
      '<h2>不收录</h2><p>需要注册账号才能使用的服务、含广告与追踪脚本的服务、无法稳定访问的站点。</p>',
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
    botInject: `window.__PAGE__=${JSON.stringify(p.path)};`,
    jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: p.title, description: p.desc, url },
  });
  html = html.replace(
    /<main class="container">/,
    `<main class="container">${seoBlock({ h1: p.h1, desc: p.desc, extra: p.content })}`
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
    /<main class="container">/,
    `<main class="container">${seoBlock({ h1: '资源库', desc: '精选免费可用的资源：图标库、免费商用字体、配色方案。与工具的区别是——工具用来做事，资源用来拿来用。', extra: list + `<p>${resources.policy}</p><p><a href="/">← 返回 ToolHub 全部工具</a></p>` })}`
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
      /<main class="container">/,
      `<main class="container">${seoBlock({
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
  html = html.replace(/<main class="container">/, `<main class="container">${seoBlock({ h1: '专题合集', desc: '按场景打包好的工具组合，不用自己从一堆工具里挑。', extra: list + '<p><a href="/">← 返回首页</a></p>' })}`);
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
    thtml = thtml.replace(/<main class="container">/, `<main class="container">${seoBlock({
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
    /<main class="container">/,
    `<main class="container">${seoBlock({
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
      /<main class="container">/,
      `<main class="container">${seoBlock({
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
  html = html.replace(/<main class="container">/, `<main class="container">${seoBlock({ h1: '更新日志', desc: '这个平台在持续迭代，每次改动都记录在这里。', extra: body })}`);
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

console.log(`✅ 生成 ${count} 个静态页面、${urls.length} 条 sitemap 记录（含长尾正文与 JSON-LD）`);
console.log(`   BASE_URL = ${BASE}`);
console.log(`   域名绑定后请重新运行：node scripts/build-pages.mjs https://你的域名`);
