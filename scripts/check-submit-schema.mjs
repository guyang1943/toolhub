#!/usr/bin/env node
// 校验「投稿规范」与真实数据是否还对得上（v3.18）
//
// 为什么需要这一层：这份 schema 被三处同时读取——前端表单、Issue 模板、这个脚本。
// 三处各说各话的典型症状是「表单填完能过、构建却失败」，而且看起来像数据坏了。
// 所以这里不只验 schema 本身合法，更要验它描述的就是**现在这份数据**：
//
//   ① schema 是合法 JSON Schema（能被共享校验器吃下去）
//   ② collection 的枚举与 resources.json 的 collections[].slug 双向一致
//   ③ 存量 50 条逐条通过 $defs.item —— 证明规范不是凭空写的
//   ④ 前端表单的 ORDER 覆盖了每一个必填项 —— 少一个，用户就永远过不了校验
//   ⑤ Issue 模板与规范同字段 —— 少一个，走模板的人就得填两次
//
// 用法：node scripts/check-submit-schema.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validate } from '../assets/lib/json-schema.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const schema = json('schemas/resource.json');
const resources = json('resources.json');
const errors = [];
const warns = [];

/* ① 规范本身 */

if (schema.type !== 'object') errors.push('schemas/resource.json 顶层 type 应为 object');
if (!schema.$defs || !schema.$defs.item) errors.push('缺 $defs.item —— 存量数据无法校验');

// 拿一个显然不合规的值试一次：校验器如果连这个都放过，说明它没被正确加载
const shouldFail = validate({ collection: 'nope', item: {}, conflict: 'x' }, schema, schema);
if (!shouldFail.length) errors.push('校验器对空投稿包没有报错，schema 可能没被正确引用');

/* ② 合集枚举与真实数据双向一致 */

const schemaSlugs = new Set(schema.properties.collection.enum || []);
const dataSlugs = new Set(resources.collections.map((c) => c.slug));

for (const s of schemaSlugs) if (!dataSlugs.has(s)) errors.push(`schema 里的合集 "${s}" 在 resources.json 中不存在（加了合集忘了改 schema？）`);
for (const s of dataSlugs) if (!schemaSlugs.has(s)) errors.push(`resources.json 的合集 "${s}" 没写进 schema 的 collection.enum（投稿时选不到，只能手改）`);

/* ③ 存量逐条校验 */

let checked = 0;
const byCollection = {};
for (const c of resources.collections) {
  byCollection[c.slug] = c.items.length;
  c.items.forEach((it, i) => {
    checked += 1;
    const errs = validate(it, schema.$defs.item, schema, `${c.slug}[${i}]`);
    for (const e of errs) errors.push(`${c.slug} 第 ${i + 1} 条（${it.name || '无名'}）：${e.path} — ${e.message}`);
  });
}

// 站内查重：两条同样的网址会让读者以为是两个东西
const seen = new Map();
for (const c of resources.collections) {
  for (const it of c.items) {
    const k = String(it.url || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    if (seen.has(k)) warns.push(`网址重复：${it.name} 与 ${seen.get(k)} 指向同一个站（${it.url}）`);
    else seen.set(k, it.name);
  }
}

/* ④ 前端表单覆盖每个必填项 */

const FORM = 'assets/submit-resource.js';
if (!existsSync(join(root, FORM))) {
  errors.push(`缺 ${FORM}`);
} else {
  const src = read(FORM);
  const m = src.match(/const ORDER = \[([^\]]+)\]/);
  if (!m) {
    errors.push('submit-resource.js 里找不到 ORDER（表单渲染顺序）');
  } else {
    const order = m[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
    // 必填项分别落在 item.* 或顶层，这里的键名与 ORDER 里的写法要对上
    const required = [
      ...(schema.required || []).map((k) => (k === 'item' ? null : k)),
      ...((schema.$defs.item.required || []).map((k) => 'item.' + k)),
    ].filter(Boolean);

    for (const r of required) if (!order.includes(r)) errors.push(`必填字段 ${r} 没有出现在表单 ORDER 里 —— 用户永远无法通过校验`);

    // 反向：ORDER 里的字段必须在 schema 里真的有定义，否则渲染出来是空壳
    for (const p of order) {
      const node = p.startsWith('item.') ? schema.$defs.item.properties[p.slice(5)] : schema.properties[p];
      if (!node) errors.push(`表单里的 ${p} 在 schema 中没有定义`);
      else if (node['x-form'] === false) errors.push(`表单渲染了 ${p}，但它标了 x-form:false（这是编辑字段，不该给投稿人）`);
    }

    if (!/from '\.\/lib\/json-schema\.js'/.test(src)) errors.push('资源表单没有复用共享校验器（那「这里通过 = 构建通过」就不成立了）');
    if (!/schemas\/resource\.json/.test(src)) errors.push('资源表单没有加载 schemas/resource.json');
  }
}

/* ⑤ Issue 模板与本规范对齐 */

const TP = '.github/ISSUE_TEMPLATE';
const templates = ['resource.yml', 'tool.yml', 'guide.yml', 'review.yml'];
for (const t of templates) {
  if (!existsSync(join(root, TP, t))) errors.push(`缺 ${TP}/${t}`);
}
if (existsSync(join(root, TP, 'config.yml'))) {
  const cfg = readFileSync(join(root, TP, 'config.yml'), 'utf8');
  // 断言真正的意图，而不是「文件存在就好」：开着空白 issue 等于四条模板白写
  if (!/blank_issues_enabled:\s*false/.test(cfg)) errors.push('config.yml 没关掉空白 issue，四个模板就白写了');
  if (!/toolhub\.bot\.cd\/submit/.test(cfg)) errors.push('config.yml 没有把投稿人引向站内表单（那他们还得手抄一遍）');
}

const resTpl = join(root, TP, 'resource.yml');
if (existsSync(resTpl)) {
  const y = readFileSync(resTpl, 'utf8');
  // 必填项的 label 必须能在模板里找到同名字段，否则「表单填完去模板里还要再填一遍」
  const need = ['资源名称', '网址', '授权方式', '为什么值得收藏', '挂到哪个合集'];
  for (const n of need) if (!y.includes(n)) errors.push(`resource.yml 缺字段「${n}」，与 schemas/resource.json 不同步`);
}

/* 输出 */

if (errors.length) {
  console.error(`\n❌ 投稿规范校验失败（${errors.length} 个问题）：\n`);
  for (const e of errors) console.error(`   ${e}`);
  console.error('\n   规范在 schemas/resource.json，前端在 assets/submit-resource.js，模板在 .github/ISSUE_TEMPLATE/。\n');
  process.exit(1);
}

for (const w of warns) console.log(`⚠️ ${w}`);

const dist = Object.entries(byCollection)
  .map(([k, v]) => `${k} ${v}`)
  .join(' · ');
// v3.23 合并：这里的合集数原本写死「6 个」，内容运营那边加了第 7 个合集后就成了假话。
// 数和分布本来就在 byCollection 里，没有理由手写。
console.log(`✅ 投稿规范一致：${Object.keys(byCollection).length} 个合集 / ${checked} 条存量全部符合 $defs.item`);
console.log(`   分布：${dist}`);
