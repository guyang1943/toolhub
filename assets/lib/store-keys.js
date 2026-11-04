// 本机存储键的唯一事实来源（v3.22）
//
// 这个文件最先要解释的是：为什么它必须只有一份。
//
// v3.20 之前，隐私页的键清单在三个地方各写了一遍——构建期静态正文、pages.js 的 SPA 渲染、
// 以及代码里真正读写的那几行。三份事实各自维护，结果必然不一样：代码里 saveDraft() 往
// `toolhub:draft:<id>` 写文本，隐私页却说「输入只存在于内存」。这类不一致不会报错，
// 只会让「你的输入不会离开这台设备」这句话慢慢失去分量——而那是本站唯一拿信誉抵押的话。
//
// 所以：清单在这里，读它的人有四个——
//   1. assets/lib/store.js          迁移与清除要按清单走
//   2. assets/app.js                读写键名
//   3. scripts/build-pages.mjs      构建期渲染隐私页静态正文（爬虫与禁用 JS 时看到的就是这份）
//   4. assets/lib/pages.js          站内导航到 /privacy/ 时重渲染的那一份
// 第 3、4 条曾经是两份文案，现在渲染同一个数组。
//
// 新增一个键的正确做法是「只改这个文件」，然后 verify 会告诉你哪一处还没接上。

/** 所有键的公共前缀。改这里等于全站搬家，迁移函数得跟着改。 */
export const PREFIX = 'toolhub:';

// 结构版本号（SCHEMA）**不在这里**，在 store.js。原因是首屏：store.js 被 app.js 静态 import，
// 不能反过来依赖这份 3 KB 的清单；而清单里的每个键都要被展示，它天然属于按需加载那一侧。

/** 分组：/my/ 面板与隐私页按它分类，清除按钮也按它一批批清。 */
export const GROUPS = {
  prefs: '偏好设置',
  library: '我的工具',
  stats: '本机统计',
  draft: '输入草稿',
  internal: '内部状态',
};

/**
 * 键清单。
 *   id    去掉前缀后的键名；kind 为 'prefix' 时是前缀（后面拼工具 id）
 *   kind  string | bool | number | array | object | prefix
 *   what  存的是什么（人话，会直接出现在隐私页与 /my/ 面板）
 *   cap   容量上限（有上限才写，是「不会无限长」的依据）
 *   tail  补充一句，通常用于「不含什么」，这句话比「含什么」更重要
 *   clear 是否提供一键清除。schema 不提供：清了会触发一次迁移，等于自找麻烦
 */
export const KEYS = [
  { id: 'theme', group: 'prefs', kind: 'string', what: '深色 / 浅色偏好', tail: '只有 light 或 dark', clear: true },
  { id: 'lang', group: 'prefs', kind: 'string', what: '界面语言', tail: '只有 zh 或 en', clear: true },
  { id: 'no-analytics', group: 'prefs', kind: 'bool', what: '你是否在本机关闭了访问统计', clear: true },

  { id: 'favs', group: 'library', kind: 'array', what: '收藏的工具 id', cap: '最多 200 条', clear: true },
  { id: 'recent', group: 'library', kind: 'array', what: '最近打开过的工具 id', cap: '最多 8 条', clear: true },
  { id: 'compare', group: 'library', kind: 'array', what: '对比栏里选中的工具 id', cap: '最多 4 条', clear: true },
  { id: 'sets', group: 'library', kind: 'object', what: '你自己命名并存的工具集合', cap: '最多 20 个', clear: true },
  {
    id: 'flows',
    group: 'library',
    kind: 'object',
    what: '你存下来的工作流参数',
    cap: '最多 20 个',
    tail: '只存参数，不存你选的文件与产物',
    clear: true,
  },

  { id: 'usage', group: 'stats', kind: 'object', what: '每个工具在本机用过几次', tail: '只用来排「最常用」', clear: true },
  {
    id: 'events',
    group: 'stats',
    kind: 'array',
    what: '跑成 / 跑挂的记录',
    cap: '最多 200 条',
    tail: '只有工具 id、结果与时间戳，不含任何输入内容，也不含报错原文',
    clear: true,
  },

  { id: 'draft:', group: 'draft', kind: 'prefix', what: '上次填的文本输入', cap: '每条 ≤ 4 KB', tail: '文件从不写入存储', clear: true },

  { id: 'schema', group: 'internal', kind: 'number', what: '存储结构版本号', tail: '升级时据此迁移旧数据', clear: false },
];

/** 展示用的完整键名。prefix 类的用尖括号表示后缀，避免读者以为键名里真有这三个字。 */
export function fullKey(k) {
  return PREFIX + k.id + (k.kind === 'prefix' ? '<工具 id>' : '');
}

/** 按分组归拢，组内保持清单顺序，组间也按清单首次出现的顺序。 */
export function byGroup() {
  const out = [];
  for (const k of KEYS) {
    let g = out.find((x) => x.group === k.group);
    if (!g) {
      g = { group: k.group, label: GROUPS[k.group] || k.group, keys: [] };
      out.push(g);
    }
    g.keys.push({ ...k, full: fullKey(k) });
  }
  return out;
}

/** 可一键清除的键（按分组）。schema 不在里面。 */
export function clearableGroups() {
  return byGroup()
    .map((g) => ({ group: g.group, label: g.label, keys: g.keys.filter((k) => k.clear) }))
    .filter((g) => g.keys.length);
}

/** 纯键名数组，迁移 / 校验用 */
export const KEY_IDS = KEYS.map((k) => k.id);

/**
 * 渲染「浏览器里存了什么」那张表（HTML 片段）。
 *
 * 这个函数放在数据文件里，而不是各页面里，是因为它要解决的问题就是「同一份清单被两处各写一遍」：
 * 构建期的静态正文（爬虫与禁用 JS 时看到的那份）和 SPA 站内跳转后重渲染的那份。
 * 只要有一处手写，两处就会在某个版本里悄悄分叉——v3.20 之前就分过一次：
 * 静态版列了 9 个键，SPA 版漏了 compare，多出来一个没人用的常量。
 *
 * 所以两处都调它。谁要加字段，改这里的 KEYS，别改页面。
 */
export function renderKeyTable() {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = KEYS.map(
    (k) =>
      `<tr><td><code>${esc(fullKey(k))}</code></td>` +
      `<td>${k.what}${k.tail ? `（${k.tail}）` : ''}</td>` +
      `<td>${k.cap || '—'}</td></tr>`
  ).join('');
  return (
    '<table class="cmp-table"><tr><th>键名</th><th>存了什么</th><th>上限</th></tr>' +
    rows +
    '</table>'
  );
}

