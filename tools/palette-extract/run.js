// 工具：图片取色（Canvas，纯浏览器执行）
//
// 用中位数切分（median cut）取主色，不用 k-means：k-means 要迭代、要随机初值，
// 同一张图跑两次可能给出两组不同结果；中位数切分是确定性的，同一张图永远同一组色，
// 这对「照着参考图取配色」很重要——用户会反复调、反复对比。
//
// 采样先在 120px 缩略图上做：原图 4000×3000 有一千二百万像素，逐个进桶既慢又没必要，
// 主色本来就是「大面积的颜色」，缩略图已经足够代表。

const SAMPLE = 120;

function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// 一个桶 = 一组像素 + 它在 RGB 空间里的包围盒
function boxOf(pixels) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const p of pixels) {
    if (p[0] < rMin) rMin = p[0];
    if (p[0] > rMax) rMax = p[0];
    if (p[1] < gMin) gMin = p[1];
    if (p[1] > gMax) gMax = p[1];
    if (p[2] < bMin) bMin = p[2];
    if (p[2] > bMax) bMax = p[2];
  }
  const ranges = [rMax - rMin, gMax - gMin, bMax - bMin];
  const channel = ranges.indexOf(Math.max(...ranges));
  return { pixels, channel, range: ranges[channel] };
}

function medianCut(pixels, count) {
  let boxes = [boxOf(pixels)];
  while (boxes.length < count) {
    // 每次切「颜色跨度最大」的那个桶，跨度都一样大时切像素最多的那个
    let target = -1;
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const score = boxes[i].range * 1000 + boxes[i].pixels.length;
      if (boxes[i].pixels.length > 1 && score > best) {
        best = score;
        target = i;
      }
    }
    if (target < 0) break;
    const box = boxes[target];
    const ch = box.channel;
    const sorted = box.pixels.slice().sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(sorted.length / 2);
    if (mid === 0) break;
    boxes.splice(target, 1, boxOf(sorted.slice(0, mid)), boxOf(sorted.slice(mid)));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const p of box.pixels) {
      r += p[0];
      g += p[1];
      b += p[2];
    }
    const n = box.pixels.length || 1;
    return { r: r / n, g: g / n, b: b / n, share: n };
  });
}

function luminance({ r, g, b }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const manifest = {
  usage:
    '选一张图片，提取 4 / 6 / 8 个主色，给出色块、HEX 与 RGB，点色块即可复制色值。取色用中位数切分，结果是确定的：同一张图取两次一定一样，方便反复对比。',
  tips: [
    '取的是「面积大」的颜色，不是「最跳」的颜色：一张 90% 白底的海报，主色会是白色而不是那点红',
    '想取到点缀色，先把图片裁掉大片背景再传——这正是取色要配合裁剪工具用的原因',
    '色块按占比从大到小排，排第一的就是画面里最主要的那个颜色',
    '同一张图每次取到的色值完全一致（确定性算法），所以可以放心把色值贴进设计稿再回来核对',
  ],
  scenarios: [
    { scene: '做 PPT 时照着参考图配色', how: '传参考图、选 6 色', result: '拿到一组主色，直接填进主题色' },
    { scene: '做海报要用品牌色', how: '传品牌物料、选 4 色', result: '主色通常是底色，下面几个是辅助色' },
    { scene: '取不到想要的那个点缀色', how: '先裁剪到只留那部分再取色', result: '面积占比上来之后才会被选中' },
  ],
  inputs: [
    { name: 'file', label: '选择图片', type: 'file', accept: 'image/*' },
    {
      name: 'count',
      label: '取几个颜色',
      type: 'select',
      options: [
        { value: '4', label: '4 色' },
        { value: '6', label: '6 色' },
        { value: '8', label: '8 色' },
      ],
    },
  ],
  runLabel: '提取配色',
};

export async function run({ file, count }) {
  if (!file) throw new Error('请先选择一张图片');
  if (file.type && !/^image\//.test(file.type)) {
    throw new Error(`「${file.name || '这个文件'}」不是图片（${file.type}），请选择 PNG / JPEG / WebP 等图片文件`);
  }
  const want = [4, 6, 8].includes(Number(count)) ? Number(count) : 4;

  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('这张图片无法解码，可能是 HEIC/RAW 等浏览器不支持的格式，请先另存为 PNG 或 JPEG');
  }
  const scale = Math.min(1, SAMPLE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法取色');
  ctx.drawImage(bmp, 0, 0, w, h);
  if (typeof bmp.close === 'function') bmp.close();

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    throw new Error('读不出像素（图片可能来自跨域资源或受保护），请另存到本地后再试');
  }

  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    // 全透明像素不参与取色：一张带透明边的 PNG 会取出一堆黑色
    if (data[i + 3] < 16) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pixels.length) throw new Error('这张图几乎全是透明像素，没有可取的颜色');

  const total = pixels.length;
  const colors = medianCut(pixels, want)
    .map((c) => ({ ...c, pct: (c.share / total) * 100 }))
    .sort((a, b) => b.pct - a.pct);

  const swatches = colors
    .map((c) => {
      const hx = hex(c.r, c.g, c.b);
      const fg = luminance(c) > 150 ? '#111111' : '#ffffff';
      return `<button type="button" class="pal-sw" data-hex="${hx}" title="点击复制 ${hx}" style="all:unset;cursor:pointer;display:flex;flex-direction:column;justify-content:flex-end;height:96px;border-radius:10px;padding:8px;background:${hx};color:${fg};border:1px solid var(--border);box-sizing:border-box;flex:1 1 68px">
        <span style="font-family:var(--mono);font-size:13px;font-weight:600">${hx.toUpperCase()}</span>
        <span style="font-size:11px;opacity:.85">${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)} · ${c.pct.toFixed(1)}%</span>
      </button>`;
    })
    .join('');

  return {
    html: `<div class="msg-ok">🎨 提取到 ${colors.length} 个主色（按面积占比排序）</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${swatches}</div>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">点色块复制 HEX。占比是该颜色在采样像素中的比例，透明像素不参与计算；采样在 ${w}×${h} 的缩略图上进行，所以极小的点缀色可能取不到。</p>`,
    text: colors
      .map((c) => `${hex(c.r, c.g, c.b).toUpperCase()}  rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})  ${c.pct.toFixed(1)}%`)
      .join('\n'),
  };
}

// 色块点了要能复制：结果区是 run() 拼出来的 HTML，没有现成的复制逻辑，
// 所以在这里挂一个一次性的事件代理，只认 .pal-sw，别处点不动。
export function onForm() {
  if (window.__palBound) return;
  window.__palBound = true;
  document.addEventListener('click', async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.pal-sw') : null;
    if (!btn) return;
    const hx = btn.getAttribute('data-hex') || '';
    if (!hx) return;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(hx.toUpperCase());
      else {
        const ta = document.createElement('textarea');
        ta.value = hx.toUpperCase();
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const label = btn.querySelector('span');
      if (label) {
        const t = label.textContent;
        label.textContent = '已复制 ' + hx.toUpperCase();
        setTimeout(() => (label.textContent = t), 900);
      }
    } catch {
      /* 复制失败就保持原样，色值本身还看得见 */
    }
  });
}
