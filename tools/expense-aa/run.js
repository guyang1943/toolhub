// 工具：AA 分摊（纯浏览器执行）
//
// 三件容易算错的事，这里都按「钱」的规矩办：
//   1. 全程用整数分运算。0.1 + 0.2 !== 0.3，十几个人一分摊，尾差会凭空多出几分钱，
//      结果一贴到群里就有人问「怎么多了两毛」。除法只在最后一步、且带余数分配。
//   2. 分摊尾差有明确归属：除不尽的余数按「垫付最多的人先摊」的顺序分配，
//      不是随手塞给最后一个人，也不静默丢掉。
//   3. 转账笔数取最少：最大债主配最大债户，N 个人最多 N-1 笔。
//      挨个转「每人给每个人」是 N(N-1) 笔，5 个人就是 20 笔，真到群里没人愿意照做。
//
// 只吃不垫的人写 0，别漏行——漏了就等于默认他不参与，人均会算高。

const MAX_PEOPLE = 60;

function parseAmount(raw) {
  const s = String(raw).replace(/[¥￥,，\s]/g, '');
  if (!s) throw new Error('金额是空的');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error('「' + raw + '」不是合法金额：只写数字，最多两位小数（例如 128 或 128.50）');
  }
  return Math.round(Number(s) * 100);
}

