// 访问事件上报（v3.36）
//
// 为什么自己写一个，而不是接统计 SDK：
//   1. 第三方脚本要么写 Cookie，要么拿不到我们要的漏斗（路径 → 进工具 → 真的跑完）。
//   2. 它必须是「关得掉」的：本机开关（no-analytics）、Do Not Track、断网，三种情况都直接不发。
//   3. 它不能拖累站点：走 sendBeacon，失败一律静默——统计挂掉不该让工具跑不起来。
//
// 只发四样：路径、事件名、本机随机号、时间戳。
//   **不发输入内容、不发文件名、不发来源页、不发屏幕尺寸。**
//   本机随机号存在 localStorage 的 visitor 键（登记在 store-keys.js，可在 /my/ 里看见并删掉）。
//   它不是「用户 ID」——没有账号、不跨站、换设备就是另一个人，删掉就换一个新的。
//
// 事件只有五种，多一个都要先问「拿它做什么决定」：
//   view       打开一个页面
//   tool_open  打开某个工具的详情页
//   run        工具真的跑完了（成功与失败都算，失败在工具侧另记）
//   result     点了结果操作（复制 / 下载）
//   outbound   点了外链工具（跳去第三方站点）
import { get, set } from './store.js';

const ENDPOINT = '/api/e';
const VISITOR_KEY = 'visitor';

function optedOut() {
  try {
    return get('no-analytics', false) === true;
  } catch {
    return true; // 读不出来就当用户关掉了：宁可不统计
  }
}

function dnt() {
  return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1';
}

/** 本机随机号：首次访问生成，之后复用。只用来区分设备，不做指纹。 */
function visitor() {
  let v = get(VISITOR_KEY);
  if (typeof v === 'string' && v.length >= 8) return v;
  try {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    v = Array.from(a, (n) => n.toString(16).padStart(2, '0')).join('');
    set(VISITOR_KEY, v);
  } catch {
    v = 'anon'; // 没有 crypto 就不区分设备，仍然可以统计页面访问量
  }
  return v;
}

/** 发一个事件。任何失败都不抛出——调用方不该为统计写 try/catch。 */
export function track(event) {
  if (!event) return;
  // 构建期开关（window.__TH_BEACON__ 由 build-pages 按 analytics.json 的 beacon 字段注入）。
  // 为什么要它：站点现在发布在 GitHub Pages，没有服务端；不开开关就发请求，每次加载都会
  // 打一个 404，而那条请求仍然带着 IP 到 GitHub 的边缘——与隐私页「不存 IP」的说法不符。
  // 所以默认关闭，切到 Workers（有 /api/e）之后再打开。
  if (!window.__TH_BEACON__) return;
  try {
    if (navigator.onLine === false) return;
    if (optedOut() || dnt()) return;
    const body = JSON.stringify({ e: event, p: location.pathname, v: visitor(), t: Date.now() });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    // sendBeacon 不可用（老浏览器 / 被拦截）时退回 fetch，keepalive 保证跳转时也能发出
    fetch(ENDPOINT, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {});
  } catch {
    /* 统计失败绝不影响工具本身 */
  }
}

/** 页面级初始化：记一次 view。由 app.js 动态加载本模块后调用。 */
export function init() {
  track('view');
}
