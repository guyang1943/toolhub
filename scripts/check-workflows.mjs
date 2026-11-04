#!/usr/bin/env node
// 工作流的构建期闸门（v3.23）
//
// 存在的理由只有一条：**参数漂移**。
//   工作流把工具按顺序接起来，而工具是会改的——表单里删掉一个选项、把滑块上限从 95 调到 90、
//   把输入项改名，流程那几行 JSON 不会跟着变。这类漂移在运行时表现为「点了运行，第一步就抛异常」，
//   或者更糟：不抛异常，只是输出一个看起来正常但错的结果。
//   所以凡是能静态判定的，一律在这里拦下来，而不是等用户点。
//
// 能静态判定的：
//   · 工具存不存在、是不是本地执行（外链工具没有 run.js，接不上）
//   · args 的键在不在 manifest.inputs 里，值是否落在枚举 / 上下限内
//   · 每个输入是否都有确定的值（args / bind / 默认值 / 唯一同类口自动接）
//   · bind 的引用写法是否合法、首步有没有引用「上一步」
//   · 流程入口接受的类型，第一步吃不吃得下
// 不能静态判定的（不要假装能）：
//   · 上一步实际产出的是文件还是文本 —— 只有跑起来才知道
//
// 用法：node scripts/check-workflows.mjs [--quiet]
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readManifest } from './lib/tool-manifest.mjs';
import { validateArgs, planStep, parseRef, acceptMismatch, REF_FORMS } from '../assets/lib/workflow-core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const rel = 'workflows/workflows.json';
const errors = [];
const warns = [];
const err = (m) => errors.push(m);

