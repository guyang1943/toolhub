#!/usr/bin/env node
// 搜索别名词条生成：为每个工具计算拼音全拼/首字母/英文关键词，写入 tools/<id>/tool.json 与 directory.json 的 aliases 字段
// 用法：node scripts/gen-search-aliases.mjs
// 说明：构建期一次性生成，运行时零依赖；新增/改名工具后重跑即可。多音字只取一个默认读音，
//       高频多音字在下方 EXTRA 里手工补常见读音。
//       v2.8 起本地工具元数据按分片存放，别名写回分片；tools/tools.json 由 sync-tools.mjs 派生。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pinyin = require('./vendor/tiny-pinyin/dist/index.js');
import { spokenAliases } from './lib/search-lexicon.mjs';

// 多音字补丁（工具名里的高频词，补上另一个常见读音的全拼）
const EXTRA = {
  强密码生成: ['qiangmimashengcheng', 'qiangmima'],
};

// 取名称中的中文片段，转拼音全拼 + 首字母
function zhAliases(name) {
  const segs = name.match(/[\u4e00-\u9fff]+/g);
  if (!segs) return [];
  const out = new Set();
  const allParts = [];
  for (const seg of segs) {
    const full = pinyin.convertToPinyin(seg, '-', true);
    if (!full || /[^a-z-]/.test(full)) continue;
    const parts = full.split('-').filter(Boolean);
    allParts.push(...parts);
    out.add(full.replace(/-/g, ''));
    out.add(parts.map((p) => p[0]).join(''));
  }
  if (allParts.length > 1) out.add(allParts.map((p) => p[0]).join(''));
  return [...out];
}

// 英文关键词：取 i18n.json 英文名的整串与拆词
const i18n = JSON.parse(readFileSync(join(root, 'i18n.json'), 'utf8'));
const enTools = (i18n.en && i18n.en.tools) || {};

/** 给单个工具算别名，返回去重后的数组（顺序稳定，便于增量 diff） */
function aliasesFor(t) {
  const alias = new Set(zhAliases(t.name));
  (EXTRA[t.name] || []).forEach((a) => alias.add(a));
  // v3.11：口语说法也进别名（「瘦身」→ 图片压缩）。放在拼音之后、英文之前，
  // 顺序稳定，增量 diff 时不会整段翻掉。
  spokenAliases(t.name, t.tags).forEach((a) => alias.add(a));
  const enName = enTools[t.id] && enTools[t.id].name;
  if (enName) {
    alias.add(enName.toLowerCase());
    enName
      .split(/[\s/·\-—]+/)
      .filter((w) => w.length > 1)
      .forEach((w) => alias.add(w.toLowerCase()));
  }
  return [...alias].filter(Boolean);
}

// 本地工具：逐分片写回
{
  const reg = JSON.parse(readFileSync(join(root, 'tools/registry.json'), 'utf8'));
  const known = new Set(reg.order || []);
  let count = 0;
  let total = 0;
  for (const name of readdirSync(join(root, 'tools'), { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const p = join(root, 'tools', name.name, 'tool.json');
    if (!existsSync(p)) continue;
    total++;
    const meta = JSON.parse(readFileSync(p, 'utf8'));
    if (!known.has(meta.id)) console.log(`  ⚠ ${meta.id} 未登记在 registry.order，会被追加到列表末尾`);
    const arr = aliasesFor(meta);
    if (arr.length) {
      meta.aliases = arr;
      count++;
    } else {
      delete meta.aliases;
    }
    writeFileSync(p, JSON.stringify(meta, null, 2) + '\n');
  }
  console.log(`tools/<id>/tool.json: ${count}/${total} 个工具生成别名`);
}

// 目录工具：仍是单文件
{
  const p = join(root, 'tools/directory.json');
  const data = JSON.parse(readFileSync(p, 'utf8'));
  let count = 0;
  for (const t of data.tools) {
    const arr = aliasesFor(t);
    if (arr.length) {
      t.aliases = arr;
      count++;
    } else {
      delete t.aliases;
    }
  }
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  console.log(`tools/directory.json: ${count}/${data.tools.length} 个工具生成别名`);
}

console.log('完成。搜索匹配逻辑见 assets/app.js 的 toolScore()。');
