// 工具：颜色对比度检查（WCAG 2.1，纯浏览器执行）
export const manifest = {
  usage: '输入文字色与背景色，计算 WCAG 对比度并判断是否达到 AA / AAA 标准（正文 4.5:1、大号文字 3:1）。同时给出建议：是否该改深或改浅。',
  tips: ['正文对比度至少 4.5:1，大字（18pt/14pt 粗体）可降到 3:1', '纯黑配纯白是 21:1，但长时间阅读反而刺眼，正文常用 #1f2328 这类深灰', '给按钮做配色时，别只看视觉效果，一定要过一遍对比度'],
  scenarios: [
    { scene: '设计稿上的灰色小字看不清', how: '输入文字色与背景色', result: '立刻知道是否达标，差多少' },
    { scene: '上线前做可访问性自查', how: '把主要配色组合逐个测', result: '避免被无障碍审计卡住' },
    { scene: '给按钮选文字颜色', how: '分别测白字与黑字', result: '选出对比度更高的方案' },
  ],
  inputs: [
    { name: 'fg', label: '文字颜色', type: 'text', placeholder: '#666666', default: '#7b8794' },
    { name: 'bg', label: '背景颜色', type: 'text', placeholder: '#ffffff', default: '#ffffff' },
  ],
  runLabel: '检查对比度',
};

function parse(input) {
  const el = document.createElement('div');
  el.style.color = '';
  el.style.color = String(input).trim();
  if (!el.style.color) throw new Error(`无法识别的颜色：${input}`);
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color;
  el.remove();
  const m = rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) throw new Error(`无法识别的颜色：${input}`);
  return [+m[1], +m[2], +m[3]];
}

function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export async function run({ fg, bg }) {
  let a, b;
  try {
    a = parse(fg);
    b = parse(bg);
  } catch (e) {
    return { html: `<div class="msg-err">❌ ${e.message}<br>支持 #666、#666666、rgb(102,102,102)、hsl(...)</div>` };
  }
  const L1 = luminance(a), L2 = luminance(b);
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  const r = Math.round(ratio * 100) / 100;
  const passAA = r >= 4.5, passAAA = r >= 7, passLarge = r >= 3;
  const pick = (ok) => (ok ? '<span style="color:#16a34a">✓ 通过</span>' : '<span style="color:#dc2626">✗ 未通过</span>');
  const advice = passAAA
    ? '对比度充足，正文与标题都可以放心使用。'
    : passAA
    ? '达到 AA 标准（≥4.5:1），正文可用；若要做 AAA 需要再加深文字或提亮背景。'
    : passLarge
    ? '只达到大号文字标准（≥3:1），正文阅读会吃力，建议加深文字色。'
    : '对比度不足，正文几乎不可读，必须调整配色。';
  return {
    html: `
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
        <div style="width:120px;height:60px;border-radius:8px;border:1px solid var(--border);background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:15px">文字示例</div>
        <div><b style="font-size:22px">${r}:1</b><div style="font-size:12.5px;color:var(--muted)">WCAG 对比度</div></div>
      </div>
      <table style="width:100%;font-size:13.5px;border-collapse:collapse">
        <tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 4px;color:var(--muted)">正文 AA（≥4.5:1）</td><td style="padding:7px 4px">${pick(passAA)}</td></tr>
        <tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 4px;color:var(--muted)">正文 AAA（≥7:1）</td><td style="padding:7px 4px">${pick(passAAA)}</td></tr>
        <tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 4px;color:var(--muted)">大字 AA（≥3:1）</td><td style="padding:7px 4px">${pick(passLarge)}</td></tr>
      </table>
      <div class="panel" style="margin-top:12px;background:var(--accent-soft);border-color:#c7d4f5;font-size:13px">💡 ${advice}</div>`,
  };
}
