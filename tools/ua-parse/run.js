// 工具：User-Agent 解析（纯浏览器执行，零依赖）
//
// 为什么不引 ua-parser-js：那套正则表 40 KB+，超过单工具 200 KB 预算的一半，
// 而且它是给服务端日志分析用的，这里只做「贴一段 UA，看看它是什么」。
//
// 两条口径写死，也在结果区原样说明：
//   1. 正则表有「最后核对日期」——UA 词半年一变（Arc、夸克、微信 XWEB/X5），过期要重核
//   2. 认不出来的字段一律写「未识别」并原样回显 UA，不猜、不按相近特征套一个品牌
//
// 数据边界：UA 只在本机内存里被正则匹配，不发请求、不写存储。
const LAST_VERIFIED = '2026-11-06';

// 顺序即优先级：越靠前越具体。Edg 必须在 Chrome 之前（Edge 的 UA 里也有 Chrome），
// MicroMessenger / XWEB 必须在 Safari 之前（微信内置浏览器的 UA 里也有 Safari）。
const BROWSERS = [
  { name: '微信内置浏览器', re: /MicroMessenger\/([\d.]+)/i },
  { name: 'QQ 浏览器', re: /(?:M?QQBrowser|QQ)\/([\d.]+)/i },
  { name: '夸克浏览器', re: /Quark\/([\d.]+)/i },
  { name: 'UC 浏览器', re: /(?:UCBrowser|UCWEB)\/([\d.]+)/i },
  { name: '百度 App', re: /baiduboxapp[/\s]([\d.]+)/i },
  { name: '钉钉内置浏览器', re: /DingTalk\/([\d.]+)/i },
  { name: '支付宝内置浏览器', re: /AlipayClient\/([\d.]+)/i },
  { name: '搜狗浏览器', re: /SogouMobileBrowser\/([\d.]+)/i },
  { name: '360 浏览器', re: /(?:QIHU 360SE|360Browser)\/([\d.]+)/i },
  { name: '华为浏览器', re: /HuaweiBrowser\/([\d.]+)/i },
  { name: '小米浏览器', re: /MiuiBrowser\/([\d.]+)/i },
  { name: '三星浏览器', re: /SamsungBrowser\/([\d.]+)/i },
  { name: 'Opera', re: /(?:OPR|Opera)\/([\d.]+)/i },
  { name: 'Vivaldi', re: /Vivaldi\/([\d.]+)/i },
  { name: 'Edge（Chromium）', re: /EdgA?\/([\d.]+)/i },
  { name: 'Edge（旧版 EdgeHTML）', re: /Edge\/([\d.]+)/i },
  { name: 'Brave', re: /Brave\/([\d.]+)/i },
  { name: 'Arc', re: /Arc\/([\d.]+)/i },
  { name: 'Electron', re: /Electron\/([\d.]+)/i },
  { name: 'Firefox', re: /(?:Firefox|FxiOS)\/([\d.]+)/i },
  { name: 'IE 11', re: /Trident\/.*rv:([\d.]+)/i },
  { name: 'IE 10 及以下', re: /MSIE ([\d.]+)/i },
  { name: 'Chrome', re: /(?:Chrome|CriOS|Chromium)\/([\d.]+)/i },
  { name: 'Safari', re: /Version\/([\d.]+).*Safari/i },
];

const ENGINES = [
  { name: 'XWEB（微信/腾讯WebView）', re: /XWEB\/([\d.]+)/i },
  { name: 'X5（腾讯浏览服务）', re: /(?:TBS|X5)\/([\d.]+)/i },
  { name: 'U3（UC 内核）', re: /U3\/([\d.]+)/i },
  { name: 'Trident', re: /Trident\/([\d.]+)/i },
  { name: 'Presto', re: /Presto\/([\d.]+)/i },
  { name: 'Gecko', re: /(?:Gecko|Firefox)\/([\d.]+)/i },
  { name: 'Blink', re: /(?:Chrome|Chromium|CriOS|EdgA?|OPR)\/([\d.]+)/i },
  { name: 'WebKit', re: /(?:AppleWebKit|Version\/[\d.]+.*Safari)\/([\d.]+)/i },
];

