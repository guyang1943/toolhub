#!/usr/bin/env node
// 外链探活：给 evidence.link 补真实证据。
//
// 用法：
//   node scripts/check-links.mjs                只报告，不改数据
//   node scripts/check-links.mjs --write        把结果写回 tools/directory.json
//   node scripts/check-links.mjs --only a,b     只探指定条目
//   node scripts/check-links.mjs --concurrency 6
//
// 为什么不用 node 的 fetch：这台机器上 node 的 https 不走系统代理，会直接超时；
// curl 读系统代理设置，行为与用户浏览器一致。用 curl 子进程是为了让「探得通」
// 这个结论和「用户点得开」尽量是同一件事。
//
// 四态判定，并且**只有前两种才更新证据**：
//   ok           2xx，站点正常
//   alive        401/403/405/418/429/5xx——拒绝爬虫、限流或此刻抽风，但站点还在
//   dead         404/410，链接真的没了
//   unreachable  超时/连不上/DNS 失败——**这不等于站点死了**，可能只是本机网络
//                访问不了（本站历史上 github.com 网页域就是这样）。所以绝不据此下架，
//                也绝不刷新 evidence.at，否则等于用「我没看到」冒充「我核过了」。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_PATH = join(root, 'tools', 'directory.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const WRITE = has('--write');
const ONLY = val('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const CONC = Number(val('--concurrency', '4'));
const TIMEOUT = Number(val('--timeout', '10'));
const LIMIT = Number(val('--limit', '0'));

// --ssl-no-revoke 只在 Windows 的 schannel 后端存在，其他平台加上会直接报错退出。
const WIN = process.platform === 'win32';
const SSL_FLAG = WIN ? ['--ssl-no-revoke'] : [];
// 空设备必须按平台给：spawn 直接调 curl.exe 时没有 MSYS 的路径转换，
// 写 /dev/null 会以 exit 23 (write error) 失败——而状态码其实是 200，
// 于是每一条都被误判成「探不了」。Git Bash 里手敲能过，脚本里过不了，就是这个原因。
const NULL_OUT = WIN ? 'NUL' : '/dev/null';

const file = JSON.parse(readFileSync(DIR_PATH, 'utf8'));
let list = file.tools;
if (ONLY.length) list = list.filter((t) => ONLY.includes(t.id));
if (LIMIT > 0) list = list.slice(0, LIMIT);

function probe(url) {
  return new Promise((resolve) => {
    const args = ['-s', '-o', NULL_OUT, '-w', '%{http_code}', '-m', String(TIMEOUT), '-L', ...SSL_FLAG, url];
    const child = spawn('curl', args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (err) => resolve({ state: 'unreachable', code: 0, why: err.code || 'spawn-failed' }));
    child.on('close', (exit) => {
      const code = Number(out.trim()) || 0;
      if (exit !== 0) {
        const why = { 28: 'timeout', 7: 'connect-failed', 6: 'dns', 35: 'tls', 60: 'cert' }[exit] || `curl-${exit}`;
        // TLS/证书错误说明域名有东西在听，但这条路走不通，仍归 unreachable，
        // 不归 dead——dead 的语义必须是「这个地址已经不是那个站了」。
        return resolve({ state: 'unreachable', code, why });
      }
      if (code >= 200 && code < 300) return resolve({ state: 'ok', code });
      if ([401, 403, 405, 406, 418, 429].includes(code)) return resolve({ state: 'alive', code, why: 'blocked' });
      if (code >= 500) return resolve({ state: 'alive', code, why: 'server-error' });
      if ([404, 410].includes(code)) return resolve({ state: 'dead', code });
      return resolve({ state: 'alive', code });
    });
  });
}

// 「探不了」重试一次再下结论。实测同一批地址两次运行会出现零星 connect-failed
// （pairdrop、regex-vis 各踩过一次），而它们在另一次运行里都是 200——单次抖动
// 不该变成一条证据，也不该让 CI 变红。
async function probeStable(url) {
  const first = await probe(url);
  if (first.state !== 'unreachable') return first;
  await new Promise((r) => setTimeout(r, 1500));
  const second = await probe(url);
  return second.state !== 'unreachable' ? { ...second, retried: true } : second;
}

const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

console.log(`探活 ${list.length} 条外链（并发 ${CONC}，超时 ${TIMEOUT}s）…\n`);

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < list.length) {
    const t = list[cursor++];
    const r = await probeStable(t.url);
    r.id = t.id;
    r.name = t.name;
    r.url = t.url;
    results.push(r);
    const mark = { ok: '✓', alive: '~', dead: '✗', unreachable: '?' }[r.state];
    const note = [r.why, r.retried ? '重试后通' : ''].filter(Boolean).join(', ');
    console.log(`${mark} ${String(r.code || '---').padStart(3)}  ${r.id.padEnd(18)} ${r.state}${note ? ` (${note})` : ''}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, worker));

const by = (s) => results.filter((r) => r.state === s);
const ok = by('ok');
const alive = by('alive');
const dead = by('dead');
const unre = by('unreachable');

console.log('\n———— 汇总 ————');
console.log(`  正常 ${ok.length} · 拒绝/抽风但存在 ${alive.length} · 疑似失效 ${dead.length} · 探不了 ${unre.length}`);
for (const r of dead) console.log(`  ✗ ${r.id}  ${r.code}  ${r.url}`);
for (const r of unre) console.log(`  ? ${r.id}  ${r.why}  ${r.url}`);
if (unre.length) {
  console.log('\n  注：「探不了」不计入失效，也不刷新证据——本机网络不通不等于站点没了。');
  console.log('      要确认请用别的网络单独打开一次，人工核实。');
}

if (WRITE) {
  const touched = new Set();
  for (const r of results) {
    // 只有真正拿到结论的两种才写。dead 也要写：它是有价值的发现。
    if (!['ok', 'alive', 'dead'].includes(r.state)) continue;
    const t = file.tools.find((x) => x.id === r.id);
    if (!t) continue;
    t.evidence = t.evidence || {};
    t.evidence.link = { at: ymd, by: 'check-links.mjs', method: 'probe' };
    t.linkStatus = r.state === 'dead' ? 'dead' : 'ok';
    touched.add(r.id);
  }
  writeFileSync(DIR_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  console.log(`\n已写回 ${touched.size} 条的 evidence.link（跳过 ${results.length - touched.size} 条「探不了」）`);
} else {
  console.log('\n（未改动数据。加 --write 写回 evidence.link）');
}

// 退出码：只在有死链时非零，方便 CI 接；unreachable 不阻断，那是网络问题不是数据问题。
process.exit(dead.length ? 1 : 0);
