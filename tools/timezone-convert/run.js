// 工具：时区转换（Intl API，纯本地计算，自动处理夏令时）
// 核心：wall clock → UTC 瞬时（两轮偏移迭代）→ 各时区显示；夏令时按全年偏移区间判定
const ZONES = [
  ['Asia/Shanghai', '北京 / 上海', '中国'],
  ['Asia/Hong_Kong', '中国香港', '中国'],
  ['Asia/Macau', '中国澳门', '中国'],
  ['Asia/Taipei', '中国台湾', '中国'],
  ['Asia/Tokyo', '东京', '日本'],
  ['Asia/Seoul', '首尔', '韩国'],
  ['Asia/Singapore', '新加坡', '新加坡'],
  ['Asia/Bangkok', '曼谷', '泰国'],
  ['Asia/Kolkata', '孟买 / 新德里', '印度'],
  ['Asia/Dubai', '迪拜', '阿联酋'],
  ['Europe/London', '伦敦', '英国'],
  ['Europe/Paris', '巴黎', '法国'],
  ['Europe/Berlin', '柏林', '德国'],
  ['Europe/Moscow', '莫斯科', '俄罗斯'],
  ['America/New_York', '纽约', '美国东部'],
  ['America/Chicago', '芝加哥', '美国中部'],
  ['America/Denver', '丹佛', '美国山地'],
  ['America/Los_Angeles', '洛杉矶 / 旧金山', '美国西部'],
  ['America/Sao_Paulo', '圣保罗', '巴西'],
  ['Australia/Sydney', '悉尼', '澳大利亚'],
  ['Pacific/Auckland', '奥克兰', '新西兰'],
  ['UTC', 'UTC', '协调世界时'],
];

function partsIn(date, tz, opts) {
  const dtf = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...opts,
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  // ICU 的 h24 周期会把午夜输出成 24 点，统一成 00
  if (p.hour === '24') p.hour = '00';
  return p;
}

// 某时区在某一时刻相对 UTC 的偏移（毫秒）
function offsetMs(date, tz) {
  const p = partsIn(date, tz);
  const hour = p.hour === '24' ? '00' : p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
  return asUtc - (date.getTime() - (date.getTime() % 1000));
}

// 夏令时判定：取当年 12 个采样点的偏移，最大值视为夏令时偏移
const dstCache = new Map();
function dstInfo(year) {
  if (dstCache.has(year)) return dstCache.get(year);
  const map = new Map();
  for (const [tz] of ZONES) {
    let min = Infinity;
    let max = -Infinity;
    for (let m = 0; m < 12; m++) {
      const off = offsetMs(new Date(Date.UTC(year, m, 15, 12)), tz);
      if (off < min) min = off;
      if (off > max) max = off;
    }
    map.set(tz, { min, max, hasDst: max > min });
  }
  dstCache.set(year, map);
  return map;
}

// 把「某时区的墙上时间」换算成真实瞬时
function wallToInstant(y, mo, d, h, mi, sec, tz) {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, sec);
  let ts = asUtc - offsetMs(new Date(asUtc), tz);
  ts = asUtc - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

function parseWall(s) {
  const t = String(s || '')
    .trim()
    .replace(/[／/]/g, '-')
    .replace('T', ' ')
    .replace(/\s+/g, ' ');
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?: (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!m) throw new Error('时间格式无法识别，请用「2026-10-25 20:00」这种格式（留空表示当前时刻）');
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = m[4] ? +m[4] : 0;
  const mi = m[5] ? +m[5] : 0;
  const sec = m[6] ? +m[6] : 0;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new Error('这个日期不存在，请核对月份和日期');
  }
  if (h > 23 || mi > 59 || sec > 59) throw new Error('时间需要在 00:00:00–23:59:59 之间');
  return { y, mo, d, h, mi, sec };
}

const pad = (n) => String(n).padStart(2, '0');