function osOf(ua) {
  if (/Windows NT 10\.0/.test(ua)) return 'Windows 10 / 11（NT 10.0，UA 无法区分 10 与 11）';
  const winMap = { '6.4': 'Windows 10 技术预览版', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7', '6.0': 'Windows Vista', '5.2': 'Windows XP x64', '5.1': 'Windows XP' };
  const w = /Windows NT ([\d.]+)/.exec(ua);
  if (w) return winMap[w[1]] || 'Windows NT ' + w[1];
  if (/Windows Phone/.test(ua)) return 'Windows Phone';
  const ios = /(?:iPhone OS|CPU OS|CPU iPhone OS) (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
  if (ios) return 'iOS / iPadOS ' + ios[1] + '.' + ios[2] + (ios[3] ? '.' + ios[3] : '');
  const mac = /Mac OS X (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
  if (mac) return 'macOS ' + mac[1] + '.' + mac[2] + (mac[3] ? '.' + mac[3] : '') + '（10.16 及以上 UA 仍写 10.15/10.16）';
  if (/HarmonyOS/.test(ua)) return 'HarmonyOS';
  const and = /Android (\d+(?:\.\d+){0,2})/.exec(ua);
  if (and) return 'Android ' + and[1];
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Ubuntu/.test(ua)) return 'Ubuntu Linux';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

const DEVICE_BRANDS = [
  ['HUAWEI', /HUAWEI|HONOR|HW-/i],
  ['Xiaomi / Redmi', /Xiaomi|Mi \d|Redmi|MIUI/i],
  ['OPPO / OnePlus', /OPPO|OnePlus|CPH\d|PBEM00/i],
  ['vivo', /vivo|V\d{4}[A-Z]/i],
  ['Samsung', /Samsung|SM-[A-Z]\d/i],
  ['Google Pixel', /Pixel \d/i],
  ['Meizu', /Meizu|MZ-/i],
  ['Lenovo / Motorola', /Lenovo|Moto/i],
  ['Apple', /iPhone|iPad|iPod|Macintosh/i],
];

function deviceOf(ua) {
  const brand = DEVICE_BRANDS.find(([, re]) => re.test(ua));
  const isMobile = /Mobile|Android|iPhone|iPod/i.test(ua);
  const isTablet = /iPad|Tablet(?!.*Mobile)|Android(?!.*Mobile)/i.test(ua);
  let kind = '桌面设备';
  if (isTablet) kind = '平板';
  else if (isMobile) kind = '移动设备';
  if (!brand && !isMobile && !isTablet && !/Macintosh|Windows/.test(ua)) return null;
  // 型号只在认出品牌时才取：桌面 UA 里的 x64 / Win64 是平台标记，不是设备型号，
  // 拿它当「型号」报出来正是「按相近特征瞎填一个」的坏例子。
  let model = '未识别';
  if (brand) {
    const m = /(?:;\s*)([A-Za-z0-9][A-Za-z0-9 _.\-]{2,28})\s*(?:Build|\))/.exec(ua);
    if (m) model = m[1].trim();
  }
  return {
    kind,
    brand: brand ? brand[0] : '未识别',
    model,
  };
}

function matchTable(table, ua) {
  for (const row of table) {
    const m = row.re.exec(ua);
    if (m) return { name: row.name, version: m[1] || '未识别' };
  }
  return null;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const UNKNOWN = '未识别';

export const manifest = {
  usage:
    '粘贴一段 User-Agent，拆成浏览器 / 内核 / 系统 / 设备四项；留空则解析你当前浏览器的 UA。认不出来的字段写「未识别」并原样回显，不按相近特征猜品牌。正则表标注了最后核对日期，UA 词会过期。',
  tips: [
    '留空直接点「解析」＝解析本机 UA；贴别人的 UA 时不会读取、也不会覆盖你自己的',
    '正则表最后核对于 2026-11-06：新浏览器（Arc、夸克、微信 XWEB/X5）的 UA 词半年就变一次，过期请重核',
    '认不出来就是认不出来：字段写「未识别」并把原文放出来，不猜、不套相近品牌',
    'Windows 10 与 11 的 UA 都是 NT 10.0，只凭 UA 分不开；iOS 13 之后的 iPad UA 也会伪装成 macOS',
    '整段 UA 只在本机内存里做正则匹配，不发请求、不上传、不写入本地存储',
  ],
  scenarios: [
    { scene: '排查「这个用户用的是什么浏览器」', how: '把日志里的 UA 粘进来，点解析', result: '四项拆开列出，附版本号和常见混淆说明' },
    { scene: '看自己浏览器的真实 UA', how: '输入框留空，直接点解析', result: '显示当前浏览器的 UA 原文与拆解结果' },
    { scene: '验证一段测试 UA 写得对不对', how: '贴自定义 UA 字符串', result: '能识别的字段逐项列出，认不出的原样回显' },
  ],
  inputs: [
    { name: 'ua', label: 'User-Agent（留空＝解析本机 UA）', type: 'textarea', placeholder: 'Mozilla/5.0 (…) AppleWebKit/537.36 …' },
  ],
  example: { ua: '' },
  runLabel: '解析',
};

export async function run({ ua }) {
  const localUa = typeof navigator !== 'undefined' && navigator ? navigator.userAgent : '';
  const raw = String(ua == null ? '' : ua).trim() || localUa;
  if (!raw) throw new Error('输入框是空的，而且当前环境读不到 navigator.userAgent；请手动粘贴一段 UA');
  if (raw.length > 2000) throw new Error('这段 UA 有 ' + raw.length + ' 个字符，超过 2000 字符上限；请只贴 UA 本身');

  const browser = matchTable(BROWSERS, raw);
  const engine = matchTable(ENGINES, raw);
  const os = osOf(raw);
  const device = deviceOf(raw);
  const hitCount = [browser, engine, os, device].filter(Boolean).length;

  const rows = [
    ['浏览器', browser ? browser.name + ' ' + browser.version : UNKNOWN],
    ['内核', engine ? engine.name + ' ' + engine.version : UNKNOWN],
    ['操作系统', os || UNKNOWN],
    ['设备类型', device ? device.kind : UNKNOWN],
    ['设备品牌', device ? device.brand : UNKNOWN],
    ['设备型号', device ? device.model : UNKNOWN],
  ];

  const table =
    '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px">' +
    '<thead><tr><th style="text-align:left;padding:6px;width:100px;color:var(--muted);font-size:12px">维度</th>' +
    '<th style="text-align:left;padding:6px;color:var(--muted);font-size:12px">识别结果</th></tr></thead><tbody>' +
    rows
      .map(
        ([k, v]) =>
          '<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px;white-space:nowrap">' +
          esc(k) +
          '</td><td style="padding:6px;font-family:var(--mono);font-size:12px;word-break:break-all">' +
          esc(v) +
          '</td></tr>'
      )
      .join('') +
    '</tbody></table>';

  const head =
    hitCount === 0
      ? '<div class="msg-ok">⚠️ 这段 UA 没有任何一项能识别，下面原样回显，不做推测</div>'
      : '<div class="msg-ok">🔍 识别到 ' + hitCount + ' / 4 个维度；未识别的项保持「未识别」，不猜</div>';

  const note =
    '<p style="margin-top:10px;color:var(--muted);font-size:13px">正则表最后核对：' +
    LAST_VERIFIED +
    '。UA 会过期，也会伪装：Windows 10/11 同为 NT 10.0，iPadOS 13+ 可能报成 macOS，' +
    'Chrome 的 UA 里也带 Safari。识别不了时以原文为准。</p>';

  const original =
    '<p style="margin-top:10px;color:var(--muted);font-size:12px">UA 原文（' +
    raw.length +
    ' 字符）：</p><pre style="white-space:pre-wrap;word-break:break-all;padding:10px;background:var(--bg-alt,#f6f7f9);border:1px solid var(--border);border-radius:6px;font-size:12px">' +
    esc(raw) +
    '</pre>';

  return {
    html: head + table + note + original,
    text:
      rows.map(([k, v]) => k + '：' + v).join('\n') +
      '\n\n正则表最后核对：' + LAST_VERIFIED + '（未识别项不猜）\nUA 原文：' + raw,
  };
}
