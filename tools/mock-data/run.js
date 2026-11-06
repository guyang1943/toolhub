// 工具：测试假数据生成（纯浏览器执行，零依赖）
//
// 三条硬要求（TP7 任务书）：
//   1. 手机号只用现行已分配号段，不编 154 / 164 这类空段
//   2. 身份证号带 GB 11643（ISO 7064 MOD 11-2）校验位，地区码真实存在
//   3. 全部随机生成，结果区醒目标注「仅供测试，非真实号码」——不承诺零碰撞
//
// 数据边界：所有字节在本机内存里生成，不发请求、不上传、不写本地存储。
// 邮箱一律用 RFC 2606 保留域（example.com / example.net / example.org），
// 这样即便有人把结果塞进注册表单，也不会往真人邮箱发信。

// 核对日期与 ua-parse 同一批：号段会新增，行政区划会撤并，过期要重核。
const LAST_VERIFIED = '2026-11-06';

// 工信部已分配的中国移动电话号段前三位（不含 154 / 164 等空段、不含 14x 里未开放的）。
const MOBILE_PREFIXES = [
  '130', '131', '132', '133', '134', '135', '136', '137', '138', '139',
  '145', '146', '147', '148', '149',
  '150', '151', '152', '153', '155', '156', '157', '158', '159',
  '162', '165', '166', '167',
  '170', '171', '172', '173', '174', '175', '176', '177', '178',
  '180', '181', '182', '183', '184', '185', '186', '187', '188', '189',
  '190', '191', '192', '193', '195', '196', '197', '198', '199',
];

// 真实存在的县级行政区划代码（GB/T 2260）。身份证前六位取这里，
// 不是全量表——够用来造「能过被测系统校验」的假数据即可。
const REGIONS = [
  ['110101', '北京市东城区'],
  ['110105', '北京市朝阳区'],
  ['310101', '上海市黄浦区'],
  ['310115', '上海市浦东新区'],
  ['440305', '广东省深圳市南山区'],
  ['440106', '广东省广州市天河区'],
  ['330106', '浙江省杭州市西湖区'],
  ['320115', '江苏省南京市江宁区'],
  ['510104', '四川省成都市锦江区'],
  ['500103', '重庆市渝中区'],
  ['420111', '湖北省武汉市洪山区'],
  ['610113', '陕西省西安市雁塔区'],
  ['370102', '山东省济南市历下区'],
  ['350203', '福建省厦门市思明区'],
  ['130102', '河北省石家庄市长安区'],
  ['210202', '辽宁省大连市中山区'],
  ['410105', '河南省郑州市金水区'],
  ['430111', '湖南省长沙市雨花区'],
  ['530102', '云南省昆明市五华区'],
  ['650102', '新疆乌鲁木齐市天山区'],
];

const SURNAMES = ('王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤').split('');
const GIVEN = ('伟 芳 娜 秀英 敏 静 丽 强 磊 军 洋 勇 艳 杰 娟 涛 明 超 秀霞 平 刚 桂兰 文 辉 力 俊 峰 建华 思宇 晨 浩然 子轩 梓涵 欣怡 雨泽 嘉宁 安琪 若曦 一诺 子墨 可欣 宇航 诗涵 俊杰').split(' ');
const ROADS = ('人民路 中山路 建设路 解放路 文化街 科技大道 学府路 长江路 黄河街 春晖路 望江路 银杏街 青云路 海棠巷 梧桐街 滨河路 和平大道 创新路').split(' ');
const MAIL_DOMAINS = ['example.com', 'example.net', 'example.org'];

// 顺序码池：优先取 000–009 与 990–999 两端，降低与真实身份证碰撞的概率。
// 其余 8 位（地区 + 生日）仍然随机，所以每次结果都不同。
const ORDER_POOL = [
  ...Array.from({ length: 10 }, (_, i) => String(i).padStart(3, '0')),
  ...Array.from({ length: 10 }, (_, i) => String(990 + i)),
];

/** 取 [0, n) 的随机整数：优先用 CSPRNG，Node 测试环境回退到 Math.random */
function rnd(n) {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && typeof c.getRandomValues === 'function') {
    // 用拒绝采样消除取模偏差（这里 n 很小，实际几乎不会重采）
    const limit = Math.floor(4294967296 / n) * n;
    const buf = new Uint32Array(1);
    let v;
    do {
      c.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return v % n;
  }
  return Math.floor(Math.random() * n);
}
const pick = (arr) => arr[rnd(arr.length)];
const digits = (n) => Array.from({ length: n }, () => rnd(10)).join('');

