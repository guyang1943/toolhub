// 工具：日期计算器（纯浏览器执行）
//
// 三个模式共用一套严格的日期解析：YYYY-MM-DD 必须是真的日期，2026-02-30 要报错，
// 而不是像 new Date('2026-02-30') 那样悄悄滚到 3 月 2 日——滚过去之后所有天数都错，
// 用户还以为算对了。
//
// 全部按「日历日」算：用 UTC 毫秒差除以 86400000。不能用本地时间相减，
// 夏令时切换那天会差一小时，除以一天后得到 0.958 天，四舍五入就把一天吃掉。
const DAY = 86400000;

function parseDate(input, field) {
  const s = String(input || '').trim();
  if (!s) throw new Error(`请填${field}：格式 2026-11-05（年-月-日）`);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) throw new Error(`「${s}」不是合法日期：请写成年-月-日，例如 2026-11-05`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200) throw new Error(`${field}「${s}」的年份超出范围（1900–2200）`);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`${field}「${s}」这一天不存在：${y} 年 ${mo} 月没有 ${d} 号`);
  }
  return { y, mo, d, ms: dt.getTime() };
}

const fmt = (ms) => {
  const t = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
};
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const weekdayOf = (ms) => WEEK[new Date(ms).getUTCDay()];

// 工作日：只跳周六日。法定节假日与调休不在本地判断范围内——节假日表每年由国务院发布、
// 各省还有自己的安排，写死在代码里既会过期又会被信以为真，所以明确不做，并在结果里说明。
function addWorkdays(ms, n) {
  const step = n >= 0 ? DAY : -DAY;
  let left = Math.abs(n);
  let cur = ms;
  let skipped = 0;
  while (left > 0) {
    cur += step;
    const wd = new Date(cur).getUTCDay();
    if (wd === 0 || wd === 6) skipped++;
    else left--;
  }
  return { ms: cur, skipped };
}

