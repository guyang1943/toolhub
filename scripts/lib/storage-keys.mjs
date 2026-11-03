// 本机存储键的单一事实来源：扫源码，不手写清单。
//
// 起因是一个真实矛盾：隐私页一边说「输入只存在于浏览器内存里」，一边
// `saveDraft()` 把文本输入写进 `toolhub:draft:<id>`。行为是对的、说法是错的，
// 而错的根因不是笔误——是同一份事实写了两遍（代码一处、文案一处），迟早会漂。
//
// 所以这里不维护「键清单常量」，而是每次重新扫一遍 assets 下的源码：
// 任何 `'toolhub:...'` 字面量都是一个真在用的键，隐私页必须逐个提到它。
// 新增存储却忘了写文案会被当场拦住，而不是等三年后有人发现。
//
// 边界：这里只核对**构建产物**（隐私页的静态正文，也是爬虫与禁用 JS 时看到的那份）；
// SPA 渲染出来的那份由 browser-test 在真浏览器里断言，因为它的键名可能是变量插值。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 只扫浏览器侧代码。vendor 是第三方运行时（Pyodide 等），它有自己的存储机制，不归本站文案管。
const SCAN_DIRS = ['assets', 'assets/lib'];
const SKIP = new Set(['vendor']);

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

/**
 * 扫描出所有在用的本机存储键。
 * @returns {{key: string, files: string[]}[]} 按 key 排序
 */
export function scanStorageKeys(root) {
  const found = new Map();
  const re = /'(toolhub:[a-z0-9:-]*)'/g;
  for (const dir of SCAN_DIRS) {
    for (const file of listJs(join(root, dir))) {
      const rel = file.slice(root.length + 1).replace(/\\/g, '/');
      for (const m of readFileSync(file, 'utf8').matchAll(re)) {
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(rel);
      }
    }
  }
  return [...found.entries()]
    .map(([key, files]) => ({ key, files: [...files].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * 每个在用的键是否都写进了隐私页的静态正文。
 * `toolhub:draft:` 在文案里出现为 `toolhub:draft:<工具id>`，前缀比对即可。
 * @returns {{keys: string[], missing: {key: string, files: string[]}[]}}
 */
export function checkStorageKeys(root) {
  const scanned = scanStorageKeys(root);
  const page = join(root, 'privacy', 'index.html');
  const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
  return {
    keys: scanned.map((s) => s.key),
    missing: scanned.filter((s) => !html.includes(s.key)),
  };
}
