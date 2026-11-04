// /workflows/ 页的引擎（v3.23，按需加载，不进首屏）
//
// 一句话：把 assets/tool-page.js 里「import 一个 run.js、调 run(values)」那一行放进循环。
// 没有第二套执行层、没有沙箱、没有 Worker——100 个工具的契约一行不改，白得一套编排能力。
//
// 三个刻意写死的行为：
//   1. **中途不落盘。** 上一步的文件只活在这个页面的内存里，关掉页面即释放。所以整页没有任何
//      上传请求，也没有「任务 id」「服务端队列」这类东西的存在空间。
//   2. **失败即停，不猜着往下跑。** 某一步抛错就停在那一步，把它的原话显示出来，并允许整条重跑。
//      继续用半成品往下走，只会产出看起来正常但内容错的结果——那比报错更难发现。
//   3. **本步没有产出但输入还在时，沿用上一段。** 这不是容错，是 reality：exif-strip 遇到
//      本来就是干净的照片时不会产出新文件（它没东西可删）。若因为「这一步没产出」就判失败，
//      用户会以为工具坏了。所以沿用时会在界面上明写「沿用上一段」，不假装这一步做了事。

import { buildValues } from './lib/workflow-core.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 工具返回的 html 里通常已经写清了错在哪；取一小段纯文本放进步骤状态里 */
function digest(html) {
  const t = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 140 ? t.slice(0, 140) + '…' : t;
}

const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB');

