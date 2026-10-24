// 工具：单位换算（长度/面积/体积/质量/温度/速度/时间/数据/压力/功率/能量/角度，纯本地计算）
// f = 每个单位折合「基准单位」的数量；温度为线性换算，单独处理
const UNITS = {
  length: {
    label: '长度',
    def: ['m', 'ft'],
    units: [
      { id: 'mm', name: '毫米 mm', f: 0.001 },
      { id: 'cm', name: '厘米 cm', f: 0.01 },
      { id: 'm', name: '米 m', f: 1 },
      { id: 'km', name: '千米 km', f: 1000 },
      { id: 'in', name: '英寸 in', f: 0.0254 },
      { id: 'ft', name: '英尺 ft', f: 0.3048 },
      { id: 'yd', name: '码 yd', f: 0.9144 },
      { id: 'mi', name: '英里 mi', f: 1609.344 },
      { id: 'nmi', name: '海里 nmi', f: 1852 },
    ],
  },
  area: {
    label: '面积',
    def: ['m2', 'mu'],
    units: [
      { id: 'mm2', name: '平方毫米 mm²', f: 1e-6 },
      { id: 'cm2', name: '平方厘米 cm²', f: 1e-4 },
      { id: 'm2', name: '平方米 m²', f: 1 },
      { id: 'km2', name: '平方千米 km²', f: 1e6 },
      { id: 'mu', name: '亩', f: 666.6666666667 },
      { id: 'ha', name: '公顷 ha', f: 10000 },
      { id: 'ft2', name: '平方英尺 ft²', f: 0.09290304 },
      { id: 'yd2', name: '平方码 yd²', f: 0.83612736 },
      { id: 'ac', name: '英亩 ac', f: 4046.8564224 },
    ],
  },
  volume: {
    label: '体积',
    def: ['L', 'gal'],
    units: [
      { id: 'mL', name: '毫升 mL', f: 0.001 },
      { id: 'L', name: '升 L', f: 1 },
      { id: 'cm3', name: '立方厘米 cm³', f: 0.001 },
      { id: 'm3', name: '立方米 m³', f: 1000 },
      { id: 'in3', name: '立方英寸 in³', f: 0.016387064 },
      { id: 'ft3', name: '立方英尺 ft³', f: 28.316846592 },
      { id: 'gal', name: '美制加仑 gal', f: 3.785411784 },
      { id: 'qt', name: '美制夸脱 qt', f: 0.946352946 },
      { id: 'pt', name: '美制品脱 pt', f: 0.473176473 },
      { id: 'oz', name: '美制液量盎司 fl oz', f: 0.0295735295625 },
    ],
  },
  mass: {
    label: '质量',
    def: ['kg', 'jin'],
    units: [
      { id: 'mg', name: '毫克 mg', f: 1e-6 },
      { id: 'g', name: '克 g', f: 0.001 },
      { id: 'kg', name: '千克 kg', f: 1 },
      { id: 't', name: '吨 t', f: 1000 },
      { id: 'jin', name: '市斤', f: 0.5 },
      { id: 'oz', name: '盎司 oz', f: 0.028349523125 },
      { id: 'lb', name: '磅 lb', f: 0.45359237 },
      { id: 'st', name: '英石 st', f: 6.35029318 },
    ],
  },
  temperature: {
    label: '温度',
    def: ['C', 'F'],
    units: [
      { id: 'C', name: '摄氏度 ℃' },
      { id: 'F', name: '华氏度 ℉' },
      { id: 'K', name: '开尔文 K' },
    ],
  },
  speed: {
    label: '速度',
    def: ['ms', 'kmh'],
    units: [
      { id: 'ms', name: '米/秒 m/s', f: 1 },
      { id: 'kmh', name: '千米/时 km/h', f: 1 / 3.6 },
      { id: 'mph', name: '英里/时 mph', f: 0.44704 },
      { id: 'kn', name: '节 kn', f: 0.5144444444444444 },
      { id: 'mach', name: '马赫 Ma（15℃ 海平面）', f: 340.29 },
    ],
  },
  time: {
    label: '时间',
    def: ['h', 'min'],
    units: [
      { id: 'ms', name: '毫秒 ms', f: 0.001 },
      { id: 's', name: '秒 s', f: 1 },
      { id: 'min', name: '分钟 min', f: 60 },
      { id: 'h', name: '小时 h', f: 3600 },
      { id: 'd', name: '天 d', f: 86400 },
      { id: 'wk', name: '周 wk', f: 604800 },
      { id: 'mo', name: '月（30 天）', f: 2592000 },
      { id: 'yr', name: '年（365 天）', f: 31536000 },
    ],
  },
  data: {
    label: '数据存储',
    def: ['MB', 'MiB'],
    units: [
      { id: 'bit', name: '位 bit', f: 0.125 },
      { id: 'B', name: '字节 B', f: 1 },
      { id: 'KB', name: '千字节 KB（10³）', f: 1e3 },
      { id: 'MB', name: '兆字节 MB（10⁶）', f: 1e6 },
      { id: 'GB', name: '吉字节 GB（10⁹）', f: 1e9 },
      { id: 'TB', name: '太字节 TB（10¹²）', f: 1e12 },
      { id: 'KiB', name: 'KiB（2¹⁰）', f: 1024 },
      { id: 'MiB', name: 'MiB（2²⁰）', f: 1048576 },
      { id: 'GiB', name: 'GiB（2³⁰）', f: 1073741824 },
      { id: 'TiB', name: 'TiB（2⁴⁰）', f: 1099511627776 },
    ],
  },
  pressure: {
    label: '压力',
    def: ['kPa', 'psi'],
    units: [
      { id: 'Pa', name: '帕斯卡 Pa', f: 1 },
      { id: 'kPa', name: '千帕 kPa', f: 1e3 },
      { id: 'MPa', name: '兆帕 MPa', f: 1e6 },
      { id: 'bar', name: '巴 bar', f: 1e5 },
      { id: 'mbar', name: '毫巴 mbar', f: 1e2 },
      { id: 'atm', name: '标准大气压 atm', f: 101325 },
      { id: 'mmHg', name: '毫米汞柱 mmHg', f: 133.322387415 },
      { id: 'psi', name: '磅力/平方英寸 psi', f: 6894.757293168 },
    ],
  },
  power: {
    label: '功率',
    def: ['kW', 'PS'],
    units: [
      { id: 'W', name: '瓦 W', f: 1 },
      { id: 'kW', name: '千瓦 kW', f: 1e3 },
      { id: 'MW', name: '兆瓦 MW', f: 1e6 },
      { id: 'PS', name: '公制马力 PS', f: 735.49875 },
      { id: 'hp', name: '英制马力 hp', f: 745.6998715822702 },
    ],
  },
  energy: {
    label: '能量',
    def: ['kcal', 'kJ'],
    units: [
      { id: 'J', name: '焦耳 J', f: 1 },
      { id: 'kJ', name: '千焦 kJ', f: 1e3 },
      { id: 'cal', name: '卡 cal', f: 4.184 },
      { id: 'kcal', name: '千卡 kcal', f: 4184 },
      { id: 'Wh', name: '瓦时 Wh', f: 3600 },
      { id: 'kWh', name: '千瓦时 kWh', f: 3.6e6 },
      { id: 'BTU', name: '英热单位 BTU', f: 1055.05585262 },
    ],
  },
  angle: {
    label: '角度',
    def: ['deg', 'rad'],
    units: [
      { id: 'deg', name: '度 °', f: 1 },
      { id: 'rad', name: '弧度 rad', f: 57.29577951308232 },
      { id: 'gon', name: '百分度 gon', f: 0.9 },
      { id: 'arcmin', name: '角分 ′', f: 1 / 60 },
      { id: 'arcsec', name: '角秒 ″', f: 1 / 3600 },
    ],
  },
};

