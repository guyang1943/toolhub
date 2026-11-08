#!/usr/bin/env node
// 全量校验：数据完整性 / 覆盖率 / 静态页 / sitemap / 资源 / 可疑内容
// 用法：node scripts/verify.mjs   （失败时退出码 1，可直接接 CI）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { lintAll } from './lib/tool-lint.mjs';
import { buildToolsJson } from './sync-tools.mjs';
import { sameJsonText } from './lib/eol.mjs';
import { checkStorageKeys } from './lib/storage-keys.mjs';
// 键清单本身也要被校验，所以直接从浏览器侧那份模块读——不复制一份到 Node 侧。
import * as storeKeys from '../assets/lib/store-keys.js';
import { staticPaths, matchPage, pagePatterns } from './lib/pages-registry.mjs';
import { PRIVACY_KINDS, validateToolMeta } from './lib/tool-meta.mjs';
import { loadResources } from './lib/resources-data.mjs';
import { BOOT_DROP, buildOnlyFieldsLeft, slimDirectory } from './lib/directory-boot.mjs';
import { validateIo, PORTS } from '../assets/lib/tool-io.js';
import { COVERAGE_FLOOR } from './lib/evidence.mjs';

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
// v3.24 起正文不在 resources.json 里，用共用加载器合起来读；
// 下面「资源正文不在首屏」那一条单独盯拆分有没有被悄悄退回。
const res = loadResources(root);
const topics = read('topics.json');
const changelog = read('changelog.json');
const all = [...local.tools, ...dir.tools];
const ids = new Set(all.map((x) => x.id));
// v3.30：本地工具的 aliases 已从 tools.json 拆到 tools/aliases.json（首屏按需加载）。
// 校验侧要把它合回来——「口语词表里的变体是否真的进了别名」这条断言查的就是这里，
// 少了这一句，加工具忘了跑别名生成器会静默通过。
const ALIAS_MAP = read('tools/aliases.json');
for (const tool of local.tools) {
  if (!tool.aliases && ALIAS_MAP[tool.id]) tool.aliases = ALIAS_MAP[tool.id];
}

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

// v3.27：上一条只查「文件里有没有 export 这两行」，查不出反引号没配对这类语法错——
// 而 run.js 是浏览器动态 import 的，构建期不解析它，于是页面生成成功、结构断言全过，
// 用户打开才看到「工具加载失败」。media-info 漏一个反引号就是这么漏过去的（浏览器测试抓到的）。
// 这里真的让 V8 解析一遍：只解析不执行（不碰 DOM），一个进程跑完 62 个约 0.25 秒。
check('工具脚本语法可解析（run.js）', () => {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', 'scripts/lib/parse-tools.cjs', root], {
    cwd: root,
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  assert(r.status === 0, '有 run.js 解析失败：' + out.split('\n').slice(0, 3).join(' | '));
  return `${out.replace(/^OK /, '')} 个 run.js 通过 V8 解析`;
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

// v3.24：正文拆出首屏这件事必须有人盯着。否则哪天有人「顺手」把 note 写回 resources.json，
// 页面照样正常显示，只有首屏悄悄背着 3.8 KB 上路——这种退化只有断言看得见。
check('资源正文不在首屏', () => {
  const raw = read('resources.json');
  const back = raw.collections.reduce((a, c) => a + c.items.filter((i) => 'note' in i).length, 0);
  assert(!back, `${back} 条正文又写回了 resources.json（首屏会重新背上约 3.8 KB）`);

  const notes = read('resources-notes.json');
  const total = raw.collections.reduce((a, c) => a + c.items.length, 0);
  const have = raw.collections.reduce((a, c) => a + Object.keys(notes.notes[c.slug] || {}).length, 0);
  assert(have === total, `正文 ${have} 条 / 条目 ${total} 条，对不上`);

  const missing = res.__missingNotes || [];
  assert(!missing.length, `缺正文: ${missing.slice(0, 5).join(', ')}`);
  return `${total} 条正文在 resources-notes.json 按需加载`;
});

// v3.32：目录数据的证据字段必须留在源文件。evidence / linkStatus 只有构建期写页面时用得到，
// 浏览器从不读；它们要是跟着一起回到首屏，页面照样正常，只有体积悄悄涨 1 KB——
// 和「资源正文被写回首屏」是同一类退化，同样只有断言看得见。
check('目录证据不在首屏', () => {
  const budget = read('perf-budget.json');
  assert(
    !budget.bootData.includes('tools/directory.json'),
    '首屏启动数据又列了源文件 tools/directory.json——证据字段会跟着回到首屏'
  );
  assert(budget.bootData.includes('tools/directory-boot.json'), '启动数据缺 tools/directory-boot.json');

  const boot = read('tools/directory-boot.json');
  const left = buildOnlyFieldsLeft(boot);
  assert(!left.length, `启动副本里还有构建期字段（${BOOT_DROP.join(' / ')}）：${left.slice(0, 4).join(', ')}`);

  // 副本必须是源的严格派生：源改了却没重建，这里直接红。这种不同步在页面上完全看不出来
  // ——详情页的「证据」行由源文件渲染，而卡片列表读的是副本，两边各自都是对的。
  const src = read('tools/directory.json');
  const want = JSON.stringify(slimDirectory(src).tools);
  assert(JSON.stringify(boot.tools) === want, 'tools/directory-boot.json 与源不同步，重跑 npm run build');

  const client = readFileSync(join(root, 'assets', 'app.js'), 'utf8') + readFileSync(join(root, 'assets', 'my.js'), 'utf8');
  assert(!client.includes("fetch('/tools/directory.json')"), 'app.js / my.js 又去取源文件了（首屏重新背上约 1 KB）');

  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert(sw.includes('"/tools/directory-boot.json"'), '离线清单里没有启动副本——断网后目录工具会整片消失');
  assert(!sw.includes('"/tools/directory.json"'), '离线清单还在装源文件（多装 1 KB，且没有任何页面取它）');
  return `${boot.tools.length} 条目录首屏只带启动副本，证据字段留在源文件`;
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
    if (!ev.slug || !ev.title || !ev.summary || !ev.date) bad.push(ev.slug + '(索引缺字段)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) bad.push(ev.slug + '(日期格式)');
    if (typeof ev.itemCount !== 'number' || ev.itemCount < 2) bad.push(ev.slug + '(对比项 <2)');
    if (!existsSync(join(root, 'evaluations', ev.slug, 'index.html'))) bad.push(ev.slug + '(缺静态页)');
    const bodyPath = join(root, 'evaluations', ev.slug + '.json');
    if (!existsSync(bodyPath)) {
      bad.push(ev.slug + '(缺正文)');
      continue;
    }
    const full = read('evaluations/' + ev.slug + '.json');
    // 索引与正文必须指的是同一篇：两边标题对不上，说明改了正文忘了重建索引
    if (full.title !== ev.title) bad.push(ev.slug + '(索引与正文标题不一致)');
    if (!full.verdict) bad.push(ev.slug + '(缺结论)');
    if (!full.items || full.items.length !== ev.itemCount) bad.push(ev.slug + '(对比项数不一致)');
    if (!full.body || full.body.length < 2) bad.push(ev.slug + '(正文 <2 段)');
    for (const it of full.items || []) {
      if (!it.name || !it.type || !it.privacy) bad.push(`${ev.slug}(${it.name || '?'} 缺字段)`);
      if (!Array.isArray(it.pros) || !Array.isArray(it.cons)) bad.push(`${ev.slug}(${it.name || '?'} 缺优劣)`);
    }
    // 「怎么用」一旦给了，就得是能照着做的：每块至少 2 步
    for (const u of full.usage || []) {
      if (!u.name || !Array.isArray(u.steps) || u.steps.length < 2) bad.push(`${ev.slug}(使用说明不完整: ${u.name || '?'})`);
    }
    if ((full.usage || []).length && !full.method) bad.push(ev.slug + '(有使用说明但没写测试方式)');
    const miss = (full.relatedTools || []).filter((id) => !ids.has(id));
    if (miss.length) bad.push(`${ev.slug}(引用不存在: ${miss.join(',')})`);
  }
  assert(!bad.length, bad.join('; '));
  return `${evals.evaluations.length} 篇评测（索引 ${Math.round(statSync(join(root, 'evaluations.json')).size / 1024)} KB）`;
});

// 全站 HTML 清单。几条「某个东西不许出现在某些页面」的检查都要用，扫一次省得各写一遍。
const HTML_FILES = (() => {
  const out = [];
  const skip = new Set(['assets', '.git', 'node_modules', '.workbuddy']);
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) {
        if (!skip.has(f.name)) walk(p);
        continue;
      }
      if (f.name.endsWith('.html')) out.push(p);
    }
  };
  walk(root);
  return out;
})();

