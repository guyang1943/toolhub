// 本地事件底座（v3.20）
//
// 为什么不接统计服务：analytics.json 的 provider 是 `none`，全站零第三方请求——
// 这是立站时就定下的，不为「多一个全局留存数字」破例。
// 少了服务，指标只能在本机算，而这恰好够用：我们真正想回答的是
// 「这个工具在真实使用中多大比例跑成功」，不是「有多少人访问过」。
// 前者本机就能算准，后者本来也不该由这个站去数。
//
// 只记三样：工具 id、事件类型、时间戳。
//   **不存任何输入内容**，也不存文件大小、报错文本——报错文本里可能带着用户粘贴的内容，
//   一旦落盘就等于把「输入不会离开设备」这句承诺换成「输入会留在设备里，只是不上传」。
//   两者差别很大，不给自己留下解释空间。
//
// 存储上限 200 条（环形缓冲）。超了从头部丢，不做压缩、不做增量聚合：
// 写入路径必须短，聚合放在读取时算。
import { get, set, del } from './store.js';

const KEY = 'events';
const MAX = 200;

/** 记录一个事件。失败一律静默——指标不能影响工具本身能不能用。 */
export function record(tool, event) {
  if (!tool || !event) return;
  try {
    const list = read();
    list.push({ tool, event, ts: Date.now() });
    if (list.length > MAX) list.splice(0, list.length - MAX);
    set(KEY, list);
  } catch {
    /* 隐私模式禁用存储、配额满：丢掉这一次，不报错 */
  }
}

/** 读回最近的事件（旧的在前）。任何脏数据都当没有。 */
export function read() {
  const list = get(KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && typeof e.tool === 'string' && typeof e.event === 'string' && Number.isFinite(e.ts));
}

export function clear() {
  del(KEY);
}

/**
 * 按工具聚合。返回 [{tool, runs, ok, rate}]，按 runs 降序。
 * rate 是「跑成功的比例」，样本不足 3 次不给比例——一次失败就报 0% 是在骗人。
 */
export function summary() {
  const by = new Map();
  for (const e of read()) {
    const s = by.get(e.tool) || { tool: e.tool, runs: 0, ok: 0 };
    s.runs += 1;
    if (e.event === 'ok') s.ok += 1;
    by.set(e.tool, s);
  }
  return [...by.values()]
    .map((s) => ({ ...s, rate: s.runs >= 3 ? Math.round((s.ok / s.runs) * 100) : null }))
    .sort((a, b) => b.runs - a.runs);
}

export const MAX_EVENTS = MAX;
