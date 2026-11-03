#!/usr/bin/env node
// 一条命令跑完全部验收，只回「每套一行」+ 失败明细。
// 为什么要有它：五套测试 + 体检 + 预算各自会刷几十到上百行 ✅，
// 全量输出进了上下文，读完只为了确认「全绿」——纯噪音。
// 这个脚本负责把噪音留在自己的进程里，只把结论递给调用方。
// 用法：
//   node scripts/check-all.mjs            # 全跑（自己起本地服务器，跑完关掉）
//   node scripts/check-all.mjs verify spa # 只跑指定几套
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8788);
const LOCAL = `http://127.0.0.1:${PORT}`;
const only = process.argv.slice(2);

const SUITES = [
  { key: 'verify', name: '结构校验', script: 'verify.mjs' },
  { key: 'spa', name: 'SPA 渲染', script: 'spa-render-test.mjs' },
  { key: 'func', name: '工具功能', script: 'new-tools-test.mjs' },
  { key: 'perf', name: '首屏预算', script: 'perf-budget.mjs' },
  // v3.20：冒烟一直没进这个清单。脚本自称「一条命令跑完全部验收」，
  // 实际少了 149 项（含 62 个目录页的可达性）——「全跑一遍」的结论不能靠人记着自己补一条。
  { key: 'smoke', name: '冒烟', script: 'smoke-test.mjs', args: [LOCAL], needsServer: true },
  { key: 'browser', name: '真浏览器', script: 'browser-test.mjs', args: [LOCAL], needsServer: true },
  { key: 'audit', name: '全站体检', script: 'audit.mjs', args: [LOCAL], needsServer: true },
];

const picked = only.length ? SUITES.filter((s) => only.includes(s.key)) : SUITES;
if (!picked.length) {
  console.error(`未知套件：${only.join(' ')}。可选：${SUITES.map((s) => s.key).join(' / ')}`);
  process.exit(2);
}
const needServer = picked.some((s) => s.needsServer);

// 前置闸门（v3.17）：外链的边界字段缺一条，六套测试全绿也救不回一句假承诺。
// 它不算「一套」，所以不进 SUITES——但每次跑都先过它，过不了直接停。
{
  const g = spawnSync(process.execPath, [join(root, 'scripts', 'check-tool-meta.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (g.status !== 0) {
    console.error('❌ 外链边界字段闸门未过，先修数据再跑测试：\n');
    console.error(`${g.stdout || ''}${g.stderr || ''}`);
    process.exit(1);
  }
  const line = (g.stdout || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('✅'));
  if (line) console.log(line);
}

// 前置闸门（v3.18）：投稿规范与存量数据、前端表单、Issue 模板三处必须一致。
// 漂移的症状是「用户填完过不了校验」或「走模板要填两遍」，而六套测试一条都抓不到。
{
  const g = spawnSync(process.execPath, [join(root, 'scripts', 'check-submit-schema.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (g.status !== 0) {
    console.error('❌ 投稿规范闸门未过（schema / 表单 / 模板三处不同步）：\n');
    console.error(`${g.stdout || ''}${g.stderr || ''}`);
    process.exit(1);
  }
  const line = (g.stdout || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('✅'));
  if (line) console.log(line);
}

// 前置闸门（v3.20）：隐私页说的存储键，必须等于代码实际在用的键。
// 这是一条「说法」与「行为」的对账——漂了不会报错，只会让「输入不会离开这台设备」悄悄缩水。
{
  const g = spawnSync(process.execPath, [join(root, 'scripts', 'check-storage-keys.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (g.status !== 0) {
    console.error('❌ 存储键与隐私页不一致（新增存储忘了写文案，或删功能留了死文案）：\n');
    console.error(`${g.stdout || ''}${g.stderr || ''}`);
    process.exit(1);
  }
  const line = (g.stdout || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('✅'));
  if (line) console.log(line);
}

// 只抓两类行：汇总（最后一行带 ✅ 的）和失败（带 ❌ 的）。其余全部丢弃。
const keep = (out) =>
  out
    .split('\n')
    .map((l) => l.trim())
    // 把 ⚠️ 与「合计」也留下：audit 的中低优问题不算失败（它只对 high 退 1），
    // 但「不算失败」不等于「可以看不见」——v3.15 就是在这里漏读了一条真实的可点区域问题。
    .filter((l) => l && (l.includes('❌') || /^✅/.test(l) || /^⚠️/.test(l) || /^合计/.test(l)));

function run(s) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(root, 'scripts', s.script), ...(s.args || [])], {
    cwd: root,
    encoding: 'utf8',
    timeout: 600000,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const lines = keep(out);
  const bad = lines.filter((l) => l.includes('❌'));
  // 有的脚本最后一行是分隔线，按「最后一行」取汇总会取空。优先取真正的结论行：
  // 先找 ✅ 开头的结论，没有再退到 audit 的「合计 N 条」。
  const summary =
    [...lines].reverse().find((l) => /^✅/.test(l)) ||
    [...lines].reverse().find((l) => /^合计/.test(l)) ||
    lines[lines.length - 1] ||
    '(无输出)';
  // 软警告只认 audit 那种 ⚠️ 前缀，以及「合计 N 条」里 N 不为 0 的情况。
  // 不能把所有「合计」都当警告：perf-budget 的预算明细最后一行也叫「合计」，那是正常输出。
  const warns = lines.filter((l) => /^⚠️/.test(l));
  const soft = warns.length > 0 || (/^合计/.test(summary) && !/合计\s*0\s*条/.test(summary));
  const ok = r.status === 0 && !bad.length;
  return { ok, summary, bad, warns, soft, ms: Date.now() - started, code: r.status };
}

async function waitServer(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${LOCAL}/`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  return false;
}

let server = null;
if (needServer) {
  server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), String(PORT)], { cwd: root, stdio: 'ignore' });
  if (!(await waitServer())) {
    console.error(`❌ 本地服务器没起来（${LOCAL}），先单独跑 node scripts/serve.mjs ${PORT} 看看`);
    server.kill();
    process.exit(2);
  }
}

let failed = 0;
for (const s of picked) {
  const r = run(s);
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  if (r.ok) {
    // 通过但有中低优提示：用 ⚠️ 打头，别让「✅ 全站体检」把一条真问题盖过去
    const mark = r.soft ? '⚠️' : '✅';
    console.log(`${mark} ${s.name.padEnd(6, '　')} ${r.summary.replace(/^✅\s*/, '')}  (${secs})`);
    for (const l of r.warns.slice(0, 6)) console.log(`     ${l}`);
  } else {
    failed++;
    console.log(`❌ ${s.name.padEnd(6, '　')} 退出码 ${r.code}  (${secs})`);
    for (const l of (r.bad.length ? r.bad : [r.summary]).slice(0, 12)) console.log(`     ${l}`);
  }
}

if (server) server.kill();
console.log(failed ? `\n❌ ${failed}/${picked.length} 套未通过` : `\n✅ ${picked.length} 套全部通过`);
process.exit(failed ? 1 : 0);
