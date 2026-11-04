// 资源库数据的两份文件怎么合起来读。
//
// v3.24 起资源条目被拆成两半，原因是首屏体积：
//
//   resources.json        条目骨架（name / url / source / license / tags / recommended）+ 合集元信息。
//                         它是首屏六个启动 JSON 之一——首页要拿合集标题、说明和条目数量。
//   resources-notes.json  条目的正文（note，为什么值得收藏）。58 条按 gzip 算 3.8 KB，
//                         而正文只在 /resources/<合集>/ 那一页出现，首页一个字节都用不到。
//
// 拆完之后首页不必为「用户可能永远不打开的合集页」付解析时间。代价是两份文件要对得上，
// 所以这里只暴露一个入口：**所有需要正文的地方都从 loadResources 拿合并后的结果**，
// 不要在别处直接读 resources.json 再自己拼——那样漏一条正文不会报错，只会安静地渲染出空段落。
//
// 条目按「合集 slug + 条目名」定位。不用数组下标，是因为往合集中间插一条就会让后面全部错位。

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const NOTES_FILE = 'resources-notes.json';

/**
 * @param {string} root 仓库根目录
 * @param {{strict?: boolean}} [opt] strict=true 时缺正文直接抛错（构建用）
 * @returns {{version:string,updated:string,policy:string,groups:object[],collections:object[]}}
 */
export function loadResources(root, opt = {}) {
  const res = JSON.parse(readFileSync(join(root, 'resources.json'), 'utf8'));
  const p = join(root, NOTES_FILE);
  const notes = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).notes || {} : {};

  const missing = [];
  for (const c of res.collections || []) {
    const bucket = notes[c.slug] || {};
    for (const it of c.items || []) {
      if (typeof it.note === 'string' && it.note) continue; // 兼容「还没拆」的旧数据
      const n = bucket[it.name];
      if (n) it.note = n;
      else missing.push(`${c.slug}/${it.name}`);
    }
  }

  if (opt.strict && missing.length) {
    throw new Error(
      `${NOTES_FILE} 缺少 ${missing.length} 条正文（条目骨架还在，正文没了）：\n  ` +
        missing.join('\n  ') +
        `\n加条目时两份文件都要改：骨架写 resources.json，正文写 ${NOTES_FILE}。`
    );
  }
  res.__missingNotes = missing;
  return res;
}
