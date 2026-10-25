/**
 * 批量处理图片（v3.0 E3）
 *
 * 解决的真实问题：一次要处理十几张截图时，「打开工具 → 选一张 → 下载 → 再来一张」是纯浪费。
 * 这里一趟跑完：限制最大边长 → 统一格式 → 质量压缩 → 打包成一个 zip。
 *
 * 全部在浏览器内完成：图片不上传，也不经过任何第三方库（只用 createImageBitmap + canvas）。
 * 按需加载：只有 /batch/ 页面才会 import 这个文件，不参与首屏。
 */

const fmt = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountBatch(root) {
  if (!root) return;
  root.innerHTML = `
    <div class="batch-drop" id="b-drop" tabindex="0" role="button"
         aria-label="选择或拖入多张图片">
      <div class="bd-icon">🖼️</div>
      <b>拖入多张图片，或点击选择</b>
      <span>JPG / PNG / WebP / AVIF / GIF · 单张 ≤ 30MB · 全部在本机处理</span>
      <input type="file" id="b-input" accept="image/*" multiple hidden />
    </div>

    <div class="batch-params">
      <label>输出格式
        <select id="b-format">
          <option value="keep">保持原格式</option>
          <option value="image/jpeg">JPEG</option>
          <option value="image/webp" selected>WebP</option>
          <option value="image/png">PNG</option>
        </select>
      </label>
      <label>质量 <output id="b-q-out">78</output>
        <input type="range" id="b-quality" min="10" max="95" value="78" />
      </label>
      <label>最大边长（px，0 = 不缩放）
        <input type="number" id="b-edge" value="1600" min="0" max="8000" step="100" />
      </label>
      <button class="btn" id="b-run" disabled>开始处理</button>
    </div>

    <div class="batch-progress" id="b-progress" hidden>
      <div class="bp-bar"><div class="bp-fill" id="b-fill"></div></div>
      <div class="bp-text" id="b-text"></div>
    </div>

    <div class="batch-list" id="b-list"></div>
    <div class="batch-result" id="b-result"></div>`;

  const $ = (id) => root.querySelector('#' + id);
  const drop = $('b-drop');
  const input = $('b-input');
  const list = $('b-list');
  const result = $('b-result');
  const runBtn = $('b-run');
  const progress = $('b-progress');
  const fill = $('b-fill');
  const ptext = $('b-text');
  const qOut = $('b-q-out');
  let files = [];
  let outputs = [];

  $('b-quality').addEventListener('input', (e) => (qOut.textContent = e.target.value));

  const setFiles = (list_) => {
    files = [...list_].filter((f) => f.type.startsWith('image/'));
    outputs = [];
    result.innerHTML = '';
    runBtn.disabled = !files.length;
    runBtn.textContent = files.length ? `开始处理 ${files.length} 张` : '开始处理';
    list.innerHTML = files.length
      ? files
          .map(
            (f, i) => `<div class="bl-item" data-i="${i}">
              <span class="bl-name">${esc(f.name)}</span>
              <span class="bl-size">${fmt(f.size)}</span>
              <span class="bl-state">待处理</span>
            </div>`
          )
          .join('')
      : '';
    const skipped = list_.length - files.length;
    if (skipped > 0) list.insertAdjacentHTML('afterbegin', `<div class="bl-warn">已忽略 ${skipped} 个非图片文件</div>`);
  };

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => setFiles(input.files));
  // 拖拽：dragover 必须 preventDefault，否则浏览器会直接打开图片
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    if (e.dataTransfer?.files?.length) setFiles(e.dataTransfer.files);
  });

  async function processOne(file, opts) {
    const bmp = await createImageBitmap(file);
    let w = bmp.width;
    let h = bmp.height;
    if (opts.maxEdge > 0 && Math.max(w, h) > opts.maxEdge) {
      const s = opts.maxEdge / Math.max(w, h);
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const mime =
      opts.format === 'keep'
        ? file.type === 'image/png'
          ? 'image/png'
          : file.type === 'image/webp'
            ? 'image/webp'
            : 'image/jpeg'
        : opts.format;
    // PNG 是无损的，quality 对它无效（这里传了也不会更小，属于浏览器行为）
    const blob = await new Promise((res) => canvas.toBlob(res, mime, opts.quality / 100));
    if (!blob) throw new Error('该格式无法编码这张图（尝试换成 WebP 或 JPEG）');
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    const base = file.name.replace(/\.[^.]+$/, '');
    return { name: `${base}.${ext}`, blob, w, h, before: file.size, after: blob.size };
  }

  runBtn.addEventListener('click', async () => {
    if (!files.length) return;
    const opts = {
      format: $('b-format').value,
      quality: Number($('b-quality').value),
      maxEdge: Math.max(0, Number($('b-edge').value) || 0),
    };
    runBtn.disabled = true;
    progress.hidden = false;
    result.innerHTML = '';
    outputs = [];
    const rows = [...list.querySelectorAll('.bl-item')];
    let ok = 0;
    let before = 0;
    let after = 0;

    for (let i = 0; i < files.length; i++) {
      const row = rows[i];
      row.classList.add('busy');
      row.querySelector('.bl-state').textContent = '处理中…';
      fill.style.width = Math.round((i / files.length) * 100) + '%';
      ptext.textContent = `正在处理 ${i + 1} / ${files.length}：${files[i].name}`;
      try {
        const out = await processOne(files[i], opts);
        outputs.push(out);
        before += out.before;
        after += out.after;
        ok++;
        row.classList.remove('busy');
        row.classList.add('done');
        row.querySelector('.bl-state').textContent = `${out.w}×${out.h} · ${fmt(out.after)}`;
      } catch (e) {
        row.classList.remove('busy');
        row.classList.add('fail');
        row.querySelector('.bl-state').textContent = '失败：' + e.message;
      }
      await new Promise((r) => setTimeout(r, 0)); // 让出主线程，进度条能刷新
    }
    fill.style.width = '100%';
    ptext.textContent = `完成 ${ok} / ${files.length}`;
    runBtn.disabled = false;

    if (!outputs.length) {
      result.innerHTML = '<div class="msg-err">没有生成任何文件，请检查格式设置</div>';
      return;
    }
    const saved = before - after;
    const pct = before ? Math.round((saved / before) * 100) : 0;
    result.innerHTML = `
      <div class="msg-ok">✅ 处理完成 ${ok} 张 · ${fmt(before)} → ${fmt(after)}${
        saved > 0 ? `（省 ${pct}%，${fmt(saved)}）` : '（结果比原图大，试试调低质量或换 JPEG）'
      }</div>
      <div class="row">
        <button class="btn" id="b-zip">📦 打包下载（${outputs.length} 个）</button>
        <button class="btn ghost" id="b-one">逐个下载</button>
      </div>`;
    result.querySelector('#b-zip').onclick = async () => {
      const btn = result.querySelector('#b-zip');
      btn.disabled = true;
      btn.textContent = '打包中…';
      try {
        const { zipBlob } = await import('/assets/lib/zip.js');
        const zip = await zipBlob(outputs.map((o) => ({ name: o.name, data: o.blob })));
        const url = URL.createObjectURL(zip);
        const a = document.createElement('a');
        a.href = url;
        a.download = `batch-${outputs.length}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        btn.textContent = '✓ 已下载';
      } catch (e) {
        btn.textContent = '打包失败';
        console.warn(e);
      }
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = `📦 打包下载（${outputs.length} 个）`;
      }, 1800);
    };
    result.querySelector('#b-one').onclick = () => {
      outputs.forEach((o, i) => {
        setTimeout(() => {
          const url = URL.createObjectURL(o.blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = o.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        }, i * 400);
      });
    };
  });
}
