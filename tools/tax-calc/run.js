// 工具：个税计算器（工资薪金所得 · 累计预扣法，纯本地计算）
// 依据：国家税务总局累计预扣法 + 个人所得税预扣率表一；专项附加扣除标准（2023 年提高后）
const BRACKETS = [
  [36000, 0.03, 0],
  [144000, 0.1, 2520],
  [300000, 0.2, 16920],
  [420000, 0.25, 31920],
  [660000, 0.3, 52920],
  [960000, 0.35, 85920],
  [Infinity, 0.45, 181920],
];
const BASIC = 5000; // 月起征点（减除费用）

// 年度税率表：返回适用税率与速算扣除数，并给出累计税额
function annualTax(taxable) {
  if (taxable <= 0) return { rate: 0, quick: 0, tax: 0 };
  for (const [cap, rate, quick] of BRACKETS) {
    if (taxable <= cap) return { rate, quick, tax: taxable * rate - quick };
  }
  return { rate: 0.45, quick: 181920, tax: taxable * 0.45 - 181920 };
}

// 累计预扣法：前 m 个月的累计应预扣预缴税额
function cumulative(salary, m, social, extra, other) {
  const cumIncome = salary * m;
  const cumTaxable = Math.max(0, cumIncome - BASIC * m - social * m - extra * m - other * m);
  const { rate, quick, tax } = annualTax(cumTaxable);
  return { cumIncome, cumTaxable, rate, quick, cumTax: Math.max(0, tax) };
}

const yuan = (n) => '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (r) => (r * 100).toFixed(0) + '%';

export const manifest = {
  inputs: [
    { name: 'salary', label: '税前月薪（元）', type: 'number', default: 15000, placeholder: '如 15000' },
    { name: 'month', label: '计算第几个月（1–12）', type: 'number', default: String(new Date().getMonth() + 1), placeholder: '如 10' },
    { name: 'social', label: '三险一金个人部分（元/月）', type: 'number', default: 0, placeholder: '工资条上的个人缴纳合计' },
    {
      name: 'kids',
      label: '子女教育扣除',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: '无' },
        { value: '1000', label: '1 个子女 · 夫妻各半（1000 元/月）' },
        { value: '2000', label: '合计 2000 元/月（1 个子女全额，或 2 个子女各半）' },
        { value: '4000', label: '合计 4000 元/月（2 个子女全额）' },
      ],
    },
    {
      name: 'toddlers',
      label: '3 岁以下婴幼儿照护',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: '无' },
        { value: '2000', label: '1 个婴幼儿（2000 元/月）' },
        { value: '4000', label: '2 个婴幼儿（4000 元/月）' },
        { value: '6000', label: '3 个及以上（6000 元/月）' },
      ],
    },
    {
      name: 'elder',
      label: '赡养老人扣除',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: '无' },
        { value: '3000', label: '独生子女（3000 元/月）' },
        { value: '1500', label: '非独生子女 · 分摊（不超过 1500 元/月）' },
      ],
    },
    {
      name: 'housing',
      label: '住房扣除（贷款利息与租金二选一）',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: '无' },
        { value: '1000', label: '住房贷款利息（1000 元/月）' },
        { value: '1500', label: '住房租金 · 直辖市/省会/计划单列市（1500 元/月）' },
        { value: '1100', label: '住房租金 · 市辖区户籍人口超 100 万（1100 元/月）' },
        { value: '800', label: '住房租金 · 不超过 100 万（800 元/月）' },
      ],
    },
    {
      name: 'edu',
      label: '继续教育扣除',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: '无' },
        { value: '400', label: '学历（学位）教育（400 元/月）' },
        { value: '300', label: '职业资格教育（3600 元/年，约 300 元/月）' },
      ],
    },
    { name: 'other', label: '其他扣除（元/月）', type: 'number', default: 0, placeholder: '商业健康险、年金等' },
  ],
  runLabel: '计算个税',
  tips: [
    '累计预扣法下，年初月薪相同个税也低，累计越接近高税率档，单月个税越高——全年 12 个月相加正好等于年度汇算税额',
    '年终奖可以选单独计税或并入综合所得，哪种划算取决于收入水平，发奖前用两种方式各算一次',
    '三险一金、专项附加扣除都按「当年累计」计算，年中才开始的扣除记得从实际发生月份算起',
  ],
  scenarios: [
    { scene: '工资条上的个税看不懂', how: '填入月薪、三险一金和专项附加扣除', result: '逐月列出累计应税额、税率和当月个税' },
    { scene: '跳槽后两家公司分别扣税', how: '按下家的累计口径重新计算，此前已缴手工从累计里减', result: '避免两家公司各自从低档税率扣、汇算时补税' },
    { scene: '发年终奖前想比一比', how: '先按本工具算并入综合所得的全年税，再对比单独计税', result: '选总额更小的那种方式' },
  ],
  example: { salary: '15000', month: '10', social: '2500', kids: '2000', toddlers: '0', elder: '0', housing: '1500', edu: '0', other: '0' },
};