function fmtOffset(ms) {
  const totalMin = Math.round(ms / 60000);
  const sign = totalMin < 0 ? '-' : '+';
  const abs = Math.abs(totalMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + pad(m) : ''}`;
}

export const manifest = {
  usage:
    '输入一个时间并选择它所属的时区，工具会把这个时刻换算成二十多个城市的当地时间，并标出与来源时区的时差、是否跨日、是否处于夏令时。不填时间则按当前时刻换算。会议邀约、跨国发布、看海外直播时间都用得上，全部在本地计算。',
  tips: [
    '夏令时由时区数据库自动处理：欧美夏季会比冬季多 1 小时，换算结果已包含这一变化',
    '「跨日」标注很重要：北京时间上午 9 点对应纽约前一天晚上 21 点',
    '印度、部分时区为半小时偏移（UTC+5:30），显示为 +5:30 而非整数小时',
    '留空时间即按你点击那一刻换算，适合临时查「对方现在几点」',
  ],
  scenarios: [
    { scene: '约海外客户开会，不想算错时差', how: '填北京时间 → 看对方城市那一列', result: '直接看到对方当地时间与是否跨日' },
    { scene: '海外直播/发布会几点开始', how: '填当地公布的时间 + 该城市时区', result: '换算成北京时间，避免错过' },
    { scene: '远程团队跨时区排班', how: '把候选时间段逐个换算', result: '找出所有人都在工作时间的窗口' },
  ],
  inputs: [
    { name: 'datetime', label: '时间（YYYY-MM-DD HH:mm，留空表示现在）', type: 'text', placeholder: '如 2026-10-25 20:00' },
    {
      name: 'zone',
      label: '这个时间属于哪个时区',
      type: 'select',
      default: 'Asia/Shanghai',
      options: ZONES.map(([tz, name]) => ({ value: tz, label: `${name}（${tz}）` })),
    },
  ],
  runLabel: '换算',
};

export async function run(v) {
  const src = ZONES.some(([tz]) => tz === v.zone) ? v.zone : 'Asia/Shanghai';
  const wall = parseWall(v.datetime);
  const instant = wall ? wallToInstant(wall.y, wall.mo, wall.d, wall.h, wall.mi, wall.sec, src) : new Date();
  if (Number.isNaN(instant.getTime())) throw new Error('时间解析失败，请换一个日期试试');

  const srcParts = partsIn(instant, src, { weekday: 'short' });
  const srcDate = `${srcParts.year}-${srcParts.month}-${srcParts.day}`;
  const srcOff = offsetMs(instant, src);
  const dst = dstInfo(instant.getUTCFullYear());
  const srcName = (ZONES.find(([tz]) => tz === src) || [])[1] || src;

  const rows = ZONES.map(([tz, name, region]) => {
    const p = partsIn(instant, tz, { weekday: 'short' });
    const off = offsetMs(instant, tz);
    const deltaH = (off - srcOff) / 3600000;
    const date = `${p.year}-${p.month}-${p.day}`;
    const diffDays = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(+srcParts.year, +srcParts.month - 1, +srcParts.day)) / 86400000);
    const dayTag = diffDays === 0 ? '' : diffDays > 0 ? `+${diffDays} 天` : `${diffDays} 天`;
    const info = dst.get(tz);
    const dstTag = info && info.hasDst ? (off === info.max ? '夏令时' : '标准时') : '';
    const deltaText = deltaH === 0 ? '同时区' : `${deltaH > 0 ? '+' : '−'}${Math.abs(deltaH) % 1 === 0 ? Math.abs(deltaH) : Math.abs(deltaH).toFixed(1)} 小时`;
    const isSrc = tz === src;
    return `<tr${isSrc ? ' style="font-weight:700;background:rgba(37,99,235,.08)"' : ''}>
      <td>${name}${isSrc ? '（来源）' : ''}<div style="font-size:12px;color:var(--muted);font-weight:400">${region} · ${tz}</div></td>
      <td>${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}<span style="color:var(--muted);font-size:12px">:${p.second}</span></td>
      <td>${p.weekday}</td>
      <td>${deltaText}</td>
      <td>${fmtOffset(off)}</td>
      <td>${[dayTag, dstTag].filter(Boolean).join(' · ') || '—'}</td>
    </tr>`;
  }).join('');

  const beijing = ZONES[0][0] === src ? null : partsIn(instant, 'Asia/Shanghai', { weekday: 'short' });
  const headline = `${srcName} ${srcParts.year}-${srcParts.month}-${srcParts.day} ${srcParts.hour}:${srcParts.minute}`;

  return {
    html: `
      <div class="msg-ok">✅ ${wall ? '已按指定时间换算' : '未填时间，已按当前时刻换算（点击「换算」可刷新）'}</div>
      <div class="tax-hero">
        <div class="tax-hero-item"><b>${headline}</b><span>来源时间（${fmtOffset(srcOff)}）</span></div>
        <div class="tax-hero-item"><b>${beijing ? `${beijing.hour}:${beijing.minute}` : srcParts.hour + ':' + srcParts.minute}</b><span>北京时间</span></div>
        <div class="tax-hero-item"><b>${instant.toISOString().slice(11, 16)}</b><span>UTC 时间</span></div>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>城市</th><th>当地时间</th><th>星期</th><th>与来源时差</th><th>UTC 偏移</th><th>备注</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="panel tips" style="margin-top:14px">📌 <b>说明</b>
        <ul>
          <li>同一时刻在全球是唯一的，只有「当地时间」不同；本表左列时间是同一个瞬间的不同写法</li>
          <li>「备注」中的 ±1 天表示该城市与来源时区不在同一个日历日，约会议时要特别说明</li>
          <li>夏令时信息按 ${instant.getUTCFullYear()} 年的时区规则判定，未来的规则变化以各国公告为准</li>
        </ul>
      </div>`,
    text: [
      `来源：${headline}（${fmtOffset(srcOff)}）`,
      `北京时间：${beijing ? `${beijing.year}-${beijing.month}-${beijing.day} ${beijing.hour}:${beijing.minute}` : `${srcParts.year}-${srcParts.month}-${srcParts.day} ${srcParts.hour}:${srcParts.minute}`}`,
      `UTC：${instant.toISOString().slice(0, 16).replace('T', ' ')}`,
    ].join('\n'),
  };
}
