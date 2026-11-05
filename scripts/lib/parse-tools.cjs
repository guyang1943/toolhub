#!/usr/bin/env node
// 工具脚本语法闸门（v3.27）：把每个 tools/<id>/run.js 交给 V8 解析一遍，只解析、不执行。
//
// 为什么需要它：run.js 是浏览器里动态 import() 的模块，语法错在构建期完全看不出来——
// 页面照样生成、SEO 正文照样在、verify 的结构断言全过，只有用户打开那个工具页时
// 才看到「工具加载失败：Unexpected identifier」。v3.27 的 media-info 就漏了一个反引号，
// 是浏览器测试打到的，不是构建闸门——这种错该在建站时红。
//
// 为什么用 vm.SourceTextModule 而不是 `node --check`：
//   --check 一次只吃一个文件，62 个工具要起 62 个进程（实测 11.5 秒）；
//   这里一个进程解析全部，0.25 秒，而且不需要 "type": "module"（仓库刻意不加，UMD 会崩）。
//   代价是必须带 --experimental-vm-modules，所以入口里写死了这个参数。
//
// 用法：node --experimental-vm-modules scripts/lib/parse-tools.cjs <root>
// 退出码 0 = 全部可解析；1 = 有文件解析失败（错误逐条打到 stdout）。
const { readdirSync, readFileSync, existsSync } = require('node:fs');
const vm = require('node:vm');

const root = process.argv[2] || process.cwd();
const bad = [];
let n = 0;

for (const dir of readdirSync(root + '/tools')) {
  const file = root + '/tools/' + dir + '/run.js';
  if (!existsSync(file)) continue; // 目录工具（runtime=link）没有 run.js
  n++;
  try {
    // 只构造不 evaluate：构造函数内部就会解析，语法错在这里抛
    new vm.SourceTextModule(readFileSync(file, 'utf8'), { identifier: file });
  } catch (e) {
    bad.push(`${dir}/run.js: ${e.message}`);
  }
}

if (bad.length) {
  console.log(bad.join('\n'));
  process.exit(1);
}
console.log(`OK ${n}`);
