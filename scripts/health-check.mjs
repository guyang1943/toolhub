#!/usr/bin/env node
// ToolHub 目录健康检查：拨测 directory.json 中全部 URL，输出死链报告
// 用法：node scripts/health-check.mjs [--timeout 15000]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8'));
// 资源库链接同样纳入巡检（资源站死链率更高）
const resPath = join(root, 'resources.json');
const resItems = (() => {
  try {
    const r = JSON.parse(readFileSync(resPath, 'utf8'));
    return r.collections.flatMap((c) => c.items.map((it) => ({ id: `${c.slug}/${it.name}`, url: it.url })));
  } catch {
    return [];
  }
})();
const targets = [...dir.tools, ...resItems];
const timeout = process.argv.includes('--timeout') ? Number(process.argv[process.argv.indexOf('--timeout') + 1]) : 15000;

console.log(`🔎 拨测 ${targets.length} 个链接（工具 ${dir.tools.length} + 资源 ${resItems.length}，超时 ${timeout}ms）...\n`);

const OK_CODES = new Set([200, 202, 203, 204, 301, 302, 307, 308]);
const BOT_CODES = new Set([401, 403, 405, 406, 429]);

async function probe(url, timeout) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'Mozilla/5.0 (ToolHub-HealthCheck/1.0)' },
      });
      if (OK_CODES.has(res.status)) return { code: res.status, attempt };
      last = { code: res.status, attempt };
    } catch (e) {
      last = { code: 0, err: e.name === 'TimeoutError' ? 'timeout' : e.cause?.code || e.message, attempt };
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt)); // 重试前等待，避开瞬时抖动
  }
  return last;
}

// 并发探测（默认 8 路），带重试
const CONCURRENCY = Number(process.env.HC_CONCURRENCY || 8);
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const t = targets[cursor++];
    const r = await probe(t.url, timeout);
    results.push({ id: t.id, url: t.url, ...r });
    process.stdout.write(r.code === 200 ? '.' : 'x');
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
console.log('');

const alive = results.filter((r) => OK_CODES.has(r.code));
const bot = results.filter((r) => BOT_CODES.has(r.code));
const dead = results.filter((r) => !OK_CODES.has(r.code) && !BOT_CODES.has(r.code));
for (const r of [...results].sort((a, b) => a.code - b.code)) {
  const mark = OK_CODES.has(r.code) ? '✅' : BOT_CODES.has(r.code) ? '🟡' : '⛔';
  console.log(`${mark} ${String(r.code).padEnd(3)} ${r.id.padEnd(16)} ${r.url}${r.err ? '  (' + r.err + ')' : ''}`);
}
console.log(`\n✅ 正常 ${alive.length}/${results.length} · 🟡 疑似反爬/需复核 ${bot.length} · ⛔ 异常 ${dead.length}`);
if (bot.length) {
  console.log('\n🟡 疑似反爬（浏览器可正常打开，不必处理）：');
  for (const r of bot) console.log(`  - ${r.id}: HTTP ${r.code}`);
}
if (dead.length) {
  console.log('\n⛔ 需要处理：');
  for (const r of dead) console.log(`  - ${r.id}: ${r.code === 0 ? '无法访问（可能是检查机网络限制，需人工复核）' : 'HTTP ' + r.code + '，考虑更换镜像或剔除'}`);
}
