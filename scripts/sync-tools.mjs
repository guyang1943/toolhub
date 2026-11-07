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
import { isMainModule } from './lib/is-main.mjs';
import { readManifest } from './lib/tool-manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(root, 'tools');
const OUT = join(TOOLS, 'tools.json');
// v3.30：别名按需加载，不再压首屏（见 buildToolsJson 与 app.js 的 ensureAliasesForSearch）
const ALIAS_OUT = join(TOOLS, 'aliases.json');
// v3.31：端口声明（io）也不进首屏。70 个工具各一对 in/out，压缩后约 1.2 KB，
// 只有「选中一个工具想知道下一步接什么」时才需要——首页一次都用不到。
// 它是 check-workflows 与助手的共用数据源，派生自已手写的 tool.json。
const IO_OUT = join(TOOLS, 'io.json');
const REG = join(TOOLS, 'registry.json');
const CAT_COPY = join(root, 'content', 'categories.json');

/** 分类名 → URL slug。缺文案时返回空对象，构建期那边有硬闸门会直接报错 */
function readCategorySlugs() {
  if (!existsSync(CAT_COPY)) return {};
  const list = JSON.parse(readFileSync(CAT_COPY, 'utf8')).categories || [];
  return Object.fromEntries(list.map((c) => [c.name, c.slug]));
}
const categorySlugs = readCategorySlugs();

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

/** 从 run.js 的 manifest 里取「这个工具能吃哪些文件、能不能吃多个」。
 *  用途是全局拖放路由（v3.1）：只能推荐**真的接受这种文件**的工具，
 *  否则用户点进去会看到「选择文件」却拖不进去。
 *  返回 null 表示不接受文件或清单读不出来（构建期就不写这个字段，保持 JSON 精简）。 */
export function acceptsOf(id) {
  const r = readManifest(id, root);
  if (!r.ok || !r.manifest || !Array.isArray(r.manifest.inputs)) return null;
  const list = [];
  let multiple = false;
  for (const inp of r.manifest.inputs) {
    if (inp.type !== 'file') continue;
    if (inp.multiple) multiple = true;
    for (const a of String(inp.accept || '*').split(',')) {
      const s = a.trim().toLowerCase();
      if (s && !list.includes(s)) list.push(s);
    }
  }
  return list.length ? { accepts: list, multiple } : null;
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
    // v3.30：aliases 不再进 tools.json。拼音全拼/首字母/英文词压缩后约 2.1 KB，
    // 是全站最大的一块可拆启动数据，而首页不搜索时一个字都用不到——它现在按需从
    // tools/aliases.json 取（见 assets/app.js 的 ensureAliasesForSearch）。
    // 派生的「可接收文件类型」：不进 tool.json（那是手写的），由 run.js 的 manifest 算出来
    if (m.runtime !== 'link' && existsSync(join(TOOLS, id, 'run.js'))) {
      const acc = acceptsOf(id);
      if (acc) {
        out.accepts = acc.accepts;
        if (acc.multiple) out.fileMultiple = true;
      }
    }
    // 第三方贡献的工具带上署名与入口，页面会显示「社区贡献」
    if (m.author) out.author = m.author;
    if (m.homepage) out.homepage = m.homepage;
    if (m.since) out.since = m.since;
    return out;
  });
  // 别名单独成文件：键是工具 id，值是别名词条。顺序跟随 tools 的顺序，增量 diff 稳定。
  const aliases = {};
  // 端口单独成文件：键是工具 id，值是 { in, out }。只收本地工具（外链没有 run.js，谈不上端口）。
  const io = {};
  for (const t of [...order, ...rest]) {
    const m = byId.get(t);
    if (m.aliases && m.aliases.length) aliases[t] = m.aliases;
    if (m.io && Array.isArray(m.io.in) && Array.isArray(m.io.out)) io[t] = { in: m.io.in, out: m.io.out };
  }
  return {
    aliases,
    io,
    // v3.13：分类页有独立 URL 后，前端需要「分类名 → slug」的映射组链接。
    // 放在这里而不是 app.js 里硬编码，是为了让 content/categories.json 保持唯一真相：
    // 加一个分类时改那一份文案就够了，前端与构建期都跟着走。
    payload: { version: reg.version, categories: reg.categories, categorySlugs, featured: reg.featured, tools },
    order,
    unknown: rest,
    shardCount: shards.length,
  };
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const { payload, aliases, io, unknown, shardCount } = buildToolsJson();
  const text = JSON.stringify(payload, null, 2);
  // 一行紧凑写法：这两个文件只给程序读，越小越好（都不在首屏，按需取）
  const aliasText = JSON.stringify(aliases);
  const ioText = JSON.stringify(io);
  const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const oldAlias = existsSync(ALIAS_OUT) ? readFileSync(ALIAS_OUT, 'utf8') : '';
  const oldIo = existsSync(IO_OUT) ? readFileSync(IO_OUT, 'utf8') : '';
  const same =
    old.trim() === text.trim() && oldAlias.trim() === aliasText.trim() && oldIo.trim() === ioText.trim();
  if (unknown.length) console.log(`   ⚠ 未登记在 registry.order 的工具（已追加到末尾）：${unknown.join(', ')}`);
  if (check) {
    if (!same) {
      console.log('❌ tools/tools.json（或 aliases.json / io.json）与分片元数据不一致，请运行：node scripts/sync-tools.mjs');
      process.exit(1);
    }
    console.log(`✅ 注册表已同步（${shardCount} 个工具分片 / ${Object.keys(aliases).length} 组别名 / ${Object.keys(io).length} 组端口）`);
  } else {
    if (same) {
      console.log(`✅ 已是同步状态（${shardCount} 个工具分片 / ${Object.keys(aliases).length} 组别名 / ${Object.keys(io).length} 组端口）`);
    } else {
      writeFileSync(OUT, text, 'utf8');
      writeFileSync(ALIAS_OUT, aliasText, 'utf8');
      writeFileSync(IO_OUT, ioText, 'utf8');
      console.log(`✅ 已生成 tools/tools.json、aliases.json、io.json（${shardCount} 个工具分片 / ${Object.keys(aliases).length} 组别名 / ${Object.keys(io).length} 组端口）`);
    }
  }
}
