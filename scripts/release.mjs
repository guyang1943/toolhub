#!/usr/bin/env node
// 一键发布：生成静态页 → 全量校验 → 打包 zip 到桌面
// 用法：
//   node scripts/release.mjs                                  # 用默认域名
//   node scripts/release.mjs https://tools.sitool.eu.org      # 指定正式域名
//   node scripts/release.mjs https://xxx --skip-build         # 跳过重新生成（只校验+打包）
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) || 'https://toolhub.guyang1966.workers.dev';
const skipBuild = args.includes('--skip-build');
const NODE = process.execPath;

const step = (n, msg) => console.log(`\n[${n}/4] ${msg}`);
const ok = (msg) => console.log(`      ✅ ${msg}`);
const fail = (msg) => {
  console.log(`      ❌ ${msg}`);
  process.exit(1);
};

function run(script, extra = []) {
  const r = spawnSync(NODE, [join(root, 'scripts', script), ...extra], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log('🚀 ToolHub 发布流程');
console.log(`   目标域名: ${base}`);

// 1. 生成静态页
step(1, '生成静态页面与 sitemap');
if (skipBuild) {
  ok('已跳过（--skip-build）');
} else {
  const r = run('build-pages.mjs', [base]);
  const line = r.out.split('\n').find((l) => l.includes('生成')) || '';
  if (r.code !== 0) fail('生成失败：\n' + r.out);
  ok(line.replace(/^✅\s*/, '').trim());
}

// 2. 全量校验
step(2, '全量校验（17 项）');
const v = run('verify.mjs');
const summary = v.out.split('\n').filter((l) => l.includes('✅ 全部通过') || l.includes('❌ 失败')).pop();
if (v.code !== 0) {
  console.log(v.out);
  fail('校验未通过，请修复后再发布');
}
ok(summary ? summary.trim() : '通过');

// 3. 同步 sw 版本号（每次发布自动 +1，避免浏览器读旧缓存）
step(3, '递增 Service Worker 版本号');
const swPath = join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
const m = sw.match(/toolhub-v(\d+)\.(\d+)/);
let newVer;
if (m) {
  newVer = `toolhub-v${m[1]}.${Number(m[2]) + 1}`;
  sw = sw.replace(/toolhub-v[\d.]+/, newVer);
  writeFileSync(swPath, sw, 'utf8');
  ok(`${m[0]} → ${newVer}`);
} else {
  ok('未找到版本号，跳过');
}

// 4. 打包 zip 到桌面
step(4, '打包到桌面');
const zipPath = join(homedir(), 'Desktop', 'toolhub.zip');
const ps = `Compress-Archive -Path "${join(root, '*')}" -DestinationPath "${zipPath}" -Force`;
const z = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
if (z.status !== 0 || !existsSync(zipPath)) fail('打包失败：' + (z.stderr || ''));
const kb = Math.round(statSync(zipPath).size / 1024);
ok(`toolhub.zip（${kb} KB）→ ${zipPath}`);

console.log(`
────────────────────────────────────────
✅ 发布包已就绪

下一步：
  1. Cloudflare → Workers & Pages → toolhub → 上传 ${zipPath}
  2. 部署后验证：
     node scripts/smoke-test.mjs ${base}
  3. 若换了域名，记得重跑本脚本并更新 Worker 的 Custom Domain
────────────────────────────────────────
`);
