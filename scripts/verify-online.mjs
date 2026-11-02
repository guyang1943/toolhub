#!/usr/bin/env node
// 上线复验：一次回答「发上去了吗、线上是不是这一版」。
// 这轮踩过的坑都在这里收口：
//   1) 推完立刻探新路径会 404 —— Pages 构建有几十秒滞后，不是没发上去；
//   2) 本机 node 的 fetch 直连 GitHub Pages 会间歇超时（curl 走系统代理才稳）；
//   3) 判断「哪一版在线」最可靠的证据是 sw.js 里的版本号，它跟 changelog.json 走。
// 用法：node scripts/verify-online.mjs [https://toolhub.bot.cd] [--wait 90]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) || 'https://toolhub.bot.cd').replace(/\/$/, '');
const waitIdx = args.indexOf('--wait');
const WAIT = waitIdx >= 0 ? Number(args[waitIdx + 1] || 90) : 0;

const PATHS = ['/', '/tools/', '/categories/', '/categories/image/', '/evaluations/', '/sw.js', '/assets/content-pages.js', '/sitemap.xml'];

async function get(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { signal: AbortSignal.timeout(12000) });
      return r;
    } catch {
      // 直连超时是常态，隔一秒再来；三次都不通才判失败
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  return null;
}

function localVersion() {
  const cl = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
  const list = cl.entries || cl;
  // changelog 里存的是 "v3.14"，sw.js 里是 "toolhub-v3.14"。统一在这里收口成完整 token，
  // 免得调用处再拼一次前缀（v3.14 首次上线时就这样比出了 "toolhub-vv3.14"，误报未到位）。
  const v = String(list[0].version || list[0].v || '').replace(/^v/, '');
  return 'toolhub-v' + v;
}

function gitHead(kind) {
  try {
    const out =
      kind === 'local'
        ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
        : execFileSync('git', ['ls-remote', 'origin', 'main'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    return out.trim().slice(0, 7);
  } catch {
    return '?';
  }
}

if (WAIT) {
  // Pages 构建滞后：先探一次，404 就等（不是失败）
  const first = await get('/', 1);
  const probe = await get('/sw.js', 1);
  const txt = probe ? await probe.text() : '';
  const v = (txt.match(/toolhub-v[\d.]+/) || [])[0];
  if (!first || first.status !== 200 || v !== localVersion()) {
    console.log(`   首次探测：${first ? first.status : '超时'} / ${v || '无版本号'}，等 ${WAIT}s 再验（Pages 构建有滞后）`);
    await new Promise((res) => setTimeout(res, WAIT * 1000));
  }
}

const rows = [];
for (const p of PATHS) {
  const r = await get(p);
  rows.push({ p, code: r ? r.status : 0 });
}
const sw = await get('/sw.js');
const swText = sw ? await sw.text() : '';
const online = (swText.match(/toolhub-v[\d.]+/) || ['(读不到)'])[0];
const local = localVersion();
const head = gitHead('local');
const remote = gitHead('remote');

const bad = rows.filter((r) => r.code !== 200);
console.log(`🌐 线上复验 ${BASE}`);
for (const r of rows) console.log(`   ${r.code === 200 ? '✅' : '❌'} ${String(r.code).padEnd(3)} ${r.p}`);
console.log(`   版本  线上 ${online} / 本地 ${local}${online === local ? ' ✅' : ' ❌'}`);
console.log(`   提交  本地 ${head} / 远端 ${remote}${head === remote ? ' ✅ 已推送' : ' ⚠️ 未推送'}`);

const ok = !bad.length && online === local && head === remote;
console.log(ok ? '\n✅ 上线确认：路径全通，线上就是本地这一版' : '\n❌ 上线未确认，按上面标红的项排查');
process.exit(ok ? 0 : 1);
