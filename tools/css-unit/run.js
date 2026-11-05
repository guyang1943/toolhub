// 工具：CSS 单位换算（px/rem/em/vw/vh/pt，纯浏览器执行）
//
// 换算都以 px 为中转，但四个单位的「参照物」不是一回事，不写清就等于给错答案：
// · rem 参照根元素字号（默认 16px，可在本页改）
// · em 参照父元素字号——本工具只能假设它等于基准字号，界面上必须说明
// · vw / vh 参照视口，这里固定按 1920×1080 折算，也只能是假设
// · pt 是绝对单位：1pt = 1/72 英寸，CSS 里 1px = 1/96 英寸，所以 1pt = 4/3 px
// 所以结果区把「按什么假设算的」写在数字旁边，而不是藏在提示里。
const VIEW_W = 1920;
const VIEW_H = 1080;
const UNITS = ['px', 'rem', 'em', 'vw', 'vh', 'pt'];

export const manifest = {
  usage:
    '在 px / rem / em / vw / vh / pt 之间换算，基准字号可改。结果会同时给出六种单位的对照值，并标明 vw/vh 是按 1920×1080、em 是按「父级字号等于基准字号」折算的。',
  tips: [
    'vw / vh 固定按 1920×1080 视口折算，换视口要自己按比例再算——结果里会写明这个假设',
    'em 参照父元素字号，本工具只能假设父级字号等于基准字号；嵌套元素里 em 会逐层变化',
    'pt 是印刷单位：1pt = 4/3 px（1/72 英寸 vs 1/96 英寸），所以 12pt = 16px',
    '改基准字号（常见 16、14、10）会影响 rem / em 的全部结果，做设计还原时先确认设计稿用的是哪个',
  ],
  scenarios: [
    { scene: '设计稿标的是 px，代码要用 rem', how: '填 24、选 px → rem、基准 16', result: '得到 1.5rem，直接写进样式' },
    { scene: '要做随视口缩放的标题', how: '填 px 值 → 选 vw', result: '按 1920 宽度折算出 vw，并知道假设前提' },
    { scene: '字体规范给的是 pt', how: '填 12pt → 选 px', result: '得到 16px，和浏览器里的实际渲染对上' },
  ],
  inputs: [
    { name: 'value', label: '数值', type: 'number', placeholder: '如 24' },
    {
      name: 'from',
      label: '原单位',
      type: 'select',
      options: UNITS.map((u) => ({ value: u, label: u })),
    },
    {
      name: 'to',
      label: '目标单位',
      type: 'select',
      options: UNITS.map((u) => ({ value: u, label: u })),
    },
    { name: 'base', label: '基准字号（px，留空按 16）', type: 'number', min: 1, max: 200, placeholder: '16' },
  ],
  runLabel: '换算',
};

function toPx(v, unit, base) {
  switch (unit) {
    case 'px':
      return v;
    case 'rem':
    case 'em':
      return v * base;
    case 'vw':
      return (v * VIEW_W) / 100;
    case 'vh':
      return (v * VIEW_H) / 100;
    case 'pt':
      return (v * 4) / 3;
    default:
      throw new Error(`不认识的单位：${unit}`);
  }
}

function fromPx(px, unit, base) {
  switch (unit) {
    case 'px':
      return px;
    case 'rem':
    case 'em':
      return px / base;
    case 'vw':
      return (px / VIEW_W) * 100;
    case 'vh':
      return (px / VIEW_H) * 100;
    case 'pt':
      return (px * 3) / 4;
    default:
      throw new Error(`不认识的单位：${unit}`);
  }
}

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 10000) / 10000;
  return String(r);
}

export async function run({ value, from, to, base }) {
  const raw = value === undefined || value === null || String(value).trim() === '' ? '' : String(value).trim();
  if (!raw) throw new Error('请填要换算的数值');
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`「${raw}」不是数字`);
  if (Math.abs(v) > 1e9) throw new Error('数值太大了，CSS 里不会有这种尺寸');

  const baseRaw = base === undefined || base === null || String(base).trim() === '' ? 16 : Number(base);
  if (!Number.isFinite(baseRaw) || baseRaw < 1 || baseRaw > 200) throw new Error(`基准字号要在 1–200 px 之间（填的是 ${base}）`);

  const fromUnit = UNITS.includes(from) ? from : 'px';
  const toUnit = UNITS.includes(to) ? to : 'rem';
  const px = toPx(v, fromUnit, baseRaw);
  const result = fromPx(px, toUnit, baseRaw);

  const rows = UNITS.map((u) => {
    const val = fmt(fromPx(px, u, baseRaw));
    return `<tr style="border-bottom:1px solid var(--border)${u === toUnit ? ';font-weight:700' : ''}">
      <td style="padding:6px 4px;font-family:var(--mono)">${u}</td>
      <td style="padding:6px 4px;font-family:var(--mono);text-align:right">${val}</td>
      <td style="padding:6px 4px;color:var(--muted);font-size:12.5px">${u === toUnit ? '← 目标单位' : ''}</td>
    </tr>`;
  });

  const assumptions = [
    `基准字号 ${baseRaw}px（影响 rem、em）`,
    `vw/vh 按 ${VIEW_W}×${VIEW_H} 视口折算`,
    'em 假设父级字号等于基准字号；嵌套元素里 em 会逐层变化',
  ];

  return {
    html: `<div class="msg-ok">✅ ${v}${fromUnit} = <b style="font-size:18px;font-family:var(--mono)">${fmt(result)}${toUnit}</b></div>
      <p style="margin:10px 0 6px;color:var(--muted);font-size:13px">换算前提：${assumptions.join(' · ')}</p>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:8px">
        <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:12.5px"><th style="padding:6px 4px;text-align:left">单位</th><th style="padding:6px 4px;text-align:right">等值</th><th style="padding:6px 4px;text-align:left">备注</th></tr>
        ${rows.join('')}
      </table>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">中间以 px 为中转，保留 4 位小数；1pt = 4/3 px。</p>`,
    text: `${v}${fromUnit} = ${fmt(result)}${toUnit}（基准 ${baseRaw}px；vw/vh 按 ${VIEW_W}×${VIEW_H}）`,
  };
}