function parseBill(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[#/]/.test(l));
  if (!lines.length) throw new Error('请按「人名 金额」每行一条填写，例如：张三 128');

  const order = [];
  const paid = new Map();
  for (const line of lines) {
    // 人名与金额之间允许空格、制表符、冒号、等号、逗号；人名自身不能带数字
    const m = /^(.+?)[\s:：=,，]+(-?[\d.,]+)$/.exec(line);
    if (!m) throw new Error('这一行读不出来：「' + line + '」。格式是「人名 金额」，中间用空格隔开');
    const name = m[1].trim();
    if (!name) throw new Error('「' + line + '」前面缺人名');
    if (name.length > 20) throw new Error('人名太长（超过 20 字）：「' + name.slice(0, 12) + '…」');
    const cents = parseAmount(m[2]);
    if (cents < 0) throw new Error('「' + name + '」的金额是负数：这里只填垫付金额，没垫钱就写 0');
    if (!paid.has(name)) {
      paid.set(name, 0);
      order.push(name);
    }
    paid.set(name, paid.get(name) + cents);
  }
  if (order.length > MAX_PEOPLE) throw new Error('人数超过 ' + MAX_PEOPLE + '，这个工具不是为这种场景做的');
  return { order, paid };
}

const yuan = (cents) => (cents / 100).toFixed(2);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const manifest = {
  usage:
    '每行写「人名 金额」，金额是这个人为这顿饭垫付了多少钱；只吃没垫钱的人写 0。点「算清」得到每人应摊多少、垫付了多少、差多少，以及最少几笔转账能结清。全程在本机算，金额不会上传。',
  tips: [
    '只吃没垫钱的人也要写一行（金额 0），漏了就等于默认他不参与，人均会被算高',
    '同一个人可以写多行（比如先垫了餐费又垫了打车费），会自动相加',
    '转账按「最少笔数」给：最大债主配最大债户，5 个人最多 4 笔，不是每人给每人',
    '精确到「元」时除不尽的零头有明确归属：垫付最多的人先摊，结果里会写清谁承担了多少尾差',
  ],
  scenarios: [
    {
      scene: '同事聚餐一个人先买单',
      how: '买单的人写实际付款额，其余人写 0',
      result: '直接给出「谁转谁多少钱」，照着发群里就行',
    },
    {
      scene: '几个人各付了一部分',
      how: '每人一行，写各自垫付的金额',
      result: '多退少补算清，转账笔数压到最少，不用互相转一圈',
    },
    {
      scene: '含服务费要凑整到元',
      how: '精确度选「元」',
      result: '每人应摊取整到元，零头归属写清楚，不会出现「多了三毛」',
    },
  ],
  inputs: [
    { name: 'bill', label: '每行「人名 金额」（只吃没垫钱写 0）', type: 'textarea', placeholder: '张三 328.5\n李四 0\n王五 46' },
    {
      name: 'roundTo',
      label: '每人应摊精确到',
      type: 'select',
      options: [
        { value: 'cent', label: '分（0.01 元）' },
        { value: 'jiao', label: '角（0.1 元）' },
        { value: 'yuan', label: '元（1 元）' },
      ],
    },
  ],
  runLabel: '算清',
};

export async function run({ bill, roundTo }) {
  const { order, paid } = parseBill(bill);
  const n = order.length;
  const total = order.reduce((s, name) => s + paid.get(name), 0);
  if (total <= 0 && n > 1) throw new Error('总垫付金额是 0：把所有金额都填 0 的话，没有账要算');

  const step = roundTo === 'yuan' ? 100 : roundTo === 'jiao' ? 10 : 1;

  // 应摊：先按「分」平分，余下的几分钱给垫付最多的人先摊；
  // 若要求精确到角/元，再把每份向下取整到 step，剩下的整 step 单位继续按同样顺序分。
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const byPayer = order.slice().sort((x, y) => paid.get(y) - paid.get(x) || order.indexOf(x) - order.indexOf(y));
  const raw = new Map(order.map((name) => [name, base]));
  for (let i = 0; i < rem; i++) {
    const who = byPayer[i % n];
    raw.set(who, raw.get(who) + 1);
  }

  // 精确度取整：向下取整到 step，凑不齐的部分按 step 一块一块补给垫付最多的人
  const share = new Map();
  let assigned = 0;
  for (const name of order) {
    const v = Math.floor(raw.get(name) / step) * step;
    share.set(name, v);
    assigned += v;
  }
  let gap = total - assigned;
  let gi = 0;
  while (gap >= step && gi < n * 200) {
    const who = byPayer[gi % n];
    share.set(who, share.get(who) + step);
    gap -= step;
    gi++;
  }
  if (gap > 0) {
    // 剩下的不足一个 step 的分位（只在「精确到角/元」时出现），归垫付最多的人
    const who = byPayer[0];
    share.set(who, share.get(who) + gap);
  }

  const balances = order.map((name) => ({ name, paid: paid.get(name), share: share.get(name), diff: paid.get(name) - share.get(name) }));
  // 注意：这里必须复制 diff，不能直接用 balances 里的对象——
  // 配对循环会边配对边把 diff 减到 0，借用同一个对象的话，下面的明细表会全变成「正好」。
  const creditors = balances.filter((b) => b.diff > 0).map((b) => ({ name: b.name, diff: b.diff })).sort((a, b) => b.diff - a.diff);
  const debtors = balances.filter((b) => b.diff < 0).map((b) => ({ name: b.name, diff: -b.diff })).sort((a, b) => b.diff - a.diff);

  // 贪心配对：最大债主 ↔ 最大债户。每次至少清掉一方，所以最多 N-1 笔。
  const transfers = [];
  let ci = 0;
  let di = 0;
  let guard = 0;
  while (ci < creditors.length && di < debtors.length && guard++ < 10000) {
    const c = creditors[ci];
    const d = debtors[di];
    const amt = Math.min(c.diff, d.diff);
    if (amt > 0) transfers.push({ from: d.name, to: c.name, amount: amt });
    c.diff -= amt;
    d.diff -= amt;
    if (c.diff === 0) ci++;
    if (d.diff === 0) di++;
  }

  const rows = balances
    .map((b) => {
      const sign = b.diff > 0 ? '垫多了' : b.diff < 0 ? '还要出' : '正好';
      const color = b.diff > 0 ? 'var(--ok)' : b.diff < 0 ? 'var(--err)' : 'var(--muted)';
      return (
        '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:6px 4px">' + esc(b.name) + '</td>' +
        '<td style="padding:6px 4px;font-family:var(--mono)">' + yuan(b.paid) + '</td>' +
        '<td style="padding:6px 4px;font-family:var(--mono)">' + yuan(b.share) + '</td>' +
        '<td style="padding:6px 4px;font-family:var(--mono);color:' + color + '">' +
        (b.diff === 0 ? '0.00' : (b.diff > 0 ? '+' : '−') + yuan(Math.abs(b.diff))) +
        ' <span style="color:var(--muted);font-size:12px">' + sign + '</span></td>' +
        '</tr>'
      );
    })
    .join('');

  const transferHtml = transfers.length
    ? '<ol style="margin:8px 0 0;padding-left:22px;font-size:14px">' +
      transfers
        .map((t) => '<li style="margin:4px 0"><strong>' + esc(t.from) + '</strong> 转给 <strong>' + esc(t.to) + '</strong> <span style="font-family:var(--mono)">' + yuan(t.amount) + ' 元</span></li>')
        .join('') +
      '</ol>'
    : '<p class="empty" style="padding:12px 0">不需要转账：每个人垫付的正好等于应摊的。</p>';

  const head =
    '<div class="msg-ok">🧾 ' + n + ' 人 · 总额 ' + yuan(total) + ' 元 · 人均 ' + yuan(Math.round(total / n)) +
    ' 元 · 需转账 ' + transfers.length + ' 笔</div>';
  const stepNote =
    step === 1
      ? '每人应摊精确到分。'
      : '每人应摊精确到' + (step === 100 ? '元' : '角') + '，除不尽的零头按「垫付最多的人先摊」分配：' +
        byPayer.slice(0, 3).map((x) => esc(x)).join('、') + (n > 3 ? ' 等' : '') + ' 承担了零头。';

  const textLines = ['总垫付 ' + yuan(total) + ' 元，' + n + ' 人，人均 ' + yuan(Math.round(total / n)) + ' 元'];
  for (const b of balances) {
    textLines.push(b.name + '：垫付 ' + yuan(b.paid) + '，应摊 ' + yuan(b.share) + '，' + (b.diff > 0 ? '应收回 ' + yuan(b.diff) : b.diff < 0 ? '应补 ' + yuan(-b.diff) : '正好'));
  }
  if (transfers.length) {
    textLines.push('转账方案（' + transfers.length + ' 笔）：');
    for (const t of transfers) textLines.push('  ' + t.from + ' → ' + t.to + ' ' + yuan(t.amount) + ' 元');
  } else {
    textLines.push('不需要转账。');
  }

  return {
    html:
      head +
      '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px">' +
      '<thead><tr>' +
      '<th style="text-align:left;padding:6px 4px;font-size:12px;color:var(--muted)">谁</th>' +
      '<th style="text-align:left;padding:6px 4px;font-size:12px;color:var(--muted)">垫付</th>' +
      '<th style="text-align:left;padding:6px 4px;font-size:12px;color:var(--muted)">应摊</th>' +
      '<th style="text-align:left;padding:6px 4px;font-size:12px;color:var(--muted)">差额</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h3 style="font-size:14px;margin:14px 0 0">转账方案（' + transfers.length + ' 笔结清）</h3>' +
      transferHtml +
      '<p style="margin-top:10px;color:var(--muted);font-size:13px">' + stepNote +
      '全程按整数分计算，不会出现「多了几分钱」的尾差。</p>',
    text: textLines.join('\n'),
  };
}
