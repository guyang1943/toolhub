// 工具：房贷计算器（等额本息 / 等额本金，纯本地计算）
// 公式：等额本息 M = P·r·(1+r)^n / ((1+r)^n − 1)；等额本金 每月本金 = P/n，利息按月递减
const yuan = (n) => '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rateText = (r) => (Math.round(r * 1000) / 1000).toString() + '%';

// 生成逐月还款计划
function schedule(principal, annualRate, years, mode) {
  const n = Math.round(years * 12);
  const r = annualRate / 100 / 12;
  const rows = [];
  let balance = principal;
  let totalInterest = 0;
  const fixedPrincipal = principal / n;
  const fixedPayment = r === 0 ? principal / n : (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

  for (let m = 1; m <= n; m++) {
    const interest = balance * r;
    let pay = mode === 'equal-payment' ? fixedPayment : fixedPrincipal + interest;
    let principalPart = pay - interest;
    // 末期抹平浮点尾差，保证本金恰好还完
    if (m === n) {
      principalPart = balance;
      pay = principalPart + interest;
    }
    balance = Math.max(0, balance - principalPart);
    totalInterest += interest;
    rows.push({ m, pay, principalPart, interest, balance });
  }
  return { rows, totalInterest, total: principal + totalInterest, fixedPayment };
}

// 按年汇总
function byYear(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 12) {
    const chunk = rows.slice(i, i + 12);
    out.push({
      year: Math.floor(i / 12) + 1,
      pay: chunk.reduce((s, x) => s + x.pay, 0),
      principalPart: chunk.reduce((s, x) => s + x.principalPart, 0),
      interest: chunk.reduce((s, x) => s + x.interest, 0),
      balance: chunk[chunk.length - 1].balance,
    });
  }
  return out;
}

export const manifest = {
  usage:
    '输入贷款金额、年利率和年限，选择还款方式，即可看到月供、支付利息总额、还款总额，以及逐年的本金与利息构成。工具会同时算出另一种还款方式的结果并对比总利息差，方便你在签约前判断哪种更合适。全部为本地计算，不上传任何信息。',
  tips: [
    '等额本息每月还款额固定，前期利息占比高；等额本金每月还款递减，总利息更少但前期压力大',
    '利率填合同上的年利率（如 3.5 表示 3.5%），LPR 加点后的实际执行利率请以银行为准',
    '公积金与商业贷款可以分别算一遍再相加，组合贷就是两笔贷款的结果之和',
    '提前还款后剩余期限不变或缩短，结果会不同，这里只按「按期还满」计算',
  ],
  scenarios: [
    { scene: '准备签贷款合同，想确认月供压力', how: '填金额/利率/年限 → 等额本息', result: '固定月供、总利息、利息占本金比例' },
    { scene: '纠结选等额本息还是等额本金', how: '算完后看下方两种方式的总利息对比', result: '直接看到省多少利息、首月多付多少' },
    { scene: '想核对银行给的还款计划表', how: '按同样条件算一遍，对照逐年本金余额', result: '发现利率或年限是否被写错' },
  ],
  inputs: [
    { name: 'amount', label: '贷款金额（万元）', type: 'number', default: 100, placeholder: '如 100' },
    { name: 'rate', label: '年利率（%）', type: 'number', default: 3.5, placeholder: '如 3.5' },
    {
      name: 'years',
      label: '贷款年限',
      type: 'select',
      default: '30',
      options: [
        { value: '5', label: '5 年（60 期）' },
        { value: '10', label: '10 年（120 期）' },
        { value: '15', label: '15 年（180 期）' },
        { value: '20', label: '20 年（240 期）' },
        { value: '25', label: '25 年（300 期）' },
        { value: '30', label: '30 年（360 期）' },
      ],
    },
    {
      name: 'mode',
      label: '还款方式',
      type: 'select',
      default: 'equal-payment',
      options: [
        { value: 'equal-payment', label: '等额本息（每月还款额固定）' },
        { value: 'equal-principal', label: '等额本金（每月本金固定，月供递减）' },
      ],
    },
  ],
  runLabel: '计算月供',
};

