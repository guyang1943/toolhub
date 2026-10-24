#!/usr/bin/env node
// 搜索别名词条生成：为每个工具计算拼音全拼/首字母/英文关键词，写入 tools.json 与 directory.json 的 aliases 字段
// 用法：node scripts/gen-search-aliases.mjs
// 说明：构建期一次性生成，运行时零依赖；新增/改名工具后重跑即可。多音字只取一个默认读音，
//       高频多音字在下方 EXTRA 里手工补常见读音。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pinyin = require('./vendor/tiny-pinyin/dist/index.js');

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

for (const file of ['tools/tools.json', 'tools/directory.json']) {
  const p = join(root, file);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  let count = 0;
  for (const t of data.tools) {
    const alias = new Set(zhAliases(t.name));
    (EXTRA[t.name] || []).forEach((a) => alias.add(a));
    const enName = enTools[t.id] && enTools[t.id].name;
    if (enName) {
      alias.add(enName.toLowerCase());
      enName
        .split(/[\s/·\-—]+/)
        .filter((w) => w.length > 1)
        .forEach((w) => alias.add(w.toLowerCase()));
    }
    const arr = [...alias].filter(Boolean);
    if (arr.length) {
      t.aliases = arr;
      count++;
    } else {
      delete t.aliases;
    }
  }
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  console.log(`${file}: ${count}/${data.tools.length} 个工具生成别名`);
}
console.log('完成。搜索匹配逻辑见 assets/app.js 的 toolScore()。');
