#!/usr/bin/env node
// 校验「浏览器里存了什么」这件事的四处说法是否一致（v3.20 建立，v3.22 四向闭合）
//
// 起因不是文案笔误，是两份事实各自维护：
//   代码里 saveDraft() 写 `toolhub:draft:<id>`，隐私页却说「输入只存在于内存」。
// 行为对、说法错。更麻烦的是这类不一致没人会主动发现——它不会报错，只会让
// 「你的输入不会离开这台设备」这句话慢慢失去分量。
//
// 现在有四个方向要闭合（详见 scripts/lib/storage-keys.mjs 的注释）：
//   ① 清单 → 源码：没有死键
//   ② 源码 → 清单：没有未申报的键
//   ③ 清单 → 隐私页：键表逐条列出，且行数与清单一致
//   ④ 除了 store.js / store-keys.js，没有裸的 `'toolhub:'` 字面量
//
// 用法：node scripts/check-storage-keys.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkStorageKeys, auditStorageKeys } from './lib/storage-keys.mjs';
import { KEYS } from '../assets/lib/store-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, 'privacy', 'index.html'))) {
  console.error('\n❌ 找不到 privacy/index.html —— 先跑 node scripts/build-pages.mjs\n');
  process.exit(1);
}

const { keys, problems } = checkStorageKeys(root);
const a = auditStorageKeys(root);
const errors = [...problems];

// ③ 的加强版：不只看「提到了没有」，还看行数。手抄的表在加键那天不会自动长出一行。
const html = readFileSync(join(root, 'privacy', 'index.html'), 'utf8');
const rows = (html.match(/<tr><td><code>toolhub:/g) || []).length;
if (rows !== KEYS.length) {
  errors.push(`隐私页键表 ${rows} 行，清单 ${KEYS.length} 个键 —— 表是从清单渲染的，行数对不上说明有人改过产物或绕过了渲染`);
}

if (errors.length) {
  console.error(`\n❌ 存储键四处不一致（${errors.length} 个问题）：\n`);
  for (const e of errors) console.error(`   ${e}`);
  console.error('\n   清单在 assets/lib/store-keys.js；读写内核在 assets/lib/store.js；');
  console.error('   隐私页与 /my/ 面板都由清单渲染，不要在页面里手写键名。\n');
  process.exit(1);
}

console.log(`✅ 存储键四处一致：${keys.length} 个键`);
console.log(`   清单 = 源码 = 隐私页表 = /my/ 面板，且没有绕过 store 的裸前缀`);
console.log(`   ${keys.join(' · ')}`);
console.log(`   源码实际读写：${a.used.join(' · ')}`);
