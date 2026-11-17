/* 教程分类（v3.34）。
   静态页与 SPA 都从这里取：分类名、顺序、锚点只有一份实现。
   上一版 /guides/ 是 16 条平铺——读者知道这里有教程，但不知道「哪一篇是我要的」。

   分类不是给机器打的标签，是读者脑子里的那个问句：
   「我想让网站上线」「我想把闲置硬件用起来」「我要做小程序」。
   所以它跟工具的 10 个分类**不共用**：工具按「处理什么」分（文本/图片/数据），
   教程按「想达成什么」分。硬套工具分类会得到「效率 7 篇」这种谁都用不上的桶。

   顺序也是内容的一部分：上面两类的读者最多（建站、自建），先给。 */

export const GUIDE_CATEGORIES = [
  { slug: 'site', name: '建站与上线', desc: '从零把一个网站发布出去：建站、绑域名、加速、自动部署' },
  { slug: 'selfhost', name: '自建与内网', desc: '把闲置硬件和家里的服务变成 24 小时在线的东西' },
  { slug: 'mobile', name: '小程序与手机', desc: '小程序从注册到上线，以及手机上的自动化' },
  { slug: 'ai', name: 'AI 与效率', desc: '用 AI 干活：写材料、搭一个带后台的工作台' },
  { slug: 'media', name: '图片与文档', desc: '压缩、转格式、合并——把文件处理到能上传' },
];

const SLUG_OF = new Map(GUIDE_CATEGORIES.map((c) => [c.name, c.slug]));

/** 分类锚点 id。静态页与 SPA 必须一致，否则从首页跳进来落点会错。 */
export function guideAnchor(name) {
  return 'gcat-' + (SLUG_OF.get(name) || 'other');
}

/** 按声明顺序分组，空组不输出。
 *  未知/缺分类的条目落到「未分类」并排在最后：这里兜底不让页面崩，
 *  真正的防线是 verify 那条「每篇必须有分类且在白名单内」。 */
export function groupGuides(guides = []) {
  const buckets = new Map(GUIDE_CATEGORIES.map((c) => [c.name, []]));
  const other = [];
  for (const g of guides) (buckets.get(g.category) || other).push(g);
  const out = GUIDE_CATEGORIES.map((c) => ({ ...c, items: buckets.get(c.name) })).filter((c) => c.items.length);
  if (other.length) out.push({ slug: 'other', name: '未分类', desc: '', items: other });
  return out;
}

/** 分类导航：纯锚点链接，不用 JS。
 *  静态页与 SPA 是同一份 HTML，所以没有「两套筛选逻辑」可言——
 *  上一版首页筛选器那种 JS 状态机一旦有第二份实现，必然有一份先坏。 */
export function guideNavHTML(groups) {
  const chips = groups
    .map(
      (c) =>
        `<a class="gcat-chip" href="#${guideAnchor(c.name)}"><b>${c.name}</b><span>${c.items.length}</span></a>`
    )
    .join('');
  return `<nav class="gcat-nav" aria-label="教程分类">${chips}</nav>`;
}