function countWorkdays(fromMs, toMs) {
  const step = toMs >= fromMs ? DAY : -DAY;
  let cur = fromMs;
  let n = 0;
  while (step > 0 ? cur < toMs : cur > toMs) {
    cur += step;
    const wd = new Date(cur).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export const manifest = {
  usage:
    '三种算法共用一个表单：① 填两个日期算相隔多少天（附中间的工昨日数）；② 只填开始日期与天数，算之后（或之前）是哪一天；③ 只填开始日期与工作日数，跳过周六日往后推，适合算「N 个工作日后交付」。日期一律按日历日计算，不受时区与夏令时影响。',
  tips: [
    '日期必须写成 年-月-日，且必须是真实存在的日期：2026-02-30 会直接报错，不会悄悄变成 3 月 2 日',
    '「工作日」只跳过周六日，不含法定节假日与调休——节假日每年由国务院发布，各省还有差异，写死在代码里会过期',
    '算间隔时结果给三个数：相差天数、含首尾的天数、中间的工昨日数，做排期时用的是第三个',
    '天数可以填负数：减 30 天就是往前推，跨月天数按真实日历算',
  ],
  scenarios: [
    { scene: '算项目周期', how: '起始填 2026-11-05，结束填 2026-12-20，选「间隔天数」', result: '拿到相差天数与中间的工昨日数，报工期时用工作日更实' },
    { scene: '算合同到期日', how: '填签约日与 90，选「加减天数」', result: '直接给出到期日与星期几，周末到期能提前发现' },
    { scene: '算「5 个工作日后交付」', how: '填开始日期与 5，选「加减工作日」', result: '自动跳过周六日，并告诉你这一路跳过了几天' },
  ],
  inputs: [
    { name: 'd1', label: '开始日期', type: 'text', placeholder: '2026-11-05' },
    { name: 'd2', label: '结束日期（仅「间隔天数」用，可留空）', type: 'text', placeholder: '2026-12-20' },
    {
      name: 'op',
      label: '算什么',
      type: 'select',
      options: [
        { value: 'diff', label: '间隔天数' },
        { value: 'add', label: '加减天数' },
        { value: 'work', label: '加减工作日' },
      ],
    },
    { name: 'n', label: '天数（「间隔」时忽略，可为负数）', type: 'number', placeholder: '30', min: -36500, max: 36500 },
  ],
  runLabel: '计算',
};

export async function run({ d1, d2, op, n }) {
  const a = parseDate(d1, '开始日期');
  const mode = op || 'diff';
  const num = n === '' || n === undefined || n === null ? 0 : Number(n);
  if (!Number.isFinite(num)) throw new Error(`天数「${n}」不是数字`);
  if (!Number.isInteger(num)) throw new Error(`天数要填整数，「${n}」带小数会被四舍五入，结果就对不上了`);

  const rows = [];
  let headline = '';

  if (mode === 'diff') {
    const b = parseDate(d2, '结束日期');
    const days = Math.round((b.ms - a.ms) / DAY);
    const abs = Math.abs(days);
    const work = countWorkdays(a.ms, b.ms);
    const dir = days === 0 ? '同一天' : days > 0 ? `结束日期在后，晚 ${abs} 天` : `结束日期在前，早 ${abs} 天`;
    headline = `📅 相差 ${abs} 天（${dir}）`;
    rows.push(['相差天数', `${abs} 天`]);
    rows.push(['含首尾共', `${abs + 1} 天`]);
    rows.push(['中间工作日', `${work} 天（只跳周六日）`]);
    rows.push(['折合周数', `${(abs / 7).toFixed(1)} 周`]);
    rows.push(['开始 → 结束', `${fmt(a.ms)}（${weekdayOf(a.ms)}） → ${fmt(b.ms)}（${weekdayOf(b.ms)}）`]);
  } else if (mode === 'add') {
    const r = a.ms + num * DAY;
    headline = `📅 ${fmt(a.ms)} ${num >= 0 ? '加' : '减'} ${Math.abs(num)} 天 = ${fmt(r)}（${weekdayOf(r)}）`;
    rows.push(['结果日期', `${fmt(r)}（${weekdayOf(r)}）`]);
    rows.push(['偏移', `${num >= 0 ? '+' : ''}${num} 天`]);
    rows.push(['起点', `${fmt(a.ms)}（${weekdayOf(a.ms)}）`]);
    rows.push(['是否周末', [0, 6].includes(new Date(r).getUTCDay()) ? '是（周六或周日）' : '否']);
  } else if (mode === 'work') {
    const { ms, skipped } = addWorkdays(a.ms, num);
    headline = `📅 ${fmt(a.ms)} ${num >= 0 ? '之后' : '之前'} ${Math.abs(num)} 个工作日 = ${fmt(ms)}（${weekdayOf(ms)}）`;
    rows.push(['结果日期', `${fmt(ms)}（${weekdayOf(ms)}）`]);
    rows.push(['偏移工作日', `${num >= 0 ? '+' : ''}${num} 个`]);
    rows.push(['跳过的周末天数', `${skipped} 天`]);
    rows.push(['起点', `${fmt(a.ms)}（${weekdayOf(a.ms)}）`]);
  } else {
    throw new Error(`不认识的算法「${mode}」：请选间隔天数、加减天数或加减工作日`);
  }

  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const leapNote = isLeap(a.y) ? `${a.y} 是闰年（2 月 29 天）` : `${a.y} 不是闰年（2 月 28 天）`;

  return {
    html: `<div class="msg-ok">${headline}</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted);width:38%">${k}</td><td style="padding:6px 4px;font-family:var(--mono)">${v}</td></tr>`
          )
          .join('')}
      </table>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">${leapNote}。工作日只跳过周六日，<strong>不含法定节假日与调休</strong>——节假日安排每年发布、各地还有差异，内置一份会过期，所以这里不做。</p>`,
    text: [headline.replace('📅 ', ''), ...rows.map(([k, v]) => `${k}：${v}`)].join('\n'),
  };
}