/* ---------------- 载入 ---------------- */
let data;
try {
  data = JSON.parse(readFileSync(join(root, rel), 'utf8'));
} catch (e) {
  console.error(`\n❌ 读不到 ${rel}：${e.message}\n`);
  process.exit(1);
}
const localTools = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools;
const localIds = new Set(localTools.map((t) => t.id));
const dirIds = new Set(JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8')).tools.map((t) => t.id));

const flows = Array.isArray(data.flows) ? data.flows : [];
if (!flows.length) err(`${rel} 里没有 flows——工作流页面会是一片空白`);
if (flows.length > 0 && !data.version) err(`${rel} 缺 version 字段`);

/* ---------------- 逐条流程 ---------------- */
const seen = new Set();
const manifestCache = new Map();
const manifestOf = (id) => {
  if (!manifestCache.has(id)) manifestCache.set(id, readManifest(id, root));
  return manifestCache.get(id);
};

const summary = [];

for (const [i, f] of flows.entries()) {
  const at = `flows[${i}]`;
  if (!f || typeof f !== 'object') {
    err(`${at} 不是对象`);
    continue;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id || '')) err(`${at}.id = ${JSON.stringify(f.id)} 必须是 kebab-case`);
  if (seen.has(f.id)) err(`${at}.id = ${f.id} 重复`);
  seen.add(f.id);
  for (const k of ['name', 'goal', 'detail']) {
    if (!f[k] || typeof f[k] !== 'string') err(`${at}.${k} 必填（人读的一句话）`);
  }
  if (!f.input || typeof f.input !== 'object') {
    err(`${at}.input 必填——流程总得有个入口`);
    continue;
  }
  if (!['file', 'text'].includes(f.input.kind)) err(`${at}.input.kind 只能是 file 或 text`);
  if (f.input.kind === 'file' && !f.input.accept) err(`${at}.input.accept 必填（文件流程要说明收什么）`);
  if (f.input.kind === 'text' && !f.input.label) err(`${at}.input.label 必填（文本流程要说明粘什么）`);

  const steps = Array.isArray(f.steps) ? f.steps : [];
  if (steps.length < 2) err(`${at}.steps 至少两步——一步的事不需要工作流，直接打开那个工具更省事`);
  if (steps.length > 6) err(`${at}.steps 超过 6 步：链路越长，中间产物对不上的机会越多`);

  const lines = [];
  for (const [j, step] of steps.entries()) {
    const where = `${f.id} 第 ${j + 1} 步`;
    if (!step.tool) {
      err(`${where} 缺 tool`);
      continue;
    }
    if (dirIds.has(step.tool) && !localIds.has(step.tool)) {
      err(`${where}：${step.tool} 是外链目录工具，没有 run.js，工作流接不上`);
      continue;
    }
    if (!localIds.has(step.tool)) {
      err(`${where}：工具 ${step.tool} 不存在（tools/tools.json 里没有）`);
      continue;
    }
    if (!existsSync(join(root, 'tools', step.tool, 'run.js'))) {
      err(`${where}：tools/${step.tool}/run.js 不存在`);
      continue;
    }
    const mf = manifestOf(step.tool);
    if (!mf.ok) {
      err(`${where}：读不出 ${step.tool} 的 manifest（${mf.error}）——没有它就无法校验参数`);
      continue;
    }
    const src = readFileSync(join(root, 'tools', step.tool, 'run.js'), 'utf8');
    if (!/export\s+(async\s+)?function\s+run\b/.test(src)) err(`${where}：tools/${step.tool}/run.js 没有导出 run()`);

    for (const e of validateArgs(mf.manifest, step)) err(`${where}：${e}`);

    const plan = planStep(mf.manifest, step, j);
    for (const e of plan.errors) err(`${where}：${e}`);

    // 首步引用「上一步」= 一定取不到值，属于写错了而不是运行期才知道的事
    if (j === 0) {
      for (const v of plan.values) {
        const r = parseRef(v.ref);
        if (r && r.stage === 1) err(`${where} 是第一步，却绑定了「上一步」的 ${v.ref}——第一步没有上一步`);
      }
    }

    // 入口类型与首步是否兼容
    if (j === 0 && f.input.kind === 'file') {
      const firstFile = (mf.manifest.inputs || []).find((x) => x.type === 'file');
      if (!firstFile) err(`${f.id} 的入口收文件，但第一步 ${step.tool} 没有文件输入`);
      else {
        const bad = acceptMismatch(f.input.accept, firstFile.accept);
        if (bad.length) {
          err(
            `${f.id} 的入口写了 ${f.input.accept}，但第一步 ${step.tool} 只收 ${firstFile.accept}——` +
              `用户选了 ${bad.join(' / ')} 会在第一步失败`
          );
        }
      }
    }
    if (j === 0 && f.input.kind === 'text') {
      const firstText = (mf.manifest.inputs || []).find((x) => ['textarea', 'text'].includes(x.type));
      if (!firstText) err(`${f.id} 的入口收文本，但第一步 ${step.tool} 没有文本输入`);
    }

    const binds = plan.values.filter((v) => v.from === 'bind' || v.from === 'auto');
    lines.push(
      `   ${j + 1}. ${step.tool}${step.note ? ' — ' + step.note : ''}` +
        (binds.length ? `\n      接：${binds.map((b) => `${b.name}←${b.ref}`).join('，')}` : '')
    );
  }

  if (!f.cost) warns.push(`${f.id} 没写 cost（给用户一个「大概要等多久」的预期）`);
  summary.push({ id: f.id, name: f.name, steps: steps.length, lines });
}

/* ---------------- 输出 ---------------- */
if (errors.length) {
  console.error(`\n❌ 工作流校验失败（${errors.length} 个问题）：\n`);
  for (const e of errors) console.error(`   · ${e}`);
  console.error(`\n   绑定写法只有这几种：${REF_FORMS.join(' / ')}`);
  console.error('   「每个输入都得有值」是硬规则：流程不能在中途停下来问人。\n');
  process.exit(1);
}

if (!quiet) {
  console.log(`\n🧩 工作流：${flows.length} 条，全部通过静态校验`);
  for (const s of summary) {
    console.log(`   ▸ ${s.name}（${s.id}）· ${s.steps} 步`);
    for (const l of s.lines) console.log(l);
  }
  for (const w of warns) console.log(`   ⚠️ ${w}`);
}
