// 页面注册表：一处声明「本站有哪些页面」，七个脚本读它（v3.20）
//
// 为什么要有这个文件：
//   新增一个页面，过去要改 7 个脚本——build-pages / gen-sw / verify / smoke / spa-render /
//   browser-test / audit，其中 gen-sw 里同一份清单还写了两遍。漏一处不会报错，只会静默失效：
//   62 个目录工具页当初就是这么成为测试盲区的（页面建出来了，没人测）。
//   「七处接线、漏一处不报错」是这一类问题的共同形状，治法是让清单只有一个来源。
//
// 但这里不是「147 个页面逐条列出来」——那只是把七份清单换成一份更长的清单，仍然会漂。
// 所以分两层：
//   · STATIC_PAGES   路径固定的页面，逐条写清楚（15 个）
//   · PAGE_FAMILIES  由数据生成的页面族，只声明**模式**与策略（6 族，133 个页面）
// 新增工具 / 分类 / 教程会自动落进对应的族，不需要改这里，也不需要改任何脚本。
//
// 字段含义：
//   offline  'core' 首屏必需（装完就能打开首页搜索）| 'full' 进完整离线包 | false 不进
//   audit    是否进全站体检：true / 'all' / 'sample'（抽样，页面太多跑不动）| false
//   smoke    是否进冒烟可达性
//
// 消费方：gen-sw（离线包）、verify（双向闸门）、audit（体检范围）、smoke-test（可达性）、
//         build-pages（生成）。browser-test / spa-render-test 不按清单跑，它们测的是行为，
//         但「某个页面有没有被测到」由 verify 的反向闸门兜底：产物里每个页面都必须在册。

/** 路径固定的页面 */
export const STATIC_PAGES = [
  { path: '/', title: '首页', offline: 'core', audit: true, smoke: true },
  { path: '/tools/', title: '全部工具', offline: 'full', audit: true, smoke: true },
  { path: '/categories/', title: '全部分类', offline: 'full', audit: true, smoke: true },
  { path: '/guides/', title: '教程总览', offline: 'full', audit: true, smoke: true },
  { path: '/topics/', title: '专题总览', offline: 'full', audit: true, smoke: true },
  { path: '/evaluations/', title: '测评总览', offline: 'full', audit: true, smoke: true },
  { path: '/resources/', title: '资源库', offline: 'full', audit: true, smoke: true },
  { path: '/compare/', title: '工具对比', offline: 'full', audit: true, smoke: true },
  { path: '/changelog/', title: '更新日志', offline: 'full', audit: true, smoke: true },
  { path: '/about/', title: '关于', offline: 'full', audit: true, smoke: true },
  { path: '/privacy/', title: '隐私说明', offline: 'full', audit: true, smoke: true },
  { path: '/submit/', title: '投稿', offline: 'full', audit: true, smoke: true },
  // v3.20：/feedback/ 以前没进离线包。它是页脚常驻入口，断网点进去就是 404——
  // 「能点到的页面都该在包里」这条比「包小一点」重要。
  { path: '/feedback/', title: '反馈', offline: 'full', audit: true, smoke: true },
  { path: '/batch/', title: '批量处理', offline: 'full', audit: true, smoke: true },
  // v3.22：「我的数据」页。进离线包是有意义的——它读的 localStorage 完全不依赖网络，
  // 断网时正是「我到底存了什么」最需要被查清的时候。
  { path: '/my/', title: '我的数据', offline: 'full', audit: true, smoke: true },
  // v3.23：工作流页。它跑的全是本地工具，断网时更该能用——所以整条链（页面 + 引擎 +
  // workflows.json + 每一步的 run.js）都进离线包，见 gen-sw.mjs。
  { path: '/workflows/', title: '工作流', offline: 'full', audit: true, smoke: true },
  { path: '/offline/', title: '离线说明', offline: 'core', audit: true, smoke: true },
];

/** 由数据生成的页面族 */
export const PAGE_FAMILIES = [
  { id: 'tool', title: '工具详情', pattern: /^\/tools\/[^/]+\/$/, offline: 'full', audit: 'all' },
  { id: 'category', title: '分类详情', pattern: /^\/categories\/[^/]+\/$/, offline: 'full', audit: 'sample' },
  { id: 'guide', title: '教程正文', pattern: /^\/guides\/[^/]+\/$/, offline: 'full', audit: 'all' },
  { id: 'topic', title: '专题详情', pattern: /^\/topics\/[^/]+\/$/, offline: 'full', audit: 'sample' },
  { id: 'evaluation', title: '测评正文', pattern: /^\/evaluations\/[^/]+\/$/, offline: 'full', audit: 'sample' },
  { id: 'resource', title: '资源合集', pattern: /^\/resources\/[^/]+\/$/, offline: 'full', audit: 'sample' },
];

/** 所有页面模式（静态页 + 页面族），给「产物是否都在册」的反向闸门用 */
export function pagePatterns() {
  return [
    ...STATIC_PAGES.map((p) => ({ pattern: new RegExp('^' + p.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), meta: p })),
    ...PAGE_FAMILIES.map((f) => ({ pattern: f.pattern, meta: f })),
  ];
}

/** 一个构建产物路径（如 '/tools/qrcode/'）是否在册 */
export function matchPage(path) {
  for (const { pattern, meta } of pagePatterns()) if (pattern.test(path)) return meta;
  return null;
}

/** 静态页清单（含 '/'） */
export const staticPaths = () => STATIC_PAGES.map((p) => p.path);

/** 进首屏预缓存的页面 */
export const corePages = () => STATIC_PAGES.filter((p) => p.offline === 'core').map((p) => p.path);

/** 进完整离线包的固定页面（含 core） */
export const fullPages = () => STATIC_PAGES.filter((p) => p.offline).map((p) => p.path);

/** 需要进体检的静态页 */
export const auditPages = () => STATIC_PAGES.filter((p) => p.audit).map((p) => p.path);

/** 需要进冒烟的静态页 */
export const smokePages = () => STATIC_PAGES.filter((p) => p.smoke).map((p) => p.path);

/** 页面族按策略取：'all' 全取，'sample' 每隔 n 个取一个 */
export function familyMeta(id) {
  return PAGE_FAMILIES.find((f) => f.id === id) || null;
}
