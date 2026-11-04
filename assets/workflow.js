// /workflows/ 页的引擎（v3.23，按需加载，不进首屏）
//
// 一句话：把 assets/tool-page.js 里「import 一个 run.js、调 run(values)」那一行放进循环。
// 没有第二套执行层、没有沙箱、没有 Worker——100 个工具的契约一行不改，白得一套编排能力。
//
// 四个刻意写死的行为：
//   1. **中途不落盘。** 上一步的文件只活在这个页面的内存里，关掉页面即释放。所以整页没有任何
//      上传请求，也没有「任务 id」「服务端队列」这类东西的存在空间。
//   2. **失败即停，不猜着往下跑。** 某一步抛错就停在那一步，把它的原话显示出来。
//      继续用半成品往下走，只会产出看起来正常但内容错的结果——那比报错更难发现。
//   3. **失败不追究前面几步（v3.24）。** 已经跑完的步骤产物留在内存里，失败后照样能下载，
//      还能「从这一步重试」只重跑失败那一步及之后。这是本地处理才成立的容错：云端工作流
//      要续跑，得先把中间产物传上去；我们根本没有「中间产物在哪」这个问题。
//      断点只活在内存里，不写 localStorage——刷新即失效，才符合「关掉页面就释放」的承诺。
//   4. **本步没有产出但输入还在时，沿用上一段。** 这不是容错，是 reality：exif-strip 遇到
//      本来就是干净的照片时不会产出新文件（它没东西可删）。若因为「这一步没产出」就判失败，
//      用户会以为工具坏了。所以沿用时会在界面上写「完成（无新产物）」，不假装这一步做了事。

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

    // 每步跑完后的快照：carry 是这一步的产出，out 是工具的原始返回。
    // 失败时用它给出「已完成步骤的产物」与「从这一步重试」的起点。
    // 只活在内存里——产物本来就是 Blob，续跑只是把同一个 Blob 再喂给下一步，不产生任何副本。
    let snapshots = [];
    // 断点：失败那一步的输入（prev）与本次运行开始时的用户输入。
    // 不写 localStorage：刷新即失效，才符合「中间结果关掉页面就释放」的承诺。
    let checkpoint = null;

    const readInput = () => {
      const fi = runner.querySelector('#wf-file');
      const ti = runner.querySelector('#wf-text');
      return { picked: (fi && fi.files && fi.files[0]) || null, text: ti ? ti.value : '' };
    };

    // 输入一改，断点就作废。续跑用的是上一次运行开始时的文件与文本；混着用会得到
    // 「前半段吃旧文件、后半段吃新文件」的结果——那种结果看着正常，但是错的，比报错更难发现。
    const dropCheckpoint = () => {
      if (!checkpoint) return;
      checkpoint = null;
      const btn = out.querySelector('#wf-resume');
      if (btn) btn.remove();
      const note = out.querySelector('#wf-resume-note');
      if (note) note.textContent = '输入已改动，断点已作废——点「再跑一次」从头运行。';
    };
    for (const sel of ['#wf-file', '#wf-text']) {
      const node = runner.querySelector(sel);
      if (node) {
        node.addEventListener('change', dropCheckpoint);
        node.addEventListener('input', dropCheckpoint);
      }
    }

    runBtn.onclick = () => start({});

    /**
     * 跑流程，或从失败那一步接着跑。
     * @param {object} opts
     * @param {number|null} opts.resumeFrom 从第几步开始（null = 从头跑）
     * @param {object|null} opts.prev       续跑时这一步的输入（失败那一刻的 carry）
     * @param {object|null} opts.input      续跑时沿用上次运行开始时的用户输入
     */
    async function start({ resumeFrom = null, prev = null, input = null } = {}) {
      const resume = prev !== null;
      const own = input || readInput();

      if (!resume) {
        if (flow.input.kind === 'file' && !own.picked) {
          out.innerHTML = '<div class="msg-warn">先选一个文件再运行。</div>';
          return;
        }
        if (flow.input.kind === 'text' && !own.text.trim()) {
          out.innerHTML = '<div class="msg-warn">先把内容粘进来再运行。</div>';
          return;
        }
      }

      resetUrls();
      out.innerHTML = '';
      if (!resume) {
        snapshots = [];
        checkpoint = null;
        for (let i = 0; i < flow.steps.length; i++) setState(i, 'idle', '待运行');
      }
      runBtn.disabled = true;
      runBtn.textContent = '运行中…';

      const started = Date.now();
      const from = resume ? resumeFrom || 0 : 0;
      let at = from;
      // 这一步的输入：{ files:[{name,blob,kind}], text }
      let carry = resume ? prev : { files: own.picked ? [own.picked] : [], text: own.text || '' };
      let lastOut = snapshots.length ? snapshots[snapshots.length - 1].out : null;

      try {
        for (let i = from; i < flow.steps.length; i++) {
          at = i;
          const step = flow.steps[i];
          setState(i, 'running');
          const mod = await import(`/tools/${step.tool}/run.js`);
          const values = buildValues(mod.manifest, step, i, {
            files: own.picked ? [own.picked] : [],
            file: own.picked,
            text: own.text,
            prev: carry,
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
            if (!carry.files.length) {
              throw Object.assign(new Error(why || '这一步没有产出任何结果'), { step: i });
            }
            carry = { files: carry.files, text: '' };
            setState(i, 'warn', '完成（无新产物）');
            lastOut = res;
            snapshots[i] = { carry, out: res };
            continue;
          }
          carry = {
            files: hasFiles ? res.files : carry.files,
            text: hasText ? res.text : '',
          };
          lastOut = res;
          snapshots[i] = { carry, out: res };
          setState(i, 'done');
        }
        checkpoint = null;
        render(carry, lastOut, Date.now() - started, flow, resume ? from : null);
      } catch (e) {
        const idx = Number.isInteger(e.step) ? e.step : at;
        setState(idx, 'fail', '失败：' + (e.message || '未知错误'));
        // 断点记在失败这一步的**入口**：carry 是它的输入，重试就从这里接上。
        checkpoint = { at: idx, prev: carry, input: own };
        renderPartial(idx, e, { carry, resume });
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = '再跑一次';
      }
    }

    // 失败面板：已完成步骤的产物照样能拿走 + 从失败那一步续跑。
    // 这两件事是一件事的两面——产物还在内存里，所以才有得续。
    function renderPartial(idx, err, { carry, resume }) {
      // 某一步「沿用上一段」时产物没变，别把同一份文件列两遍，看着像跑了两遍
      const seen = new Set();
      const items = [];
      for (let i = 0; i < idx; i++) {
        const snap = snapshots[i];
        if (!snap) continue;
        for (const f of snap.carry.files || []) {
          const blob = f.blob || f;
          if (!blob || seen.has(blob)) continue;
          seen.add(blob);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          items.push(
            `<li><span class="wf-from">第 ${i + 1} 步</span><a href="${url}" download="${esc(f.name)}">${esc(
              f.name
            )}</a> <span class="wf-size">${kb(blob.size || 0)}</span></li>`
          );
        }
      }
      const partialText = carry.text || '';
      const head = `${resume ? `从第 ${idx + 1} 步重试后仍然失败` : `停在第 ${idx + 1} 步`}（${esc(
        toolName(flow.steps[idx]?.tool || '')
      )}）：${esc(err.message || '未知错误')}`;
      const tail =
        idx > 0
          ? `<p class="wf-tip">没有继续往下跑——半成品接下去只会产出一个看着正常、内容不对的结果。
               已经跑完的 ${idx} 步产物留在下面，现在就能下载，没有因为后面失败被丢掉；
               续跑也不用先把中间结果传给谁——它们一直在你内存里。</p>
             ${items.length ? `<ul class="wf-files">${items.join('')}</ul>` : ''}
             ${
               partialText
                 ? `<details class="wf-detail"><summary>已完成部分的文本结果</summary><div class="wf-text-out"><pre>${esc(
                     partialText
                   )}</pre></div></details>`
                 : ''
             }
             <div class="wf-actions">
               <button type="button" class="btn" id="wf-resume">从第 ${idx + 1} 步重试</button>
               <span class="wf-tip" id="wf-resume-note">只重跑第 ${idx + 1} 步及之后，前 ${idx} 步的产物直接复用，不会重算。</span>
             </div>`
          : '<p class="wf-tip">第 1 步就失败了，没有可复用的产物。改好输入再点一次即可。</p>';

      out.innerHTML = `<div class="msg-warn">✗ ${head}</div>${tail}`;

      const resumeBtn = out.querySelector('#wf-resume');
      if (resumeBtn) {
        resumeBtn.onclick = () => start({ resumeFrom: idx, prev: carry, input: checkpoint ? checkpoint.input : null });
      }
    }

    function render(carry, lastOut, ms, fl, resumedFrom = null) {
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
        <div class="msg-ok">✓ ${fl.name}：${fl.steps.length} 步跑完，用时 ${(ms / 1000).toFixed(1)} 秒${
          resumedFrom ? `（从第 ${resumedFrom + 1} 步继续，前 ${resumedFrom} 步没有重跑）` : ''
        }</div>
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
