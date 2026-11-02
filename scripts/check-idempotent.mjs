#!/usr/bin/env node
// 构建幂等校验：连跑两次构建，比对全部产物的内容哈希。
// 为什么要单独一个脚本：构建脚本一旦不是纯函数（多留一个空行、写进时间戳、注入区块没剥干净），
// 每次 push 都会带一批「看起来没改」的产物差异，而且很难看出来。
// 以前手工做这件事，第一次就做错了 —— 用 `git ls-files | xargs cat | sha1sum` 比，
// 只覆盖已跟踪文件，新目录（还没 git add 的）根本不在里面，于是得出「不幂等」的假结论。
// 用法：node scripts/check-idempotent.mjs [基址]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.argv[2] || 'https://toolhub.bot.cd';
const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp-shots', 'vendor', '_out', 'build']);
// 产物 = 构建脚本会写的东西。assets/*.js 是手写源码，不参与（它不会被构建改动，
// 混进来只会让 diff 噪音变多）。
const EXT = /\.(html|json|xml)$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), out);
    } else if (EXT.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function snapshot() {
  const map = new Map();
  const files = walk(root);
  files.push(join(root, 'sw.js'));
  if (existsSync(join(root, 'robots.txt'))) files.push(join(root, 'robots.txt'));
  for (const f of files) {
    if (!existsSync(f)) continue;
    const rel = relative(root, f).split(sep).join('/');
    map.set(rel, createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 12));
  }
  return map;
}

const build = () => execFileSync(process.execPath, [join(root, 'scripts', 'build-pages.mjs'), BASE], { cwd: root, stdio: 'pipe' });

process.stdout.write(`🔁 构建幂等校验（基址 ${BASE}）\n`);
build();
const a = snapshot();
build();
const b = snapshot();

const changed = [...a.keys()].filter((k) => b.get(k) !== a.get(k));
const added = [...b.keys()].filter((k) => !a.has(k));
const removed = [...a.keys()].filter((k) => !b.has(k));

if (!changed.length && !added.length && !removed.length) {
  console.log(`✅ 幂等：连跑两次，${a.size} 个产物零差异`);
  process.exit(0);
}
console.log(`❌ 不幂等：${changed.length} 改 / ${added.length} 增 / ${removed.length} 减`);
for (const k of [...changed, ...added, ...removed].slice(0, 8)) console.log(`   ${k}`);
console.log('   排查方向：注入区块剥离是否彻底、是否写了时间戳、是否有 Math.random 参与内容');
process.exit(1);
