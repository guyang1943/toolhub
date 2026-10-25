#!/usr/bin/env node
// 工具清单校验（构建与提交前的唯一闸门）
//
// 用法：
//   node scripts/lint-tools.mjs            # 校验全部工具
//   node scripts/lint-tools.mjs <id>…      # 只校验指定工具（第三方提 PR 前自查）
//   node scripts/lint-tools.mjs --json     # 机器可读输出（提交页/编辑器插件用）
//
// 退出码：0 通过；1 有错误。错误格式为 file:line: [path] message，可直接点进编辑器。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lintTool, toolSize, MAX_TOOL_BYTES } from './lib/tool-lint.mjs';
import { buildToolsJson } from './sync-tools.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const only = args.filter((a) => !a.startsWith('--'));

const schema = JSON.parse(readFileSync(join(root, 'tools', 'schema.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(root, 'tools', 'registry.json'), 'utf8'));
const categories = registry.categories || [];

/** 所有带 run.js 的工具目录 */
export function toolDirs() {
  return readdirSync(join(root, 'tools'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, 'tools', d.name, 'run.js')))
    .map((d) => d.name)
    .sort();
}

const ids = only.length ? only : toolDirs();
const missing = ids.filter((id) => !existsSync(join(root, 'tools', id, 'run.js')));
const errors = [];
for (const id of missing) {
  errors.push({ file: `tools/${id}/run.js`, line: 1, path: '(dir)', message: '工具目录不存在或缺少 run.js' });
}
for (const id of ids.filter((x) => !missing.includes(x))) {
  errors.push(...lintTool(id, { root, schema, categories }));
}

// 注册表一致性：tools/tools.json 必须等于分片派生的结果
const { payload, unknown } = buildToolsJson();
const current = existsSync(join(root, 'tools', 'tools.json')) ? readFileSync(join(root, 'tools', 'tools.json'), 'utf8') : '';
if (current.trim() !== JSON.stringify(payload, null, 2).trim()) {
  errors.push({
    file: 'tools/tools.json',
    line: 1,
    path: 'registry',
    message: '与工具分片不一致（改完 tool.json 请运行 node scripts/sync-tools.mjs）',
  });
}

if (asJson) {
  console.log(JSON.stringify({ ok: errors.length === 0, checked: ids.length, errors }, null, 2));
} else {
  console.log('\n🧪 工具清单校验\n');
  for (const id of ids.filter((x) => !missing.includes(x))) {
    const mine = errors.filter((e) => e.file.startsWith(`tools/${id}/`));
    const kb = Math.round(toolSize(id, root) / 1024);
    if (mine.length) {
      console.log(`  ❌ ${id}  ${mine.length} 个问题（${kb}KB）`);
      for (const e of mine) console.log(`     ${e.file}:${e.line}  [${e.path}] ${e.message}`);
    } else {
      console.log(`  ✅ ${id}  manifest 合规 · ${kb}KB / ${MAX_TOOL_BYTES / 1024}KB`);
    }
  }
  if (unknown.length) console.log(`\n  ⚠ 未登记在 registry.order 的工具：${unknown.join(', ')}（已追加到列表末尾，建议补登记）`);
  const others = errors.filter((e) => !ids.some((id) => e.file.startsWith(`tools/${id}/`)));
  for (const e of others) console.log(`\n  ❌ ${e.file}:${e.line}  [${e.path}] ${e.message}`);
  console.log(errors.length ? `\n❌ ${errors.length} 个问题\n` : `\n✅ 全部通过（${ids.length} 个工具）\n`);
}

process.exit(errors.length ? 1 : 0);
