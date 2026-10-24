// 工具：时间戳转换（纯浏览器执行）
export const manifest = {
  inputs: [
    {
      name: 'value',
      label: 'Unix 时间戳（秒或毫秒）或留空取当前时间',
      type: 'text',
      placeholder: '例如 1761273600',
    },
    {
      name: 'tz',
      label: '时区',
      type: 'select',
      default: 'Asia/Shanghai',
      options: [
        { value: 'Asia/Shanghai', label: '北京时间 (UTC+8)' },
        { value: 'UTC', label: 'UTC' },
        { value: 'America/New_York', label: '纽约' },
        { value: 'Europe/London', label: '伦敦' },
        { value: 'Asia/Tokyo', label: '东京' },
      ],
    },
  ],
  runLabel: '转换',
  tips: ['后端日志里常见的是 10 位（秒）或 13 位（毫秒），本工具自动识别', '排查"接口超时"问题时，把两端时间戳粘进来直接对比', '留空点转换 = 取当前时间，可顺手复制当时间戳'],
  scenarios: [
    { scene: '日志里一串 1761273600 不知道是哪天', how: '粘进来 → 转换', result: '直接显示北京时间与星期' },
    { scene: '要和海外同事对时间', how: '切换时区到 UTC / 纽约', result: '同一时刻的多地表示一目了然' },
    { scene: '需要当前时间戳写测试数据', how: '留空 → 转换', result: '秒/毫秒/ISO 三种格式任取' },
  ],
};

export async function run({ value, tz }) {
  let ts = value.trim();
  let date;
  if (!ts) {
    date = new Date();
  } else {
    if (!/^\d{10,13}$/.test(ts)) throw new Error('请输入 10 位（秒）或 13 位（毫秒）数字时间戳');
    if (ts.length === 10) ts += '000';
    date = new Date(Number(ts));
    if (isNaN(date.getTime())) throw new Error('时间戳无效');
  }
  const fmt = (loc) =>
    new Intl.DateTimeFormat(loc, {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
    }).format(date);
  const rows = [
    ['可读时间（所选时区）', fmt('zh-CN')],
    ['英文格式', fmt('en-US')],
    ['Unix 时间戳（秒）', String(Math.floor(date.getTime() / 1000))],
    ['Unix 时间戳（毫秒）', String(date.getTime())],
    ['ISO 8601', date.toISOString()],
  ];
  return {
    html: `<table style="width:100%;font-size:14px;border-collapse:collapse">
      ${rows
        .map(
          ([k, v], i) =>
            `<tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 4px;color:var(--muted);width:40%">${k}</td><td style="padding:8px 4px;font-family:var(--mono)">${v}</td></tr>`
        )
        .join('')}</table>`,
  };
}
