// 工具：图片拼接（Canvas，纯浏览器执行）
//
// 三种排布各有自己的对齐基准，混着用会得到一堆歪边：
// · 横向：全部缩放到「最高那张」的高度，宽度按原比例走
// · 纵向：全部缩放到「最宽那张」的宽度
// · 网格：单元格取最大宽 × 最大高，每张居中放进去（不缩放，避免细节被拉糊）
//
// 缩放只走一步（缩到目标高度/宽度），不做二次采样，多图拼接时的模糊主要来自这一步。
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_PIXELS = 40_000_000; // 40MP 以上的画布在移动端会直接失败

function normColor(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('请填背景色，十六进制写法，例如 #ffffff');
  const m = HEX.exec(s);
  if (!m) throw new Error(`背景色「${s}」不是十六进制：写 #fff 或 #ffffff 都可以`);
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}

export const manifest = {
  usage:
    '选多张图片，选排布方式（横向并排、纵向叠成长图、网格），设间距与背景色，拼成一张导出。横向按最高那张对齐、纵向按最宽那张对齐，网格取最大图当单元格并居中；背景色只在留白处看得到。',
  tips: [
    '多选时按住 Ctrl / ⌘，选择顺序就是拼接顺序（横向从左到右、纵向从上到下）',
    '纵向拼长图时背景色几乎看不到；网格模式因为有大小不一的空档，才会露出背景色',
    '横向拼接会按最高那张放大其他图，如果里面混了截图和照片，矮的那张会被拉粗，最好先统一尺寸',
    '总像素超过 4000 万会直接报错：再大的画布在手机上会创建失败，宁可提前说清楚',
  ],
  scenarios: [
    { scene: '聊天记录拼长图', how: '多选截图、纵向、间距 0', result: '得到一张竖长图，顺序与选择顺序一致' },
    { scene: '前后对比二合一', how: '选两张、横向、间距 12、背景白色', result: '两张按同一高度对齐，中间留白隔开' },
    { scene: '九宫格预览拼图', how: '选 6–9 张、网格', result: '列数按张数自动取，单元格按最大图对齐' },
  ],
  inputs: [
    { name: 'files', label: '选择图片（按住 Ctrl / ⌘ 多选，顺序即拼接顺序）', type: 'file', accept: 'image/*', multiple: true },
    {
      name: 'dir',
      label: '排布方式',
      type: 'select',
      options: [
        { value: 'h', label: '横向并排' },
        { value: 'v', label: '纵向叠长图' },
        { value: 'grid', label: '网格' },
      ],
    },
    { name: 'gap', label: '间距（px）', type: 'number', placeholder: '8', min: 0, max: 200 },
    { name: 'bg', label: '背景色（HEX）', type: 'text', placeholder: '#ffffff' },
  ],
  runLabel: '拼接',
};

export async function run({ files, dir, gap, bg }) {
  const list = Array.isArray(files) ? files : files ? [files] : [];
  if (!list.length) throw new Error('请先选择至少一张图片');
  if (list.length === 1) throw new Error('只选了一张：拼接至少要两张，单张处理请用裁剪或压缩工具');
  if (list.length > 40) throw new Error(`一次选了 ${list.length} 张：超过 40 张会耗尽浏览器内存，请分批拼`);

  for (const f of list) {
    if (f.type && !/^image\//.test(f.type)) {
      throw new Error(`「${f.name || '某个文件'}」不是图片（${f.type}），请只选 PNG / JPEG / WebP 等图片`);
    }
  }

  const bmps = [];
  for (const f of list) {
    try {
      bmps.push(await createImageBitmap(f));
    } catch {
      bmps.push(null);
    }
  }
  const bad = bmps.findIndex((b) => !b);
  if (bad >= 0) throw new Error(`第 ${bad + 1} 张「${list[bad].name || ''}」无法解码，可能是 HEIC/RAW 等浏览器不支持的格式`);

  const g = Math.max(0, Math.round(Number(gap) || 0));
  const color = normColor(bg);
  const mode = dir === 'v' ? 'v' : dir === 'grid' ? 'grid' : 'h';

  const widths = bmps.map((b) => b.width);
  const heights = bmps.map((b) => b.height);
  const maxW = Math.max(...widths);
  const maxH = Math.max(...heights);

  // 每张图在画布上的落位（x, y, w, h）
  let boxes = [];
  let cw = 0;
  let ch = 0;

  if (mode === 'h') {
    ch = maxH;
    let x = 0;
    boxes = bmps.map((b) => {
      const w = Math.max(1, Math.round((b.width * maxH) / b.height));
      const box = { x, y: 0, w, h: maxH };
      x += w + g;
      return box;
    });
    cw = x - g;
  } else if (mode === 'v') {
    cw = maxW;
    let y = 0;
    boxes = bmps.map((b) => {
      const h = Math.max(1, Math.round((b.height * maxW) / b.width));
      const box = { x: 0, y, w: maxW, h };
      y += h + g;
      return box;
    });
    ch = y - g;
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(bmps.length)));
    const rows = Math.ceil(bmps.length / cols);
    cw = cols * maxW + (cols - 1) * g;
    ch = rows * maxH + (rows - 1) * g;
    boxes = bmps.map((b, i) => {
      const cx = (i % cols) * (maxW + g);
      const cy = Math.floor(i / cols) * (maxH + g);
      return { x: cx + Math.round((maxW - b.width) / 2), y: cy + Math.round((maxH - b.height) / 2), w: b.width, h: b.height };
    });
  }

  if (cw * ch > MAX_PIXELS) {
    throw new Error(
      `拼出来的画布是 ${cw}×${ch}（约 ${Math.round((cw * ch) / 1e6)} 百万像素），超过 4000 万像素上限。请减少张数或先用压缩工具缩小单张尺寸`
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, cw);
  canvas.height = Math.max(1, ch);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法拼接图片');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  bmps.forEach((b, i) => {
    const box = boxes[i];
    ctx.drawImage(b, box.x, box.y, box.w, box.h);
    if (typeof b.close === 'function') b.close();
  });

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('导出 PNG 失败，这个浏览器的 Canvas 可能被禁用');

  const modeTxt = mode === 'h' ? '横向并排' : mode === 'v' ? '纵向叠图' : `网格（${Math.ceil(Math.sqrt(bmps.length))} 列）`;
  return {
    html: `<div class="msg-ok">✅ 已拼接 ${bmps.length} 张 · ${canvas.width}×${canvas.height} · ${modeTxt}</div>
      <p style="margin-top:8px;color:var(--muted);font-size:13px">${
        mode === 'h'
          ? `对齐基准是最高那张（${maxH}px），其余按比例缩放。`
          : mode === 'v'
            ? `对齐基准是最宽那张（${maxW}px）。`
            : `单元格取最大图 ${maxW}×${maxH}，每张居中；列数按张数自动取 ${Math.ceil(Math.sqrt(bmps.length))} 列。`
      }间距 ${g}px，背景 ${color}。</p>`,
    text: `已拼接 ${bmps.length} 张图片：${modeTxt}，输出 ${canvas.width}×${canvas.height}，间距 ${g}px，背景 ${color}。`,
    files: [{ name: `merged-${canvas.width}x${canvas.height}.png`, blob }],
  };
}
