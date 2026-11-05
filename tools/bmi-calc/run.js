// 工具：BMI 计算器（纯浏览器执行）
//
// 判定用中国标准（WS/T 428-2013）：< 18.5 偏瘦、18.5–23.9 正常、24–27.9 超重、≥ 28 肥胖。
// 不采用 WHO 的 25 / 30 分界——同一套数字套在不同人群上，会把一批实际超重的人判成正常，
// 这是这个工具最容易被误用的地方，所以结果里把口径写明。
//
// 边界写法：24.0 属于超重、23.9 属于正常，用闭区间段判断而不是四舍五入后的字符串比较，
// 否则 23.95 会被显示成 24.0 却仍落在「正常」里，自相矛盾。
const BANDS = [
  { max: 18.5, label: '偏瘦', tone: 'warn', advice: '体重低于正常区间下端，注意是否近期掉得快' },
  { max: 24, label: '正常', tone: 'ok', advice: '落在中国标准的正常区间（18.5–23.9）' },
  { max: 28, label: '超重', tone: 'warn', advice: '超过中国标准上限 24，建议控制总热量并增加活动量' },
  { max: Infinity, label: '肥胖', tone: 'bad', advice: '达到中国标准肥胖线 28，建议就医评估代谢指标' },
];

export const manifest = {
  usage:
    '填身高（厘米）与体重（公斤），算出 BMI、按中国标准落在哪个区间，以及这个身高对应的正常体重范围。判定线用的是中国标准（WS/T 428-2013）：18.5 / 24 / 28，不是 WHO 的 18.5 / 25 / 30。',
  tips: [
    '中国标准的上限是 24，WHO 是 25——同一个人按两套口径可能一个是「超重」一个是「正常」',
    'BMI 不区分肌肉与脂肪：常年力量训练的人 BMI 偏高但体脂不高，别只看这一个数',
    '孕期、未成年人、65 岁以上人群不适用成人 BMI 判定区间',
    '正常体重范围按身高反算（18.5–23.9 × 身高²），和你现在体重的差值是「要减多少 / 还能长多少」',
  ],
  scenarios: [
    { scene: '体检报告上 BMI 24.3 算不算超重', how: '填身高体重看区间', result: '按中国标准判为超重（≥24），并把 24 这条线的来历写明' },
    { scene: '想知道这个身高多重算正常', how: '只看结果里的正常体重范围', result: '拿到下限与上限两个数，不用自己算 18.5×1.75²' },
    { scene: '减重定目标', how: '看「距正常上限」这一行', result: '直接给出要减多少公斤，比盯着 BMI 数字直观' },
  ],
  inputs: [
    { name: 'height', label: '身高（厘米）', type: 'number', placeholder: '175', min: 50, max: 250 },
    { name: 'weight', label: '体重（公斤）', type: 'number', placeholder: '70', min: 5, max: 400 },
  ],
  runLabel: '计算',
};

export async function run({ height, weight }) {
  const h = Number(String(height ?? '').trim());
  const w = Number(String(weight ?? '').trim());

  if (height === '' || height === undefined || height === null || Number.isNaN(h)) throw new Error('请填身高（厘米），例如 175');
  if (weight === '' || weight === undefined || weight === null || Number.isNaN(w)) throw new Error('请填体重（公斤），例如 70');
  if (h <= 0) throw new Error(`身高要大于 0，收到的是 ${h}。身高按厘米填，不是米：1.75 米请写 175`);
  if (w <= 0) throw new Error(`体重要大于 0，收到的是 ${w}。体重按公斤填，不是斤：140 斤请写 70`);
  if (h < 50) throw new Error(`身高 ${h} 厘米太小了（成人不可能低于 50 厘米）。是不是把米当成厘米填了？1.75 米要写 175`);
  if (h > 250) throw new Error(`身高 ${h} 厘米超出成人范围（250 厘米以内）。单位是厘米吗？`);
  if (w < 5) throw new Error(`体重 ${w} 公斤太小了，请确认单位是公斤`);
  if (w > 400) throw new Error(`体重 ${w} 公斤超出范围（400 公斤以内），请确认单位是公斤而不是斤`);

  const m = h / 100;
  const bmi = w / (m * m);
  const band = BANDS.find((b) => bmi < b.max);
  const lo = 18.5 * m * m;
  const hi = 23.9 * m * m;
  const toHi = w - hi;
  const toLo = lo - w;

  const toneClass = band.tone === 'ok' ? 'msg-ok' : band.tone === 'bad' ? 'msg-err' : 'msg-warn';
  const icon = band.tone === 'ok' ? '✅' : band.tone === 'bad' ? '⚠️' : '⚠️';

  const rows = [
    ['BMI', bmi.toFixed(1)],
    ['判定', band.label],
    ['正常体重范围', `${lo.toFixed(1)} – ${hi.toFixed(1)} 公斤（按 18.5–23.9 反算）`],
    [
      toHi > 0 ? '距正常上限' : '距正常下限',
      toHi > 0 ? `超出 ${toHi.toFixed(1)} 公斤` : toLo > 0 ? `还差 ${toLo.toFixed(1)} 公斤到下限` : '已在正常区间内',
    ],
    ['判定口径', '中国标准 WS/T 428-2013：偏瘦 <18.5，正常 18.5–23.9，超重 24–27.9，肥胖 ≥28'],
  ];
  if (band.tone !== 'ok') rows.splice(2, 0, ['建议', band.advice]);

  return {
    html: `<div class="${toneClass}">${icon} BMI ${bmi.toFixed(1)} · ${band.label}</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted);width:32%">${k}</td><td style="padding:6px 4px">${v}</td></tr>`
          )
          .join('')}
      </table>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">BMI 只看身高体重的比值，分不清肌肉与脂肪；孕期、未成年人、65 岁以上人群不适用这套成人区间。数字仅供参考，不构成医学建议。</p>`,
    text: [
      `BMI：${bmi.toFixed(1)}`,
      `判定：${band.label}（中国标准）`,
      `正常体重范围：${lo.toFixed(1)} – ${hi.toFixed(1)} 公斤`,
      toHi > 0 ? `超出正常上限：${toHi.toFixed(1)} 公斤` : toLo > 0 ? `距正常下限还差：${toLo.toFixed(1)} 公斤` : '已在正常区间内',
    ].join('\n'),
  };
}