check('工具分类页（v3.13）', () => {
  // 分类从「首页筛选参数」变成独立页面后，最容易出的问题是三处对不上：
  // 文案里的 name 与 tools.json 的 category、静态页上的工具清单与真实归属、
  // 以及 SPA 那份单类 JSON 没生成。任何一处漏了，页面上就会少工具或整页空白。
  const copy = read('content/categories.json').categories;
  const allTools = [...local.tools, ...dir.tools];
  const cats = [...new Set(allTools.map((t) => t.category))];
  assert(copy.length === cats.length, `文案 ${copy.length} 条 ≠ 实际分类 ${cats.length} 个`);
  const bad = [];
  const seen = new Set();
  for (const c of copy) {
    if (seen.has(c.slug)) bad.push(`${c.slug}(slug 重复)`);
    seen.add(c.slug);
    if (!cats.includes(c.name)) bad.push(`${c.slug}(分类名对不上 tools.json)`);
    if (!c.title || !c.tagline || !c.intro) bad.push(`${c.slug}(缺标题/导语)`);
    if ((c.scenarios || []).length < 3) bad.push(`${c.slug}(场景 <3)`);
    if ((c.howto || []).length < 3) bad.push(`${c.slug}(挑选建议 <3)`);
    if ((c.faq || []).length < 3) bad.push(`${c.slug}(FAQ <3)`);
    const page = join(root, 'categories', c.slug, 'index.html');
    if (!existsSync(page)) {
      bad.push(`${c.slug}(缺静态页)`);
      continue;
    }
    const h = readFileSync(page, 'utf8');
    for (const t of ['CollectionPage', 'ItemList', 'BreadcrumbList', 'FAQPage']) {
      if (!h.includes(`"@type":"${t}"`)) bad.push(`${c.slug}(缺 ${t})`);
    }
    const mine = allTools.filter((t) => t.category === c.name);
    const linked = mine.filter((t) => h.includes(`href="/tools/${t.id}/"`)).length;
    if (linked !== mine.length) bad.push(`${c.slug}(工具内链 ${linked}/${mine.length})`);
    if (!existsSync(join(root, 'categories', c.slug + '.json'))) bad.push(`${c.slug}(缺单类 JSON)`);
  }
  if (!existsSync(join(root, 'categories', 'index.html'))) bad.push('缺分类总览页');
  if (!existsSync(join(root, 'categories', 'index.json'))) bad.push('缺分类总览 JSON');
  assert(!bad.length, bad.join('; '));
  return `${copy.length} 个分类页（场景/挑选/FAQ + 四类结构化数据）`;
});

check('分类内链不再回首页', () => {
  // /?cat=xxx 会把用户丢回首页的一个筛选状态：分类页白做，链接也没法被单独分享
  const bad = [];
  for (const p of HTML_FILES) {
    // 只认真正的链接：更新日志里会原样引用「href="/?cat=」这句话，按纯文本匹配会误报
    if (/<a[^>]+href="\/\?cat=/.test(readFileSync(p, 'utf8'))) bad.push(p.slice(root.length + 1).replace(/\\/g, '/'));
  }
  assert(!bad.length, `仍有 ?cat= 内链：${bad.slice(0, 3).join(', ')}`);
  return '全站分类链接均指向 /categories/<slug>/';
});

check('首页结构化数据不外溢', () => {
  // index.html 既是页面、又是其他页面的模板。它的 WebSite/Organization/SearchAction
  // 一旦被当成模板内容带出去，全站每个页面都会声明「我是那个网站」——十几个页面各嵌一份
  // SearchAction，语义上说不通，也是白塞的体积。v3.13 修的就是这个。
  const bad = [];
  for (const p of HTML_FILES) {
    if (p === join(root, 'index.html')) continue;
    if (readFileSync(p, 'utf8').includes('"#website"')) bad.push(p.slice(root.length + 1).replace(/\\/g, '/'));
  }
  assert(!bad.length, `首页 ld+json 出现在：${bad.slice(0, 3).join(', ')}`);
  const home = readFileSync(join(root, 'index.html'), 'utf8');
  assert(home.includes('"SearchAction"'), '首页反而丢了 SearchAction');
  return `${HTML_FILES.length - 1} 个非首页页均无首页 ld+json`;
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
  // 说明页清单来自页面注册表（v3.20）。以前这里是手写数组，加一页忘一处就静默漏测。
  const miss = staticPaths().filter((p) => !existsSync(join(root, p === '/' ? 'index.html' : p.slice(1) + 'index.html')));
  assert(toolPages === all.length, `工具页 ${toolPages} ≠ 工具数 ${all.length}`);
  assert(!miss.length, `静态页缺: ${miss.join(', ')}`);
  return `${toolPages} + ${staticPaths().length - 1}`;
});

// ---------- v3.20：页面注册表反向闸门 ----------
// 「产物里有的页面，注册表里必须也有」。这是七处接线能收敛成一处的前提：
// 注册表写了但没人消费会被这个闸门发现，产物生成了但没进注册表也会。
check('产物页面都在注册表内', () => {
  const orphan = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'assets') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, depth + 1);
      else if (name === 'index.html' && p !== join(root, 'index.html')) {
        const url = '/' + p.slice(root.length + 1).replace(/\\/g, '/').replace(/index\.html$/, '');
        if (!matchPage(url)) orphan.push(url);
      }
    }
  };
  walk(root, 0);
  assert(
    !orphan.length,
    `这些页面建出来了但没在 scripts/lib/pages-registry.mjs 里登记（等于没人测）: ${orphan.slice(0, 6).join(', ')}${orphan.length > 6 ? ` …共 ${orphan.length} 个` : ''}`
  );
  return `全部 ${pagePatterns().length} 条模式覆盖产物`;
});

check('公开文案计数与数据一致', () => {
  const total = all.length;
  const home = readFileSync(join(root, 'index.html'), 'utf8');
  // 首页三处计数（meta description / og / hero 提示）+ 所有生成页的 twitter:description
  const nums = [...home.matchAll(/(\d+) 个(?:精选)?开源工具/g)].map((m) => +m[1]);
  nums.push(...[...home.matchAll(/(\d+) 个工具 ·/g)].map((m) => +m[1]));
  // v3.20：首屏那句改成「N 个在本机跑 · M 个已收录」，总数字样变了，闸门要跟上
  nums.push(...[...home.matchAll(/(\d+) 个已收录/g)].map((m) => +m[1]));
  nums.push(...[...home.matchAll(/(\d+) listed/g)].map((m) => +m[1]));
  assert(nums.length >= 4, `首页计数只有 ${nums.length} 处，meta 可能被改动`);
  const wrong = nums.filter((n) => n !== total);
  assert(!wrong.length, `首页计数 ${[...new Set(wrong)].join('/')} ≠ 实际 ${total}`);
  // 本机执行数必须单独说清楚：把 62 条外链也算进「数据不出设备」，
  // 正是 v3.19 刚在首页修掉的错，别在这一版又混回去。
  // 中文在 data-zh 与正文里各出现一次，英文只在 data-en 里——所以判「至少一处 + 每处都对」，
  // 不判固定条数（那种断言改一次排版就红，却抓不到真错）。
  const localNums = [...home.matchAll(/(\d+) 个在本机跑/g)].map((m) => +m[1]);
  const localEn = [...home.matchAll(/(\d+) run in your browser/g)].map((m) => +m[1]);
  assert(localNums.length && localEn.length, '首屏缺少「N 个在本机跑 / N run in your browser」的分开陈述（中英都要有）');
  assert(
    [...localNums, ...localEn].every((n) => n === local.tools.length),
    `首屏「本机跑」写作 ${[...new Set([...localNums, ...localEn])].join('/')}，实际本地工具 ${local.tools.length} 个`
  );
  // 抽查生成页的 twitter:description（fillMeta 不覆盖它，历史上漏改过）
  const probe = readFileSync(join(root, 'tools', all[0].id, 'index.html'), 'utf8');
  const m = probe.match(/name="twitter:description" content="精选 (\d+) 个开源工具/);
  assert(m && +m[1] === total, `生成页 twitter:description 计数 ${m ? m[1] : '缺失'} ≠ ${total}`);
  return `${total} 个工具 / ${nums.length} 处文案`;
});

// ---------- v3.20：产物里不许出现 undefined ----------
check('产物不含 undefined', () => {
  // 真实事故：更新日志渲染 `e.version · e.title`，而条目只有 date/version/items 三个字段，
  // 于是 5 个版本在页面上写成「v3.18 · undefined」。这类错误不报错、不 404，
  // 只有人恰好点开那一页才看得见——所以交给闸门盯，别指望有人记得看。
  //
  // 判「故障形态」而不是「这个词」：更新日志自己会讨论这个词（这条记录就在讨论），
  // 全文匹配会让文案不敢提它。真正说明渲染出事的，是它出现在插值位置——
  // 分隔符后面、属性值里、或独占一个文本节点。
  const SHAPES = [/·\s*undefined/g, /="undefined"/g, />\s*undefined\s*</g, /undefined<\/(?:p|li|h2|div|span|a)>/g];
  const bad = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'vendor' || name === 'assets') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, depth + 1);
      else if (name === 'index.html') {
        const html = readFileSync(p, 'utf8');
        const hit = SHAPES.find((re) => re.test(html));
        if (hit) bad.push(`${p.slice(root.length + 1)}（${html.match(hit)[0].trim()}）`);
      }
    }
  };
  walk(root, 0);
  assert(!bad.length, `渲染出 undefined: ${bad.slice(0, 6).join(', ')}`);
  return '全站 HTML 无 undefined 插值';
});