export async function run(v) {
  const principal = (Number(v.amount) || 0) * 10000;
  const rate = Number(v.rate);
  const years = Number(v.years);
  const mode = v.mode === 'equal-principal' ? 'equal-principal' : 'equal-payment';

  if (!(principal > 0)) throw new Error('贷款金额需要大于 0（单位：万元）');
  if (principal > 100000000) throw new Error('贷款金额过大，请确认单位是「万元」');
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new Error('年利率请填 0–30 之间的数字（单位：%）');
  if (!Number.isFinite(years) || years < 1 || years > 40) throw new Error('贷款年限需要在 1–40 年之间');

  const main = schedule(principal, rate, years, mode);
  const other = schedule(principal, rate, years, mode === 'equal-payment' ? 'equal-principal' : 'equal-payment');
  const rows = main.rows;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const interestRatio = (main.totalInterest / principal) * 100;

  const heroMain =
    mode === 'equal-payment'
      ? `<div class="tax-hero-item"><b>${yuan(main.fixedPayment)}</b><span>每月还款额（固定）</span></div>`
      : `<div class="tax-hero-item"><b>${yuan(first.pay)}</b><span>首月还款（逐月递减）</span></div>`;

  const yearsRows = byYear(rows)
    .map(
      (y) => `<tr>
        <td>第 ${y.year} 年</td>
        <td>${yuan(y.pay)}</td>
        <td>${yuan(y.principalPart)}</td>
        <td>${yuan(y.interest)}</td>
        <td>${yuan(y.balance)}</td>
      </tr>`
    )
    .join('');

  const diff = other.totalInterest - main.totalInterest;
  const cheaper = diff > 0 ? '等额本金' : '等额本息';
  const compareHtml =
    Math.abs(diff) < 0.01
      ? '<li>两种方式总利息相同（利率为 0 时才会出现）</li>'
      : `<li>换成<b>${cheaper}</b>，总利息可${diff > 0 ? '少' : '多'}付 <b>${yuan(Math.abs(diff))}</b></li>
         <li>等额本金首月还款 ${yuan(other.rows[0].pay)}，末年降至 ${yuan(other.rows[other.rows.length - 1].pay)}</li>`;

  return {
    html: `
      <div class="msg-ok">✅ ${rateText(rate)} · ${years} 年（${rows.length} 期）· ${mode === 'equal-payment' ? '等额本息' : '等额本金'}，计算完成</div>
      <div class="tax-hero">
        ${heroMain}
        <div class="tax-hero-item"><b>${yuan(main.totalInterest)}</b><span>支付利息总额</span></div>
        <div class="tax-hero-item"><b>${yuan(main.total)}</b><span>还款总额</span></div>
      </div>
      <table class="tbl">
        <thead><tr><th>项目</th><th style="text-align:right">金额</th></tr></thead>
        <tbody>
          <tr><td>贷款本金</td><td style="text-align:right">${num(principal)}</td></tr>
          <tr><td>支付利息</td><td style="text-align:right">${num(main.totalInterest)}</td></tr>
          <tr><td>还款总额（本金 + 利息）</td><td style="text-align:right">${num(main.total)}</td></tr>
          <tr><td>利息占本金比例</td><td style="text-align:right">${interestRatio.toFixed(2)}%</td></tr>
          <tr><td>首月构成（本金 / 利息）</td><td style="text-align:right">${num(first.principalPart)} / ${num(first.interest)}</td></tr>
          <tr><td>末期还款</td><td style="text-align:right">${num(last.pay)}</td></tr>
        </tbody>
      </table>
      <div class="panel tips" style="margin-top:14px">💡 <b>两种还款方式对比</b>
        <ul>
          <li>等额本息：每月 ${yuan(main.fixedPayment)}，总利息 ${yuan(main.totalInterest)}</li>
          <li>等额本金：首月 ${yuan(other.rows[0].pay)} → 末月 ${yuan(other.rows[other.rows.length - 1].pay)}，总利息 ${yuan(other.totalInterest)}</li>
          ${compareHtml}
        </ul>
      </div>
      <h3 style="margin:18px 0 8px">逐年还款明细<span style="font-size:13px;color:var(--muted);font-weight:400">（当前方式：${mode === 'equal-payment' ? '等额本息' : '等额本金'}）</span></h3>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>年度</th><th>当年还款</th><th>其中本金</th><th>其中利息</th><th>年末剩余本金</th></tr></thead>
          <tbody>${yearsRows}</tbody>
        </table>
      </div>
      <div class="panel tips" style="margin-top:14px">📌 <b>说明</b>
        <ul>
          <li>本表按「利率不变、按期还满」计算，不含提前还款、罚息、保险与评估等费用</li>
          <li>实际月供以银行放款时的还款计划表为准；LPR 浮动利率会随重定价日调整</li>
          <li>组合贷请把公积金与商业两部分分别计算后相加</li>
        </ul>
      </div>`,
  };
}
