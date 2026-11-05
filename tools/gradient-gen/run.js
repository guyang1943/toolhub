// 工具：CSS 渐变生成器（纯浏览器执行）
//
// 预览不走「点运行再看结果」这条路：渐变要调角度、试配色，每次都点一下按钮没法用。
// 所以 onForm 钩子里自己注册监听，改动即时刷新预览与那行 CSS；run() 仍然存在，
// 负责生成可以复制的完整代码（分享链接、工作流里也走这条）。
//
// 颜色只认十六进制：3 位、6 位、8 位（带 alpha）都收，别的写法一律报错并说清楚。
// 不猜「red」「rgb(1,2,3)」——猜错颜色比报错更难查。

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normColor(input, field) {
  const s = String(input || '').trim();
  if (!s) throw new Error(`请填${field}的颜色，十六进制写法，例如 #ff7a59`);
  const m = HEX.exec(s);
  if (!m) {
    throw new Error(`${field}「${s}」不是十六进制颜色：可以写 #f70、#ff7a59、#ff7a59cc 三种长度`);
  }
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}

function buildCss(c1, c2, angle, type) {
  const a = Math.round(Number(angle) || 0);
  if (type === 'radial') {
    return {
      css: `background: radial-gradient(circle at center, ${c1} 0%, ${c2} 100%);`,
      note: '圆形径向渐变：角度参数对它无效，方向由 circle at center 决定。',
      angleUsed: false,
    };
  }
  return {
    css: `background: linear-gradient(${a}deg, ${c1} 0%, ${c2} 100%);`,
    note: '',
    angleUsed: true,
  };
}

const clampAngle = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(360, Math.max(0, Math.round(n)));
};

export const manifest = {
  usage:
    '填两个颜色、拖一个角度，实时看到渐变效果，输出一行可直接粘贴的 CSS。线性渐变按角度旋转（0deg 从下往上，90deg 从左往右），径向渐变是居中圆形——此时角度不起作用，结果里会注明。',
  tips: [
    '0deg 是从下往上，90deg 是从左往右，180deg 是从上往下：和直觉里的「顺时针从右边开始」不是一回事',
    '径向渐变的角度参数无效，方向由 circle at center 决定，想换方向得改 circle 的位置',
    '两个色标都写成 0% / 100%，避免浏览器对省略色标位置的默认插值产生差异',
    '颜色只接受十六进制：3 位、6 位、8 位（带透明度）都行，rgb() 与颜色名不认',
  ],
  scenarios: [
    { scene: '给按钮做一条渐变', how: '填两个相近色、角度 135deg', result: '复制 background 一行即可，斜向过渡最像成品按钮' },
    { scene: '做背景光晕', how: '类型选径向、外圈填深色', result: '得到居中圆形过渡，适合卡片背景' },
    { scene: '想确认角度方向', how: '慢慢拖角度看预览', result: '预览与最终 CSS 是同一套计算，不会出现「预览好看、贴上去变样」' },
  ],
  inputs: [
    { name: 'c1', label: '起始颜色（HEX）', type: 'text', placeholder: '#ff7a59' },
    { name: 'c2', label: '结束颜色（HEX）', type: 'text', placeholder: '#6a5cff' },
    { name: 'angle', label: '角度（度，径向渐变时无效）', type: 'range', min: 0, max: 360 },
    {
      name: 'type',
      label: '渐变类型',
      type: 'select',
      options: [
        { value: 'linear', label: '线性 linear' },
        { value: 'radial', label: '径向 radial' },
      ],
    },
  ],
  runLabel: '生成 CSS',
};

export async function run({ c1, c2, angle, type }) {
  const a = normColor(c1, '起始');
  const b = normColor(c2, '结束');
  const kind = type === 'radial' ? 'radial' : 'linear';
  const { css, note, angleUsed } = buildCss(a, b, clampAngle(angle), kind);

  return {
    html: `<div style="${css.replace(/;\s*$/, '')};height:120px;border-radius:10px;border:1px solid var(--border)"></div>
      <pre style="margin-top:10px;padding:10px;background:var(--bg-soft,#f6f7f9);border-radius:8px;overflow:auto;font-size:13px"><code>${css}</code></pre>
      <p style="margin-top:8px;color:var(--muted);font-size:13px">${
        angleUsed ? `角度 ${clampAngle(angle)}deg：0deg 从下往上，90deg 从左往右。` : note
      } 两个色标固定 0% / 100%。</p>`,
    text: css,
  };
}

// 浏览器里的实时预览：改动即刷新，不依赖「点运行」。
export function onForm(form) {
  const f = form || document.getElementById('tool-form');
  if (!f) return;
  const fields = document.getElementById('tool-fields');
  if (!fields || document.getElementById('grad-live')) return;

  const card = document.createElement('div');
  card.id = 'grad-live';
  card.style.cssText = 'margin:10px 0 14px;border:1px solid var(--border);border-radius:10px;overflow:hidden';
  card.innerHTML =
    '<div id="grad-swatch" style="height:110px"></div>' +
    '<code id="grad-code" style="display:block;padding:8px 10px;font-size:12px;font-family:var(--mono);color:var(--muted);word-break:break-all"></code>';
  fields.appendChild(card);

  const val = (name) => {
    const el = document.getElementById('f-' + name);
    return el ? el.value : '';
  };

  const paint = () => {
    const c1 = String(val('c1') || '').trim();
    const c2 = String(val('c2') || '').trim();
    const swatch = document.getElementById('grad-swatch');
    const code = document.getElementById('grad-code');
    if (!swatch || !code) return;
    // 输入到一半（#ff7）也让预览跟上；不合法就留上一帧，不闪白
    const okA = HEX.test(c1);
    const okB = HEX.test(c2);
    if (!okA || !okB) {
      code.textContent = !c1 || !c2 ? '填两个颜色即可看到预览' : '颜色要写成十六进制，例如 #ff7a59';
      return;
    }
    const { css, note } = buildCss(
      normColor(c1, '起始'),
      normColor(c2, '结束'),
      clampAngle(val('angle')),
      val('type') === 'radial' ? 'radial' : 'linear'
    );
    swatch.style.cssText = `${css}height:110px`;
    code.textContent = note ? `${css}  // ${note}` : css;
  };

  ['c1', 'c2', 'angle', 'type'].forEach((name) => {
    const el = document.getElementById('f-' + name);
    if (!el) return;
    el.addEventListener('input', paint);
    el.addEventListener('change', paint);
  });
  paint();
}
