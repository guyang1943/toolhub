// 工具：Cron 表达式解析（纯浏览器执行，零依赖实现）
export const manifest = {
  usage: '输入 5 段式 cron 表达式（分 时 日 月 周），本工具会用人话解释含义，并算出接下来 5 次执行时间。支持 * 、数字、区间 1-5、步长 */15。',
  tips: [
    '常见写法：0 9 * * 1-5 = 工作日早上 9 点；*/5 * * * * = 每 5 分钟',
    '周字段 0 和 7 都表示周日，1 表示周一',
    '服务器时区可能与本地不同，计算前确认目标环境的时区',
  ],
  scenarios: [
    { scene: '接手别人的定时任务，看不懂表达式', how: '粘贴表达式 → 看人话解释', result: '立刻知道是"每天 9 点"还是"每 5 分钟"' },
    { scene: '写错表达式导致任务没跑', how: '粘贴 → 看未来 5 次执行时间', result: '时间列表不对，说明表达式写错了' },
    { scene: '要确认周一到周五是否真的跳过周末', how: '粘贴 0 9 * * 1-5', result: '时间列表里只出现周一到周五' },
  ],
  inputs: [
    { name: 'expr', label: 'Cron 表达式（5 段）', type: 'text', placeholder: '*/5 * * * *', default: '0 9 * * 1-5' },
    { name: 'count', label: '计算接下来几次', type: 'number', default: '5' },
  ],
  runLabel: '解析',
};

const FIELDS = [
  { name: '分钟', min: 0, max: 59 },
  { name: '小时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12 },
  { name: '星期', min: 0, max: 6 },
];

function parseField(raw, min, max) {
  const set = new Set();
  for (const part of raw.split(',')) {
    let [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`步长非法：${part}`);
    let lo, hi;
    if (range === '*') {
      lo = min; hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number);
      lo = a; hi = b;
    } else {
      lo = hi = Number(range);
      if (stepRaw) hi = max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`字段非法：${part}`);
    if (lo < min || hi > max || lo > hi) throw new Error(`超出范围（${min}-${max}）：${part}`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}

function pad(n) { return String(n).padStart(2, '0'); }

function nextRuns(sets, count) {
  const [mins, hours, doms, months, dows] = sets;
  const out = [];
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = 366 * 24 * 60 * 2; // 最多搜索两年
  for (let i = 0; i < limit && out.length < count; i++) {
    if (
      mins.has(d.getMinutes()) && hours.has(d.getHours()) &&
      doms.has(d.getDate()) && months.has(d.getMonth() + 1) && dows.has(d.getDay())
    ) {
      out.push(new Date(d));
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}

export async function run({ expr, count }) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('需要 5 段（分 时 日 月 周），例如：0 9 * * 1-5');
  const sets = parts.map((p, i) => parseField(p, FIELDS[i].min, FIELDS[i].max));
  const n = Math.min(20, Math.max(1, Number(count) || 5));
  const runs = nextRuns(sets, n);

  const describe = (set, field, unit) => {
    if (set.size === field.max - field.min + 1) return '每' + unit;
    return [...set].sort((a, b) => a - b).map((v) => v + unit).join('、');
  };
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const summary = [
    `分钟：${describe(sets[0], FIELDS[0], '分')}`,
    `小时：${sets[1].size === 24 ? '每小时' : [...sets[1]].sort((a, b) => a - b).map((h) => h + '点').join('、')}`,
    `日期：${sets[2].size === 31 ? '每天' : [...sets[2]].sort((a, b) => a - b).join('、') + ' 号'}`,
    `月份：${sets[3].size === 12 ? '每月' : [...sets[3]].sort((a, b) => a - b).join('、') + ' 月'}`,
    `星期：${sets[4].size === 7 ? '每天' : [...sets[4]].sort((a, b) => a - b).map((d) => weekNames[d]).join('、')}`,
  ].join(' · ');

  const list = runs.length
    ? runs.map((d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${weekNames[d.getDay()]}`).join('\n')
    : '两年内没有匹配的执行时间（检查「日」与「星期」是否冲突）';

  return {
    html: `<div class="msg-ok">✅ 表达式合法（按本机时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone} 计算）</div>
      <div class="panel" style="margin-top:12px;background:var(--accent-soft);border-color:#c7d4f5;font-size:13.5px">📖 ${summary}</div>
      <div style="margin-top:12px;font-size:13px;color:var(--muted)">接下来 ${runs.length} 次执行：</div>
      <pre class="ok">${list}</pre>`,
    text: list,
  };
}
