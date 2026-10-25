#!/usr/bin/env node
// 首屏性能预算（v2.9 D4）
//
// 为什么用 gzip 字节而不是 Lighthouse 分数：分数会随机器、网络、版本漂移，
// 而「首屏要传多少字节」是确定的，改坏了就是改坏了，适合当闸门。
// 真实 LCP / CLS 由 scripts/browser-test.mjs 在真浏览器里测（那边测体验，这边守体积）。
//
// 用法：node scripts/perf-budget.mjs [--json perf-report.json] [--quiet]
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const jsonIdx = argv.indexOf('--json');
const JSON_OUT = jsonIdx > -1 ? argv[jsonIdx + 1] : '';

const budgetCfg = JSON.parse(readFileSync(join(root, 'perf-budget.json'), 'utf8'));
const B = budgetCfg.budgets;

const gz = (rel) => {
  const buf = readFileSync(join(root, rel));
  return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
};
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const html = readFileSync(join(root, 'index.html'), 'utf8');

// ---------- 首屏请求清单（从模板解析，不靠人记） ----------
const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ''));
const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ''));
const firstScreen = ['index.html', ...styles, ...scripts];

// ---------- 统计 ----------
const rows = [];
let sumDoc = 0;
let sumCss = 0;
let sumJs = 0;
for (const rel of firstScreen) {
  const { raw, gzip } = gz(rel);
  rows.push({ file: rel, raw, gzip });
  if (rel.endsWith('.html')) sumDoc += gzip;
  else if (rel.endsWith('.css')) sumCss += gzip;
  else sumJs += gzip;
}
const bootRows = (budgetCfg.bootData || []).map((rel) => ({ file: rel, ...gz(rel) }));
const bootTotal = bootRows.reduce((n, r) => n + r.gzip, 0);
const total = sumDoc + sumCss + sumJs + bootTotal;
const requests = firstScreen.length + bootRows.length;

// ---------- 判定 ----------
const fails = [];
const over = (label, actual, limit) => {
  if (actual > limit) fails.push(`${label} ${kb(actual)} 超出预算 ${kb(limit)}（+${kb(actual - limit)}）`);
};
over('文档 index.html', sumDoc, B.document);
over('样式', sumCss, B.styles);
over('首屏脚本', sumJs, B.scripts);
over('启动数据', bootTotal, B.bootData);
over('首屏合计', total, B.total);
if (requests > B.requests) fails.push(`首屏请求 ${requests} 个，超出预算 ${B.requests} 个`);

// 第三方库不允许回到首屏（这是 v2.9 的主要优化，加回去要显式改规则）
for (const f of firstScreen) {
  if ((budgetCfg.rules?.forbiddenFirstScreen || []).some((p) => f.startsWith(p))) {
    fails.push(`首屏出现按需库 ${f}：${budgetCfg.rules?.why || ''}`);
  }
}

// ---------- 输出 ----------
if (!QUIET) {
  console.log('\n📦 首屏体积（gzip）');
  console.log('─'.repeat(58));
  for (const r of rows) console.log(`  ${r.file.padEnd(34)} ${kb(r.gzip).padStart(9)}  (raw ${kb(r.raw)})`);
  console.log(`  ${'启动数据（' + bootRows.length + ' 个 JSON）'.padEnd(34)} ${kb(bootTotal).padStart(9)}`);
  console.log('─'.repeat(58));
  console.log(`  ${'文档'.padEnd(20)} ${kb(sumDoc).padStart(9)} / 预算 ${kb(B.document)}`);
  console.log(`  ${'样式'.padEnd(20)} ${kb(sumCss).padStart(9)} / 预算 ${kb(B.styles)}`);
  console.log(`  ${'脚本'.padEnd(20)} ${kb(sumJs).padStart(9)} / 预算 ${kb(B.scripts)}`);
  console.log(`  ${'启动数据'.padEnd(20)} ${kb(bootTotal).padStart(9)} / 预算 ${kb(B.bootData)}`);
  console.log(`  ${'合计'.padEnd(20)} ${kb(total).padStart(9)} / 预算 ${kb(B.total)}   ${requests} 个请求 / 预算 ${B.requests}`);
}

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), total, requests, rows, bootRows, fails }, null, 2) + '\n',
    'utf8'
  );
}

if (fails.length) {
  console.error(`\n❌ 性能预算未通过（${fails.length} 项）：`);
  for (const f of fails) console.error('   - ' + f);
  console.error('\n   要么优化，要么在 perf-budget.json 里显式提高预算（并在提交信息里写清原因）。\n');
  process.exit(1);
}
if (!QUIET) console.log(`\n✅ 性能预算通过：首屏 ${kb(total)} / ${requests} 个请求\n`);