function makeName() {
  return pick(SURNAMES) + (rnd(3) === 0 ? pick(GIVEN) + pick(GIVEN) : pick(GIVEN));
}
function makeMobile() {
  return pick(MOBILE_PREFIXES) + digits(8);
}
function makeEmail() {
  const local = Array.from({ length: 6 + rnd(5) }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[rnd(32)]).join('');
  return local + '@' + pick(MAIL_DOMAINS);
}
function makeAddress() {
  const [, regionName] = pick(REGIONS);
  return regionName + pick(ROADS) + (1 + rnd(199)) + '号' + (1 + rnd(20)) + '栋' + (1 + rnd(30)) + '单元' + (101 + rnd(800)) + '室';
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = '10X98765432';

function makeId() {
  const [code] = pick(REGIONS);
  const year = 1970 + rnd(36); // 1970–2005
  const month = 1 + rnd(12);
  const dayMax = new Date(year, month, 0).getDate(); // 自动处理闰年
  const day = 1 + rnd(dayMax);
  const birth = String(year) + String(month).padStart(2, '0') + String(day).padStart(2, '0');
  const body = code + birth + pick(ORDER_POOL);
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(body[i]) * ID_WEIGHTS[i];
  return body + ID_CHECK[sum % 11];
}

/** 校验位自检：生成完立刻按 GB 11643 验一遍，算错就当场抛错，不把坏数据交给用户 */
export function verifyId(id) {
  if (!/^\d{17}[\dX]$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * ID_WEIGHTS[i];
  return ID_CHECK[sum % 11] === id[17];
}

const KINDS = [
  { value: 'all', label: '全套（姓名+手机+邮箱+地址+身份证）' },
  { value: 'name', label: '姓名' },
  { value: 'mobile', label: '手机号' },
  { value: 'email', label: '邮箱' },
  { value: 'address', label: '地址' },
  { value: 'id', label: '身份证号' },
];
const MAKERS = { name: makeName, mobile: makeMobile, email: makeEmail, address: makeAddress, id: makeId };
const LABELS = { name: '姓名', mobile: '手机号', email: '邮箱', address: '地址', id: '身份证号' };
const FORMATS = [
  { value: 'lines', label: '每行一个' },
  { value: 'csv', label: 'CSV（带表头）' },
  { value: 'json', label: 'JSON 数组' },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const manifest = {
  usage:
    '选一类数据和条数，生成可直接粘进测试用例的假数据。手机号只用现行已分配号段，身份证号带 GB 11643 校验位且地区码真实；全部随机生成，仅供测试，不是真实号码。支持每行一个 / CSV / JSON 三种格式。',
  tips: [
    '结果区标了「仅供测试，非真实号码」：身份证顺序码优先取 000/999 两端降低碰撞，但不承诺零碰撞',
    '邮箱统一用 example.com / .net / .org（RFC 2606 保留域），误填进注册表单也不会发信给真人',
    '手机号只从 2026-11-06 核对过的已分配号段里取，不含 154 / 164 这类空段',
    '身份证最后一位按 GB 11643 的 MOD 11-2 算出，生成后工具会自己再验一遍；校验位可用现有「身份证校验」工具复核',
    '地址只保证省市区名称与行政区划代码真实，街道门牌是编的；邮编、经纬度不在生成范围',
    '所有数据在本机内存里生成，不发请求、不上传、不写本地存储',
  ],
  scenarios: [
    { scene: '给注册表单灌测试数据', how: '类型选「全套」，条数填 20，格式选 CSV', result: '拿到 20 行带表头的假用户，直接存成 .csv 喂给脚本' },
    { scene: '验证手机号正则写得对不对', how: '只生成 50 个手机号', result: '全是 11 位、前三位属于现行号段，能被正常规则匹配' },
    { scene: '检查身份证校验逻辑', how: '生成身份证号，粘进站内「身份证校验」工具', result: '校验位全部通过，说明被测系统的算法没问题' },
  ],
  inputs: [
    { name: 'kind', label: '数据类型', type: 'select', options: KINDS, default: 'all' },
    { name: 'count', label: '生成条数（1–100）', type: 'number', min: 1, max: 100, default: 10 },
    { name: 'format', label: '输出格式', type: 'select', options: FORMATS, default: 'lines' },
  ],
  example: { kind: 'all', count: 5, format: 'lines' },
  runLabel: '生成',
};

const WARNING = '仅供测试，非真实号码';

export async function run({ kind, count, format }) {
  const k = KINDS.some((x) => x.value === kind) ? kind : 'all';
  const f = FORMATS.some((x) => x.value === format) ? format : 'lines';
  const n = Math.max(1, Math.min(100, Math.floor(Number(count) || 10)));
  const keys = k === 'all' ? Object.keys(MAKERS) : [k];

  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    for (const key of keys) row[key] = MAKERS[key]();
    if (row.id && !verifyId(row.id)) throw new Error('生成的身份证号校验位没通过自检，请重试');
    rows.push(row);
  }

  let body;
  if (f === 'json') {
    body = JSON.stringify(k === 'all' ? rows : rows.map((r) => r[k]), null, 2);
  } else if (f === 'csv') {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    body = [keys.map((x) => q(LABELS[x])).join(','), ...rows.map((r) => keys.map((x) => q(r[x])).join(','))].join('\n');
  } else {
    body = rows.map((r) => (k === 'all' ? keys.map((x) => LABELS[x] + '：' + r[x]).join(' | ') : r[k])).join('\n');
  }

  const warn =
    '<div style="background:#fff4ce;border:1px solid #e0b64c;color:#6b4e00;padding:10px 12px;border-radius:6px;font-weight:700;font-size:14px">' +
    '⚠️ ' + WARNING + '：号码随机生成，可能碰巧与真实号码重复，切勿用于实名、注册或任何对外用途</div>';

  const meta =
    '<p style="margin-top:10px;color:var(--muted);font-size:13px">共 ' + n + ' 条 · ' + (k === 'all' ? '全套字段' : LABELS[k]) +
    ' · ' + (f === 'json' ? 'JSON 数组' : f === 'csv' ? 'CSV' : '每行一个') +
    '。号段与行政区划最后核对：' + LAST_VERIFIED + '。邮箱使用 RFC 2606 保留域。</p>';

  return {
    html:
      warn +
      meta +
      '<pre style="white-space:pre-wrap;word-break:break-all;padding:12px;margin-top:8px;background:var(--bg-alt,#f6f7f9);border:1px solid var(--border);border-radius:6px;font-family:var(--mono);font-size:13px;line-height:1.7">' +
      esc(body) +
      '</pre>',
    text: '⚠️ ' + WARNING + '（号码随机生成，不承诺零碰撞）\n' + body,
  };
}
