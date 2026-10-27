#!/usr/bin/env node
/**
 * 样式归属分析（v3.5）+ 拆分收益试算（v3.8）
 *
 * 干什么：把 assets/style.css 里的每条规则判一个归属——
 *   base    = 首页 / 内容页 / app.js 用到 → 必须留在首屏样式表
 *   content = 只有内容页用到              → 曾经以为可以拆，v3.8 实测不存在（见下）
 *   tool    = 只有 /tools/<id>/ 用到      → 可以挪进 assets/style.tool.css
 *   dead    = 全站没有任何引用            → 可以删
 *
 * 为什么要有这个脚本：v3.5 拆工具页样式时，靠眼睛判断「这条规则是不是只有工具页用」
 * 试了三轮都有漏，最后是靠它一次性算准的。
 *
 * ── 两个被实测否掉的假设（别再重走一遍）──────────────────────────────
 *
 * 1. 「内容页样式可以拆出一块」（v3.8 试的）
 *    报出来 0 条。原因不是脚本不准，是架构决定的：build-pages 生成的每一个 HTML
 *    （首页、内容页、工具页）都带着**全部视图**（#view-home / #view-tool / #view-page），
 *    SPA 切换只是切换显隐。所以「只在内容页出现的类」这个集合是空的——
 *    内容页用的每个类，首页的 DOM 里也都有。
 *
 * 2. 「浮层样式（命令面板 / 快捷键）可以挪出去按需加载」（v3.8 实现过，又回退了）
 *    实测账：挪走 2.78 KB 原始 → 首屏只省 **0.43 KB**（压缩后），
 *    而那块单独成一个文件要 **0.88 KB**，再加上「await 样式再显示」的加载逻辑
 *    让 app.js 多 0.3~0.5 KB —— 合计反而涨。原因是 gzip 会给整文件建一份共享字典，
 *    .pal-box / .kbd-box 的声明跟别处的面板大量重复，搬出去等于把字典拆散。
 *    结论：**在 style.css 内部搬字节基本无效**，详见 --price。
 *
 * 用法：
 *   node scripts/css-coverage.mjs            # 汇总 + 异常项
 *   node scripts/css-coverage.mjs --all      # 连逐条清单一起打
 *   node scripts/css-coverage.mjs --css assets/style.tool.css   # 换一份文件分析
 *   node scripts/css-coverage.mjs --price '#palette|\.pal-'     # 试算「把这块拆出去值不值」
 *   node scripts/css-coverage.mjs --fail     # 有 dead 就退出码 1（给 verify 当闸门用）
 *
 * ⚠️ 一个必须记住的坑：`pv-${pvClass(x)}` 这种**模板字符串拼出来的类名**，
 * 纯文本搜索天然搜不到，会被误判成死代码（v3.4 就在这上面判错过一次）。
 * 所以动态拼的前缀一律写进 FORCE_BASE，宁可少删不可错删。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SHOW_ALL = argv.includes('--all');
const FAIL_ON_DEAD = argv.includes('--fail');
const cssIdx = argv.indexOf('--css');
const CSS_FILE = cssIdx > -1 ? argv[cssIdx + 1] : 'assets/style.css';
const priceIdx = argv.indexOf('--price');
const PRICE_PATTERN = priceIdx > -1 ? argv[priceIdx + 1] : null;

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

function walk(dir, ext, out = []) {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, ext, out);
    else if (e.name.endsWith(ext)) out.push(rel);
  }
  return out;
}

/* ---------- 语料：谁可能用到某个类 ---------- */
const PAGES = ['about', 'privacy', 'compare', 'topics', 'evaluations', 'resources', 'batch', 'offline', 'submit', 'feedback', 'changelog'];
const htmlPages = ['index.html', '404.html', ...PAGES.flatMap((d) => walk(d, '.html')), ...walk('tools', '.html')].filter(exists);
const toolHtml = htmlPages.filter((p) => p.startsWith('tools') && !p.includes(path.sep + 'directory'));
const contentHtml = htmlPages.filter((p) => !p.startsWith('tools'));

// v3.8：语料要再细一档。上一版把「首屏 JS」当成一整块，但里面混着 pages.js——
// 那是**内容页**的 SPA 渲染器，它拼出来的类名属于内容页，不是首页。
// 混在一起算的后果：内容页样式全都因为「pages.js 里出现过」被判成 base，一条也分不出来。
const appFiles = walk('assets', '.js').filter(exists);
// ⚠️ walk() 在 Windows 上返回的是反斜杠路径（assets\lib\pages.js），直接跟 '/'-分隔的字面量比
// 永远不相等——v3.8 第一版就在这儿翻过车：pages.js 没被摘出去，内容页样式全被判成 base，
// 报出来「仅内容页 0 条」，看着像「没有可拆的」，其实是过滤器失效。
const posix = (p) => p.replace(/\\/g, '/');
const toolPageJs = exists('assets/tool-page.js') ? read('assets/tool-page.js') : '';
const pagesJs = exists('assets/lib/pages.js') ? read('assets/lib/pages.js') : '';
const shellJs = appFiles
  .filter((p) => posix(p) !== 'assets/tool-page.js' && posix(p) !== 'assets/lib/pages.js')
  .map(read)
  .join('\n');
