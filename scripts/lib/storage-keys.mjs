// 本机存储键的四向核对（v3.20 建立，v3.22 改成四向闭合）
//
// 起因是一个真实矛盾：隐私页一边说「输入只存在于浏览器内存里」，一边
// `saveDraft()` 把文本输入写进 `toolhub:draft:<id>`。行为是对的、说法是错的，
// 而错的根因不是笔误——是同一份事实写了两遍（代码一处、文案一处），迟早会漂。
//
// v3.20 的做法是「扫源码里的 'toolhub:' 字面量，隐私页必须逐个提到」。它挡住了一类漂移，
// 但漏了一类：**代码用变量拼键名时，扫描根本看不到**。v3.22 把键名收进 store 调用后，
// 恰好换了个前提：只要扫法跟着变，这一类就能看见。
//
// 所以现在四个方向都要闭合，缺一个方向就有一类错能躲过去：
//
//   ① 清单 → 源码：清单里每个键都必须在某处真的被读写。没有就是死键，
//     留在隐私页上等于告诉用户「我们存了这个」而其实早不存了。
//   ② 源码 → 清单：源码里 store 调用的每个键都必须在清单里。
//      不在就会被隐私页漏掉——这正是 v3.20 之前那个 draft 矛盾的产生方式。
//   ③ 清单 → 隐私页：静态正文必须逐个列出（爬虫与禁用 JS 时看到的就是这份）。
//   ④ 源码里不许再有裸的 `'toolhub:...'` 字面量（store.js 自己除外）。
//      这一条是「统一存储层」能不能算落地的唯一证据：只要有一处绕过 store 直写 localStorage，
//      前缀、迁移、兜错就都对它不生效，而它恰恰是最容易出问题的那一处。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KEYS, PREFIX, fullKey } from '../../assets/lib/store-keys.js';

// 只扫浏览器侧代码。vendor 是第三方运行时（Pyodide 等），它有自己的存储机制，不归本站文案管。
const SCAN_DIRS = ['assets', 'assets/lib'];
const SKIP = new Set(['vendor']);
// 允许出现裸 'toolhub:' 字面量的文件：store.js 定义前缀与迁移，store-keys.js 导出前缀常量。
// 其余任何文件出现裸前缀都算绕过统一层。
const PREFIX_OWNERS = new Set(['assets/lib/store.js', 'assets/lib/store-keys.js']);

function listJs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listJs(p));
    else if (name.endsWith('.js') && !name.endsWith('.min.js')) out.push(p);
  }
  return out;
}

function files(root) {
  const out = [];
  for (const dir of SCAN_DIRS) {
    for (const f of listJs(join(root, dir))) out.push({ file: f, rel: f.slice(root.length + 1).replace(/\\/g, '/') });
  }
  return out;
}

