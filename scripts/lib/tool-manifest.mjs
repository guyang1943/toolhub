// 工具清单加载器：从 tools/<id>/run.js 里取出 manifest，并尽量给出出错字段的**源码行号**
//
// 两个机制各管一件事：
//   1. 求值（vm）：拿到真实值。有些工具的 manifest 是算出来的（options: ZONES.map(...)），
//      静态解析拿不到，只有在沙箱里跑一遍才准。
//   2. 定位（parsePositions）：把对象字面量逐节点扫一遍，记下每个字段的行列。
//      纯数据字面量能给出精确行号；遇到表达式则退化为「该字段所在的起始行」，不会误导。
//
// 沙箱里只注入浏览器 API 的空壳，够 manifest 这类顶层常量求值；文件里的 run() 不会被调用。

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** 浏览器全局的空壳：足够让顶层常量求值，碰 DOM 也不会炸 */
function makeSandbox() {
  const noop = () => {};
  const el = () => ({
    style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    innerHTML: '',
    textContent: '',
  });
  const document = {
    createElement: el,
    createElementNS: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: noop,
    head: el(),
    body: el(),
    documentElement: el(),
  };
  return {
    document,
    window: { addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    navigator: { clipboard: { writeText: async () => {} }, language: 'zh-CN' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    location: { href: '', search: '', pathname: '/' },
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Blob: class Blob {},
    crypto: globalThis.crypto,
    atob,
    btoa,
  };
}

/** 去掉顶层 import，把 export 前缀换成普通声明，让 ESM 源码能在 vm 里当脚本跑 */
function toScript(src) {
  return src
    .replace(/^import\s+[^;\n]*?;?\s*$/gm, '') // 顶层 import（模板字符串里的 Python import 也在这被清掉，不影响 manifest）
    .replace(/^export\s+(const|let|var|function|class|async\s+function)/gm, '$1');
}

const MANIFEST_RE = /export\s+const\s+manifest\s*=\s*/;

/** 在源码里找 manifest 对象字面量的起始位置（{ 的下标） */
function manifestStart(src) {
  const m = MANIFEST_RE.exec(src);
  if (!m) return -1;
  let i = m.index + m[0].length;
  while (i < src.length && /\s/.test(src[i])) i++;
  return src[i] === '{' ? i : -1;
}

/**
 * 定位解析：给 manifest 字面量里每个节点记下行号。
 * 路径格式与校验器一致（inputs[2].default）。不可解析的表达式标记为 opaque，只记起始位置。
 * @returns {Map<string, {line:number, col:number}>}
 */
export function parsePositions(text, startLine) {
  const pos = new Map();
  let i = 0;
  const lineOf = (idx) => {
    let n = startLine;
    for (let k = 0; k < idx; k++) if (text.charCodeAt(k) === 10) n++;
    const lastNl = text.lastIndexOf('\n', idx - 1);
    return { line: n, col: idx - (lastNl + 1) + 1 };
  };
  const ws = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith('//', i)) {
        const nl = text.indexOf('\n', i);
        i = nl < 0 ? text.length : nl + 1;
        continue;
      }
      if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i);
        i = end < 0 ? text.length : end + 2;
        continue;
      }
      break;
    }
  };
  // 跳过一个表达式：直到本层的 , } ] 为止
  function skipExpr() {
    let depth = 0;
    let q = null;
    let esc = false;
    while (i < text.length) {
      const c = text[i];
      if (q) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === q) q = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        q = c;
        i++;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) return;
        depth--;
      } else if (c === ',' && depth === 0) return;
      i++;
    }
  }
  function parseString() {
    const q = text[i];
    let out = '';
    i++;
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\\') {
        out += text[i + 1];
        i += 2;
        continue;
      }
      out += text[i];
      i++;
    }
    i++;
    return out;
  }
  function parseValue(path) {
    ws();
    pos.set(path, lineOf(i));
    const c = text[i];
    if (c === '{') return parseObject(path);
    if (c === '[') return parseArray(path);
    if (c === '"' || c === "'") return parseString();
    // 数字 / 布尔 / null / 表达式
    const save = i;
    skipExpr();
    const raw = text.slice(save, i).trim();
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    return undefined; // 表达式：值交给 vm，位置只记起始行
  }
  function parseObject(path) {
    const obj = {};
    i++; // {
    for (;;) {
      ws();
      if (i >= text.length || text[i] === '}') {
        i++;
        return obj;
      }
      const before = i;
      let key;
      if (text[i] === '"' || text[i] === "'") key = parseString();
      else {
        // 未加引号的键：允许中文（有些工具的 example 用了中文键），读到分隔符为止
        const start = i;
        while (i < text.length && !/[\s:,{}[\]]/.test(text[i]) && text[i] !== '"' && text[i] !== "'") i++;
        key = text.slice(start, i);
      }
      ws();
      const keyPath = path ? `${path}.${key}` : key;
      pos.set(keyPath, lineOf(i));
      if (text[i] === ':') {
        i++;
        obj[key] = parseValue(keyPath);
      }
      ws();
      if (text[i] === ',') i++;
      // 防御：解析器卡住时立刻报错，而不是死循环拖垮构建
      if (i <= before) throw new Error(`manifest 解析卡住（偏移 ${i}），附近内容：${JSON.stringify(text.slice(i, i + 40))}`);
    }
  }
  function parseArray(path) {
    const arr = [];
    i++; // [
    let n = 0;
    for (;;) {
      ws();
      if (i >= text.length || text[i] === ']') {
        i++;
        return arr;
      }
      const before = i;
      arr.push(parseValue(`${path}[${n}]`));
      n++;
      ws();
      if (text[i] === ',') i++;
      if (i <= before) throw new Error(`manifest 数组解析卡住（偏移 ${i}）`);
    }
  }
  parseValue('');
  return pos;
}