// ---------- v3.22：存储键四向闭合 ----------
// v3.20 只对了「隐私页 ⊇ 源码字面量」一个方向，漏掉的三个方向各自对应一类真实错法：
//   死键（清单有、代码没有）→ 隐私页在说一件已经不存在的事
//   未申报（代码有、清单没有）→ 隐私页漏说，正是当初 draft 那个矛盾的产生方式
//   绕过 store（裸 'toolhub:' 字面量）→ 前缀、迁移、兜错对它全部不生效
check('存储键四向闭合（v3.22）', () => {
  const { keys, problems } = checkStorageKeys(root);
  assert(!problems.length, problems.join('；'));
  return `${keys.length} 个键：清单 / 源码 / 隐私页 / 前缀唯一，四处一致`;
});

// 隐私页那张表必须真的是渲染出来的，不是手抄的。
// 判据：行数恰好等于清单长度。手抄的表在加键那天不会自动长出这一行。
check('隐私页键表由清单渲染（v3.22）', () => {
  const { KEYS } = storeKeys;
  const html = readFileSync(join(root, 'privacy', 'index.html'), 'utf8');
  assert(html.includes('<th>键名</th><th>存了什么</th><th>上限</th>'), '隐私页没有那张键表（还是 <ul> 手抄版？）');
  const rows = (html.match(/<tr><td><code>toolhub:/g) || []).length;
  assert(rows === KEYS.length, `表里 ${rows} 行，清单 ${KEYS.length} 个键 —— 有人手改过这张表`);
  return `${rows} 行，与清单逐条对应`;
});

// /my/ 面板同样由清单驱动：容器在、模块在、清除按钮由 clearableGroups() 生成。
// 这几条只能证明「接了线」，真正的行为（点了确实清空）由 browser-test 在真浏览器里跑。
check('我的数据页接入（v3.22）', () => {
  const html = readFileSync(join(root, 'my', 'index.html'), 'utf8');
  assert(/style\.my\.css/.test(html), '/my/ 没有引入自己的样式表');
  assert(/我的数据/.test(html), '/my/ 缺少标题');
  assert(existsSync(join(root, 'assets', 'my.js')), '缺 assets/my.js');
  const my = readFileSync(join(root, 'assets', 'my.js'), 'utf8');
  assert(/clearableGroups\(\)/.test(my), '清除按钮没有从清单生成（手写的那份迟早会漏键）');
  assert(/byGroup\(\)/.test(my), '存储明细没有从清单生成');
  const reg = readFileSync(join(root, 'scripts', 'lib', 'pages-registry.mjs'), 'utf8');
  assert(/path: '\/my\/'/.test(reg), '/my/ 没进页面注册表（离线包与体检都会漏掉它）');
  return '容器 + 模块 + 清单驱动 + 注册表';
});

// 工作流页（v3.23）：页面 / 引擎 / 流程定义三样缺一不可，而且首屏一个字节都不该沾。
// 这几条只证明「接上了」；「点运行真的跑完、坏输入真的停住」由 browser-test 负责。
check('工作流页接入（v3.23）', () => {
  const html = readFileSync(join(root, 'workflows', 'index.html'), 'utf8');
  assert(/style\.workflows\.css/.test(html), '/workflows/ 没有引入自己的样式表');
  // 挂载点写在 pages.js 的模板里（静态产物只放给爬虫看的正文，SPA 正文由模板渲染）
  const pagesJs = readFileSync(join(root, 'assets', 'lib', 'pages.js'), 'utf8');
  assert(/id="flow-app"/.test(pagesJs), '投稿页模板里缺 #flow-app 挂载点，引擎没有地方可挂');
  assert(/<h1>工作流<\/h1>/.test(html) && /workflows\.json/.test(html), '/workflows/ 的静态正文没写清「流程定义在哪、怎么校验」');
  for (const f of ['assets/workflow.js', 'assets/lib/workflow-core.js', 'assets/style.workflows.css', 'workflows/workflows.json']) {
    assert(existsSync(join(root, f)), `缺 ${f}`);
  }
  const reg = readFileSync(join(root, 'scripts', 'lib', 'pages-registry.mjs'), 'utf8');
  assert(/path: '\/workflows\/'/.test(reg), '/workflows/ 没进页面注册表（离线包与体检都会漏掉它）');
  // 首屏不许为它付字节：引擎只能是动态 import（静态 import 会让首页多解析 10 KB）
  // v3.32：页面型路由（含页面级模块挂载表）搬到 assets/open-page.js，源码断言读合并后的两份
  const app =
    readFileSync(join(root, 'assets', 'app.js'), 'utf8') + '\n' + readFileSync(join(root, 'assets', 'open-page.js'), 'utf8');
  assert(!/^import[^\n]*workflow/m.test(app), 'app.js 静态 import 了工作流引擎——首屏会为它付解析成本');
  // 挂载侧在 v3.23 收成了一张表（容器 id → 模块 → 导出），所以「动态加载」不再长成
  // import('/assets/workflow.js') 这一行。断言对事不对形：地址在表里，且模块确实经由
  // import() 的变量形式加载。钉死某一行字面量的写法，会在下一次重构时变成假红。
  assert(/'\/assets\/workflow\.js'/.test(app), 'app.js 的挂载表里没有工作流引擎，页面会只剩空壳');
  assert(/await import\(\s*mod\s*\)/.test(app), 'app.js 没有按需 import 页面模块（工作流页会只剩空壳）');
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert(sw.includes('/assets/workflow.js'), '工作流引擎没进离线包（断网打开是一片空白）');
  assert(sw.includes('/workflows/workflows.json'), '流程定义没进离线包（断网只剩空壳）');
  return '页面 + 引擎 + 流程定义 + 注册表 + 离线包';
});

// 做了的页面必须有入口（v3.22.2 的用户反馈换来的）。工作流挂在主导航上，
// 而导航是每个页面的公共头部——只改首页模板、产物没重建，就会出现「首页有、别的页没有」。
check('工作流页在导航有入口（v3.23）', () => {
  const home = readFileSync(join(root, 'index.html'), 'utf8');
  const m = home.match(/<a href="\/workflows\/"[^>]*data-nav="workflows"[^>]*>/);
  assert(m, '首页没有指向 /workflows/ 的导航入口——做了页面却进不去，等于没做');
  assert(/data-zh="工作流"/.test(m[0]) && /data-en="Workflows"/.test(m[0]), '入口缺中文或英文文案');
  for (const p of ['tools', 'about', 'submit']) {
    const f = join(root, p, 'index.html');
    if (!existsSync(f)) continue;
    assert(/href="\/workflows\/"/.test(readFileSync(f, 'utf8')), `${p}/ 页的导航里没有工作流入口（模板改了但产物没重建）`);
  }
  return '主导航 → /workflows/，中英齐备，产物同步';
});