const toC = { C: (v) => v, F: (v) => ((v - 32) * 5) / 9, K: (v) => v - 273.15 };
const fromC = { C: (c) => c, F: (c) => (c * 9) / 5 + 32, K: (c) => c + 273.15 };

function convert(catId, fromId, toId, v) {
  const cat = UNITS[catId];
  if (!cat) throw new Error('未知的换算类型');
  const from = cat.units.find((u) => u.id === fromId);
  const to = cat.units.find((u) => u.id === toId);
  if (!from || !to) throw new Error('请先选择来源单位和目标单位');
  if (catId === 'temperature') return fromC[to.id](toC[from.id](v));
  return (v * from.f) / to.f;
}

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e13 || abs < 1e-7) return n.toExponential(4);
  return Number(n.toPrecision(8)).toLocaleString('zh-CN', { maximumFractionDigits: 8 });
}

export const manifest = {
  inputs: [
    {
      name: 'cat',
      label: '换算类型',
      type: 'select',
      default: 'length',
      options: Object.entries(UNITS).map(([id, c]) => ({ value: id, label: c.label })),
    },
    { name: 'value', label: '数值', type: 'number', default: '1', placeholder: '如 1.75' },
    { name: 'from', label: '来源单位', type: 'select', default: '', options: [{ value: '', label: '（随换算类型联动）' }] },
    { name: 'to', label: '目标单位', type: 'select', default: '', options: [{ value: '', label: '（随换算类型联动）' }] },
  ],
  runLabel: '换算',
  tips: [
    '存储容量有两套标准：KB/MB 按 1000 进制（厂商标注），KiB/MiB 按 1024 进制（系统显示），买 512GB 的盘显示约 477 GiB 是正常的',
    '马赫数随温压变化，这里按 15℃ 海平面标准大气（约 340.29 m/s）估算',
    '英制加仑与美制加仑不同，本工具的美制单位按 US customary 计算',
  ],
  scenarios: [
    { scene: '海淘页面写 5.5 ft，不知道多高', how: '换算类型选长度，5.5 英尺 → 米', result: '约 1.676 米' },
    { scene: '食谱用 fl oz，国内只有量杯', how: '体积类，8 fl oz → 毫升', result: '约 236.6 mL' },
    { scene: '硬盘标 1TB，系统显示 931GB', how: '数据类，1 TB → GiB', result: '约 931.32 GiB，并非容量缩水' },
  ],
  example: { cat: 'length', value: '1', from: 'm', to: 'ft' },
};