// store 的调用点：`store.get('theme')` 这种直接字面量。
// 前面排除 `.` 与标识符字符，否则 `params.set(` 会被当成 store.set。
const CALL_LITERAL = /(?<![.\w])(?:store\.)?(?:get|set|del|has|size)\(\s*'([a-z0-9-]+:?)'/g;
// 键名放常量里的写法：`const KEY = 'events'` 然后 `set(KEY, ...)`，
// 或 `const DRAFT_PREFIX = 'draft:'` 然后 `store.get(DRAFT_PREFIX + id)`。
// 不覆盖这两种，events 与草稿就会被判成「清单里有、代码里没人用」的死键。
const CONST_KEY = /const\s+(\w+)\s*=\s*'([a-z0-9-]+:?)'/g;

/**
 * 扫描源码里**实际使用**的键（去掉前缀的短名）。
 * @returns {{key: string, files: string[]}[]} 按 key 排序
 */
export function scanStoreUsage(root) {
  const found = new Map();
  const add = (key, rel) => {
    if (!found.has(key)) found.set(key, new Set());
    found.get(key).add(rel);
  };
  // 注意 store.js 也要扫：`schema` 这个键就是它自己维护的（读写都用 VER 常量）。
  // 跳过它会得到一个假死键——而假死键比漏检更糟，它教人「把闸门关了就行」。
  for (const { file, rel } of files(root)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(CALL_LITERAL)) add(m[1], rel);
    for (const m of src.matchAll(CONST_KEY)) {
      const name = m[1];
      const key = m[2];
      const re = new RegExp(`(?<![.\\w])(?:store\\.)?(?:get|set|del|has|size)\\(\\s*${name}\\b`);
      if (re.test(src)) add(key, rel);
    }
  }
  return [...found.entries()]
    .map(([key, f]) => ({ key, files: [...f].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * 四向闭合核对。
 * @returns {{
 *   declared: string[], used: string[], rendered: string[],
 *   deadKeys: string[], undeclared: {key:string,files:string[]}[],
 *   missingInPage: string[], extraInPage: string[], rawLiterals: {file:string,key:string}[]
 * }}
 */
export function auditStorageKeys(root) {
  const declared = KEYS.map((k) => k.id);
  const used = scanStoreUsage(root);
  const usedKeys = used.map((u) => u.key);

  // 隐私页静态正文里显式标注的键（<code>toolhub:xxx</code>）。
  // 只认 code 标签里的写法，避免把「toolhub: 前缀」这种叙述当成分键。
  const page = join(root, 'privacy', 'index.html');
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  // 前缀类的写法是 `toolhub:draft:<工具 id>`，末尾那个冒号是键名的一部分（清单里 id 就是 'draft:'），
  // 所以这里只切前缀、不去冒号——去掉的话它与清单里的 'draft:' 对不上，会同时报「漏写」和「多写」。
  const rendered = [...html.matchAll(/<code>(toolhub:[a-z0-9:-]*?)(?:&lt;[^&]*&gt;)?<\/code>/g)].map((m) =>
    m[1].slice(PREFIX.length)
  );

  // 裸字面量：只有 store.js 允许出现 `'toolhub:`。出现别处 = 绕过了统一层。
  const rawLiterals = [];
  for (const { file, rel } of files(root)) {
    if (PREFIX_OWNERS.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/'toolhub:[a-z0-9:-]*'/g)) rawLiterals.push({ file: rel, key: m[0] });
  }

  const usedSet = new Set(usedKeys);
  const declaredSet = new Set(declared);
  const renderedSet = new Set(rendered);

  return {
    declared,
    used: usedKeys,
    rendered: [...renderedSet],
    deadKeys: declared.filter((k) => !usedSet.has(k)),
    undeclared: used.filter((u) => !declaredSet.has(u.key)),
    missingInPage: declared.filter((k) => !renderedSet.has(k)),
    extraInPage: [...renderedSet].filter((k) => !declaredSet.has(k)),
    rawLiterals,
  };
}

/** 合并成一份问题清单，给独立脚本与 verify 直接用 */
export function checkStorageKeys(root) {
  const a = auditStorageKeys(root);
  const problems = [];
  for (const k of a.deadKeys) {
    const meta = KEYS.find((x) => x.id === k);
    problems.push(`${fullKey(meta || { id: k, kind: '' })} 在清单里，但代码里没人读写它 —— 死键，隐私页在说谎`);
  }
  for (const u of a.undeclared) problems.push(`${u.key} 在 ${u.files.join('、')} 里被使用，但清单里没有 —— 隐私页会漏掉它`);
  for (const k of a.missingInPage) problems.push(`隐私页没有列出 ${k}`);
  for (const k of a.extraInPage) problems.push(`隐私页列了 ${k}，但清单里没有`);
  for (const r of a.rawLiterals)
    problems.push(`${r.file} 里还有裸的 ${r.key} —— 绕过 store 直写 localStorage，迁移与兜错都对它不生效`);
  return { keys: a.declared, problems };
}
