/**
 * AI 能力矩阵（v3.43）
 *
 * 这一页只做一件事：把「这个 AI 工具支不支持某件事」写成能核、能查、会过期的表。
 *
 * 三条硬规矩（改这个文件之前先读）：
 *   1. **三态，不是二态**。true / false / "?"。`?` 表示「官方文档没说」，不是「不支持」。
 *      把 `?` 画成 `✕` 是这张表变成第二个不可信表格的最短路径。
 *   2. **每条必须有 source**。缺了构建就失败，没有「据我所知」的入口。
 *   3. **过期不隐藏**。超过 staleAfterDays 的条目照常显示，只在行尾标一句「可能已变」。
 *      删掉过期条目等于假装它一直有效；那正是导航站烂掉的方式。
 *
 * 这个模块同时被两处调用：build-pages.mjs（生成静态页，爬虫与禁用 JS 时读到的就是它）
 * 与 pages.js（站内跳转后重渲染）。正文只写这一份，两边才不会各说各的。
 */

export const MATRIX_ATTRS = [
  { key: 'mcp', label: 'MCP', full: '能接 Model Context Protocol——作为客户端或服务端，有配置入口' },
  { key: 'localModel', label: '本地模型', full: '能连本地模型或自托管端点，而不是只能用厂商云' },
  { key: 'ownKey', label: '自带 Key', full: '可自带 API key 或第三方兼容端点，不被官方订阅绑死' },
  { key: 'openSource', label: '开源', full: '源码公开，且有开源许可证' },
  { key: 'freeTier', label: '免费档', full: '有能用的免费档、免费额度或完全免费' },
  { key: 'multiAgent', label: '多代理', full: '支持多个子代理并行或委派，而不只是单轮问答' },
  { key: 'headless', label: '无界面', full: '可非交互运行（CLI 参数 / 服务模式 / 可脚本化批量调用）' },
];

export const MATRIX_KEYS = MATRIX_ATTRS.map((a) => a.key);

/** 导语。静态页与 SPA 都取这一句——导语分叉比正文分叉更难被发现，因为没人会去比对它。 */
export const MATRIX_LEAD =
  '七项属性 × 每个工具，逐条查官方文档，每条标出处与核对日期。文档没说的留问号——' +
  '它不是「不支持」，是「没核到」。这张表宁可承认不知道，也不替厂商下结论。';

const DAY = 86400000;

/** 本机日历日。构建机与浏览器都用它：UTC 在早上八点前差一天，过期判断会因此抖。 */
export function todayISO(d = new Date()) {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 10);
}

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 本地日历日差，四舍五入——用 Date.parse 直接减会在夏令时与「今天几点」上抖出一天。 */
export function ageInDays(from, today) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / DAY);
}

/** 一个属性取三态：显式 true/false 或以 '?' 占位；unknown 数组里的键按 '?' 处理。 */
export function attrState(entry, key) {
  const v = entry.attrs ? entry.attrs[key] : undefined;
  if (v === true || v === false) return v;
  if (v === '?' || (Array.isArray(entry.unknown) && entry.unknown.includes(key))) return '?';
  return '?';
}

/** 汇总：条数、待核项数、过期条数、按组计数。页面与 verify 都从这里取，不各算一遍。 */
export function matrixStats(data, today) {
  const entries = (data && data.entries) || [];
  let unknown = 0;
  let known = 0;
  const stale = [];
  const byGroup = {};
  for (const e of entries) {
    const g = e.group || '';
    byGroup[g] = (byGroup[g] || 0) + 1;
    for (const k of MATRIX_KEYS) {
      if (attrState(e, k) === '?') unknown++;
      else known++;
    }
    const age = ageInDays(e.checkedAt, today);
    const limit = Number(e.staleAfterDays) || 180;
    if (!Number.isNaN(age) && age > limit) stale.push({ id: e.id, age, limit });
  }
  return { count: entries.length, unknown, known, stale, byGroup, attrs: MATRIX_KEYS.length };
}

/**
 * 校验：构建期调用，有 error 就中止。
 * 这里故意比「字段够不够」更严——它同时是这张表的可信度闸门：
 * 缺 source 的条目不是「待补」，而是「这条不许上线」。
 */