// 表单渲染后：根据「换算类型」联动填充两个单位下拉
export function onForm(form) {
  const cat = form.querySelector('#f-cat');
  const from = form.querySelector('#f-from');
  const to = form.querySelector('#f-to');
  if (!cat || !from || !to) return;
  const fill = () => {
    const c = UNITS[cat.value];
    if (!c) return;
    const opts = c.units.map((u) => `<option value="${u.id}">${u.name}</option>`).join('');
    from.innerHTML = opts;
    to.innerHTML = opts;
    from.value = c.def[0];
    to.value = c.def[1];
  };
  cat.addEventListener('change', fill);
  fill();
}

export async function run({ cat, value, from, to }) {
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error('请输入有效数字（支持小数与负数）');
  if (!from || !to) throw new Error('请先选择来源单位和目标单位');
  const result = convert(cat, from, to, v);
  const c = UNITS[cat];
  const fu = c.units.find((u) => u.id === from);
  const tu = c.units.find((u) => u.id === to);

  // 同类单位全量表：以来源单位为基准
  const table = c.units
    .map((u) => {
      const val = cat === 'temperature' ? fromC[u.id](toC[fu.id](v)) : (v * fu.f) / u.f;
      return `<tr${u.id === to.id ? ' style="font-weight:700;background:rgba(37,99,235,.08)"' : ''}>
        <td>${u.name}</td><td style="text-align:right">${fmt(val)}</td></tr>`;
    })
    .join('');

  return {
    html: `
      <div class="msg-ok">✅ ${fmt(v)} ${fu.name} = <b>${fmt(result)}</b> ${tu.name}</div>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="copy-btn">复制结果</button></div>
      <h3 style="margin:18px 0 8px">全部${c.label}单位对照<span style="font-size:13px;color:var(--muted);font-weight:400">（高亮为目标单位）</span></h3>
      <table class="tbl"><thead><tr><th>单位</th><th style="text-align:right">等于</th></tr></thead><tbody>${table}</tbody></table>`,
    after(box) {
      box.querySelector('#copy-btn').onclick = async (e) => {
        await navigator.clipboard.writeText(fmt(result));
        e.target.textContent = '已复制 ✓';
        setTimeout(() => (e.target.textContent = '复制结果'), 1500);
      };
    },
  };
}