/** 截取从 startIndex 开始的一个平衡的 {...} 块（跳过字符串内部的花括号） */
function sliceBalanced(src, startIndex) {
  let depth = 0;
  let q = null;
  let esc = false;
  for (let j = startIndex; j < src.length; j++) {
    const c = src[j];
    if (q) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(startIndex, j + 1);
    }
  }
  return null;
}

/**
 * 读取一个工具的 manifest
 * @returns {{ok:boolean, manifest?:object, file:string, line?:number, error?:string}}
 */
export function readManifest(id, root) {
  const file = `${root}/tools/${id}/run.js`;
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, file, error: '文件不存在' };
  }
  const idx = manifestStart(src);
  if (idx < 0) {
    return { ok: false, file, error: '未找到 `export const manifest = {`（必须写成对象字面量）' };
  }
  const startLine = src.slice(0, idx).split('\n').length;

  // 求值：优先整体沙箱（能覆盖 options 由常量推导的情况）
  let manifest = null;
  let firstError = '';
  const attempts = [
    () => {
      const code = `${toScript(src)}\n;globalThis.__manifest__ = typeof manifest !== 'undefined' ? manifest : null;`;
      const ctx = vm.createContext(makeSandbox());
      vm.runInContext(code, ctx, { timeout: 3000, filename: file });
      return ctx.__manifest__;
    },
    () => {
      // 退化路径：只求值 manifest 字面量本身
      const lit = sliceBalanced(src, idx);
      if (!lit) throw new Error('manifest 的花括号不配对');
      return vm.runInNewContext(`(${lit})`, makeSandbox(), { timeout: 3000 });
    },
  ];
  for (const attempt of attempts) {
    try {
      manifest = attempt();
      if (manifest && typeof manifest === 'object') break;
    } catch (e) {
      firstError = firstError || e.message;
    }
  }
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, file, line: startLine, error: `manifest 求值失败：${firstError || '结果不是对象'}` };
  }

  // 定位：解析字面量拿行列（失败就只给起始行）
  let positions = new Map();
  const lit = sliceBalanced(src, idx);
  if (lit) {
    try {
      positions = parsePositions(lit, startLine);
    } catch {
      positions = new Map();
    }
  }
  return { ok: true, manifest, file, line: startLine, positions, source: src };
}

/** 把校验器的字段路径映射成源码行号（找不到时回退到最近的父级，最后回退到 manifest 起始行） */
export function lineOfPath(positions, path, fallback) {
  if (!positions) return fallback;
  let p = path;
  while (p) {
    const hit = positions.get(p);
    if (hit) return hit.line;
    // 逐级去掉最后一段：inputs[2].default → inputs[2] → inputs → ''
    const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
    p = cut > 0 ? p.slice(0, cut) : p === '' ? '' : '';
    if (cut <= 0) break;
  }
  return fallback;
}