export function validateMatrix(data, { today } = {}) {
  const errors = [];
  const warns = [];
  const groups = (data && data.groups) || [];
  const entries = (data && data.entries) || [];
  if (!groups.length) errors.push('groups 为空：至少要有分组，否则页面没有小标题');
  const gids = new Set();
  for (const g of groups) {
    if (!g || !g.id) errors.push('有分组缺 id');
    else if (gids.has(g.id)) errors.push(`分组 id 重复：${g.id}`);
    else gids.add(g.id);
    if (!g || !g.title) errors.push(`分组 ${g && g.id} 缺 title`);
  }
  if (!entries.length) errors.push('entries 为空');
  const ids = new Set();
  for (const e of entries) {
    const tag = e && e.id ? e.id : '(缺 id)';
    if (!e || !e.id) errors.push('有条目缺 id');
    else if (ids.has(e.id)) errors.push(`条目 id 重复：${e.id}`);
    else ids.add(e.id);
    if (!e) continue;
    if (!e.name) errors.push(`${tag} 缺 name`);
    if (!gids.has(e.group)) errors.push(`${tag} 的 group「${e.group}」不在 groups 里`);
    // 可信度闸门：没有出处的条目直接判死，不留「以后补」的口子
    if (!e.source || !/^https?:\/\//.test(e.source)) errors.push(`${tag} 缺 source（必须是对应的官方文档 URL）`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.checkedAt))) errors.push(`${tag} 的 checkedAt 必须是 YYYY-MM-DD`);
    else if (Number.isNaN(Date.parse(e.checkedAt))) errors.push(`${tag} 的 checkedAt 不是合法日期：${e.checkedAt}`);
    else if (today && Date.parse(e.checkedAt) > Date.parse(today)) errors.push(`${tag} 的 checkedAt 在未来`);
    // 七项必须逐项表态——漏一项会被画成「?」，那等于悄悄把「没写」当成「文档没说」
    for (const k of MATRIX_KEYS) {
      const v = e.attrs ? e.attrs[k] : undefined;
      if (!(v === true || v === false || v === '?')) {
        errors.push(`${tag} 的 attrs.${k} 缺失或取值非法（只接受 true / false / "?"）`);
      }
    }
    const unk = Array.isArray(e.unknown) ? e.unknown : [];
    for (const k of unk) {
      if (!MATRIX_KEYS.includes(k)) errors.push(`${tag} 的 unknown 里有未知属性：${k}`);
      const v = e.attrs ? e.attrs[k] : undefined;
      if (v === true || v === false) errors.push(`${tag} 的 ${k} 同时在 attrs 里给了值、又被列进 unknown`);
    }
    if (!e.note) warns.push(`${tag} 没写 note（表里会少一句最容易误判的解释）`);
  }
  // 已知项太少说明整张表在说「不知道」——不是错误，但要在构建日志里看见
  const st = matrixStats(data, today || new Date().toISOString().slice(0, 10));
  if (st.count && st.unknown / (st.count * MATRIX_KEYS.length) > 0.5) {
    warns.push(`待核项占 ${Math.round((st.unknown / (st.count * MATRIX_KEYS.length)) * 100)}%——过半是 "?"，这一版的信息量偏低`);
  }
  return { errors, warns, stats: st };
}

/** 单个格子。title 用原生 tooltip：不引脚本、不引浮层。
 *  注意：三态类名必须落在**内层 span** 上，不能给 <td> 本身加 .mx-u——
 *  单元格宽度由表格决定，19px 的圆圈会画在格子左上角，而问号仍居中在整格里，
 *  看起来就是「一个空心圆 + 一个跑到外面的问号」（v3.43 首版踩过）。计数改用 data-v。 */
function cell(state, label) {
  if (state === true) return `<td class="mx-c" data-v="y" title="${esc(label)}：支持"><span class="mx-y">✓</span></td>`;
  if (state === false) return `<td class="mx-c" data-v="n" title="${esc(label)}：不支持"><span class="mx-n">✕</span></td>`;
  return `<td class="mx-c" data-v="u" title="${esc(label)}：官方文档未提及，未核实"><span class="mx-u">?</span></td>`;
}

/**
 * 正文。today 由调用方给（构建期是构建日），保证静态页与 SPA 对「过期没过期」判断一致。
 */
export function matrixBody(data, today) {
  const groups = data.groups || [];
  const entries = data.entries || [];
  const st = matrixStats(data, today);
  const staleIds = new Set(st.stale.map((s) => s.id));

  const head =
    `<div class="mx-sum">` +
    `<p class="mx-num"><b>${st.count}</b> 条 · 七项属性 <b>${st.count * st.attrs}</b> 格 · ` +
    `已核 <b>${st.known}</b> 格 · 待核 <b>${st.unknown}</b> 格</p>` +
    `<p>核对日期见每行右侧。超过保鲜期的条目不删除、不隐藏，只在后面标一句「可能已变」——` +
    `删掉过期条目等于假装它一直有效。</p>` +
    `</div>`;

  const legend =
    `<h2>这张表怎么读</h2>` +
    `<ul class="mx-legend">` +
    `<li><span class="mx-key mx-y">✓</span> 官方文档明确写了支持。</li>` +
    `<li><span class="mx-key mx-n">✕</span> 官方文档明确写了不支持，或给出了完整特性清单而它不在其中。</li>` +
    `<li><span class="mx-u">?</span> <b>官方文档没说</b>，或者我没找到依据。` +
    `它不是「不支持」——很多能力是文档没提，而不是没有。宁可留一个问号，也不替厂商下结论。</li>` +
    `</ul>` +
    `<p>一处口径要说清：<b>MCP 服务端没有「订阅」这回事</b>。要你自己带 token 或数据库地址的，` +
    `「自带 Key」记 ✓；完全不需要凭据的记 ?,那是因为这个问题对它不成立，而不是它不支持。</p>` +
    `<p>七项属性各问一件事：${MATRIX_ATTRS.map((a) => `<b>${esc(a.label)}</b>（${esc(a.full)}）`).join('；')}。</p>` +
    `<p>这张表回答的是「文档承诺了什么」，不是「用起来好不好」。能力属性大约按季度变化，` +
    `所以每条都带核对日期和官方出处；价格和型号变化快得多，这里一个字都不写——` +
    `那种表上线两周就开始撒谎。</p>`;

  const body = groups
    .map((g) => {
      const rows = entries.filter((e) => e.group === g.id);
      if (!rows.length) return '';
      const trs = rows
        .map((e) => {
          const stale = staleIds.has(e.id);
          const age = ageInDays(e.checkedAt, today);
          const cells = MATRIX_ATTRS.map((a) => cell(attrState(e, a.key), a.label)).join('');
          return (
            `<tr${stale ? ' class="mx-old"' : ''}>` +
            `<th scope="row"><span class="mx-name">${esc(e.name)}</span>` +
            (e.note ? `<span class="mx-note">${esc(e.note)}</span>` : '') +
            `</th>` +
            cells +
            `<td class="mx-src"><a href="${esc(e.source)}" target="_blank" rel="noopener"` +
            (e.evidence ? ` title="${esc(e.evidence)}"` : '') +
            `>依据 ↗</a>` +
            `<span class="mx-date">${esc(e.checkedAt)}${stale ? ` · 已 ${age} 天，可能已变` : ''}</span></td>` +
            `</tr>`
          );
        })
        .join('');
      return (
        `<h2 id="mx-${esc(g.id)}">${esc(g.title)}</h2>` +
        (g.desc ? `<p class="mx-desc">${esc(g.desc)}</p>` : '') +
        `<div class="mx-wrap"><table class="mx-table"><thead><tr>` +
        `<th scope="col">项目</th>` +
        MATRIX_ATTRS.map((a) => `<th scope="col" title="${esc(a.full)}">${esc(a.label)}</th>`).join('') +
        `<th scope="col">依据</th></tr></thead><tbody>${trs}</tbody></table></div>`
      );
    })
    .join('');

  return head + legend + body + tail(data, st, today);
}

/** 表尾：口径说明 + 待核清单。待核清单是这张表「还欠什么」的明账。 */
function tail(data, st, today) {
  const fresh = (data.entries || []).filter((e) => !st.stale.some((s) => s.id === e.id));
  const oldest = fresh
    .map((e) => e.checkedAt)
    .sort()
    .slice(0, 1)[0];
  let out =
    `<h2>这张表不做什么</h2>` +
    `<p>不做价格表，不做跑分榜，也不做「收录 500 个」清单。价格与型号是周级变化，抄一次就错一次；` +
    `跑分不等于你的任务；收录量是别人更新更快的地方。这里只留变化慢、且能被官方文档核对的东西。</p>` +
    `<p>也不替你选。同一行里「开源 ✓、免费档 ✕」是好是坏，取决于你是要省钱还是要能改源码——` +
    `这张表的用处是让你在掏钱或交数据之前，先看见自己在选什么。</p>`;
  if (st.stale.length) {
    out += `<h2>已过保鲜期</h2><p>${st.stale.map((s) => esc(s.id)).join('、')} —— 核对日期距今超过各自设定的天数，` +
      `页面照常展示，但那几行可能已经不成立。下次改这一页时优先核它们。</p>`;
  }
  out += `<p class="mx-foot">数据源：<code>assets/data/ai-matrix.json</code>，构建期校验——缺出处、日期非法、` +
    `七项没逐项表态，任何一条都会让构建失败。${oldest ? `本页最老的一条核于 ${esc(oldest)}。` : ''}</p>`;
  return out;
}