const toolOwnJs = walk('tools', '.js').filter(exists).map(read).join('\n');

const corpus = {
  home: read('index.html'),
  content: contentHtml.map(read).join('\n'),
  pagesJs,
  shellJs,
  toolHtml: toolHtml.map(read).join('\n'),
  toolJs: toolPageJs + '\n' + toolOwnJs,
};

/* ---------- 切规则（含 @media 展开，保留精确行号） ---------- */
const lines = read(CSS_FILE).split('\n');
const blocks = [];
let depth = 0, sel = '', start = -1;

for (let i = 0; i < lines.length; i++) {
  const text = lines[i].replace(/\/\*[\s\S]*?\*\//g, '');
  if (depth === 0 && text.includes('{')) {
    start = i;
    sel = text.slice(0, text.indexOf('{')).trim();
  }
  depth += (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;
  if (depth === 0 && start >= 0 && sel) {
    blocks.push({ sel, start, text: lines.slice(start, i + 1).join('\n') });
    start = -1; sel = '';
  }
}

function expand(block) {
  if (!/^@(media|supports)/.test(block.sel)) return [{ ...block, wrapper: null }];
  const head = block.text.slice(0, block.text.indexOf('{')).trim();
  const body = block.text.slice(block.text.indexOf('{') + 1, block.text.lastIndexOf('}')).split('\n');
  const out = [];
  let d = 0, s = '', st = -1;
  for (let i = 0; i < body.length; i++) {
    const l = body[i].replace(/\/\*[\s\S]*?\*\//g, '');
    if (d === 0 && l.includes('{')) { st = i; s = l.slice(0, l.indexOf('{')).trim(); }
    d += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
    if (d === 0 && st >= 0 && s) {
      out.push({ sel: s, start: block.start, wrapper: head, text: body.slice(st, i + 1).join('\n') });
      st = -1; s = '';
    }
  }
  return out;
}
const rules = blocks.flatMap(expand);

/* ---------- 判断 ---------- */
// 动态拼出来的类名前缀：永远算 base
const FORCE_BASE = [/\.pv-/];

const tokensOf = (s) => {
  const out = new Set();
  for (const m of s.matchAll(/\.([a-zA-Z_][\w-]*)/g)) out.add('.' + m[1]);
  for (const m of s.matchAll(/#([a-zA-Z_][\w-]*)/g)) out.add('#' + m[1]);
  return out;
};
const usedIn = (tok, src) => {
  if (tok.startsWith('#')) return new RegExp(`id=["']${tok.slice(1)}["']`).test(src);
  const c = tok.slice(1);
  return new RegExp(`(^|[\\s"'\`])${c}([\\s"'\`.,:>)\\[=]|$)`, 'm').test(src);
};

function zone(selector) {
  if (FORCE_BASE.some((re) => re.test(selector))) return 'base';
  const toks = [...tokensOf(selector)];
  if (!toks.length) return 'base'; // 纯元素选择器，全局生效
  // 顺序即优先级：首页 > 内容页 > 工具页。一个类在首页和内容页都用，归 base（表里放最前面）。
  if (toks.some((t) => usedIn(t, corpus.home) || usedIn(t, corpus.shellJs))) return 'base';
  if (toks.some((t) => usedIn(t, corpus.content) || usedIn(t, corpus.pagesJs))) return 'content';
  if (toks.some((t) => usedIn(t, corpus.toolHtml) || usedIn(t, corpus.toolJs))) return 'tool';
  return 'dead';
}

const report = rules.map((r) => ({ ...r, zone: zone(r.sel) }));
const by = (z) => report.filter((r) => r.zone === z);

/* ---------- 输出 ---------- */
const kb = (n) => (n / 1024).toFixed(1);
const byteLen = (arr) => arr.reduce((n, r) => n + Buffer.byteLength(r.text) + 2, 0);
const total = fs.statSync(path.join(root, CSS_FILE)).size;

/* ---------- 拆分收益试算（--price）----------
   为什么要单独算这一项：直觉上「把 N KB 的规则搬出去」就是把 N KB 搬走，
   但压缩是按整个文件建字典的，搬走的块往往跟留下的部分高度重复，
   压缩后省下的远小于它的原始体积；而搬出去的那块单独成文件，反而**没有任何字典可用**。
   v3.8 就是没算这一笔，按 0.84 KB 的估算动手，实测只省 0.43 KB，白干一趟。 */
function price(pattern) {
  const re = new RegExp(pattern);
  const hit = rules.filter((r) => re.test(r.sel));
  if (!hit.length) {
    console.log(`\n💸 试算 "${pattern}"：没有匹配的规则`);
    return;
  }
  const src = fs.readFileSync(path.join(root, CSS_FILE), 'utf8');
  const keptLines = src.split('\n');
  const hitStarts = new Set(hit.map((r) => r.start));
  // 按「整块删掉」的方式重建剩余文件：只删顶层块的首行到块尾，@media 里的按行删不现实，
  // 所以这里只对顶层块生效——@media 内的命中会被跳过并在结果里点名。
  const drop = new Set();
  for (const b of blocks) {
    if (hit.some((r) => r.start === b.start)) for (let i = 0; i < b.text.split('\n').length; i++) drop.add(b.start + i);
  }
  const kept = keptLines.filter((_, i) => !drop.has(i)).join('\n');
  const gz = (s) => gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length;
  const before = gz(src);
  const after = gz(kept);
  const frag = hit.map((r) => r.text).join('\n');
  const fragGz = gz(frag);
  const save = before - after;

  console.log(`\n💸 拆分收益试算："${pattern}"`);
  console.log('─'.repeat(58));
  console.log(`  命中规则          ${hit.length} 条 / ${kb(byteLen(hit))} KB 原始`);
  console.log(`  首屏能省          ${(save / 1024).toFixed(2)} KB（压缩后，这才是真的）`);
  console.log(`  搬出去要付        ${(fragGz / 1024).toFixed(2)} KB（单独成文件，没有共享字典）`);
  console.log(`  净差价            ${((fragGz - save) / 1024).toFixed(2)} KB／每位用到它的用户`);
  console.log(`  压缩率            ${((save / byteLen(hit)) * 100).toFixed(0)}%（整个文件约 25%）`);
  console.log('');
  console.log(
    save > fragGz
      ? '  → 值得拆：省下的比搬出去的多。'
      : `  → 不值得：为了省 ${(save / 1024).toFixed(2)} KB，用到它的人要多付 ${((fragGz - save) / 1024).toFixed(2)} KB。`
  );
  console.log('  → 还没算实现成本：按需加载要改调用方（await 后再显示），app.js 会变厚，那笔账也得加进来。');
  if (hit.some((r) => !hitStarts.has(r.start))) console.log('  ⚠️ 部分命中在 @media 里，收益按整块删除估算，可能略有出入。');
}

/* ---------- 闸门（--fail）----------
   给 verify 用：style.css 里出现「全站无引用」的规则就退出码 1。
   这类规则是预算无声膨胀的主要来源，而且它们本来就是纯浪费——留着没有任何好处。 */
function failIfDead() {
  const dead = by('dead');
  if (!dead.length) return 0;
  console.log('\n❌ style.css 里有 ' + dead.length + ' 条规则全站没有任何引用：');
  for (const r of dead) console.log(`   L${r.start + 1}  ${r.sel}`);
  console.log('   要么删掉，要么确认它是模板字符串拼出来的、把前缀加进 FORCE_BASE。');
  return 1;
}

if (PRICE_PATTERN) {
  price(PRICE_PATTERN);
  process.exit(0);
}

console.log(`\n🎨 样式归属分析：${CSS_FILE}`);
console.log('─'.repeat(58));
console.log(`  规则总数        ${String(report.length).padStart(4)}    ${kb(total)} KB`);
console.log(`  基础表（必须留）  ${String(by('base').length).padStart(4)}    ${kb(byteLen(by('base')))} KB`);
console.log(`  仅内容页（可挪）  ${String(by('content').length).padStart(4)}    ${kb(byteLen(by('content')))} KB`);
console.log(`  仅工具页（可挪）  ${String(by('tool').length).padStart(4)}    ${kb(byteLen(by('tool')))} KB`);
console.log(`  无引用（可删）    ${String(by('dead').length).padStart(4)}    ${kb(byteLen(by('dead')))} KB`);

const dump = (title, arr) => {
  if (!arr.length) return;
  console.log(`\n${title}`);
  for (const r of arr) console.log(`  L${String(r.start + 1).padStart(4)}  ${r.sel}${r.wrapper ? `  （${r.wrapper}）` : ''}`);
};

if (SHOW_ALL) {
  dump('仅内容页 ── v3.8 实测为 0 条，别在这上面再花时间（原因见文件头）', by('content'));
  dump('仅工具页 ── 候选搬去 assets/style.tool.css', by('tool'));
  dump('无引用 ── 删之前先确认不是模板字符串拼出来的', by('dead'));
} else {
  dump(`无引用（${by('dead').length} 条，删之前先确认不是模板字符串拼出来的）`, by('dead'));
  const more = [
    by('content').length && `仅内容页 ${by('content').length} 条`,
    by('tool').length && `仅工具页 ${by('tool').length} 条`,
  ].filter(Boolean);
  if (more.length) console.log(`\n${more.join('、')}，加 --all 看清单。`);
}

if (by('dead').length) console.log('\n⚠️ 判为「无引用」不等于真没人用：先确认它不是模板字符串拼出来的（见文件头注释）。');
if (FAIL_ON_DEAD) process.exit(failIfDead());
