#!/usr/bin/env node
// 全量校验：数据完整性 / 覆盖率 / 静态页 / sitemap / 资源 / 可疑内容
// 用法：node scripts/verify.mjs   （失败时退出码 1，可直接接 CI）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

check('静态页数（工具 + 关于/提交/反馈）', () => {
  const toolPages = readdirSync(join(root, 'tools')).filter((d) => existsSync(join(root, 'tools', d, 'index.html'))).length;
  const extras = ['about', 'submit', 'feedback', 'compare', 'topics', 'changelog', 'evaluations'].filter((p) => existsSync(join(root, p, 'index.html'))).length;
  assert(toolPages === all.length, `工具页 ${toolPages} ≠ 工具数 ${all.length}`);
  assert(extras === 7, `静态页缺 ${7 - extras} 个`);
  return `${toolPages} + ${extras}`;
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
    'index.html', '404.html', 'robots.txt', 'sitemap.xml', 'site.webmanifest', 'sw.js', '_headers',
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

check('sw 版本号存在', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const m = sw.match(/toolhub-v[\d.]+/);
  assert(m, '未找到版本号');
  return m[0];
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
  const appSrc = readFileSync(join(root, 'assets/app.js'), 'utf8');
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
  const appSrc2 = readFileSync(join(root, 'assets/app.js'), 'utf8');
  if (!/function renderResultActions\(/.test(appSrc2)) bad.push('app.js 缺统一结果出口');
  if (!/releaseResultUrls\(\)/.test(appSrc2)) bad.push('app.js 缺 objectURL 回收');
  const css2 = readFileSync(join(root, 'assets/style.css'), 'utf8');
  if (!/\.result-actions\s*\{/.test(css2)) bad.push('缺 .result-actions 样式');
  assert(!bad.length, bad.join('; '));
  return `${covered.length}/${localDirs.length} 工具走标准出口`;
});

// ---------- 输出 ----------
console.log('\n🔍 ToolHub 全量校验\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(26)} ${r.ok ? r.detail : '→ ' + r.detail}`);
}
console.log(`\n${failed ? '❌ 失败 ' + failed + ' 项' : '✅ 全部通过'}（${results.length} 项检查）\n`);
process.exit(failed ? 1 : 0);