export async function run(v) {
  const salary = Number(v.salary);
  const month = Math.round(Number(v.month));
  if (!Number.isFinite(salary) || salary <= 0) throw new Error('请先输入税前月薪（大于 0 的数字）');
  if (!Number.isFinite(month) || month < 1 || month > 12) throw new Error('计算月份需要在 1–12 之间');

  const social = Math.max(0, Number(v.social) || 0);
  const other = Math.max(0, Number(v.other) || 0);
  const extra = ['kids', 'toddlers', 'elder', 'housing', 'edu'].reduce((s, k) => s + (Number(v[k]) || 0), 0);

  const now = cumulative(salary, month, social, extra, other);
  const prev = cumulative(salary, month - 1, social, extra, other);
  const monthTax = now.cumTax - prev.cumTax;
  const net = salary - social - monthTax;

  // 全年各月预测（假设月薪与扣除全年不变）
  const rows = [];
  let prevCum = 0;
  for (let m = 1; m <= 12; m++) {
    const c = cumulative(salary, m, social, extra, other);
    const t = c.cumTax - prevCum;
    prevCum = c.cumTax;
    rows.push({ m, cumTaxable: c.cumTaxable, rate: c.rate, tax: t, net: salary - social - t, cum: c.cumTax });
  }
  const year = rows[11];
  const burden = salary * 12 ? (year.cum / (salary * 12)) * 100 : 0;

  const detail = [
    ['累计收入', now.cumIncome],
    ['累计减除费用（5000×月数）', BASIC * month],
    ['累计专项扣除（三险一金）', social * month],
    ['累计专项附加扣除', extra * month],
    ['累计其他扣除', other * month],
    ['累计应纳税所得额', now.cumTaxable],
  ];

  const rowsHtml = rows
    .map(
      (r) => `<tr${r.m === month ? ' style="font-weight:700;background:rgba(37,99,235,.08)"' : ''}>
        <td>${r.m} 月</td><td>${num(salary)}</td><td>${num(r.cumTaxable)}</td><td>${pct(r.rate)}</td>
        <td>${yuan(r.tax)}</td><td>${yuan(r.net)}</td><td>${yuan(r.cum)}</td></tr>`
    )
    .join('');

  const detailHtml = detail.map(([k, n]) => `<tr><td>${k}</td><td style="text-align:right">${num(n)}</td></tr>`).join('');

  return {
    html: `
      <div class="msg-ok">✅ 按累计预扣法计算完成（${month} 月，适用税率 ${pct(now.rate)}）</div>
      <div class="tax-hero">
        <div class="tax-hero-item"><b>${yuan(monthTax)}</b><span>本月应预扣个税</span></div>
        <div class="tax-hero-item"><b>${yuan(net)}</b><span>本月税后到手</span></div>
      </div>
      <table class="tbl">
        <thead><tr><th>累计计算明细（前 ${month} 个月）</th><th style="text-align:right">金额（元）</th></tr></thead>
        <tbody>${detailHtml}</tbody>
      </table>
      <h3 style="margin:18px 0 8px">全年各月预测<span style="font-size:13px;color:var(--muted);font-weight:400">（假设月薪与扣除全年不变；高亮为当前月份）</span></h3>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr><th>月份</th><th>税前月薪</th><th>累计应纳税所得额</th><th>适用税率</th><th>当月个税</th><th>当月税后</th><th>累计个税</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <div class="msg-ok" style="margin-top:14px">全年合计：税前 ${yuan(salary * 12)} · 个税 ${yuan(year.cum)} · 税后 ${yuan(salary * 12 - social * 12 - year.cum)}（税负率 ${burden.toFixed(2)}%）</div>
      <div class="panel tips" style="margin-top:14px">💡 <b>提示</b>
        <ul>
          <li>本工具计算工资薪金的<b>预扣</b>环节；次年 3–6 月汇算清缴时，全年四项综合所得合并后多退少补</li>
          <li>年中换工作、才有的专项附加扣除，会让各月个税分布与本表不同，以实际累计口径为准</li>
          <li>结果为本地估算，仅供参考，具体以税务机关计算为准</li>
        </ul>
      </div>`,
    text: [
      `税前月薪 ${yuan(salary)} · 三险一金 ${yuan(social)} · 专项附加扣除 ${yuan(extra)}`,
      `${month} 月应预扣个税 ${yuan(monthTax)}（适用税率 ${pct(now.rate)}），税后到手 ${yuan(net)}`,
      `全年合计：税前 ${yuan(salary * 12)} · 个税 ${yuan(year.cum)} · 税后 ${yuan(salary * 12 - social * 12 - year.cum)}（税负率 ${burden.toFixed(2)}%）`,
    ].join('\n'),
  };
}