export async function mountWorkflows(box, reg) {
  let data;
  try {
    data = await (await fetch('/workflows/workflows.json')).json();
  } catch (e) {
    box.innerHTML = `<div class="msg-warn">流程定义没加载出来（${esc(e.message)}）。刷新一次试试；如果一直这样，说明离线包里缺了 workflows.json。</div>`;
    return;
  }
  const flows = data.flows || [];
  if (!flows.length) {
    box.innerHTML = '<div class="msg-warn">还没有可用的流程。</div>';
    return;
  }

  const el = document.createElement('div');
  el.className = 'wf';
  el.innerHTML = `
    <div class="wf-picker" role="tablist" aria-label="选择一条流程">
      ${flows
        .map(
          (f) => `<button type="button" class="wf-card" role="tab" data-flow="${esc(f.id)}" aria-selected="false">
            <b>${esc(f.name)}</b>
            <span>${esc(f.goal)}</span>
            <em>${esc(f.cost || '')} · ${f.steps.length} 步</em>
          </button>`
        )
        .join('')}
    </div>
    <div class="wf-runner" hidden></div>`;
  box.appendChild(el);

  const picker = el.querySelector('.wf-picker');
  const runner = el.querySelector('.wf-runner');
  let current = null;
  let urls = [];

  const resetUrls = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  };

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-flow]');
    if (!btn) return;
    select(btn.dataset.flow);
  });

  function select(id) {
    const flow = flows.find((f) => f.id === id);
    if (!flow) return;
    current = flow;
    resetUrls();
    for (const b of picker.querySelectorAll('[data-flow]')) b.setAttribute('aria-selected', String(b.dataset.flow === id));
    runner.hidden = false;
    runner.innerHTML = runnerHTML(flow);
    bindRunner(flow);
    runner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const nameOf = new Map((reg?.tools || []).map((t) => [t.id, t.name || t.id]));
  const toolName = (id) => nameOf.get(id) || id;

  function runnerHTML(flow) {
    const input =
      flow.input.kind === 'file'
        ? `<label class="wf-field">
             <span class="wf-label">${esc(flow.input.label || '选择文件')}</span>
             <input type="file" id="wf-file" accept="${esc(flow.input.accept || '')}" />
             <span class="wf-hint">${esc(flow.input.hint || '')}</span>
           </label>`
        : `<label class="wf-field">
             <span class="wf-label">${esc(flow.input.label || '粘贴内容')}</span>
             <textarea id="wf-text" rows="${Number(flow.input.rows) || 6}" placeholder="${esc(flow.input.placeholder || '')}"></textarea>
             <span class="wf-hint">${esc(flow.input.hint || '')}</span>
           </label>`;

    return `
      <div class="wf-head">
        <div>
          <h2>${esc(flow.name)}</h2>
          <p>${esc(flow.detail || flow.goal)}</p>
        </div>
        <span class="wf-cost">${esc(flow.cost || '')}</span>
      </div>
      <div class="wf-input">${input}</div>
      <ol class="wf-steps" id="wf-steps">
        ${flow.steps
          .map(
            (s, i) => `<li class="wf-step" data-step="${i}" data-state="idle">
              <span class="wf-dot" aria-hidden="true">${i + 1}</span>
              <div class="wf-step-body">
                <b>${esc(toolName(s.tool))}</b>
                <span class="wf-note">${esc(s.note || '')}</span>
                <span class="wf-status">待运行</span>
              </div>
            </li>`
          )
          .join('')}
      </ol>
      <div class="wf-actions">
        <button type="button" class="btn" id="wf-run">开始运行</button>
        <span class="wf-tip">全程在本机完成，产物不落盘、不上传。中间结果关掉页面即释放。</span>
      </div>
      <div class="wf-out" id="wf-out" aria-live="polite"></div>`;
  }

  function bindRunner(flow) {
    const runBtn = runner.querySelector('#wf-run');
    const out = runner.querySelector('#wf-out');
    const stepsEl = runner.querySelector('#wf-steps');

    const setState = (i, state, detail) => {
      const li = stepsEl.querySelector(`[data-step="${i}"]`);
      if (!li) return;
      li.dataset.state = state;
      const s = li.querySelector('.wf-status');
      if (s) s.textContent = detail || { idle: '待运行', running: '运行中…', done: '完成', warn: '完成（无新产物）', fail: '失败' }[state] || state;
    };

    runBtn.onclick = async () => {
      const fileInput = runner.querySelector('#wf-file');
      const textInput = runner.querySelector('#wf-text');
      const picked = fileInput && fileInput.files ? fileInput.files[0] : null;
      const text = textInput ? textInput.value : '';

      if (flow.input.kind === 'file' && !picked) {
        out.innerHTML = '<div class="msg-warn">先选一个文件再运行。</div>';
        return;
      }
      if (flow.input.kind === 'text' && !text.trim()) {
        out.innerHTML = '<div class="msg-warn">先把内容粘进来再运行。</div>';
        return;
      }

      resetUrls();
      out.innerHTML = '';
      for (let i = 0; i < flow.steps.length; i++) setState(i, 'idle', '待运行');
      runBtn.disabled = true;
      runBtn.textContent = '运行中…';

      const started = Date.now();
      // 上一步的产物：{ files:[{name,blob,kind}], text }
      let prev = { files: picked ? [picked] : [], text: text || '' };
      let lastOut = null;
      let at = 0;

      try {
        for (const [i, step] of flow.steps.entries()) {
          at = i;
          setState(i, 'running');
          const mod = await import(`/tools/${step.tool}/run.js`);
          const values = buildValues(mod.manifest, step, i, {
            files: picked ? [picked] : [],
            file: picked,
            text,
            prev,
          });
          const res = await mod.run(values);
          if (!res || (typeof res !== 'object' && typeof res !== 'string')) {
            throw new Error('工具没有返回结果');
          }
          const hasFiles = Array.isArray(res.files) && res.files.length > 0;
          const hasText = typeof res.text === 'string' && res.text !== '';

          // 本步没有产出：文件沿用上一段（exif-strip 遇到干净照片会这样），文本不沿用
          if (!hasFiles && !hasText) {
            const why = digest(res.html);
            if (!prev.files.length) {
              throw Object.assign(new Error(why || '这一步没有产出任何结果'), { step: i });
            }
            prev = { files: prev.files, text: '' };
            setState(i, 'warn', why ? '完成（无新产物）' : '完成（无新产物）');
            lastOut = res;
            continue;
          }
          prev = {
            files: hasFiles ? res.files : prev.files,
            text: hasText ? res.text : '',
          };
          lastOut = res;
          setState(i, 'done');
        }
        render(prev, lastOut, Date.now() - started, flow);
      } catch (e) {
        const idx = Number.isInteger(e.step) ? e.step : at;
        setState(idx, 'fail', '失败：' + (e.message || '未知错误'));
        out.innerHTML = `<div class="msg-warn">✗ 停在第 ${idx + 1} 步（${esc(toolName(flow.steps[idx]?.tool || ''))}）：${esc(
          e.message || '未知错误'
        )}
          </div><p class="wf-tip">没有继续往下跑——半成品接下去只会产出一个看着正常、内容不对的结果。改好输入再点一次即可，前面几步不会留下任何东西。</p>`;
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = '再跑一次';
      }
    };

    function render(carry, lastOut, ms, fl) {
      const files = carry.files || [];
      const text = carry.text || '';
      const items = files
        .map((f) => {
          const url = URL.createObjectURL(f.blob || f);
          urls.push(url);
          return `<li><a href="${url}" download="${esc(f.name)}">${esc(f.name)}</a> <span class="wf-size">${kb((f.blob || f).size || 0)}</span></li>`;
        })
        .join('');

      out.innerHTML = `
        <div class="msg-ok">✓ ${fl.name}：${fl.steps.length} 步跑完，用时 ${(ms / 1000).toFixed(1)} 秒</div>
        ${items ? `<ul class="wf-files">${items}</ul>` : ''}
        ${text ? `<div class="wf-text-out"><pre>${esc(text)}</pre><button type="button" class="btn ghost" id="wf-copy">复制文本</button></div>` : ''}
        ${lastOut && lastOut.html ? `<details class="wf-detail"><summary>最后一步的完整输出</summary><div class="wf-toolhtml">${lastOut.html}</div></details>` : ''}
        <p class="wf-tip">产物只在当前页面内存里，关掉就没了——要留就现在下载。</p>`;

      const copy = out.querySelector('#wf-copy');
      if (copy) {
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(text);
            copy.textContent = '已复制 ✓';
            setTimeout(() => (copy.textContent = '复制文本'), 1600);
          } catch {
            copy.textContent = '复制失败，请手动选中';
          }
        };
      }
    }
  }

  // 深链：#flow=image-publish 直接打开那一条（供文档与测试用，也方便贴给别人）
  const want = new URLSearchParams(location.search).get('flow') || (location.hash || '').replace(/^#(flow=)?/, '');
  if (want && flows.some((f) => f.id === want)) select(want);
}
