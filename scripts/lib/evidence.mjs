// 外链记录的「证据」模型。
//
// 起因（v3.21）：v3.17 给 62 条外链补边界字段时，一次性把 checkedAt 全写成 2026-11-03。
// 于是 180 天闸门在 2027-05-02 那天会同时亮 62 条警告——闸门从「逼着复检」退化成噪音，
// 而噪音会被无视，等于没有闸门。更糟的是它掩盖了一个事实：那 62 条里大部分 privacy
// 值是「看着像」推断出来的，没有一条真的打开页面确认过。
//
// 所以把「什么时候核的」拆成两件不同的事，因为它们能由不同行为证明：
//
//   evidence.link      链接还能不能打开。探活脚本（probe）就能证明，人工打开（manual）也行。
//   evidence.boundary  privacy 标得对不对。**只有人真的看懂了那个工具怎么处理数据才成立**，
//                      探活 200 什么也证明不了——站点活着和它上传不上传你的文件是两回事。
//
// 允许 boundary.method = imported：表示这个值继承自上游清单，没人核过。
// 这不是瑕疵，是当前真实状态；把它写出来，UI 才敢对用户说「这条边界未核实」。
//
// 分档复检周期：证据越弱，过期越快。imported 90 天就催，逼着转成 manual；
// 已经人工核过的给 365 天，因为产品不会天天改隐私模型。

export const LINK_METHODS = ['manual', 'probe'];
// inferred：按产品机制/同类工具推断出来的，有依据但没人打开页面确认。
// 它比 imported 强（imported 只是照抄上游），但**仍然不算核过**——
// 「这个工具用 WebRTC 直传」是架构常识，「它现在这个版本还这么干」得看页面。
export const BOUNDARY_METHODS = ['manual', 'inferred', 'imported'];

export const METHOD_LABEL = {
  manual: '人工核验',
  inferred: '按机制推断',
  probe: '脚本探活',
  imported: '上游继承',
};

/** 各维度的复检周期（天）。warn 只提示，fail 直接让构建失败。 */
export const TTL = {
  link: {
    probe: { warn: 180, fail: 365 },
    manual: { warn: 365, fail: 730 },
  },
  boundary: {
    manual: { warn: 365, fail: 730 },
    inferred: { warn: 120, fail: 240 },
    imported: { warn: 90, fail: 180 },
  },
};

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function daysSince(dateStr, today = new Date()) {
  if (!DATE_RE.test(String(dateStr || ''))) return null;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const then = new Date(y, m - 1, d); // 本地零点
  if (Number.isNaN(then.getTime())) return null;
  // 必须按**本地日历日**比，不能用 UTC 零点：探活脚本写的是本地日期（如 2026-11-04），
  // 而 UTC+8 的凌晨这一刻，UTC 还停在 11-03，用 UTC 比会把今天记的证据判成「在未来」。
  // 用 round 而不是 floor，因为夏令时切换那天只有 23 小时。
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((start - then) / DAY);
}

/**
 * 校验单条 evidence 子记录。
 * @returns {{errors: string[], days: number|null}}
 */
function checkSlot(raw, kind, where, today, methods) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    errors.push(`${where} 缺 evidence.${kind}（至少要有 {at, by, method}）`);
    return { errors, days: null };
  }
  const { at, by, method } = raw;
  if (!DATE_RE.test(String(at || ''))) {
    errors.push(`${where} evidence.${kind}.at=${JSON.stringify(at)} 不是 YYYY-MM-DD`);
  }
  if (!String(by || '').trim()) {
    errors.push(`${where} evidence.${kind}.by 为空（谁核的：脚本名或人名，别写「官方」）`);
  }
  if (!methods.includes(method)) {
    errors.push(`${where} evidence.${kind}.method=${JSON.stringify(method)} 不在 ${methods.join('/')} 里`);
  }
  const days = daysSince(at, today);
  if (days === null) {
    if (DATE_RE.test(String(at || ''))) errors.push(`${where} evidence.${kind}.at=${at} 不是有效日期`);
    return { errors, days: null };
  }
  if (days < 0) errors.push(`${where} evidence.${kind}.at=${at} 在未来`);
  return { errors, days };
}

/**
 * 全量校验外链证据。
 * @param {Array} dirTools tools/directory.json 的 tools 数组
 * @param {{today?: Date}} opts
 */
export function validateEvidence(dirTools, { today = new Date() } = {}) {
  const errors = [];
  const warns = [];
  const stats = {
    total: dirTools.length,
    link: { ok: 0, stale: 0 },
    boundary: { manual: 0, inferred: 0, imported: 0 },
    coverage: 0,
    oldest: { link: 0, boundary: 0 },
    // 探活判死的条目，单独列出：这些要么修 url，要么下架
    dead: [],
  };

  for (const t of dirTools) {
    const where = `directory.json:${t.id || '(缺 id)'}`;
    const ev = t.evidence || {};

    const link = checkSlot(ev.link, 'link', where, today, LINK_METHODS);
    const bnd = checkSlot(ev.boundary, 'boundary', where, today, BOUNDARY_METHODS);
    errors.push(...link.errors, ...bnd.errors);

    if (link.days !== null) {
      stats.oldest.link = Math.max(stats.oldest.link, link.days);
      const lim = TTL.link[ev.link?.method];
      if (lim) {
        if (link.days > lim.fail) {
          errors.push(`${where} 链接已 ${link.days} 天未探活（${METHOD_LABEL[ev.link.method]}上限 ${lim.fail} 天）`);
        } else if (link.days > lim.warn) {
          warns.push(`${where} 链接已 ${link.days} 天未探活`);
        }
        if (link.days <= lim.warn) stats.link.ok += 1;
        else stats.link.stale += 1;
      }
    }

    if (bnd.days !== null) {
      stats.oldest.boundary = Math.max(stats.oldest.boundary, bnd.days);
      const m = ev.boundary?.method;
      const lim = TTL.boundary[m];
      if (lim) {
        if (bnd.days > lim.fail) {
          errors.push(
            `${where} 边界标注已 ${bnd.days} 天未核（${METHOD_LABEL[m] || m}上限 ${lim.fail} 天，请打开页面确认 privacy 后改成 manual）`,
          );
        } else if (bnd.days > lim.warn) {
          warns.push(`${where} 边界标注已 ${bnd.days} 天未核（${METHOD_LABEL[m] || m}）`);
        }
      }
      if (m === 'manual') stats.boundary.manual += 1;
      if (m === 'inferred') stats.boundary.inferred += 1;
      if (m === 'imported') stats.boundary.imported += 1;
    }

    if (t.linkStatus === 'dead') stats.dead.push(t.id);
  }

  stats.coverage = stats.total ? stats.boundary.manual / stats.total : 0;
  return { errors, warns, stats };
}

/** 一行结论，给 check-all / 构建日志用 */
export function evidenceLine(stats) {
  const pct = (stats.coverage * 100).toFixed(0);
  return (
    `${stats.total} 条外链 · 链接可探 ${stats.link.ok} 条 · ` +
    `边界已核 ${stats.boundary.manual}/${stats.total}（${pct}%）· ` +
    `按机制推断 ${stats.boundary.inferred} · 上游继承 ${stats.boundary.imported}`
  );
}

/** 覆盖率低于基线就让 CI 红灯的阈值。只许往上调，不许往下调。 */
export const COVERAGE_FLOOR = 0;
