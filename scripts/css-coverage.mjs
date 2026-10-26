#!/usr/bin/env node
/**
 * 样式归属分析（v3.5）
 *
 * 干什么：把 assets/style.css 里的每条规则判一个归属——
 *   base = 首页 / 内容页 / app.js 用到 → 必须留在首屏样式表
 *   tool = 只有 /tools/<id>/ 用到      → 可以挪进 assets/style.tool.css
 *   dead = 全站没有任何引用            → 可以删
 *
 * 为什么要有这个脚本：v3.5 拆工具页样式时，靠眼睛判断「这条规则是不是只有工具页用」
 * 试了三轮都有漏，最后是靠它一次性算准的。以后再拆（内容页样式、浮层样式）还得用它。
 *
 * 用法：
 *   node scripts/css-coverage.mjs            # 汇总 + 异常项
 *   node scripts/css-coverage.mjs --all      # 连逐条清单一起打
 *   node scripts/css-coverage.mjs --css assets/style.tool.css   # 换一份文件分析
 *
 * ⚠️ 一个必须记住的坑：`pv-${pvClass(x)}` 这种**模板字符串拼出来的类名**，
 * 纯文本搜索天然搜不到，会被误判成死代码（v3.4 就在这上面判错过一次）。
 * 所以动态拼的前缀一律写进 FORCE_BASE，宁可少删不可错删。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SHOW_ALL = argv.includes('--all');
const cssIdx = argv.indexOf('--css');
const CSS_FILE = cssIdx > -1 ? argv[cssIdx + 1] : 'assets/style.css';

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

const toolPageJs = exists('assets/tool-page.js') ? read('assets/tool-page.js') : '';
const firstScreenJs = walk('assets', '.js').filter(exists).map(read).join('\n').replace(toolPageJs, '');
const toolOwnJs = walk('tools', '.js').filter(exists).map(read).join('\n');

const corpus = {
  home: read('index.html'),
  content: contentHtml.map(read).join('\n'),
  appJs: firstScreenJs,
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
  if (toks.some((t) => usedIn(t, corpus.home) || usedIn(t, corpus.content) || usedIn(t, corpus.appJs))) return 'base';
  if (toks.some((t) => usedIn(t, corpus.toolHtml) || usedIn(t, corpus.toolJs))) return 'tool';
  return 'dead';
}

const report = rules.map((r) => ({ ...r, zone: zone(r.sel) }));
const by = (z) => report.filter((r) => r.zone === z);

/* ---------- 输出 ---------- */
const kb = (n) => (n / 1024).toFixed(1);
const byteLen = (arr) => arr.reduce((n, r) => n + Buffer.byteLength(r.text) + 2, 0);
const total = fs.statSync(path.join(root, CSS_FILE)).size;

console.log(`\n🎨 样式归属分析：${CSS_FILE}`);
console.log('─'.repeat(58));
console.log(`  规则总数        ${String(report.length).padStart(4)}    ${kb(total)} KB`);
console.log(`  基础表（必须留）  ${String(by('base').length).padStart(4)}    ${kb(byteLen(by('base')))} KB`);
console.log(`  仅工具页（可挪）  ${String(by('tool').length).padStart(4)}    ${kb(byteLen(by('tool')))} KB`);
console.log(`  无引用（可删）    ${String(by('dead').length).padStart(4)}    ${kb(byteLen(by('dead')))} KB`);

const dump = (title, arr) => {
  if (!arr.length) return;
  console.log(`\n${title}`);
  for (const r of arr) console.log(`  L${String(r.start + 1).padStart(4)}  ${r.sel}${r.wrapper ? `  （${r.wrapper}）` : ''}`);
};

if (SHOW_ALL) {
  dump('仅工具页 ── 候选搬去 assets/style.tool.css', by('tool'));
  dump('无引用 ── 删之前先确认不是模板字符串拼出来的', by('dead'));
} else {
  dump(`无引用（${by('dead').length} 条，删之前先确认不是模板字符串拼出来的）`, by('dead'));
  if (by('tool').length) console.log(`\n仅工具页的规则有 ${by('tool').length} 条，加 --all 看清单。`);
}

if (by('dead').length) console.log('\n⚠️ 判为「无引用」不等于真没人用：先确认它不是模板字符串拼出来的（见文件头注释）。');
