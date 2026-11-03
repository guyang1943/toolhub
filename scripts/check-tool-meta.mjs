#!/usr/bin/env node
// 校验 tools/directory.json 的边界字段（runtime / privacy / checkedAt / privacyNote）。
// 用法：node scripts/check-tool-meta.mjs
// 单独跑是为了在「没构建」的时候也能查；构建期也会跑一遍（build-pages.mjs 里同一份逻辑）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateToolMeta, metaSummary, PRIVACY_KINDS, PRIVACY_LABEL } from './lib/tool-meta.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirTools = JSON.parse(readFileSync(join(root, 'tools', 'directory.json'), 'utf8')).tools;
const localTools = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8')).tools;

const { errors, warns, stats } = validateToolMeta(dirTools, { localTools });

if (errors.length) {
  console.error(`\n❌ 边界字段校验失败（${errors.length} 个问题）：\n`);
  for (const e of errors) console.error(`   ${e}`);
  console.error('\n   字段语义见 scripts/lib/tool-meta.mjs 顶部注释。\n');
  process.exit(1);
}

for (const w of warns) console.log(`⚠️ ${w}`);
if (stats.oldestDays > 0) console.log(`   最久未复检：${stats.oldestDays} 天`);

const unknown = dirTools.filter((t) => t.privacy === 'unknown');
if (unknown.length) {
  console.log(`⚠️ 仍未核实 ${unknown.length} 条：${unknown.map((t) => t.id).join('、')}`);
}

const byCat = {};
for (const t of dirTools) {
  byCat[t.category] = byCat[t.category] || { local: 0, other: 0 };
  if (t.privacy === 'local') byCat[t.category].local += 1;
  else byCat[t.category].other += 1;
}
const catLine = Object.entries(byCat)
  .map(([c, v]) => `${c} ${v.local}/${v.local + v.other}`)
  .join(' · ');

console.log(`✅ 边界字段：${metaSummary(stats)}`);
console.log(`   各分类「本机处理 / 总数」：${catLine}`);
console.log(`   枚举：${PRIVACY_KINDS.map((k) => `${k}=${PRIVACY_LABEL[k]}`).join(' ')}`);
