#!/usr/bin/env node
// 工具注册表同步：把 tools/<id>/tool.json 的分片元数据合并成 tools/tools.json
//
// 为什么要有这一步（v2.8 平台化）：
//   以前新增一个工具要改 tools/tools.json 这个中心文件，第三方贡献者一改就冲突。
//   现在每个工具自带 tool.json，tools/tools.json 变成**派生产物**（构建/校验前自动重算），
//   贡献者只需要提交自己那个目录，不碰公共文件。
//
// 用法：
//   node scripts/sync-tools.mjs          # 重新生成 tools/tools.json
//   node scripts/sync-tools.mjs --check  # 只检查是否需要同步（CI 用，不一致时退出码 1）
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(root, 'tools');
const OUT = join(TOOLS, 'tools.json');
const REG = join(TOOLS, 'registry.json');

/** 读取 tools/ 下所有带 tool.json 的目录（目录名就是工具 id） */
export function readToolShards() {
  const shards = [];
  for (const name of readdirSync(TOOLS, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const p = join(TOOLS, name.name, 'tool.json');
    if (!existsSync(p)) continue;
    shards.push({ dir: name.name, path: p, meta: JSON.parse(readFileSync(p, 'utf8')) });
  }
  return shards;
}

/** 按 registry.order 排序；未登记的 id 追加到末尾（按 id 字典序，保证幂等） */
export function buildToolsJson() {
  const reg = JSON.parse(readFileSync(REG, 'utf8'));
  const shards = readToolShards();
  const byId = new Map(shards.map((s) => [s.meta.id, s.meta]));
  const order = (reg.order || []).filter((id) => byId.has(id));
  const rest = [...byId.keys()].filter((id) => !order.includes(id)).sort();
  const tools = [...order, ...rest].map((id) => {
    const m = byId.get(id);
    // 字段顺序固定，避免每次生成 diff 抖动
    const out = { id: m.id, name: m.name, desc: m.desc, category: m.category, source: m.source, license: m.license };
    if (m.runtime) out.runtime = m.runtime;
    if (m.tags) out.tags = m.tags;
    if (m.hot) out.hot = true;
    if (m.aliases) out.aliases = m.aliases;
    // 第三方贡献的工具带上署名与入口，页面会显示「社区贡献」
    if (m.author) out.author = m.author;
    if (m.homepage) out.homepage = m.homepage;
    if (m.since) out.since = m.since;
    return out;
  });
  return {
    payload: { version: reg.version, categories: reg.categories, featured: reg.featured, tools },
    order,
    unknown: rest,
    shardCount: shards.length,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes('--check');
  const { payload, unknown, shardCount } = buildToolsJson();
  const text = JSON.stringify(payload, null, 2);
  const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const same = old.trim() === text.trim();
  if (unknown.length) console.log(`   ⚠ 未登记在 registry.order 的工具（已追加到末尾）：${unknown.join(', ')}`);
  if (check) {
    if (!same) {
      console.log('❌ tools/tools.json 与分片元数据不一致，请运行：node scripts/sync-tools.mjs');
      process.exit(1);
    }
    console.log(`✅ 注册表已同步（${shardCount} 个工具分片）`);
  } else {
    if (same) {
      console.log(`✅ 已是同步状态（${shardCount} 个工具分片）`);
    } else {
      writeFileSync(OUT, text, 'utf8');
      console.log(`✅ 已生成 tools/tools.json（${shardCount} 个工具分片）`);
    }
  }
}
