// 工具：CSS 阴影生成器（纯浏览器执行）
//
// box-shadow 与 text-shadow 的参数看起来一样，实际差三个：text-shadow 没有 spread、
// 没有 inset、也不能叠多个来源。所以同一套表单出来两条不同的 CSS，结果区把「哪些参数
// 在这个模式下无效」写出来，而不是悄悄丢掉。
//
// 实时预览走 onForm：阴影是拿来试的，点一下才更新没法调。

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normColor(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('请填阴影颜色，十六进制写法，例如 #00000033（后两位是透明度）');
  const m = HEX.exec(s);
  if (!m) throw new Error(`颜色「${s}」不是十六进制：可以写 #000、#000000、#0000004d 三种长度`);
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}

const numOr0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

function build({ x, y, blur, spread, color, kind, inset }) {
  const px = { x: numOr0(x), y: numOr0(y), blur: numOr0(blur), spread: numOr0(spread) };
  if (px.blur < 0) throw new Error(`模糊半径不能是负数（收到 ${px.blur}px）：负值画不出阴影，浏览器会直接忽略整条声明`);
  if (px.spread < 0 && kind !== 'text') throw new Error(`扩散半径不能是负数（收到 ${px.spread}px）：想收窄请用 0，负值会被浏览器丢弃`);

  if (kind === 'text') {
    const ignored = [];
    if (px.spread !== 0) ignored.push('扩散 spread');
    if (inset === 'yes') ignored.push('inset');
    return {
      css: `text-shadow: ${px.x}px ${px.y}px ${px.blur}px ${color};`,
      prop: 'text-shadow',
      value: `${px.x}px ${px.y}px ${px.blur}px ${color}`,
      ignored,
    };
  }
  const value = `${inset === 'yes' ? 'inset ' : ''}${px.x}px ${px.y}px ${px.blur}px ${px.spread}px ${color}`;
  return { css: `box-shadow: ${value};`, prop: 'box-shadow', value, ignored: [] };
}

export const manifest = {
  usage:
    '调偏移、模糊、扩散与颜色，实时看效果，输出一行可直接粘贴的 box-shadow 或 text-shadow。正负偏移都支持：x 为负是向左、y 为负是向上；box 模式还能加 inset 做内阴影。切到 text-shadow 时扩散与 inset 不生效，结果里会写明哪几个参数被忽略。',
  tips: [
    'y 为正时阴影往下：这是最常见的方向，做了「浮起」效果后按钮反而显得陷下去，多半是符号反了',
    '模糊半径越大越虚，扩散半径是「大小」不是「硬度」——想让阴影更实，调小模糊而不是加大扩散',
    '彩色阴影用带透明度的十六进制（#0000004d 这种），比纯黑 8% 更耐看，暗色背景下也不会脏',
    'text-shadow 不支持 spread 与 inset，这在 CSS 规范里就没有，不是本工具省略',
  ],
  scenarios: [
    { scene: '卡片做浮起效果', how: 'x=0、y=4、blur=12、spread=0、颜色 #0000001a', result: '柔和的下投影，贴到卡片上不会发灰' },
    { scene: '按钮做内凹', how: 'kind 选 box、inset 选是、y=2', result: '得到 inset 内阴影，像被按下去' },
    { scene: '标题加描边光', how: 'kind 选 text、blur 调到 0', result: '变成硬边投影，可当描边用（CSS 没有真正的 text-stroke 时）' },
  ],
  inputs: [
    { name: 'x', label: '水平偏移 X（px，可为负）', type: 'number', placeholder: '0', min: -200, max: 200 },
    { name: 'y', label: '垂直偏移 Y（px，可为负）', type: 'number', placeholder: '4', min: -200, max: 200 },
    { name: 'blur', label: '模糊半径（px，≥0）', type: 'number', placeholder: '12', min: 0, max: 200 },
    { name: 'spread', label: '扩散半径（px，仅 box）', type: 'number', placeholder: '0', min: -200, max: 200 },
    { name: 'color', label: '颜色（HEX，可带透明度）', type: 'text', placeholder: '#0000001a' },
    {
      name: 'kind',
      label: '阴影类型',
      type: 'select',
      options: [
        { value: 'box', label: 'box-shadow（元素）' },
        { value: 'text', label: 'text-shadow（文字）' },
      ],
    },
    {
      name: 'inset',
      label: '内阴影（仅 box）',
      type: 'select',
      options: [
        { value: 'no', label: '否，外阴影' },
        { value: 'yes', label: '是，内阴影 inset' },
      ],
    },
  ],
  runLabel: '生成 CSS',
};

