// 外链工具的「边界字段」校验。
//
// 为什么单独成一个模块：v3.17 之前，62 条外链只写了「它是什么」，没写「它会拿走什么」。
// 而首页最值钱的那句话是「0 字节上传服务器」——62 条外链一条都没标过边界，这句话就是虚的。
//
// 语义（改值的人照着对）：
//   privacy=local    处理在本机完成，内容不上传（可以有网络请求，但请求里不含你的数据）
//   privacy=upload   内容必须发到对方服务器才能出结果（含「加密后上传」）
//   privacy=optional 取决于用法：可自托管、或可选云同步
//   privacy=unknown  没核实过。允许存在，但不许装懂——UI 上要显示成「边界未核实」。
//
// 三条硬闸门：
//   1. runtime / privacy 必须是枚举内的值，不许写中文或自造词
//   2. 非 local 的条目必须写 privacyNote，否则卡片会给人错误印象
//   3. checkedAt 超过 180 天警告、超过 365 天直接失败——外链会死，目录站会烂，
//      这是唯一能逼着复检的机制（ahhhhfs 自己承认「云盘取消分享、链接打不开」）

export const RUNTIME_KINDS = ['web', 'desktop', 'selfhost', 'cli', 'extension', 'mobile'];
export const PRIVACY_KINDS = ['local', 'upload', 'optional', 'unknown'];
export const PRIVACY_LABEL = {
  local: '本机处理',
  upload: '会上传',
  optional: '看用法',
  unknown: '未核实',
};

const DAY = 86400000;

export function validateToolMeta(dirTools, { localTools = [], today = new Date(), warnDays = 180, failDays = 365 } = {}) {
  const errors = [];
  const warns = [];
  const seen = new Set();
  const localIds = new Set(localTools.map((t) => t.id));

  for (const t of dirTools) {
    const at = `directory.json:${t.id || '(缺 id)'}`;

    if (!t.id) errors.push(`${at} 缺 id`);
    else if (seen.has(t.id)) errors.push(`${at} id 重复`);
    else seen.add(t.id);
    if (t.id && localIds.has(t.id)) errors.push(`${at} 与站内工具 id 撞车（tools/<id>/ 会被覆盖）`);

    if (!RUNTIME_KINDS.includes(t.runtime)) {
      errors.push(`${at} runtime=${JSON.stringify(t.runtime)} 不在 ${RUNTIME_KINDS.join('/')} 里`);
    }
    if (!PRIVACY_KINDS.includes(t.privacy)) {
      errors.push(`${at} privacy=${JSON.stringify(t.privacy)} 不在 ${PRIVACY_KINDS.join('/')} 里`);
    }
    if (t.privacy && t.privacy !== 'local' && !String(t.privacyNote || '').trim()) {
      errors.push(`${at} privacy=${t.privacy} 必须写 privacyNote（说明具体怎么个上传法）`);
    }

    const raw = String(t.checkedAt || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      errors.push(`${at} checkedAt=${JSON.stringify(t.checkedAt)} 不是 YYYY-MM-DD`);
      continue;
    }
    const d = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      errors.push(`${at} checkedAt=${raw} 不是有效日期`);
      continue;
    }
    const days = Math.floor((today - d) / DAY);
    if (days < 0) errors.push(`${at} checkedAt=${raw} 在未来`);
    else if (days > failDays) errors.push(`${at} 已 ${days} 天未复检（上限 ${failDays} 天，请复检后更新 checkedAt，或下架）`);
    else if (days > warnDays) warns.push(`${at} 已 ${days} 天未复检`);
  }

  const stats = { total: dirTools.length, privacy: {}, runtime: {}, oldestDays: 0 };
  for (const t of dirTools) {
    stats.privacy[t.privacy] = (stats.privacy[t.privacy] || 0) + 1;
    stats.runtime[t.runtime] = (stats.runtime[t.runtime] || 0) + 1;
    const d = new Date(`${t.checkedAt}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) stats.oldestDays = Math.max(stats.oldestDays, Math.floor((today - d) / DAY));
  }

  return { errors, warns, stats };
}

/** 一行结论，给 check-all / 构建日志用 */
export function metaSummary(stats) {
  const p = PRIVACY_KINDS.filter((k) => stats.privacy[k]).map((k) => `${PRIVACY_LABEL[k]} ${stats.privacy[k]}`).join(' / ');
  return `${stats.total} 条外链 · ${p}`;
}
