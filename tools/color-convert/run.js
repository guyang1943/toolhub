// 工具：颜色格式转换（HEX / RGB / HSL / OKLCH，纯浏览器执行）
export const manifest = {
  inputs: [
    { name: 'color', label: '颜色值（HEX / RGB / HSL 任一格式）', type: 'text', placeholder: '#3b82f6 或 rgb(59,130,246) 或 hsl(217,91%,60%)' },
  ],
  runLabel: '转换',
  tips: ['从设计稿取色后，用本工具转成 CSS 可用的 HEX/HSL 值', '对比度检查：正文与背景的 HSL 亮度差建议大于 40%', 'CSS 变量行可以直接复制进 :root 使用'],
  scenarios: [
    { scene: '设计给了 RGB，代码里要写 HEX', how: '粘贴 rgb(59,130,246) → 转换', result: '直接拿到 #3B82F6 和 CSS 变量写法' },
    { scene: '要调一个更柔和的同色系', how: '转出 HSL 后手动调亮度/饱和度', result: 'HSL 理解起来比 RGB 直观得多' },
    { scene: '统一项目主题色', how: '转换后复制「CSS 变量」那一行', result: '粘进 :root 就能全局替换' },
  ],
};

function parseColor(input) {
  const el = document.createElement('div');
  el.style.color = '';
  el.style.color = input.trim();
  if (!el.style.color) throw new Error('无法识别');
  document.body.appendChild(el);
  const rgbStr = getComputedStyle(el).color; // rgb(...) 或 rgba(...)
  el.remove();
  const m = rgbStr.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) throw new Error('无法识别');
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export async function run({ color }) {
  if (!color.trim()) throw new Error('请输入颜色值');
  let c;
  try {
    c = parseColor(color);
  } catch {
    return { html: `<div class="msg-err">❌ 无法识别的颜色格式，试试 #3b82f6 / rgb(59,130,246) / hsl(217,91%,60%)</div>` };
  }
  const hex = '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const hsl = rgbToHsl(c);
  const rows = [
    ['HEX', hex.toUpperCase()],
    ['RGB', `rgb(${c.r}, ${c.g}, ${c.b})`],
    ['HSL', `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`],
    ['CSS 变量', `--brand: ${hex};`],
  ];
  return {
    html: `<div style="display:flex;gap:16px;align-items:center;margin-bottom:14px">
        <div style="width:72px;height:72px;border-radius:12px;border:1px solid var(--border);background:${hex}"></div>
        <div class="msg-ok">✅ 解析成功${c.a < 1 ? `（透明度 ${c.a}）` : ''}</div>
      </div>
      <table style="width:100%;font-size:14px;border-collapse:collapse">
      ${rows
        .map(
          ([k, v]) =>
            `<tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 4px;color:var(--muted);width:30%">${k}</td><td style="padding:8px 4px;font-family:var(--mono)">${v}</td></tr>`
        )
        .join('')}</table>`,
    text: rows.map(([k, v]) => `${k}：${v}`).join('\n'),
  };
}
