#!/usr/bin/env node
// 全量校验：数据完整性 / 覆盖率 / 静态页 / sitemap / 资源 / 可疑内容
// 用法：node scripts/verify.mjs   （失败时退出码 1，可直接接 CI）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { lintAll } from './lib/tool-lint.mjs';
import { buildToolsJson } from './sync-tools.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
let failed = 0;
const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail });
  } catch (e) {
    failed++;
    results.push({ ok: false, name, detail: e.message });
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
// 少量检查需要动态 import（安全头是 ESM 纯函数模块），统一收集后在打印前顺序执行
const pending = [];
function checkAsync(name, fn) {
  pending.push({ name, fn });
}

// ---------- 1. 数据文件 ----------
const local = read('tools/tools.json');
const dir = read('tools/directory.json');
const en = read('i18n.json').en;
const det = read('i18n-detail.json').en;
const art = read('articles.json');
const evals = read('evaluations.json');
const res = read('resources.json');
const topics = read('topics.json');
const changelog = read('changelog.json');
const all = [...local.tools, ...dir.tools];
const ids = new Set(all.map((x) => x.id));

check('数据文件可解析', () => `${all.length} 个工具`);

check('ID 唯一', () => {
  const ids = all.map((x) => x.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(!dup.length, '重复 ID: ' + dup.join(', '));
  return '无重复';
});

check('工具必填字段', () => {
  const need = ['id', 'name', 'desc', 'category', 'source', 'license'];
  // 目录工具的 runtime 在运行时补为 link，数据文件里可省略
  const bad = all.filter((x) => need.some((k) => !x[k]) || (!x.runtime && x.url === undefined)).map((x) => x.id);
  assert(!bad.length, '缺字段: ' + bad.join(', '));
  return '完整';
});

check('分类都在分类表内', () => {
  const cats = new Set(local.categories);
  const bad = all.filter((x) => !cats.has(x.category)).map((x) => x.id);
  assert(!bad.length, '未知分类: ' + bad.join(', '));
  return `${cats.size} 个分类`;
});

check('featured 引用有效', () => {
  const ids = new Set(all.map((x) => x.id));
  const bad = (local.featured || []).filter((id) => !ids.has(id));
  assert(!bad.length, '无效: ' + bad.join(', '));
  return `${local.featured.length} 个推荐位`;
});

check('目录工具 URL 合法', () => {
  const bad = dir.tools.filter((x) => !/^https?:\/\/[^\s]+$/.test(x.url)).map((x) => x.id);
  assert(!bad.length, 'URL 非法: ' + bad.join(', '));
  return `${dir.tools.length} 个链接`;
});

// ---------- 2. 翻译与内容覆盖 ----------
check('英文名称/简介覆盖', () => {
  const miss = all.filter((x) => !en.tools?.[x.id]).map((x) => x.id);
  assert(!miss.length, '缺译: ' + miss.join(', '));
  return `${all.length}/${all.length}`;
});

check('本地工具英文详情覆盖', () => {
  const localIds = local.tools.map((x) => x.id);
  const miss = localIds.filter((id) => {
    const d = det[id];
    return !d || !d.usage || !d.tips?.length || !d.scenarios?.length || !d.labels;
  });
  assert(!miss.length, '缺详情: ' + miss.join(', '));
  return `${localIds.length}/${localIds.length}`;
});

check('长尾正文覆盖 + 结构', () => {
  const localIds = local.tools.map((x) => x.id);
  const miss = localIds.filter((id) => {
    const a = art[id];
    return (
      !a ||
      !a.intro ||
      a.intro.length < 60 ||
      !a.steps ||
      a.steps.length < 3 ||
      !a.faq ||
      a.faq.length < 2 ||
      !a.pitfalls ||
      a.pitfalls.length < 2 ||
      a.pitfalls.some((p) => !p.title || !p.body)
    );
  });
  assert(!miss.length, '缺内容: ' + miss.join(', '));
  return `${localIds.length}/${localIds.length}（简介+步骤+FAQ+常见错误）`;
});

check('工具自身 usage/tips/scenarios', () => {
  const bad = [];
  for (const t of local.tools) {
    const mod = readFileSync(join(root, 'tools', t.id, 'run.js'), 'utf8');
    if (!mod.includes('export const manifest')) bad.push(t.id + '(manifest)');
    if (!mod.includes('export async function run')) bad.push(t.id + '(run)');
  }
  assert(!bad.length, '异常: ' + bad.join(', '));
  return `${local.tools.length} 个模块导出正常`;
});

// ---------- 2.5 资源库 ----------
check('资源库数据结构', () => {
  assert(res.collections?.length, '没有 collections');
  const bad = [];
  for (const c of res.collections) {
    if (!c.slug || !c.title || !c.desc || !c.intro) bad.push(c.slug + '(缺字段)');
    else if (c.intro.length < 80) bad.push(c.slug + '(导语过短)');
    if (!c.items || c.items.length < 6) bad.push(c.slug + '(条目 <6)');
  }
  assert(!bad.length, bad.join(', '));
  return `${res.collections.length} 个合集 / ${res.collections.reduce((a, c) => a + c.items.length, 0)} 条资源`;
});

check('资源条目标注授权', () => {
  const bad = [];
  for (const c of res.collections) {
    for (const it of c.items) {
      if (!it.url || !/^https?:\/\//.test(it.url)) bad.push(`${c.slug}/${it.name}(url)`);
      if (!it.license || it.license.length < 2) bad.push(`${c.slug}/${it.name}(license)`);
      if (!it.note || it.note.length < 15) bad.push(`${c.slug}/${it.name}(note)`);
      if (!it.source) bad.push(`${c.slug}/${it.name}(source)`);
    }
  }
  assert(!bad.length, bad.slice(0, 6).join(', '));
  return '每条都有 url / 授权 / 来源 / 推荐语';
});

check('资源库静态页', () => {
  assert(existsSync(join(root, 'resources', 'index.html')), '缺 /resources/');
  const miss = res.collections.filter((c) => !existsSync(join(root, 'resources', c.slug, 'index.html'))).map((c) => c.slug);
  assert(!miss.length, '缺合集页: ' + miss.join(', '));
  return `1 + ${res.collections.length} 页`;
});

// ---------- 2.6 专题 / 日志 / API / RSS ----------
check('专题数据结构', () => {
  assert(topics.topics?.length >= 1, '没有专题');
  const bad = [];
  for (const t of topics.topics) {
    if (!t.slug || !t.title || !t.intro || !t.desc) bad.push(t.slug + '(缺字段)');
    if (!t.tools || t.tools.length < 3) bad.push(t.slug + '(工具 <3)');
    if (!t.guides || t.guides.length < 2) bad.push(t.slug + '(常见问题 <2)');
    const miss = (t.tools || []).filter((id) => !ids.has(id));
    if (miss.length) bad.push(`${t.slug}(引用不存在: ${miss.join(',')})`);
    if (!existsSync(join(root, 'topics', t.slug, 'index.html'))) bad.push(t.slug + '(缺静态页)');
  }
  assert(!bad.length, bad.join('; '));
  return `${topics.topics.length} 个专题`;
});

check('评测数据结构', () => {
  assert(evals.evaluations?.length >= 1, '没有评测');
  const bad = [];
  for (const ev of evals.evaluations) {
    if (!ev.slug || !ev.title || !ev.summary || !ev.verdict || !ev.date) bad.push(ev.slug + '(缺字段)');
    if (!ev.items || ev.items.length < 2) bad.push(ev.slug + '(对比项 <2)');
    if (!ev.body || ev.body.length < 2) bad.push(ev.slug + '(正文 <2 段)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) bad.push(ev.slug + '(日期格式)');
    for (const it of ev.items || []) {
      if (!it.name || !it.type || !it.privacy) bad.push(`${ev.slug}(${it.name || '?'} 缺字段)`);
    }
    const miss = (ev.relatedTools || []).filter((id) => !ids.has(id));
    if (miss.length) bad.push(`${ev.slug}(引用不存在: ${miss.join(',')})`);
    if (!existsSync(join(root, 'evaluations', ev.slug, 'index.html'))) bad.push(ev.slug + '(缺静态页)');
  }
  assert(!bad.length, bad.join('; '));
  return `${evals.evaluations.length} 篇评测`;
});

check('更新日志结构', () => {
  assert(changelog.entries?.length >= 1, '没有记录');
  const bad = changelog.entries.filter((e) => !e.version || !e.date || !e.items?.length);
  assert(!bad.length, '条目字段不全');
  return `${changelog.entries.length} 条记录`;
});

check('公开 API 与 RSS', () => {
  const apiPath = join(root, 'api', 'tools.json');
  assert(existsSync(apiPath), '缺 api/tools.json');
  const api = JSON.parse(readFileSync(apiPath, 'utf8'));
  assert(api.tools.length === all.length, `API 工具数 ${api.tools.length} ≠ ${all.length}`);
  assert(api.total === all.length, 'API total 不一致');
  const feed = readFileSync(join(root, 'feed.xml'), 'utf8');
  assert(feed.includes('<rss') && feed.includes('<item>'), 'feed.xml 结构异常');
  return `API ${api.tools.length} 条 / RSS ${(feed.match(/<item>/g) || []).length} 项`;
});

// ---------- 3. 静态页与 sitemap ----------
check('每个工具都有静态页', () => {
  const miss = all.filter((t) => !existsSync(join(root, 'tools', t.id, 'index.html'))).map((t) => t.id);
  assert(!miss.length, `缺 ${miss.length} 个: ` + miss.slice(0, 8).join(', ') + (miss.length > 8 ? ' …' : ''));
  return `${all.length} 个页面`;
});

check('静态页含必备 meta', () => {
  const sample = all.slice(0, 12);
  const bad = [];
  for (const t of sample) {
    const html = readFileSync(join(root, 'tools', t.id, 'index.html'), 'utf8');
    if (!/<title>[^<]{5,}<\/title>/.test(html)) bad.push(t.id + '(title)');
    if (!/rel="canonical" href="https?:\/\//.test(html)) bad.push(t.id + '(canonical)');
    if (!/application\/ld\+json/.test(html)) bad.push(t.id + '(jsonld)');
    if (!/og:image" content="https?:\/\//.test(html)) bad.push(t.id + '(og:image)');
  }
  assert(!bad.length, '异常: ' + bad.join(', '));
  return `抽查 ${sample.length} 页均含 title/canonical/JSON-LD/og:image`;
});

check('sitemap 与页面一致', () => {
  const sm = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expect = all.length + 4; // 首页 + 84 工具 + about/submit/feedback（+尾部余量）
  assert(locs.length >= all.length, `sitemap 只有 ${locs.length} 条，少于工具数 ${all.length}`);
  return `${locs.length} 条 URL`;
});

check('静态页数（工具 + 说明页）', () => {
  const toolPages = readdirSync(join(root, 'tools')).filter((d) => existsSync(join(root, 'tools', d, 'index.html'))).length;
  // 说明页清单：漏建一个就等于导航里挂了个 404，所以逐个点名而不是数个数
  const PAGES = ['about', 'submit', 'feedback', 'compare', 'topics', 'changelog', 'evaluations', 'privacy', 'batch', 'offline'];
  const miss = PAGES.filter((p) => !existsSync(join(root, p, 'index.html')));
  assert(toolPages === all.length, `工具页 ${toolPages} ≠ 工具数 ${all.length}`);
  assert(!miss.length, `静态页缺: ${miss.join(', ')}`);
  return `${toolPages} + ${PAGES.length}`;
});

check('公开文案计数与数据一致', () => {
  const total = all.length;
  const home = readFileSync(join(root, 'index.html'), 'utf8');
  // 首页三处计数（meta description / og / hero 提示）+ 所有生成页的 twitter:description
  const nums = [...home.matchAll(/(\d+) 个(?:精选)?开源工具/g)].map((m) => +m[1]);
  nums.push(...[...home.matchAll(/(\d+) 个工具 ·/g)].map((m) => +m[1]));
  assert(nums.length >= 4, `首页计数只有 ${nums.length} 处，meta 可能被改动`);
  const wrong = nums.filter((n) => n !== total);
  assert(!wrong.length, `首页计数 ${[...new Set(wrong)].join('/')} ≠ 实际 ${total}`);
  // 抽查生成页的 twitter:description（fillMeta 不覆盖它，历史上漏改过）
  const probe = readFileSync(join(root, 'tools', all[0].id, 'index.html'), 'utf8');
  const m = probe.match(/name="twitter:description" content="精选 (\d+) 个开源工具/);
  assert(m && +m[1] === total, `生成页 twitter:description 计数 ${m ? m[1] : '缺失'} ≠ ${total}`);
  return `${total} 个工具 / ${nums.length} 处文案`;
});

// ---------- 4. 资源与可疑内容 ----------
check('关键资源存在', () => {
  const files = [
    'index.html', '404.html', 'robots.txt', 'sitemap.xml', 'site.webmanifest', 'sw.js',
    'package.json', 'analytics.json', 'perf-budget.json',
    '_worker.js/index.js', 'assets/lib/security-headers.js',
    'assets/app.js', 'assets/style.css', 'assets/pyodide-runtime.js', 'assets/og.png',
    'assets/icon-512.png', 'assets/icon-180.png', 'i18n.json', 'i18n-detail.json',
  ];
  const miss = files.filter((f) => !existsSync(join(root, f)));
  assert(!miss.length, '缺文件: ' + miss.join(', '));
  const small = files.filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).size < 50);
  assert(!small.length, '文件过小可能为空: ' + small.join(', '));
  return `${files.length} 个文件`;
});

check('无占位/调试残留', () => {
  const targets = ['assets/app.js', 'index.html', '404.html'];
  const badPatterns = [/undefined<\/b>/, /lorem ipsum/i, /TODO:/, /console\.log\('debug/, /\$\{t\('三'/];
  const hits = [];
  for (const f of targets) {
    const s = readFileSync(join(root, f), 'utf8');
    for (const p of badPatterns) if (p.test(s)) hits.push(`${f} → ${p}`);
  }
  assert(!hits.length, hits.join('; '));
  return '干净';
});

check('sw 版本号与 changelog 一致', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const m = sw.match(/const VERSION = "([^"]+)"/);
  assert(m, '未找到 VERSION 常量');
  const latest = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8')).entries[0].version;
  assert(m[1] === `toolhub-${latest}`, `sw 版本 ${m[1]} ≠ changelog 最新 ${latest}（忘了 npm run build？）`);
  assert(/由 scripts\/gen-sw\.mjs 生成/.test(sw), 'sw.js 不是构建期生成的（会被手改覆盖）');
  return m[1];
});

check('部署安全：不发布版本库与本地环境', () => {
  const ig = readFileSync(join(root, '.assetsignore'), 'utf8');
  const must = ['.git/', '.wrangler/', 'node_modules/'];
  const bad = must.filter((x) => !ig.split('\n').map((l) => l.trim()).includes(x));
  assert(!bad.length, '缺排除项: ' + bad.join(', '));
  // .git 若被发布，任何人都能下载完整提交历史
  assert(existsSync(join(root, '.git')), '.git 不存在，检查失去意义');
  return '.git / .wrangler / node_modules 已排除';
});

// ---------- 5. 无障碍基础 ----------
check('无障碍基础（skip link / 地标 / aria）', () => {
  const home = readFileSync(join(root, 'index.html'), 'utf8');
  const bad = [];
  if (!/class="skip-link" href="#main-content"/.test(home)) bad.push('缺 skip link');
  if (!/id="main-content"/.test(home)) bad.push('main 缺 id');
  if (!/<nav[^>]+aria-label=/.test(home)) bad.push('nav 缺 aria-label');
  if (!/id="search"[^>]+aria-label=/.test(home)) bad.push('搜索框缺 aria-label');
  if (!/id="palette"[^>]+role="dialog"/.test(home)) bad.push('命令面板缺 dialog 语义');
  // 工具页（由模板生成）同样具备
  const sample = all.slice(0, 6);
  const miss = sample.filter((t) => {
    const h = readFileSync(join(root, 'tools', t.id, 'index.html'), 'utf8');
    return !/class="skip-link"/.test(h) || !/id="main-content"/.test(h);
  }).map((t) => t.id);
  if (miss.length) bad.push('工具页缺: ' + miss.join(','));
  // 结果区 aria-live
  // v3.3：工具页（结果区 aria-live 等）已拆到 assets/tool-page.js，源码断言要读合并后的两份
  const appSrc =
    readFileSync(join(root, 'assets', 'app.js'), 'utf8') + '\n' + readFileSync(join(root, 'assets', 'tool-page.js'), 'utf8');
  if (!/id="tool-result"[^>]+aria-live="polite"/.test(appSrc)) bad.push('结果区缺 aria-live');
  // 卡片键盘可达（div 卡片需要 tabindex + role + Enter/Space）
  if (!/function kbLink\(/.test(appSrc)) bad.push('缺 kbLink 辅助函数');
  if (!/tabIndex = 0/.test(appSrc) || !/setAttribute\('role', 'link'\)/.test(appSrc)) bad.push('卡片缺键盘可达处理');
  // 焦点样式
  const css = readFileSync(join(root, 'assets/style.css'), 'utf8');
  if (!/:focus-visible/.test(css)) bad.push('缺 focus-visible 样式');
  if (!/prefers-reduced-motion/.test(css)) bad.push('缺 reduced-motion');
  assert(!bad.length, bad.join('; '));
  return 'skip link + landmark + aria + focus-visible';
});

check('结果出口契约（text / files）', () => {
  const localDirs = readdirSync(join(root, 'tools')).filter((d) => existsSync(join(root, 'tools', d, 'run.js')));
  const src = (d) => readFileSync(join(root, 'tools', d, 'run.js'), 'utf8');
  const covered = localDirs.filter((d) => /^\s{2,6}(text|files)\s*[:,]/m.test(src(d)));
  const bad = [];
  if (covered.length < 30) bad.push(`仅 ${covered.length}/${localDirs.length} 个工具返回 text/files`);
  // 不允许回退成工具自绘复制按钮或下载链接（否则无法统一回收 objectURL）
  const legacy = localDirs.filter((d) => /id="copy-btn"/.test(src(d)));
  if (legacy.length) bad.push('自绘复制按钮: ' + legacy.join(','));
  const appSrc2 =
    readFileSync(join(root, 'assets', 'app.js'), 'utf8') + '\n' + readFileSync(join(root, 'assets', 'tool-page.js'), 'utf8');
  if (!/function renderResultActions\(/.test(appSrc2)) bad.push('缺统一结果出口');
  if (!/releaseResultUrls\(\)/.test(appSrc2)) bad.push('缺 objectURL 回收');
  const css2 = readFileSync(join(root, 'assets/style.css'), 'utf8');
  if (!/\.result-actions\s*\{/.test(css2)) bad.push('缺 .result-actions 样式');
  assert(!bad.length, bad.join('; '));
  return `${covered.length}/${localDirs.length} 工具走标准出口`;
});

check('目录工具正文（v2.7 B1）', () => {
  const dirPath = join(root, 'content', 'directory-copy.json');
  assert(existsSync(dirPath), '缺 content/directory-copy.json');
  const copy = JSON.parse(readFileSync(dirPath, 'utf8'));
  const dirs = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8')).tools;
  const local = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools;
  const names = new Set([...local.map((x) => x.id), ...dirs.map((x) => x.id)]);
  const bad = [];
  for (const t of dirs) {
    const c = copy[t.id];
    if (!c) {
      bad.push(t.id + '(缺正文)');
      continue;
    }
    const chars = (c.intro + c.caveat + (c.scenes || []).join('')).length;
    if (chars < 220) bad.push(t.id + `(${chars}字偏少)`);
    if (!Array.isArray(c.scenes) || c.scenes.length < 3) bad.push(t.id + '(场景不足3)');
    if (!Array.isArray(c.pairs) || c.pairs.length < 1) bad.push(t.id + '(缺配合工具)');
    for (const pr of c.pairs || []) if (!names.has(pr.id)) bad.push(t.id + '→' + pr.id + '(指向不存在的工具)');
  }
  assert(!bad.length, bad.slice(0, 8).join('; '));
  return `${dirs.length} 个目录工具全部有人工正文`;
});

check('内链与结构化数据（v2.7 B2/B3）', () => {
  const dirs = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8')).tools;
  const missing = dirs.filter((t) => !existsSync(join(root, 'tools', t.id, 'index.html')));
  assert(!missing.length, '未构建的目录页: ' + missing.map((x) => x.id).join(','));
  const bad = [];
  let minChars = 1e9;
  let minId = '';
  for (const t of dirs) {
    const html = readFileSync(join(root, 'tools', t.id, 'index.html'), 'utf8');
    const i = html.indexOf('seo-static');
    const seg = i >= 0 ? html.slice(i, i + 20000) : '';
    const text = seg.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    if (text.length < 400) bad.push(t.id + `(${text.length}字)`);
    if (text.length < minChars) {
      minChars = text.length;
      minId = t.id;
    }
    const links = (seg.match(/href="\/(?:tools|topics|evaluations)\//g) || []).length;
    if (links < 3) bad.push(t.id + `(内链${links})`);
    if (!/FAQPage/.test(html)) bad.push(t.id + '(缺 FAQPage)');
    if (!/SoftwareApplication/.test(html)) bad.push(t.id + '(缺 SoftwareApplication)');
  }
  assert(!bad.length, bad.slice(0, 8).join('; '));
  return `全部 ≥400 字，最短 ${minId} ${minChars} 字`;
});

check('本地工具页相关阅读（v2.7 B3）', () => {
  const local = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools;
  const bad = [];
  let howTo = 0;
  for (const t of local) {
    const f = join(root, 'tools', t.id, 'index.html');
    if (!existsSync(f)) continue;
    const html = readFileSync(f, 'utf8');
    const i = html.indexOf('seo-static');
    const seg = i >= 0 ? html.slice(i, i + 20000) : '';
    if (!/相关阅读/.test(seg)) bad.push(t.id + '(缺相关阅读)');
    const links = (seg.match(/href="\/tools\//g) || []).length;
    if (links < 2) bad.push(t.id + `(内链${links})`);
    if (/HowTo/.test(html)) howTo++;
  }
  assert(!bad.length, bad.slice(0, 8).join('; '));
  return `${local.length} 个本地工具页有相关阅读，${howTo} 个带 HowTo`;
});

check('工具清单合规（v2.8 C1）', () => {
  const schema = read('tools/schema.json');
  const reg = read('tools/registry.json');
  const { errors, ids } = lintAll(root, schema, reg.categories || []);
  if (errors.length) {
    throw new Error(
      `${errors.length} 个问题：` + errors.slice(0, 4).map((e) => `${e.file}:${e.line} ${e.message}`).join('; ')
    );
  }
  return `${ids.length} 个 manifest 通过 schema + 语义校验`;
});

check('注册表与工具分片同步（v2.8 C2）', () => {
  const { payload, unknown } = buildToolsJson();
  const cur = readFileSync(join(root, 'tools', 'tools.json'), 'utf8').trim();
  assert(cur === JSON.stringify(payload, null, 2).trim(), 'tools/tools.json 与 tool.json 分片不一致，请跑 node scripts/sync-tools.mjs');
  assert(!unknown.length, `未登记在 registry.order：${unknown.join(', ')}`);
  return `${payload.tools.length} 个工具 / 排序已登记`;
});

check('接入闭环（v2.8 C3）', () => {
  const bad = [];
  if (!existsSync(join(root, 'docs', 'TOOL-CONTRACT.md'))) bad.push('缺 docs/TOOL-CONTRACT.md');
  if (!existsSync(join(root, 'scripts', 'new-tool.mjs'))) bad.push('缺脚手架 scripts/new-tool.mjs');
  if (!existsSync(join(root, 'scripts', 'sync-tools.mjs'))) bad.push('缺注册表同步脚本');
  // 生成器必须复用构建期的校验器与规范，否则「页面通过、构建失败」
  const builder = existsSync(join(root, 'assets', 'toolbuilder.js')) ? readFileSync(join(root, 'assets', 'toolbuilder.js'), 'utf8') : '';
  if (!builder) bad.push('缺提交页生成器 assets/toolbuilder.js');
  else {
    if (!/from '\.\/lib\/json-schema\.js'/.test(builder)) bad.push('生成器没有复用共享校验器');
    if (!/\/tools\/schema\.json/.test(builder)) bad.push('生成器没有加载 tools/schema.json');
    // zip 实现抽到了 assets/lib/zip.js（v3.0 E3 起结果区与批量页复用同一份）
    if (!/from '\.\/lib\/zip\.js'/.test(builder)) bad.push('生成器没有复用共享 zip 库');
    const zipLib = existsSync(join(root, 'assets', 'lib', 'zip.js')) ? readFileSync(join(root, 'assets', 'lib', 'zip.js'), 'utf8') : '';
    if (!zipLib) bad.push('缺 assets/lib/zip.js');
    else if (!/06054b50/.test(zipLib) || !/04034b50/.test(zipLib)) bad.push('zip 库缺目录结束/本地文件头签名');
  }
  // 脚手架模板必须自带契约要求的导出
  const cli = existsSync(join(root, 'scripts', 'new-tool.mjs')) ? readFileSync(join(root, 'scripts', 'new-tool.mjs'), 'utf8') : '';
  if (cli && !/export const manifest/.test(cli)) bad.push('脚手架模板缺 export const manifest');
  if (cli && !/export async function run/.test(cli)) bad.push('脚手架模板缺 export async function run');
  // 规范文件必须同时覆盖 manifest 与 toolMeta
  const schema = read('tools/schema.json');
  for (const k of ['manifest', 'toolMeta', 'input', 'scenario', 'option']) {
    if (!schema.$defs || !schema.$defs[k]) bad.push(`schema.json 缺 $defs.${k}`);
  }
  // 对外可见的契约：schema 已进发布包（爬虫与提交者都能直接取）
  const ig = readFileSync(join(root, '.assetsignore'), 'utf8');
  if (/^tools\/$/m.test(ig)) bad.push('tools/ 被整体排除，schema.json 会 404');
  assert(!bad.length, bad.join('; '));
  return '契约文档 + 脚手架 + 生成器 + 规范文件齐备';
});

// ---------- 7. 运维与合规（v2.9 D） ----------
check('安全头定义一致（D5）', () => {
  const secPath = join(root, 'assets', 'lib', 'security-headers.js');
  assert(existsSync(secPath), '缺 assets/lib/security-headers.js');
  const workerPath = join(root, '_worker.js', 'index.js');
  assert(existsSync(workerPath), '缺 _worker.js/index.js（安全头靠它注入）');
  const worker = readFileSync(workerPath, 'utf8');
  assert(/securityHeaders/.test(worker), 'Worker 没有复用共享的安全头定义');
  // 本地服务器必须用同一份，否则「本地能跑、线上被 CSP 拦」
  const serve = readFileSync(join(root, 'scripts', 'serve.mjs'), 'utf8');
  assert(/assets\/lib\/security-headers\.js/.test(serve), '本地服务器没有复用共享的安全头定义');
  // _headers 无法按查询串区分，会与工具页的嵌入需求冲突，故已移除
  assert(!existsSync(join(root, '_headers')), '_headers 仍存在，会与 Worker 的 CSP 叠加（frame-ancestors 取交集后嵌入失效）');
  return 'Worker + 本地服务器共用一份定义';
});

checkAsync('CSP 与嵌入规则（D5）', async () => {
  // 静态读一份即可：模块是纯函数，不依赖 DOM
  const mod = await import(pathToFileURL(join(root, 'assets', 'lib', 'security-headers.js')).href);
  const cspOf = (p) => mod.securityHeaders(p)['Content-Security-Policy'] || '';
  const home = cspOf('/');
  const tool = cspOf('/tools/json-format/');
  const issues = [];
  for (const token of ["'wasm-unsafe-eval'", 'blob:', "'self'", 'object-src', 'frame-ancestors']) {
    if (!home.includes(token)) issues.push(`首页 CSP 缺 ${token}`);
  }
  if (!/frame-ancestors 'self'/.test(home)) issues.push("首页 frame-ancestors 应为 'self'");
  // 工具页要能被第三方嵌入（?embed=1 的嵌入代码才有意义）
  if (!/frame-ancestors \*/.test(tool)) issues.push('工具页 frame-ancestors 应为 *，否则复制出去的嵌入代码被浏览器拦掉');
  // X-Frame-Options 无法按路径变化，会把工具页一起锁死
  const all = Object.keys(mod.securityHeaders('/'));
  if (all.includes('X-Frame-Options')) issues.push('不应再发 X-Frame-Options，改用 CSP frame-ancestors');
  if (!all.includes('Strict-Transport-Security')) issues.push('缺 HSTS');
  assert(!issues.length, issues.join('; '));
  return 'CSP 放行 wasm/blob，工具页可嵌入，其余同源';
});

checkAsync('统计配置与 CSP 对齐（D3）', async () => {
  const cfg = read('analytics.json');
  const allowed = ['none', 'cloudflare', 'plausible', 'umami'];
  assert(allowed.includes(cfg.provider), `provider=${cfg.provider} 不在 ${allowed.join('/')} 内`);
  assert(typeof cfg.honorDNT === 'boolean', 'honorDNT 必须是布尔值');
  if (cfg.provider === 'none') {
    // 默认状态下必须零第三方脚本：CSP 里也不需要任何统计域名
    const app = readFileSync(join(root, 'assets', 'app.js'), 'utf8');
    assert(/provider === 'none'/.test(app) || /!provider \|\| provider === 'none'/.test(app), 'app.js 没有处理 provider=none 的分支');
    return '默认关闭（零第三方请求）';
  }
  // 开启时：CSP 必须放行对应域名，否则脚本会被静默拦掉（用户以为有数据，其实一条都没有）
  const mod = await import(pathToFileURL(join(root, 'assets', 'lib', 'security-headers.js')).href);
  const csp = mod.securityHeaders('/')['Content-Security-Policy'];
  const need = {
    cloudflare: 'static.cloudflareinsights.com',
    plausible: cfg.scriptUrl ? new URL(cfg.scriptUrl).host : 'plausible.io',
    umami: cfg.scriptUrl ? new URL(cfg.scriptUrl).host : '',
  }[cfg.provider];
  assert(need, `${cfg.provider} 需要填写 scriptUrl`);
  assert(csp.includes(need), `CSP 未放行 ${need}，统计脚本会被拦掉`);
  return `${cfg.provider} 已放行 ${need}`;
});

check('首屏性能预算（D4）', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  const vendor = srcs.filter((s) => s.includes('/assets/vendor/'));
  assert(!vendor.length, `首屏又引入了第三方库：${vendor.join(', ')}（应在工具内按需加载）`);
  assert(existsSync(join(root, 'perf-budget.json')), '缺 perf-budget.json');
  assert(existsSync(join(root, 'scripts', 'perf-budget.mjs')), '缺 scripts/perf-budget.mjs');
  return `${srcs.length} 个首屏脚本，无第三方库`;
});

check('隐私说明与统计口径（D3）', () => {
  const page = join(root, 'privacy', 'index.html');
  assert(existsSync(page), '缺 /privacy/ 静态页（构建后再校验）');
  const body = readFileSync(page, 'utf8');
  assert(/不上传/.test(body), '隐私页没有说明数据不上传');
  assert(/analytics-optout|统计/.test(body), '隐私页没有提到统计与关闭方式');
  const sm = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  assert(/\/privacy\/<\/loc>/.test(sm), 'sitemap 缺 /privacy/');
  const app = readFileSync(join(root, 'assets', 'app.js'), 'utf8');
  assert(/ANALYTICS_OPT_OUT/.test(app), 'app.js 缺本机退出统计的实现');
  return '隐私页 + sitemap + 退出开关';
});

// ---------- v3.0 E1–E4 ----------
check('离线包清单（E1）', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const full = JSON.parse(sw.match(/const FULL = (\[[\s\S]*?\n\]);/)[1]);
  const core = JSON.parse(sw.match(/const CORE = (\[[\s\S]*?\n\]);/)[1]);
  const set = new Set(full);
  const bad = [];
  // 每个本地工具页与执行文件都必须在清单里——漏一个就是「装了应用，那个工具离线打不开」
  for (const t of all.filter((x) => existsSync(join(root, 'tools', x.id, 'run.js')))) {
    if (!set.has(`/tools/${t.id}/`)) bad.push(`${t.id} 页`);
    if (!set.has(`/tools/${t.id}/run.js`)) bad.push(`${t.id} run.js`);
  }
  for (const p of ['/', '/offline/', '/site.webmanifest', '/assets/app.js', '/assets/style.css']) {
    if (!set.has(p)) bad.push(p);
  }
  // SW 自己不能被自己缓存，否则永远拿不到新版本
  assert(!set.has('/sw.js'), '预缓存清单不应包含 /sw.js');
  assert(sw.includes("url.pathname === '/sw.js'"), 'fetch 事件没有跳过 /sw.js');
  assert(core.length >= 10 && core.length < full.length, `首屏清单 ${core.length} 项不合理`);
  // Pyodide 运行时不能进包（核心 13MB + pandas 36MB），否则「安装」会变成几分钟；
  // 但 assets/pyodide-runtime.js（4KB 的共享加载器，app.js 的静态 import）必须进首屏，
  // pyodide-loader.js 也要进——否则离线打开 Python 工具连报错都报不出来。
  // 注意运行时本体在 /assets/vendor/pyodide/ 下，不在 assets/ 根目录，别把加载器误判成运行时。
  assert(!full.some((u) => /^\/assets\/vendor\/pyodide\//.test(u) || /\.whl$/i.test(u)), '离线包不应包含 Pyodide 运行时');
  assert(full.some((u) => /pyodide-loader\.js$/.test(u)), '离线包缺 pyodide-loader.js（离线时 Python 工具会静默失败）');

  // 应用自身的按需模块（batch / drop / zip / 加密分享 / 意图解析 …）也必须在包里。
  // 这些是 import() 加载的，缺了不会白屏，而是「离线点一下没反应」——更难发现也更容易漏。
  const appModules = readdirSync(join(root, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `/assets/${f}`);
  for (const f of readdirSync(join(root, 'assets', 'lib'))) {
    if (f.endsWith('.js') && !['json-schema.js', 'security-headers.js'].includes(f)) appModules.push(`/assets/lib/${f}`);
  }
  for (const m of appModules) if (!set.has(m)) bad.push(`${m} 不在离线清单`);

  // 静态 import 是启动链的一部分：缺一个整页白屏，必须在**首屏**清单里（而不是「按需补」）
  const bootImports = [...readFileSync(join(root, 'assets', 'app.js'), 'utf8').matchAll(/^import .* from '(\/assets\/[\w./-]+)';$/gm)].map(
    (m) => m[1]
  );
  for (const b of bootImports) if (!core.includes(b)) bad.push(`${b} 是静态 import，却没进首屏清单`);

  assert(!bad.length, '清单缺失: ' + bad.slice(0, 6).join(', '));
  return `${full.length} 个地址 / 首屏 ${core.length} 项`;
});

check('PWA 可安装（E1）', () => {
  const mf = JSON.parse(readFileSync(join(root, 'site.webmanifest'), 'utf8'));
  const sizes = mf.icons.map((i) => i.sizes);
  const bad = [];
  if (!sizes.includes('192x192')) bad.push('缺 192 图标');
  if (!sizes.includes('512x512')) bad.push('缺 512 图标');
  if (!mf.icons.some((i) => i.purpose === 'maskable')) bad.push('缺 maskable 图标');
  for (const i of mf.icons.filter((x) => x.src.startsWith('/'))) {
    if (!existsSync(join(root, i.src.replace(/^\//, '')))) bad.push(`图标文件不存在 ${i.src}`);
  }
  const app = readFileSync(join(root, 'assets', 'app.js'), 'utf8');
  if (!/beforeinstallprompt/.test(app)) bad.push('app.js 未捕获 beforeinstallprompt');
  if (!/__OFFLINE_META__/.test(readFileSync(join(root, 'offline', 'index.html'), 'utf8'))) bad.push('/offline/ 页缺离线统计注入');
  assert(!bad.length, bad.join('; '));
  return `${mf.icons.length} 个图标 + 安装入口`;
});

check('加密分享实现（E2）', () => {
  const src = readFileSync(join(root, 'assets', 'lib', 'secure-share.js'), 'utf8');
  const bad = [];
  if (!/AES-GCM/.test(src)) bad.push('未使用 AES-GCM');
  if (!/256/.test(src)) bad.push('密钥长度不是 256');
  if (!/PBKDF2/.test(src)) bad.push('口令派生未用 PBKDF2');
  if (!/ENC_PREFIX = '#enc='/.test(src)) bad.push('片段前缀不是 #enc=（片段不随请求发送，是这套方案的前提）');
  const app =
    readFileSync(join(root, 'assets', 'app.js'), 'utf8') + '\n' + readFileSync(join(root, 'assets', 'tool-page.js'), 'utf8');
  if (!/applyEncryptedShare/.test(app)) bad.push('未接入收链接自动解密');
  if (!/share-enc/.test(app)) bad.push('结果区缺加密分享入口');
  // 明文绝不能出现在 query string 里（那会进服务器日志）
  if (/location\.search\s*=\s*[^;]*enc=/.test(app)) bad.push('密文被写进了 query string');
  assert(!bad.length, bad.join('; '));
  return 'AES-GCM 256 + PBKDF2 + # 片段';
});

check('批量处理与 ZIP（E3）', () => {
  const zip = readFileSync(join(root, 'assets', 'lib', 'zip.js'), 'utf8');
  const batch = readFileSync(join(root, 'assets', 'batch.js'), 'utf8');
  const bad = [];
  // 本地文件头 + 中央目录结束记录：两个签名都在，才说明真的产出了可解压的 zip
  if (!zip.includes('04034b50')) bad.push('缺本地文件头签名');
  if (!zip.includes('06054b50')) bad.push('缺中央目录结束签名');
  if (!zip.includes('\\u0800') && !zip.includes('0x0800')) bad.push('缺 UTF-8 文件名标记（中文文件名会乱码）');
  if (!/export (async )?function zipBlob/.test(zip)) bad.push('未导出 zipBlob');
  // 三处复用同一份实现，不允许再出现第二份手写 zip
  for (const f of ['assets/batch.js', 'assets/toolbuilder.js', 'assets/tool-page.js']) {
    if (!/lib\/zip\.js/.test(readFileSync(join(root, f), 'utf8'))) bad.push(`${f} 未复用 lib/zip.js`);
  }
  if (!/export (async )?function mountBatch/.test(batch)) bad.push('batch.js 未导出 mountBatch');
  assert(!bad.length, bad.join('; '));
  return 'STORE + CRC32 单一实现';
});

checkAsync('意图解析规则（E4）', async () => {
  const mod = await import(pathToFileURL(join(root, 'assets', 'lib', 'intent.js')).href);
  const cases = [
    ['把这张图压到 200KB', 'image-compress', { quality: 60 }],
    ['帮我算下月薪 20000 的个税', 'tax-calc', { salary: 20000 }],
    ['把 jpg 转成 webp', 'image-convert', {}],
    ['缩到 800px', 'image-resize', { max: '1200' }],
    ['生成一个二维码', 'qrcode', {}],
    ['合并两个 pdf', 'pdf-merge', {}],
  ];
  const ids = new Set(all.map((t) => t.id));
  const bad = [];
  for (const [q, id, params] of cases) {
    const r = mod.parseIntent(q);
    if (!r) { bad.push(`「${q}」无命中`); continue; }
    if (r.id !== id) bad.push(`「${q}」→ ${r.id}，期望 ${id}`);
    if (!ids.has(r.id)) bad.push(`规则指向不存在的工具 ${r.id}`);
    for (const [k, v] of Object.entries(params)) {
      if (r.params[k] !== v) bad.push(`「${q}」参数 ${k}=${r.params[k]}，期望 ${v}`);
    }
  }
  // 参数键必须真实存在于工具的 inputs，否则 applyValues 会静默丢弃——
  // 用户会看到「跳对了工具，但参数一个也没填」。tools.json 是精简注册表、不带 inputs，
  // 所以直接在 run.js 源码里找字段声明（零依赖，不需要解析 JS）。
  for (const [q] of cases) {
    const r = mod.parseIntent(q);
    let src;
    try {
      src = readFileSync(join(root, 'tools', r.id, 'run.js'), 'utf8');
    } catch {
      bad.push(`${r.id} 没有 run.js，不能作为意图目标`);
      continue;
    }
    for (const [k, v] of Object.entries(r.params || {})) {
      const declared = new RegExp(`name:\\s*['"]${k}['"]`).test(src);
      if (!declared) {
        bad.push(`「${q}」参数键 ${k} 不是 ${r.id} 的字段`);
        continue;
      }
      // select 的取值必须在选项中，否则填进去等于没填
      if (typeof v === 'string' && !new RegExp(`value:\\s*['"]${v}['"]`).test(src)) {
        bad.push(`「${q}」参数 ${k}=${v} 不在 ${r.id} 的选项中`);
      }
    }
  }
  // 站内没有汇率工具，这类句子不该硬凑一个答案
  assert(mod.parseIntent('100 美元是多少人民币') === null, '不该为站内不存在的汇率能力给出结果');
  assert(!bad.length, bad.join('; '));
  return `${cases.length} 条用例 + 参数合法性`;
});

// ---------- 异步检查 ----------
for (const p of pending) {
  try {
    const detail = await p.fn();
    results.push({ ok: true, name: p.name, detail });
  } catch (e) {
    failed++;
    results.push({ ok: false, name: p.name, detail: e.message });
  }
}

// ---------- 输出 ----------
console.log('\n🔍 ToolHub 全量校验\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(26)} ${r.ok ? r.detail : '→ ' + r.detail}`);
}
console.log(`\n${failed ? '❌ 失败 ' + failed + ' 项' : '✅ 全部通过'}（${results.length} 项检查）\n`);
process.exit(failed ? 1 : 0);
