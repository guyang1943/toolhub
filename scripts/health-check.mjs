#!/usr/bin/env node
// ToolHub 外链巡检（v2.9 D2）：拨测目录工具与资源合集里的全部外链
//
// 用法：
//   node scripts/health-check.mjs                                  # 人看
//   node scripts/health-check.mjs --json r.json --report r.md      # 机器看 + 给 issue 用
//   node scripts/health-check.mjs --fail-on-dead                   # 有死链就退出码 2（CI 用）
//
// 判定口径：
//   ✅ 200/3xx           正常
//   🟡 401/403/405/429   有反爬或限流，浏览器通常能打开，不算死链
//   ⛔ 0（超时/连接失败）、404、5xx 等  需要人工处理
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const TIMEOUT = Number(opt('timeout', 15000));
const CONCURRENCY = Number(opt('concurrency', process.env.HC_CONCURRENCY || 8));
const JSON_OUT = opt('json', '');
const MD_OUT = opt('report', '');

// ---------- 目标 ----------
const dir = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8'));
let resItems = [];
try {
  const r = JSON.parse(readFileSync(join(root, 'resources.json'), 'utf8'));
  resItems = r.collections.flatMap((c) => c.items.map((it) => ({ id: `${c.slug}/${it.name}`, url: it.url })));
} catch {
  /* 资源库可选 */
}
const targets = [
  ...dir.tools.map((t) => ({ id: t.id, url: t.url, kind: '工具' })),
  ...resItems.map((it) => ({ ...it, kind: '资源' })),
];

console.log(`🔎 拨测 ${targets.length} 个链接（工具 ${dir.tools.length} + 资源 ${resItems.length}，超时 ${TIMEOUT}ms）...\n`);

const OK_CODES = new Set([200, 202, 203, 204, 301, 302, 307, 308]);
const BOT_CODES = new Set([401, 403, 405, 406, 429, 503]); // 503 常见于 Cloudflare 反爬挑战页

async function probe(url) {
  let last = { code: 0, err: 'unknown' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0 (ToolHub-HealthCheck/1.0)' },
      });
      if (OK_CODES.has(res.status)) return { code: res.status, attempt };
      last = { code: res.status, attempt };
    } catch (e) {
      last = { code: 0, err: e.name === 'TimeoutError' ? 'timeout' : e.cause?.code || e.message, attempt };
    }
    await new Promise((r) => setTimeout(r, 800 * attempt)); // 退避重试，避开瞬时抖动
  }
  return last;
}

const started = new Date();
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const t = targets[cursor++];
    results.push({ ...t, ...(await probe(t.url)) });
    process.stdout.write('·');
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, targets.length)) }, worker));
console.log('\n');

const alive = results.filter((r) => OK_CODES.has(r.code));
const bot = results.filter((r) => BOT_CODES.has(r.code));
const dead = results.filter((r) => !OK_CODES.has(r.code) && !BOT_CODES.has(r.code));

for (const r of [...results].sort((a, b) => a.code - b.code)) {
  const mark = OK_CODES.has(r.code) ? '✅' : BOT_CODES.has(r.code) ? '🟡' : '⛔';
  console.log(`${mark} ${String(r.code).padEnd(3)} ${r.id.padEnd(20)} ${r.url}${r.err ? '  (' + r.err + ')' : ''}`);
}
console.log(`\n✅ 正常 ${alive.length}/${results.length} · 🟡 疑似反爬/需复核 ${bot.length} · ⛔ 异常 ${dead.length} · 耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

if (bot.length) {
  console.log('\n🟡 疑似反爬（浏览器可正常打开，不必处理）：');
  for (const r of bot) console.log(`  - ${r.id}: HTTP ${r.code}`);
}
if (dead.length) {
  console.log('\n⛔ 需要处理：');
  for (const r of dead) {
    console.log(`  - ${r.id}: ${r.code === 0 ? '无法访问（可能是检查机网络限制，需人工复核）' : 'HTTP ' + r.code + '，考虑更换镜像或剔除'}`);
  }
}

// ---------- 结构化输出 ----------
const slim = (arr) => arr.map(({ id, url, kind, code, err }) => ({ id, url, kind, code, ...(err ? { err } : {}) }));
const json = {
  generatedAt: started.toISOString(),
  total: results.length,
  alive: alive.length,
  bot: bot.length,
  dead: dead.length,
  ok: slim(alive),
  blocked: slim(bot),
  dead: slim(dead),
};
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`\n📄 JSON 报告：${JSON_OUT}`);
}

if (MD_OUT) {
  const row = (r) => `| ${r.kind} | \`${r.id}\` | ${r.code === 0 ? r.err || '无法访问' : r.code} | ${r.url} |`;
  const md = [
    `## 链接巡检报告 · ${started.toISOString().slice(0, 10)}`,
    '',
    `- 拨测总数：**${json.total}**`,
    `- 正常：${json.alive} · 疑似反爬：${json.bot} · 异常：**${json.dead}**`,
    '',
    json.dead.length
      ? ['### ⛔ 需要处理', '', '| 类型 | id | 状态 | 地址 |', '|---|---|---|---|', ...json.dead.map(row)].join('\n')
      : '### ✅ 没有发现死链',
    '',
    json.bot.length
      ? ['### 🟡 疑似反爬（浏览器可打开，仅供参考）', '', '| 类型 | id | 状态 | 地址 |', '|---|---|---|---|', ...json.blocked.map(row)].join('\n')
      : '',
    '',
    '<sub>由 `scripts/health-check.mjs` 生成。死链请优先换镜像或从目录剔除；连续两周失败的项目直接下线。</sub>',
  ].join('\n');
  writeFileSync(MD_OUT, md + '\n', 'utf8');
  console.log(`📝 Markdown 报告：${MD_OUT}`);
}

if (flag('fail-on-dead') && dead.length) process.exit(2);
