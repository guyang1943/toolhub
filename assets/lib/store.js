// 本机存储层（v3.22）
//
// 存在的理由不是「架构好看」，是三个已经在发生、或者随时会发生的具体故障：
//
//   ① 脏数据打挂整页。过去 favs() 直接 JSON.parse(localStorage.getItem('toolhub:favs') || '[]')，
//      只要存储里是半截 JSON（写一半关了页面、旧版本写过别的形状），解析立刻抛错。
//      而 favs() 在 renderChips() 里被调用 → 整个首页渲染中断，白屏。
//      注意后果的量级：不是「收藏没了」，是「站打不开」。
//   ② 格式漂移丢偏好。theme / lang 历史上存的是裸字符串（`dark`），后来改成 JSON。
//      谁先谁后没人记得，而 JSON.parse('dark') 抛错后 get() 兜底返回默认值——
//      于是老用户的深浅色偏好在升级当天静默消失，不报错、不留痕。
//   ③ 清除不彻底。键名散在五个文件里，想做「清除我的数据」得去五个地方各抄一遍，
//      抄漏一个就变成「以为清了、其实没清」——比不做清除更糟。
//
// 所以这一层只做三件事：读写兜错、版本迁移、按清单清除。
// 不做响应式、不做观察者、不做序列化格式的花活——首页为这里付的每一个字节都要有理由。
//
// **首屏成本**：app.js 静态 import 它，所以它进首屏。因此它刻意**不** import store-keys.js
// （那份清单 3 KB，首页一条都用不上）。清单只在 /my/ 与隐私页按需加载。
// 代价是「哪些键是历史裸字符串」这份知识要写在这里，而不是清单里——它本来就属于迁移函数。
const P = 'toolhub:';
const VER = 'schema';

/** 结构版本。字段含义变了才加一；只是新增一个键不用动它。 */
export const SCHEMA = 1;

function raw(k) {
  try {
    return localStorage.getItem(P + k);
  } catch {
    return null; // 隐私模式 / 存储被禁：当作没有，读写全部静默失败
  }
}

/**
 * 读。脏数据一律回默认值。
 * 宁可当作没有，也不能让一个坏字节把整个页面打挂——这是这一层存在的第一理由。
 */
export function get(k, d = null) {
  const v = raw(k);
  if (v === null) return d;
  try {
    return JSON.parse(v);
  } catch {
    return d;
  }
}

/** 写。返回是否成功，但调用方可以不看：失败就是这一次没存上，功能照常用。 */
export function set(k, v) {
  try {
    localStorage.setItem(P + k, JSON.stringify(v));
    return true;
  } catch {
    return false; // 配额满 / 隐私模式
  }
}

export function del(k) {
  try {
    localStorage.removeItem(P + k);
  } catch {
    /* 同上 */
  }
}

export function has(k) {
  return raw(k) !== null;
}

/** 实际存在的全部本站键（含 draft: 这类动态后缀），返回去掉前缀的短名。 */
export function allKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(P)) out.push(k.slice(P.length));
    }
  } catch {
    /* 同上 */
  }
  return out.sort();
}

/**
 * 某个键当前占多少字节。
 * localStorage 按 UTF-16 存，所以「字符数 × 2」比 UTF-8 字节数更贴近配额占用。
 * /my/ 面板显示的是这个数——用户想知道的是「占了我多少地方」，不是「发出去多大」。
 */
export function size(k) {
  const v = raw(k);
  return v === null ? 0 : v.length * 2;
}

// v0 → v1：theme / lang / no-analytics 三个键历史上是裸字符串（`dark`、`1`），
// v1 起统一存 JSON（`"dark"`、`true`）。
//
// 这一步不能省，而且顺序有讲究：必须在任何 get() 之前跑完。
// JSON.parse('dark') 抛错 → get() 兜底返回默认值 → 偏好静默丢失。
// no-analytics 顺手从 '1' / '0' 归一成布尔，否则每个调用点都得写一次 `=== '1'`，
// 而那种写法一旦有一处写成 `== '1'` 或者忘了，就会出现「关了还是统计」。
const LEGACY = { theme: (s) => s, lang: (s) => s, 'no-analytics': (s) => s === '1' };

/**
 * 迁移到当前结构版本。返回转换了几个键。幂等。
 *
 * 这里**不做版本号短路**，是踩过一次才改的：第一版写的是
 * `if (get(VER,0) >= SCHEMA) return 0;`，而 schema 键在第一次访问就写下了，
 * 于是「把 theme 从 JSON 改回裸字符串」这种状态再也不会被修——测试里当场就复现了：
 * 存量 theme 读出来还是 `dark`，而 get() 用 JSON.parse 解析它失败，静默退回系统偏好。
 *
 * 现实中的对应场景是版本回退：用户在 v3.22 访问过（schema=1 已写入），回退到旧版改了主题，
 * 再升回来 —— 偏好丢失，且不报错。这种坑不值得为省 3 次 getItem 留着。
 * 三个键逐次自检「是不是裸格式」，不是就跳过，所以重复调用没有副作用。
 */
export function migrate() {
  let n = 0;
  for (const [k, conv] of Object.entries(LEGACY)) {
    const s = raw(k);
    // 空值、已是 JSON 字符串（" 开头）、已是布尔字面量：都说明不需要转换
    if (s === null || s === '' || s[0] === '"' || s === 'true' || s === 'false') continue;
    try {
      localStorage.setItem(P + k, JSON.stringify(conv(s)));
      n++;
    } catch {
      /* 写不进去就下次启动再说，不阻断页面 */
    }
  }
  if (get(VER, 0) < SCHEMA) set(VER, SCHEMA);
  return n;
}