export async function run({ x, y, blur, spread, color, kind, inset }) {
  const c = normColor(color);
  const k = kind === 'text' ? 'text' : 'box';
  const r = build({ x, y, blur, spread, color: c, kind: k, inset });

  const demo =
    k === 'text'
      ? `<div style="padding:28px 12px;text-align:center;font-size:28px;font-weight:700;color:var(--fg,#111);${r.css}">阴影预览 Shadow</div>`
      : `<div style="padding:28px 12px;text-align:center"><div style="display:inline-block;padding:22px 34px;border-radius:12px;background:var(--bg-soft,#fff);border:1px solid var(--border);${r.css}">阴影预览</div></div>`;

  const ignoredTxt = r.ignored.length
    ? `<p style="margin-top:8px;color:#c2570a;font-size:13px">⚠️ text-shadow 不支持${r.ignored.join(' 与 ')}，这几个参数在本次结果里被忽略了。</p>`
    : '';

  return {
    html: `${demo}
      <pre style="margin-top:10px;padding:10px;background:var(--bg-soft,#f6f7f9);border-radius:8px;overflow:auto;font-size:13px"><code>${r.css}</code></pre>
      ${ignoredTxt}
      <p style="margin-top:8px;color:var(--muted);font-size:13px">x 为负向左、y 为负向上。${
        k === 'box' ? 'box-shadow 可以叠多层：用逗号分隔多条声明即可。' : 'text-shadow 每条只能一个来源，要叠多层同样用逗号。'
      }</p>`,
    text: r.css,
  };
}

export function onForm(form) {
  const f = form || document.getElementById('tool-form');
  if (!f) return;
  const fields = document.getElementById('tool-fields');
  if (!fields || document.getElementById('shadow-live')) return;

  const card = document.createElement('div');
  card.id = 'shadow-live';
  card.style.cssText = 'margin:10px 0 14px;padding:24px 12px;border:1px solid var(--border);border-radius:10px;text-align:center';
  // 预览底板写死白底 + 深字，不跟主题走：阴影是相对背景看的，暗色底上的投影
  // 和白色卡片上的投影完全不是一回事，用户在深色模式里调出来的值贴到浅色页面就变样。
  // 踩过的坑：原来用 var(--bg-soft,#fff)，深色模式下背景是白的、文字跟着主题变浅色，
  // 于是「阴影预览」四个字几乎看不见（体检的对比度检查 1.22:1 抓到的）。
  card.innerHTML =
    '<div id="shadow-demo" style="display:inline-block;padding:20px 30px;border-radius:12px;background:#ffffff;color:#1f2328;border:1px solid #e3e6ea">阴影预览</div>';
  fields.appendChild(card);

  const val = (name) => {
    const el = document.getElementById('f-' + name);
    return el ? el.value : '';
  };

  const paint = () => {
    const demo = document.getElementById('shadow-demo');
    if (!demo) return;
    const c = String(val('color') || '').trim();
    if (!HEX.test(c)) {
      demo.style.boxShadow = '';
      demo.style.textShadow = '';
      return;
    }
    try {
      const r = build({
        x: val('x'),
        y: val('y'),
        blur: val('blur'),
        spread: val('spread'),
        color: normColor(c),
        kind: val('kind') === 'text' ? 'text' : 'box',
        inset: val('inset'),
      });
      const isText = r.prop === 'text-shadow';
      demo.style.boxShadow = isText ? '' : r.value;
      demo.style.textShadow = isText ? r.value : '';
      demo.style.fontSize = isText ? '24px' : '';
      demo.style.fontWeight = isText ? '700' : '';
      demo.style.border = isText ? '1px solid var(--border)' : '1px solid var(--border)';
    } catch {
      /* 输入到一半（负模糊之类）不闪，保留上一帧 */
    }
  };

  ['x', 'y', 'blur', 'spread', 'color', 'kind', 'inset'].forEach((name) => {
    const el = document.getElementById('f-' + name);
    if (!el) return;
    el.addEventListener('input', paint);
    el.addEventListener('change', paint);
  });
  paint();
}
