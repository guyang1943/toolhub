#!/usr/bin/env node
// 校验隐私页说的「浏览器里存了什么」与代码实际在用的键是否一致（v3.20）
//
// 起因不是文案笔误，是两份事实各自维护：
//   代码里 saveDraft() 写 `toolhub:draft:<id>`，隐私页却说「输入只存在于内存」。
// 行为对、说法错。更麻烦的是这类不一致没人会主动发现——它不会报错，只会让
// 「你的输入不会离开这台设备」这句话慢慢失去分量。
//
// 所以这里不做「人工核对一遍」，而是让机器每次构建都对：
//   ① 扫 assets 下所有 `'toolhub:...'` 字面量 —— 这是真在用的键，不是声称的键
//   ② 每个键都必须出现在 privacy/index.html 的正文里
//   ③ 反向：隐私页没有提到任何**不存在**的键（防止删了功能还留着文案）
//
// 用法：node scripts/check-storage-keys.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkStorageKeys, scanStorageKeys } from './lib/storage-keys.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, 'privacy', 'index.html'))) {
  console.error('\n❌ 找不到 privacy/index.html —— 先跑 node scripts/build-pages.mjs\n');
  process.exit(1);
}

const { keys, missing } = checkStorageKeys(root);
const errors = [];

for (const m of missing) {
  errors.push(
    `隐私页没有提到 ${m.key}（在 ${m.files.join('、')} 里实际使用）—— ` +
      '新增存储却忘了写文案，等于让「输入不会离开这台设备」这句话悄悄缩水'
  );
}

// 反向核对：隐私页里列出的键，必须在源码里真的存在。
// 只认 <code>toolhub:...</code> 这种被显式标注的写法，避免把叙述性文字当成键。
const html = readFileSync(join(root, 'privacy', 'index.html'), 'utf8');
const claimed = new Set([...html.matchAll(/<code>(toolhub:[a-z0-9:-]*)(?:&lt;[^&]*&gt;)?<\/code>/g)].map((m) => m[1]));
const real = new Set(scanStorageKeys(root).map((s) => s.key));
for (const c of claimed) {
  if (!real.has(c)) errors.push(`隐私页列了 ${c}，但代码里已经没人用它 —— 删功能时忘了改文案`);
}

if (errors.length) {
  console.error(`\n❌ 存储键与隐私页不一致（${errors.length} 个问题）：\n`);
  for (const e of errors) console.error(`   ${e}`);
  console.error('\n   源码扫描逻辑在 scripts/lib/storage-keys.mjs，文案在 scripts/build-pages.mjs 的 privacy 段。\n');
  process.exit(1);
}

console.log(`✅ 存储键与隐私页一致：${keys.length} 个键全部有说明`);
console.log(`   ${keys.join(' · ')}`);