// ---------- v3.20：更新日志正文必须转义 ----------
// 条目里一直有 `/tools/<id>/`、`<main>`、`<script>` 这类技术写法。它们是数据，
// 但过去直接拼进 HTML，浏览器当标签解析：`<id>` 被吞掉，`<script>` 真的注入一段脚本。
check('更新日志正文已转义', () => {
  const html = readFileSync(join(root, 'changelog', 'index.html'), 'utf8');
  const raw = ['tools/<id>', '<main>', '<script>undefined'].filter((s) => html.includes(s));
  assert(!raw.length, `正文里有未转义标签: ${raw.join(', ')}`);
  assert(html.includes('tools/&lt;id&gt;'), '技术写法应当以转义形式显示，否则读者看到的内容是缺的');
  return '技术写法按文本显示';
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
  // .git 若被发布，任何人都能下载完整提交历史。
  // 没有 .git 的目录多半是 git archive 导出的快照（外包 / 交接），
  // 这种场景下没有版本库可供发布，检查不适用——报红只会让收包方以为环境坏了。
  if (!existsSync(join(root, '.git'))) return '排除项已配（快照无 .git，跳过版本库检查）';
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

check('页面型路由按需加载（v3.32）', () => {
  // 这八个页面首页一次都进不去（about / submit / feedback / privacy / batch / offline / my / workflows），
  // 它们的渲染代码搬到了 assets/open-page.js。**这里防的是它被谁「顺手」搬回来**：
  // 首屏脚本每多 1 KB，所有访客都要付；而页面的使用频率是「偶尔」。
  const shell = readFileSync(join(root, 'assets', 'app.js'), 'utf8');
  const modPath = join(root, 'assets', 'open-page.js');
  assert(existsSync(modPath), '缺 assets/open-page.js：页面型路由无处可去');
  const mod = readFileSync(modPath, 'utf8');
  assert(/export async function openPage\(/.test(mod), 'open-page.js 没有导出 openPage');
  // 依赖必须显式传入：模块里一旦出现「以为 app.js 的变量还在」的写法，只有当用户真的点进
  // 某个页面才会 ReferenceError —— 首页与工具页测试全绿，最难发现。抽几个关键名钉住。
  for (const dep of ['loadRegistry', 'makePages', 'stateHTML', 'ensureCss']) {
    assert(new RegExp('\\b' + dep + '\\b').test(mod), 'open-page.js 没用到 ' + dep + '，依赖注入怕是漏了');
  }
  assert(/import\('\/assets\/open-page\.js'\)/.test(shell), '首屏没有按需加载 open-page.js 的入口（这些页面会打不开）');
  assert(!/makePages\(reg/.test(shell), '页面渲染实体又写回了 app.js——首屏会重新背上约 1.3 KB');
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert(sw.includes('/assets/open-page.js'), '按需模块没进离线包：断网打开这八个页面会白屏');
  const tpl = readFileSync(join(root, 'index.html'), 'utf8');
  assert(!/src="[^"]*open-page\.js/.test(tpl), '首屏 <script> 里不该出现 open-page.js');
  return '8 个页面型路由走按需模块，首屏只留薄壳';
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
  // v3.5：工具页样式拆到 assets/style.tool.css，结果区的样式在那边；断言按「全站样式」合并读
  const css2 =
    readFileSync(join(root, 'assets/style.css'), 'utf8') + '\n' + readFileSync(join(root, 'assets/style.tool.css'), 'utf8');
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
  const { payload, aliases, io, unknown } = buildToolsJson();
  const cur = readFileSync(join(root, 'tools', 'tools.json'), 'utf8').trim();
  // 忽略行尾：Windows 上 core.autocrlf=true 的机器 clone 出来就是 CRLF，
  // 逐字节比会误报成「分片不一致」，把新接手的人引到完全错误的方向（v3.5.1）
  assert(sameJsonText(cur, JSON.stringify(payload, null, 2)), 'tools/tools.json 与 tool.json 分片不一致，请跑 node scripts/sync-tools.mjs');
  // 别名单独一个文件，就得多一道「它也跟着同步了吗」的闸门：少这道，改了 tool.json 的别名
  // 但忘了同步，搜索会静默退回「只能按名称搜」——页面上完全看不出来。
  const aliasCur = readFileSync(join(root, 'tools', 'aliases.json'), 'utf8').trim();
  assert(sameJsonText(aliasCur, JSON.stringify(aliases)), 'tools/aliases.json 与 tool.json 分片不一致，请跑 node scripts/sync-tools.mjs');
  // v3.31：端口同理。它不在首屏，所以「页面上看着不对」永远不会发生——
  // 忘了同步的后果是流程闸门与助手拿到旧端口，安静地推荐一条接不上的链。
  assert(existsSync(join(root, 'tools', 'io.json')), '缺 tools/io.json，请跑 node scripts/sync-tools.mjs');
  const ioCur = readFileSync(join(root, 'tools', 'io.json'), 'utf8').trim();
  assert(sameJsonText(ioCur, JSON.stringify(io)), 'tools/io.json 与 tool.json 分片不一致，请跑 node scripts/sync-tools.mjs');
  assert(!unknown.length, `未登记在 registry.order：${unknown.join(', ')}`);
  return `${payload.tools.length} 个工具 / 排序已登记 / ${Object.keys(io).length} 组端口`;
});

check('工具端口声明（v3.31）', () => {
  const errs = [];
  const ids = readdirSync(join(root, 'tools')).filter((d) => existsSync(join(root, 'tools', d, 'tool.json')));
  for (const id of ids) {
    const meta = read(`tools/${id}/tool.json`);
    // 本地工具必须声明；外链目录工具没有 run.js，也就没有端口，不要求
    const local = meta.runtime !== 'link' && existsSync(join(root, 'tools', id, 'run.js'));
    if (!local) continue;
    if (!meta.io) {
      errs.push(`${id} 没有 io 声明（端口是流程闸门与助手的唯一依据，不能缺）`);
      continue;
    }
    errs.push(...validateIo(meta.io, id));
  }
  assert(!errs.length, `端口声明有问题：${errs.slice(0, 5).join('；')}`);
  return `${ids.length} 个工具端口合法（词表 ${PORTS.length} 类：${PORTS.join(' / ')}）`;
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

// ---------- v3.5：工具页样式分片 ----------
check('工具页样式分片（v3.5）', () => {
  const TOOL_CSS = 'assets/style.tool.css';
  assert(existsSync(join(root, TOOL_CSS)), '缺 assets/style.tool.css');
  const toolCss = readFileSync(join(root, TOOL_CSS), 'utf8');
  const base = readFileSync(join(root, 'assets/style.css'), 'utf8');
  assert(toolCss.length > 4000, `style.tool.css 只有 ${toolCss.length} 字节，不像是真拆过`);
  // 首页必须不为它付字节——这是整个拆分的目的
  const home = readFileSync(join(root, 'index.html'), 'utf8');
  assert(!home.includes('style.tool.css'), '首页又引入了工具页样式，首屏预算白省了');
  // 每个工具页（本地 + 目录）构建期就要带上它，否则整页加载会先闪一下裸结构
  const bad = [];
  for (const t of all) {
    const p = join(root, 'tools', t.id, 'index.html');
    if (!existsSync(p)) continue;
    if (!readFileSync(p, 'utf8').includes('href="/assets/style.tool.css"')) bad.push(t.id);
  }
  assert(
    !bad.length,
    `工具页没引 style.tool.css：${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ` 等 ${bad.length} 个` : ''}`
  );
  // 内容页用不到它，引了就是白加一个请求
  for (const p of ['submit/index.html', 'about/index.html', 'compare/index.html']) {
    const f = join(root, p);
    if (existsSync(f)) assert(!readFileSync(f, 'utf8').includes('style.tool.css'), `${p} 引了工具页样式`);
  }
  // 防回流：这几个只服务工具页的规则不许再长回基础表
  const leaked = ['.result-actions', '.tax-hero', '.md-preview', '.enc-modal', '.pitfall-item', '.doc-body'].filter(
    (sel) => new RegExp(`\\${sel}\\s*[,{]`).test(base)
  );
  assert(!leaked.length, `这些只服务工具页的规则又回到 style.css：${leaked.join(', ')}`);
  // 断网打开工具页也得有样式
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert(sw.includes('/assets/style.tool.css'), 'sw.js 预缓存缺 style.tool.css（断网后工具页没样式）');
  return `${(toolCss.length / 1024).toFixed(1)} KB 已拆出，${all.length} 个工具页逐页引入`;
});

// ---------- v3.8：样式预算口径 ----------
// 这一条守的不是数字，是「上限得给人留活路」这件事本身。
// v3.7 收尾时 styles 只剩 0.6 KB，于是三个新工具里每加一条样式都要先掂量——
// 上限一旦贴着实际值，它就从「提醒」变成了「禁令」，谁都不敢改样式了。
check('样式预算口径（v3.8）', () => {
  const budget = read('perf-budget.json').budgets;
  const cssGz = gzipSync(readFileSync(join(root, 'assets/style.css')), { level: 9 }).length;
  const headroom = budget.styles - cssGz;
  assert(
    headroom >= 512,
    `styles 只剩 ${(headroom / 1024).toFixed(2)} KB 余量（下限 0.5 KB）。加一条新样式就会顶到上限——` +
      '这时候该做的不是压着不改，而是要么搬进分片、要么重新定档并写明理由。'
  );
  // 总量必须严格小于各分项之和。否则四条单项可以同时贴着上限，总量那条线永远碰不到，等于没有刹车。
  const sum = budget.document + budget.styles + budget.scripts + budget.bootData;
  assert(
    budget.total < sum,
    `total ${(budget.total / 1024).toFixed(1)} KB 已经不小于各分项之和 ${(sum / 1024).toFixed(1)} KB，` +
      '总量预算失去意义（分项一起贴顶也不会触发它）'
  );
  return `styles ${(cssGz / 1024).toFixed(1)} / ${(budget.styles / 1024).toFixed(1)} KB，余量 ${(headroom / 1024).toFixed(2)} KB`;
});

// ---------- v3.8：基础样式表不许有死规则 ----------
// 预算膨胀最常见的来源不是「加了一条大样式」，而是「删了功能、样式留着」。
// 这类规则留着没有任何好处，直接卡在发版前。
check('基础样式表无死规则（v3.8）', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/css-coverage.mjs'), '--fail'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert(r.status === 0, (r.stdout || '').split('\n').filter((l) => l.trim()).slice(-12).join('\n'));
  return 'style.css 里每条规则都有引用';
});

check('隐私说明与统计口径（D3）', () => {  const page = join(root, 'privacy', 'index.html');
  assert(existsSync(page), '缺 /privacy/ 静态页（构建后再校验）');
  const body = readFileSync(page, 'utf8');
  assert(/不上传/.test(body), '隐私页没有说明数据不上传');
  assert(/analytics-optout|统计/.test(body), '隐私页没有提到统计与关闭方式');
  const sm = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  assert(/\/privacy\/<\/loc>/.test(sm), 'sitemap 缺 /privacy/');
  // v3.32：页面型路由（含页面级模块挂载表）搬到 assets/open-page.js，源码断言读合并后的两份
  const app =
    readFileSync(join(root, 'assets', 'app.js'), 'utf8') + '\n' + readFileSync(join(root, 'assets', 'open-page.js'), 'utf8');
  // v3.22：统计开关改走 store，常量 ANALYTICS_OPT_OUT 已删除。断言改成分别判读与写两个故障形态——
  // 只判一个字符串在不在，会让「能读不能写」这种半残实现照样通过。
  assert(/store\.set\('no-analytics'/.test(app), 'app.js 缺「在本机关闭统计」的写入路径（按钮点了不生效）');
  assert(/store\.get\('no-analytics'/.test(app), 'app.js 缺「本机关闭了统计」的读取路径（开关永远读成未关闭）');
  return '隐私页 + sitemap + 退出开关';
});

// ---------- v3.21 外链证据层 ----------
// 已经人工核过的条目，id 写在这里。改回 imported 就是「把核过的又变回没核过」，
// 等于让「0 字节上传服务器」这句话重新失去依据——所以只许加，不许减。
const BOUNDARY_VERIFIED_BASELINE = ['excalidraw', 'filepizza', 'localsend', 'pairdrop'];

// v3.32：边界「已核」条数下限。未核（imported / inferred）可以躺着不动，但不能变多；
// 新增一条外链就必须真核一条，否则这条红。数字只许往上调。
const BOUNDARY_MANUAL_FLOOR = 25;

check('外链证据：结构完整、旧字段已清除（v3.21）', () => {
  const stale = dir.tools.filter((t) => 'checkedAt' in t);
  assert(!stale.length, `仍有 ${stale.length} 条在用旧的 checkedAt：${stale.slice(0, 3).map((t) => t.id).join('、')}`);
  const missing = dir.tools.filter((t) => !t.evidence?.link?.at || !t.evidence?.boundary?.at);
  assert(!missing.length, `缺 evidence.link/boundary 的有 ${missing.length} 条：${missing.slice(0, 3).map((t) => t.id).join('、')}`);
  // 探活只证明「站点活着」，不能拿去覆盖边界标注——这是整个模型的核心区分。
  const wrong = dir.tools.filter((t) => t.evidence.boundary.method === 'probe');
  assert(!wrong.length, `boundary.method 不允许是 probe（探活证明不了隐私边界）：${wrong.map((t) => t.id).join('、')}`);
  const manual = dir.tools.filter((t) => t.evidence.boundary.method === 'manual').map((t) => t.id);
  const dropped = BOUNDARY_VERIFIED_BASELINE.filter((id) => !manual.includes(id));
  assert(!dropped.length, `这些条目曾人工核实过，现在退回了未核实：${dropped.join('、')}`);
  // v3.32：把「未核」从定时炸弹改成持续约束。旧写法是给 imported 定 90/180 天到期报错——
  // 54 条同一天到期，那不是「该复检了」，是「从来没人核过」。这两种事必须分开处理：
  // 已核的按 365/730 天复检，未核的只提醒、另由下面两条盯住总量。
  assert(
    manual.length >= BOUNDARY_MANUAL_FLOOR,
    `边界已核 ${manual.length} 条，低于下限 ${BOUNDARY_MANUAL_FLOOR} 条：未核条目只许减少，不许增加`,
  );
  const ratio = manual.length / dir.tools.length;
  assert(
    ratio >= COVERAGE_FLOOR,
    `边界已核 ${manual.length}/${dir.tools.length}（${(ratio * 100).toFixed(0)}%），低于下限 ${(COVERAGE_FLOOR * 100).toFixed(0)}%：新增外链要顺手核一条`,
  );
  return `${dir.tools.length} 条证据结构合法 · 边界已核 ${manual.length}/${dir.tools.length}（${(ratio * 100).toFixed(0)}%）· 无检查探活冒充核实`;
});

check('外链证据：页面与数据一致（v3.21）', () => {
  let n = 0;
  for (const t of dir.tools) {
    const p = join(root, 'tools', t.id, 'index.html');
    assert(existsSync(p), `缺详情页 tools/${t.id}/index.html（先构建再校验）`);
    const body = readFileSync(p, 'utf8');
    assert(body.includes('class="evi"'), `${t.id} 详情页没有「证据：」行`);
    const m = t.evidence.boundary.method;
    // 三种方法对应三种说法，页面上必须说同一种——数据改了页面没改是这类站最典型的漂移。
    const want = m === 'manual' ? '边界已核实' : m === 'inferred' ? '尚未逐页核实' : '尚未核实';
    assert(body.includes(want), `${t.id} 页面证据与数据不符：method=${m}，页面上应出现「${want}」`);
    n++;
  }
  return `${n} 个详情页的证据行与 boundary.method 一致`;
});

check('数据边界枚举与前端一致（v3.21）', () => {
  // 枚举以 lib/tool-meta.mjs 为唯一来源，这里只是核对前端与 i18n 有没有跟上。
  // 三处不同步的后果很隐蔽：徽标会静默退回「未核实」，页面看起来正常，只是在说谎。
  const app = readFileSync(join(root, 'assets', 'app.js'), 'utf8');
  for (const k of PRIVACY_KINDS) {
    assert(new RegExp(`\\b${k}:\\s*\\['`).test(app), `app.js 的 PV 少了枚举值 ${k}`);
  }
  assert(en.ui.privacyP2P, 'i18n 缺 ui.privacyP2P（英文徽标会退回「未核实」）');
  const used = new Set(dir.tools.map((t) => t.privacy));
  const unknown = [...used].filter((k) => !PRIVACY_KINDS.includes(k));
  assert(!unknown.length, `数据里出现枚举外的 privacy：${unknown.join('、')}`);
  const { errors } = validateToolMeta(dir.tools, { localTools: local.tools });
  assert(!errors.length, `边界字段校验不通过：${errors.slice(0, 3).join(' / ')}`);
  return `${PRIVACY_KINDS.length} 个枚举值：前端 / i18n / 数据三处对齐`;
});

check('AI 分类的运行位置与提示词去向（v3.25）', () => {
  // 这一栏的立栏理由是「每条都能回答跑在哪、提示词去哪」。数据层已由 lib/tool-meta.mjs 验过，
  // 这里验的是**渲染出来的页面**——字段写对了但没渲染出去，用户看到的还是空白。
  // 最要紧的一条是否定式断言：非 web 的条目绝不能出现「怎么用上：🌐 在线直达」。
  // 那正是这一版要修的口径错误（Ollama 要装客户端、Dify 要自己部署）。
  const ai = dir.tools.filter((t) => t.category === 'AI');
  assert(ai.length >= 6, `AI 分类只有 ${ai.length} 条`);
  const ACCESS = {
    web: '在线直达',
    desktop: '需安装客户端',
    selfhost: '需自行部署',
    cli: '需安装命令行',
    extension: '编辑器扩展',
    mobile: '需安装 App',
  };
  const bad = [];
  for (const t of ai) {
    const p = join(root, 'tools', t.id, 'index.html');
    if (!existsSync(p)) {
      bad.push(`${t.id}(缺详情页)`);
      continue;
    }
    const h = readFileSync(p, 'utf8');
    if (!h.includes(ACCESS[t.runtime])) bad.push(`${t.id}(没写「${ACCESS[t.runtime]}」)`);
    if (t.runtime !== 'web' && h.includes('怎么用上：🌐')) bad.push(`${t.id}(被写成在线直达)`);
    if (!h.includes('你的提示词会去哪里')) bad.push(`${t.id}(缺提示词去向)`);
    if (t.keyRequired && !h.includes('需 API Key')) bad.push(`${t.id}(缺 Key 徽标)`);
  }
  assert(!bad.length, bad.join(' / '));
  // 列表侧也要跟上：卡片不再把目录工具一律标成「在线直达」，靠的是保留真实 runtime。
  const app = readFileSync(join(root, 'assets', 'app.js'), 'utf8');
  assert(/runsOn: t\.runtime/.test(app), 'app.js 没保留目录工具的真实运行位置（runsOn）');
  assert(/RUNS\[x\.runsOn\]/.test(app), 'app.js 的徽标没按 runsOn 分档');
  return `${ai.length} 条 AI 工具：位置徽标 / 提示词去向 / Key 标记都在`;
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
    // 工具目录里自带的同源脚本（v3.27 起 barcode-gen 的 jsbarcode.min.js）：
    // 它们是动态 <script> 注入的，漏了不白屏，只是「断网点运行没反应」。
    // 断言在这里而不是只在 gen-sw 里扫：扫目录写错一处，闸门要能喊。
    for (const f of readdirSync(join(root, 'tools', t.id))) {
      if (f.endsWith('.js') && f !== 'run.js' && !set.has(`/tools/${t.id}/${f}`)) bad.push(`${t.id}/${f} 不在离线清单`);
    }
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

// ---------- SEO：结构化数据 ----------
// v3.10：全站 131 页原来只有首页没有 ld+json——工具页早有 SoftwareApplication /
// FAQPage / HowTo，首页反而空着，品牌词就拿不到 sitelinks 与搜索框。
check('首页结构化数据（SEO）', () => {
  const h = readFileSync(join(root, 'index.html'), 'utf8');
  const m = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(m, '首页没有 ld+json');
  const d = JSON.parse(m[1]);
  const nodes = d['@graph'] || [d];
  const types = new Set(nodes.map((x) => x['@type']));
  assert(types.has('WebSite'), '缺 WebSite');
  assert(types.has('Organization'), '缺 Organization');
  const site = nodes.find((x) => x['@type'] === 'WebSite');
  const tpl = site.potentialAction?.target?.urlTemplate || '';
  assert(tpl.includes('?q={search_term_string}'), `SearchAction 未指向 ?q=，实际 ${tpl || '(无)'}`);
  // 声明了站内搜索，就必须真的能搜。写一个抓出来是空页的 URL 会被 Search Console 判无效。
  const js = readFileSync(join(root, 'assets', 'app.js'), 'utf8');
  assert(
    /URLSearchParams\(location\.search\)\.get\('q'\)/.test(js),
    'SearchAction 声明了站内搜索，但 app.js 不读 ?q= —— 属于无效声明'
  );
  return 'WebSite + Organization + SearchAction(?q= 已接线)';
});

// ---------- SEO：标题语言单一 ----------
// 中英挤在一个 title 里（「JSON 格式化 / JSON Formatter · ToolHub」）拿不到两份排名，
// 只会把权重摊薄，页面语言也判不清楚。英文词条留在 i18n.json，等 hreflang 双语站再用。
check('标题不中英混排（SEO）', () => {
  const files = ['index.html', ...all.map((t) => `tools/${t.id}/index.html`)];
  // 旧格式是「中文名 / 英文名 · ToolHub」——特征是斜杠**右侧是一段纯英文**，
  // 即同一个工具用两种语言说了两遍。判据就只抓这一种，别的都不算：
  //   「JSON 格式化 / JSON Formatter」→ 右段纯英 → 混排
  //   「Base64 / URL 编解码」        → 右段含中文，是名字内部并列，不是混排
  //   「OKLCH Color Picker · …」    → 产品名本来就是英文，合法
  const CJK = /[\u4e00-\u9fa5]/;
  const bad = [];
  let n = 0;
  for (const f of files) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    n++;
    const m = readFileSync(p, 'utf8').match(/<title>([\s\S]*?)<\/title>/);
    if (!m) { bad.push(`${f} 无 title`); continue; }
    const head = m[1].split(' · ')[0];
    const slash = head.indexOf(' / ');
    if (slash < 0) continue;
    const right = head.slice(slash + 3).trim();
    if (right && !CJK.test(right)) bad.push(`${f}: ${m[1]}`);
  }
  assert(!bad.length, `中英混排 ${bad.length} 处：` + bad.slice(0, 4).join(' | '));
  return `${n} 个页面均为单一语言`;
});

// ---------- SEO：工具页问答深度 ----------
// v3.10：本地工具的 FAQ 从每篇 2 条补到 5 条（共 185 条）。FAQPage 结构化数据是
// 工具页唯一能拿到富结果的抓手，条数掉了直接反映在搜索结果里，所以钉成断言。
check('工具页 FAQ 深度（SEO）', () => {
  const thin = [];
  let n = 0;
  for (const tool of local.tools) {
    const p = join(root, 'tools', tool.id, 'index.html');
    if (!existsSync(p)) continue;
    const h = readFileSync(p, 'utf8');
    const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const faq = blocks.map((b) => JSON.parse(b[1])).find((d) => d['@type'] === 'FAQPage');
    if (!faq) { thin.push(`${tool.id}(无 FAQPage)`); continue; }
    const c = (faq.mainEntity || []).length;
    n += c;
    if (c < 5) thin.push(`${tool.id}(${c} 条)`);
  }
  assert(!thin.length, `FAQ 不足 5 条 ${thin.length} 个：` + thin.slice(0, 6).join(' '));
  // 单篇 JSON 也要在：工具页按 id 取自己那一篇，缺了就是「SPA 进来没有使用步骤」
  const noFile = local.tools.filter((t) => !existsSync(join(root, 'articles', t.id + '.json'))).map((t) => t.id);
  assert(!noFile.length, '缺单篇教程 JSON：' + noFile.slice(0, 6).join(' '));
  return `${local.tools.length} 个工具页共 ${n} 条问答`;
});

// v3.11：口语词表是「配置」，最难查的不是写错，是写了却不生效——
// 主词如果不在任何工具名/标签里，这条映射永远命中不了；变体如果没重跑生成器，
// 就别指望搜索能搜到。这两种都只有机器能发现，所以让机器盯着。
checkAsync('搜索口语词表（v3.11）', async () => {
  const { SPOKEN } = await import(pathToFileURL(join(root, 'scripts', 'lib', 'search-lexicon.mjs')).href);
  const dead = Object.keys(SPOKEN).filter((k) => !all.some((t) => (t.name + ' ' + (t.tags || []).join(' ')).includes(k)));
  assert(!dead.length, `主词不在任何工具名/标签里（映射永不生效，属于死配置）：${dead.join('、')}`);
  const missing = [];
  for (const variants of Object.values(SPOKEN)) {
    for (const v of variants) if (!all.some((t) => (t.aliases || []).includes(v))) missing.push(v);
  }
  assert(!missing.length, `变体没写进别名（忘了重跑 gen-search-aliases + sync-tools？）：${missing.slice(0, 10).join('、')}`);
  return `${Object.keys(SPOKEN).length} 组 / ${Object.values(SPOKEN).flat().length} 个口语词已并入 ${all.length} 个工具`;
});

check('全部工具页（v3.14）', () => {
  // 导航「工具」和首页入口卡原来都只是回到首页、滚到工具区：点完还在首页，也分享不出去。
  // 这一页是它们的落地页，所以最要紧的是「列全」——少列一个工具，就少一条入口。
  const p = join(root, 'tools', 'index.html');
  assert(existsSync(p), '缺 tools/index.html');
  const html = readFileSync(p, 'utf8');
  const total = local.tools.length + dir.tools.length;
  const cats = read('content/categories.json').categories;
  const rows = (html.match(/class="fl-row"/g) || []).length;
  assert(rows === total, `列了 ${rows} 个，清单里是 ${total} 个`);
  const groups = (html.match(/class="res-group-title"/g) || []).length;
  assert(groups >= cats.length, `只分了 ${groups} 组，分类有 ${cats.length} 个`);
  assert(html.includes('全部工具'), '标题里没有「全部工具」');
  for (const k of ['CollectionPage', 'BreadcrumbList', 'ItemList']) assert(html.includes(`"${k}"`), `缺 ${k}`);
  // ItemList 的条数必须和页面上真的行数一致：99 条清单写少一个，搜索引擎与用户看到的就是两份东西。
  assert(html.includes(`"numberOfItems":${rows}`), `ItemList 条数与页面 ${rows} 行对不上`);
  const links = (html.match(/class="fl-row" href="\/tools\/[\w-]+\/"/g) || []).length;
  assert(links === rows, `${rows} 行里只有 ${links} 行带工具链接`);
  return `${rows} 个工具 / ${groups} 组`;
});

check('折腾指南（v3.15）', () => {
  // 这一层的价值不在「多了一个页面」，而在「回退路径有没有写」。
  // 所以除了完整性，额外钉死两件事：风险等级高的必须有显式风险块，
  // 每篇必须带「翻车了怎么办」——缺了它，教程就是在催人做不可逆的操作。
  const g = JSON.parse(readFileSync(join(root, 'content', 'guides.json'), 'utf8')).guides;
  assert(g.length, 'guides.json 是空的');
  const rootIdx = join(root, 'guides', 'index.html');
  assert(existsSync(rootIdx), '缺 guides/index.html');
  assert(existsSync(join(root, 'guides', 'index.json')), '缺 guides/index.json（总览的轻量索引）');
  const idxHtml = readFileSync(rootIdx, 'utf8');
  const ids = new Set([...local.tools, ...dir.tools].map((t) => t.id));

  for (const x of g) {
    const p = join(root, 'guides', x.slug, 'index.html');
    assert(existsSync(p), `${x.slug} 没有静态页`);
    const html = readFileSync(p, 'utf8');
    // 步骤以 li 承载，数量必须与数据源一致：漏渲染一步，读者就卡在那一步
    const steps = (html.match(/<li><b>/g) || []).length;
    assert(steps === x.steps.length, `${x.slug} 渲染了 ${steps} 步，数据里是 ${x.steps.length} 步`);
    for (const k of ['HowTo', 'HowToStep', 'BreadcrumbList', 'FAQPage']) assert(html.includes(`"${k}"`), `${x.slug} 缺 ${k}`);
    assert(html.includes(`PT${x.minutes}M`), `${x.slug} 的 HowTo 时长不是 ISO 8601`);
    assert(html.includes('翻车了怎么办'), `${x.slug} 没有回退章节`);
    assert(html.includes('最后核对'), `${x.slug} 没有标注最后核对日期`);
    // 围栏代码块（```lang … ```）必须渲染成 <pre><code>：
    // 教程正文是按 HTML 拼进去的，原样输出会让示例里的 <html>/<title> 被浏览器当成真标签，
    // 整段示例在页面上消失、后面的正文被挤到步骤外面。v3.28 的 GitHub Pages 篇就踩了这个。
    // 只看 <main> 之内：JSON-LD 里的 HowToStep 文本本来就该带着原文（换行在 JSON 里是 \n 转义）。
    const visible = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
    assert(!visible.includes('```'), `${x.slug} 页面上出现了字面的三反引号（围栏没被渲染）`);
    if (x.steps.some((s) => /^\s*```/m.test(s.body))) {
      assert(visible.includes('<pre><code>'), `${x.slug} 有围栏代码块，但页面上没有 <pre><code>`);
    }
    // 反过来的坑：缩进块（YAML、命令行、目录树）忘了加围栏。正文只有「围栏」一种块级语法，
    // 没围栏的缩进行会被 HTML 折叠成一段连排文字——教程里那句「把下面这份内容完整粘贴」
    // 就成了让人复制一段没有缩进的跑马灯。guides 第四批的 GitHub Actions 篇漏了 27 行 YAML，
    // 因为当时没有任何闸门看这个方向，全绿上线。这里按「4 空格缩进 + 没有围栏」认。
    const unfenced = x.steps
      .map((s, i) => [i + 1, s.body || ''])
      .filter(([, b]) => /^\s{4,}\S/m.test(b) && !b.includes('```'))
      .map(([i]) => i);
    assert(!unfenced.length, `${x.slug} 第 ${unfenced.join('/')} 步有缩进代码块但没加围栏（会被折叠成一段）`);
    if (x.risk === 'high') assert(html.includes('guide-risk'), `${x.slug} 风险为 high 但没有风险提示块`);
    // riskNote 只给 high 用。构建只在 high 时渲染这个字段，mid/low 写了就是没人看得见的死数据
    // （cloudflare-free 这么躺了两个版本）。低/中风险的风险提示要写进 intro / prereqs / 步骤正文，
    // 并且放在动作前面——先说会出什么事，再说怎么做。
    assert(
      x.risk === 'high' || !x.riskNote,
      `${x.slug} 的 risk 是 ${x.risk}，不该有 riskNote 字段（改写进 intro / prereqs / 步骤正文，放在动作之前）`,
    );
    // 站内工具引用必须真的渲染出链接，并且 id 存在（构建期已校验，这里查产物）
    for (const id of x.tools || []) {
      assert(ids.has(id), `${x.slug} 引用了不存在的工具 ${id}`);
      assert(html.includes(`href="/tools/${id}/"`), `${x.slug} 没有把 ${id} 渲染成链接`);
    }
    assert(existsSync(join(root, 'guides', x.slug + '.json')), `${x.slug} 缺单篇 JSON`);
    assert(idxHtml.includes(`/guides/${x.slug}/`), `总览页没有列出 ${x.slug}`);
  }
  const listed = (idxHtml.match(/class="fl-row"/g) || []).length;
  assert(listed === g.length, `总览列了 ${listed} 篇，数据里 ${g.length} 篇`);
  return `${g.length} 篇 / ${g.reduce((n, x) => n + x.steps.length, 0)} 步`;
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

// TP7：拼音包是构建产物，数据源在 scripts/vendor/tiny-pinyin/dist。
// 改了字典却忘了重打包，页面上不会报错，只会静默沿用旧字音——这种漂移只有断言抓得住。
checkAsync('拼音包与数据源同步（TP7）', async () => {
  const { buildPinyinBundle } = await import(pathToFileURL(join(root, 'scripts', 'build-pinyin-bundle.mjs')).href);
  const want = buildPinyinBundle();
  const p = join(root, 'assets', 'vendor', 'pinyin.min.js');
  assert(existsSync(p), '缺 assets/vendor/pinyin.min.js，请跑 node scripts/build-pinyin-bundle.mjs');
  const got = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert(got === want, 'pinyin.min.js 与 dist 数据源不一致，请跑 node scripts/build-pinyin-bundle.mjs');
  return `${(Buffer.byteLength(want) / 1024).toFixed(1)} KB，与数据源逐字一致`;
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

// ---------- v3.22.2：做了的页面必须有入口 ----------
// 这一条是用户直接反馈换来的：「这两版主页上看不出来」。查下去发现 v3.22 做的 /my/
// 在首页零入口，全站只有隐私页链过去——功能存在，但用户到不了，等于没做。
// 判据写死成「首页存在指向它的链接」，而不是「文件存在」：文件存在只证明我写过。
check('我的数据页在首页有入口（v3.22.2）', () => {
  const home = readFileSync(join(root, 'index.html'), 'utf8');
  const m = home.match(/<a[^>]*class="ts-link"[^>]*href="\/my\/"/);
  assert(m, '首页没有指向 /my/ 的入口——做了页面却进不去，等于没做');
  // 入口要挂在「收藏与记录只存在本机」那句话旁边才有意义，所以顺带判它是否仍在信任区里
  const trust = home.slice(home.indexOf('trust-strip'), home.indexOf('</section>', home.indexOf('trust-strip')));
  assert(/href="\/my\/"/.test(trust), '入口不在信任区里——脱离「数据只存在本机」的语境就成了孤立链接');
  // 中英文都得有，否则切到英文版这条承诺就断了
  assert(/data-en="Where it lives, how to delete/.test(home), '入口缺英文文案');
  return '首页信任区 → /my/，中英各一条';
});

// ---------- v3.22.1：README 头部数字由数据推导 ----------
// 这一条是被现实咬出来的：e46ae70 加了第 38 个本地工具，站点首页（数字由数据推导）当场变成
// 「38 个在本机跑 · 100 个已收录」，而 README 开头还写着 99 / 37，一直到 v3.22 都没人发现。
// 首页不会漂，因为它从数据渲染；README 会，因为它是手写的。所以给它加一道闸门——
// 手写可以，但写错就红。
check('README 头部数字与数据一致（v3.22.1）', () => {
  const md = readFileSync(join(root, 'README.md'), 'utf8');
  const localN = local.tools.length;
  const totalN = localN + dir.tools.length;
  // 第三条参数是「两个捕获组各是什么」——英文导语写的是「38 of the 100」，
  // 本地在前、总数在后，与另外两处正好相反。第一版没写这个，闸门上来就红在自己身上。
  const pats = [
    [/\*\*(\d+) 个开源工具收录，其中 (\d+) 个在浏览器里跑/, '中文导语', ['total', 'local']],
    [/(\d+) of the (\d+) tools run entirely in your browser/, '英文导语', ['local', 'total']],
    [/当前收录 (\d+) 个工具\*\*：(\d+) 个本地执行/, '规模说明', ['total', 'local']],
  ];
  for (const [re, label, order] of pats) {
    const m = md.match(re);
    assert(m, `README 的${label}那句改了写法，闸门认不出——要么改回来，要么改这条断言`);
    const got = order[0] === 'total' ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    assert(
      got[0] === totalN && got[1] === localN,
      `README 的${label}写的是 ${got[0]} 收录 / ${got[1]} 本地，数据是 ${totalN} / ${localN}`
    );
  }
  return `${totalN} 收录 / ${localN} 本地，三处一致`;
});

// ---------- v3.29.1：页脚合集数由数据推导 ----------
// 页脚那句「全部 N 个合集 →」一直写死在 index.html（构建把它当模板读），第 8 个合集进来后
// 全站 200 个页面的页脚都停在 6。这类数字最难受的地方是：它出现在每一页，却没有任何人核对，
// 而「全部 6 个合集」下面正好列着 8 个。现在构建按 resources.collections.length 归一，
// 这里反过来验产物——只验首页不够，模板一歪，歪的是 200 页。
check('页脚合集数与资源数据一致（v3.29.1）', () => {
  const n = res.collections.length;
  const probe = ['index.html', 'about/index.html', 'categories/index.html', 'resources/index.html', 'tools/index.html'];
  const bad = [];
  for (const p of probe) {
    const f = join(root, p);
    if (!existsSync(f)) continue;
    const h = readFileSync(f, 'utf8');
    // v3.30：不只页脚那句「全部 N 个合集」。首页资源卡还写着一句「N 个合集：图标、字体、配色…」，
    // 它同样由构建归一，同样没人会去核对——只匹配「全部 N」的话，这里写歪了照样全绿。
    const zh = [...h.matchAll(/(\d+) 个合集/g)].map((m) => Number(m[1]));
    const en = [...h.matchAll(/(\d+) collections/g)].map((m) => Number(m[1]));
    if (!zh.length) bad.push(`${p} 找不到「N 个合集」`);
    for (const v of zh) if (v !== n) bad.push(`${p} 写「${v} 个合集」`);
    for (const v of en) if (v !== n) bad.push(`${p} 写「${v} collections」`);
  }
  assert(!bad.length, `合集数写成死数（数据是 ${n} 个）：${bad.slice(0, 4).join('；')}`);
  return `${n} 个合集，${probe.length} 个页面一致（中英双语）`;
});

// ---------- v3.24：llms.txt 不能漂 ----------
// llms.txt 是给 AI 抓取的「一页说清」，它和站点数据是两份东西——不做闸门就一定会漂：
// 加了一条工具、忘了重建，链接里少一条，而页面上完全看不出来（AI 拿到的就是缺的）。
// 所以三条一起判：文件在、条数等于两份 manifest、每条 URL 都能在页面注册表里对上。
check('llms.txt 与工具/流程数据一致（v3.24）', () => {
  const p = join(root, 'llms.txt');
  assert(existsSync(p), '根目录没有 llms.txt——构建链末尾没调用 gen-llms-txt');
  const txt = readFileSync(p, 'utf8');

  const flows = read('workflows/workflows.json').flows || [];
  const want = { local: local.tools.length, dir: dir.tools.length, flows: flows.length };

  // 按 H2 切段，只数 `- [` 开头的条目
  const sections = {};
  let cur = null;
  for (const line of txt.split('\n')) {
    if (line.startsWith('## ')) {
      cur = line.slice(3).trim();
      sections[cur] = [];
      continue;
    }
    if (cur && /^-\s+\[/.test(line)) sections[cur].push(line);
  }
  const findSec = (prefix) => Object.keys(sections).find((k) => k.startsWith(prefix));
  const localKey = findSec('本地工具');
  const dirKey = findSec('第三方目录');
  const flowKey = findSec('工作流');
  assert(localKey, 'llms.txt 缺「本地工具」一节');
  assert(dirKey, 'llms.txt 缺「第三方目录」一节');
  assert(flowKey, 'llms.txt 缺「工作流」一节');
  assert(sections[localKey].length === want.local, `本地工具条目 ${sections[localKey].length} ≠ 数据 ${want.local}`);
  assert(sections[dirKey].length === want.dir, `第三方目录条目 ${sections[dirKey].length} ≠ 数据 ${want.dir}`);
  assert(sections[flowKey].length === want.flows, `工作流条目 ${sections[flowKey].length} ≠ 数据 ${want.flows}`);

  // 标题里声明的数字也必须等于实际条目数——正文和标题各说各的，是最常见的漂法
  const hdrN = (k) => {
    const m = /（(\d+) 个/.exec(k);
    return m ? Number(m[1]) : null;
  };
  assert(hdrN(localKey) === want.local, `本地工具标题写 ${hdrN(localKey)} 个，实际 ${want.local}`);
  assert(hdrN(dirKey) === want.dir, `第三方目录标题写 ${hdrN(dirKey)} 个，实际 ${want.dir}`);

  // 每条 URL 的 pathname 必须在页面注册表里能对上（复用注册表，不手抄清单）
  const bad = [];
  let n = 0;
  for (const line of txt.split('\n')) {
    const m = /^-\s+\[[^\]]*\]\(([^)]+)\)/.exec(line);
    if (!m) continue;
    n++;
    let pathname;
    try {
      pathname = new URL(m[1]).pathname;
    } catch {
      bad.push(m[1] + '（不是绝对 URL）');
      continue;
    }
    if (!matchPage(pathname)) bad.push(m[1]);
  }
  assert(!bad.length, 'llms.txt 里的 URL 对不上页面注册表：' + bad.slice(0, 5).join(' / '));
  return `本地 ${want.local} / 目录 ${want.dir} / 流程 ${want.flows}，${n} 条 URL 全部可对上`;
});

// ---------- 输出 ----------
console.log('\n🔍 ToolHub 全量校验\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(26)} ${r.ok ? r.detail : '→ ' + r.detail}`);
}
console.log(`\n${failed ? '❌ 失败 ' + failed + ' 项' : '✅ 全部通过'}（${results.length} 项检查）\n`);
process.exit(failed ? 1 : 0);
