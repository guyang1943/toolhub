// 外链工具的「边界字段」校验。
//
// 为什么单独成一个模块：v3.17 之前，62 条外链只写了「它是什么」，没写「它会拿走什么」。
// 而首页最值钱的那句话是「0 字节上传服务器」——62 条外链一条都没标过边界，这句话就是虚的。
//
// 语义（改值的人照着对）：
//   privacy=local    处理在本机完成，内容不上传（可以有网络请求，但请求里不含你的数据）
//   privacy=p2p      文件/内容在两台设备之间直传，不经站点服务器。**不等于 local**：
//                    东西确实离开了这台机器，只是去了另一台而不是厂商服务器。
//                    跨 NAT 时可能经 TURN 中继，必须在 privacyNote 里写明。
//   privacy=upload   内容必须发到对方服务器才能出结果（含「加密后上传」）
//   privacy=optional 取决于用法：可自托管、或可选云同步
//   privacy=unknown  没核实过。允许存在，但不许装懂——UI 上要显示成「边界未核实」。
//
// 闸门分两层，因为「说清楚」和「说对了」是两件事：
//   1. 结构层：runtime / privacy 必须是枚举内的值；非 local 的必须写 privacyNote，
//      否则卡片会给人错误印象。
//   2. 证据层：每条必须说明这个隐私标注凭什么成立（见 lib/evidence.mjs）。
//      v3.21 之前只有一个 checkedAt 日期，62 条还全写的同一天（批量补的），
//      于是 180 天后会同时亮 62 条警告——闸门退化成噪音，等于没有闸门。

import { validateEvidence } from './evidence.mjs';

export const RUNTIME_KINDS = ['web', 'desktop', 'selfhost', 'cli', 'extension', 'mobile'];
// 顺序即 UI 强度排序：从「最不出门」到「最说不清」。app.js 的 PV 数组依赖这个顺序。
export const PRIVACY_KINDS = ['local', 'p2p', 'upload', 'optional', 'unknown'];
export const PRIVACY_LABEL = {
  local: '本机处理',
  p2p: '点对点',
  upload: '会上传',
  optional: '看用法',
  unknown: '未核实',
};

export function validateToolMeta(dirTools, { localTools = [], today = new Date() } = {}) {
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
      errors.push(`${at} privacy=${t.privacy} 必须写 privacyNote（说明具体怎么个传法）`);
    }

    // v3.25：AI 分类多两个字段。
    // keyRequired 回答「不填模型凭据能不能用」，promptNote 回答「提示词会去哪里」——
    // 这两件事在 AI 工具上比「哪个站点」重要得多：同一个工具接本地模型和接云 API，
    // 数据边界完全相反。所以不做「AI 分类免检」，而是要求每条都把话说清。
    if (t.keyRequired !== undefined && typeof t.keyRequired !== 'boolean') {
      errors.push(`${at} keyRequired 必须是布尔值（不填 = 不需要凭据）`);
    }
    // 全本机的工具不可能「需要你在别处填 Key」——两者同时出现，说明有一条是错的。
    // 这条防的是偷懒：给本地工具贴个「需 API Key」徽标，或者反过来把要 Key 的标成本机处理。
    if (t.keyRequired === true && t.privacy === 'local') {
      errors.push(`${at} keyRequired=true 却标 privacy=local（要用别人的 Key，内容就不可能全在本机）`);
    }
    if (t.category === 'AI') {
      if (!String(t.promptNote || '').trim()) {
        errors.push(`${at} AI 分类必须写 promptNote（你的提示词会去哪里），这是这一栏的立栏理由`);
      }
      if (t.evidence?.boundary?.method === 'imported') {
        errors.push(`${at} AI 分类不接受 boundary.method=imported（照抄上游说明不了提示词去哪）`);
      }
    }
  }

  const ev = validateEvidence(dirTools, { today });
  errors.push(...ev.errors);
  warns.push(...ev.warns);

  const stats = { total: dirTools.length, privacy: {}, runtime: {}, evidence: ev.stats, keys: 0 };
  for (const t of dirTools) {
    stats.privacy[t.privacy] = (stats.privacy[t.privacy] || 0) + 1;
    stats.runtime[t.runtime] = (stats.runtime[t.runtime] || 0) + 1;
    if (t.keyRequired === true) stats.keys += 1;
  }

  return { errors, warns, stats };
}

/** 一行结论，给 check-all / 构建日志用 */
export function metaSummary(stats) {
  const p = PRIVACY_KINDS.filter((k) => stats.privacy[k])
    .map((k) => `${PRIVACY_LABEL[k]} ${stats.privacy[k]}`)
    .join(' / ');
  return `${stats.total} 条外链 · ${p}`;
}
