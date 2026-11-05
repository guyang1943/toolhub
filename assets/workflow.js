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

import { buildValues, runBanner } from './lib/workflow-core.js';
// 只 import store.js（它本来就在首屏，被 app.js 静态引用），**不** import store-keys.js：
// 那份清单 3 KB，这一页只需要一个键名，为它多付一次请求不值得。
import * as store from './lib/store.js';
// 工具页的「加入流程」把产物放进同一个会话级 handoff 里再跳过来。pipeline.js 本来就在
// 首屏（app.js 静态 import），这里是缓存命中，不产生新请求。
import { peekHandoff, takeHandoff } from './pipeline.js';

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

  // 英文界面下导航写的是 Workflows，但这一页与引擎的界面文案只有中文。
  // 与其让人点进来发现整页中文，不如在顶部说明——工具页对「详细说明只有中文」也是这么处理的。
  if (store.get('lang', 'zh') === 'en') {
    const note = document.createElement('p');
    note.className = 'wf-dim wf-lang-note';
    note.textContent =
      'The workflow runner is currently Chinese-only. Everything still runs locally in this browser — no file ever leaves your device.';
    box.insertBefore(note, el);
  }

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
    applyJoinHandoff(flow);
    runner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * 「加入流程」（v3.24）：工具页把这次的产物放进 handoff 带过来，这里填进流程入口。
   *
   * 三条边界：
   * 1. **只认带 flow 字段的 handoff。** 工具页的「单跳」传的是 {from, files, text}，
   *    那种 handoff 到了别的机制里被消费掉就没了，不能在这里顺手吃掉。
   * 2. **填好不自动跑。** 流程页有参数面板，先跑一遍再改参数等于白跑一次；
   *    工具页的接力也是「填好 + 提示」，两处说法保持一致。
   * 3. **填不进去就静默。** 产物类型对不上的组合在工具页已经被过滤掉了，
   *    走到这里还填不进去说明 FileList 构造失败（老浏览器），退回手动选择。
   */
  function applyJoinHandoff(flow) {
    const h = peekHandoff();
    if (!h || !h.flow || h.flow !== flow.id) return;
    takeHandoff();
    const isFile = flow.input && flow.input.kind === 'file';
    let fed = false;
    if (isFile) {
      const el = runner.querySelector('#wf-file');
      const f0 = h.files && h.files[0];
      if (el && f0) {
        try {
          const dt = new DataTransfer();
          dt.items.add(new File([f0.blob], f0.name, { type: f0.blob.type || 'application/octet-stream' }));
          el.files = dt.files;
          fed = true;
        } catch {
          fed = false; // 老浏览器不支持构造 FileList，退回手动选择
        }
      }
    } else {
      const el = runner.querySelector('#wf-text');
      if (el && h.text) {
        el.value = h.text;
        fed = true;
      }
    }
    if (!fed) return;
    const note = document.createElement('div');
    note.className = 'wf-join-note';
    note.innerHTML = `↪ 已带入「${esc(toolName(h.from))}」的结果${
      isFile ? `（${esc(h.files[0].name)}）` : ''
    }，确认参数后点「开始运行」。`;
    const inputBox = runner.querySelector('.wf-input');
    if (inputBox) inputBox.after(note);
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
      <div class="wf-saved-wrap" id="wf-saved"></div>
      <details class="wf-params" id="wf-params">
        <summary>参数 · 改完可以存成「我的流程」</summary>
        <div id="wf-pbody"></div>
      </details>
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

    /* ---------- 参数面板 + 「我的流程」（v3.24） ---------- */
    //
    // 流程定义里写死的 args 是「默认值」，不是「不可改」：公众号封面要 1200、
    // 头像要 512，同一套步骤在不同场景下差的就是几个数字。这个面板把 args 摊开，
    // 改完能存成一条「我的流程」，下次选同一条流程一键套用。
    //
    // 只摊 args，不摊 bind：bind 是流程内部的接线，改它等于改流程本身——那属于 workflows.json，
    // 改错了不会报错，只会把 A 的产物喂给 B。这种权限不该出现在运行页上。
    //
    // 面板默认折叠：展开才去 import 各工具的 run.js 读 manifest（它们运行时要 import 同一批，
    // 所以展开后不额外花第二次请求）。只是看一眼流程的人不该为此多下载三个模块。
    const FLOW_KEY = 'flows'; // 键名登记在 assets/lib/store-keys.js
    const FLOW_MAX = 20;
    const NAME_MAX = 20;

    const loadSaved = () => {
      const v = store.get(FLOW_KEY, {});
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    };

    /**
     * 流程指纹：每一步「是哪个工具、有哪些可改参数」。
     *
     * 不带这个就埋了个静默错误：`workflows.json` 以后调换步骤顺序、换掉某个工具、或删掉一个
     * 参数，旧参数仍会按**下标**套到新步骤上——键名碰巧相同就直接跑，产出看着正常、内容却是错的。
     * 所以套用前先比指纹，对不上就不盲套。
     */
    const toolsOf = (fl) => (fl.steps || []).map((s) => s.tool || '');
    const sigOf = (fl) =>
      (fl.steps || []).map((s) => `${s.tool || ''}:${Object.keys(s.args || {}).sort().join(',')}`).join('|');

    /**
     * 把一套存量参数裁到「当前流程还认」的形状：步骤下标还在、工具没换、参数键还在才留。
     * 丢掉的数量一并返回，用来在界面上说清楚「丢了几个」，而不是悄悄改掉用户存的东西。
     */
    const fitArgs = (args, tools, fl) => {
      const out = {};
      let dropped = 0;
      for (const [key, obj] of Object.entries(args || {})) {
        const idx = Number(key);
        const step = (fl.steps || [])[idx];
        const cur = step && step.args;
        const sameTool = !tools || !tools[idx] || tools[idx] === step?.tool;
        if (!cur || !sameTool) {
          dropped += Object.keys(obj || {}).length;
          continue;
        }
        for (const [k, v] of Object.entries(obj || {})) {
          if (k in cur) (out[idx] = out[idx] || {})[k] = v;
          else dropped++;
        }
      }
      return { args: out, dropped };
    };

    // 「用这个跑」套用的参数，以及面板没展开时的取值来源。
    // 注意它不能替代 DOM：面板展开后用户改了输入框，DOM 才是最新值。
    let applied = {};

    const argCount = (args) => Object.values(args || {}).reduce((n, o) => n + Object.keys(o || {}).length, 0);

    const fmtAt = (t) => {
      if (!t) return '';
      const d = new Date(t);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    /** 这一次运行真正的参数：先套 applied，再让面板上的输入覆盖它 */
    const readOverrides = () => {
      const ov = {};
      for (const [i, o] of Object.entries(applied)) ov[i] = { ...o };
      for (const el of runner.querySelectorAll('[data-arg]')) {
        const [i, k] = el.dataset.arg.split(':');
        if (!flow.steps[Number(i)]?.args || !(k in flow.steps[Number(i)].args)) continue;
        (ov[i] = ov[i] || {})[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      }
      return ov;
    };

    /** 把一套参数写进面板（面板没展开就只记在 applied 里，展开时用得上） */
    const applyArgs = (args) => {
      applied = JSON.parse(JSON.stringify(args || {}));
      for (const el of runner.querySelectorAll('[data-arg]')) {
        const [i, k] = el.dataset.arg.split(':');
        const v = (applied[i] || {})[k];
        if (v === undefined) continue;
        if (el.type === 'checkbox') el.checked = !!v;
        else el.value = v;
      }
    };

    const saveNote = (msg) => {
      const n = runner.querySelector('#wf-save-note');
      if (n) n.textContent = msg;
    };

    function fieldHTML(id, input, val) {
      const label = esc(input.label || input.name);
      const cur = val ?? input.default ?? '';
      if (input.type === 'select') {
        const opts = (input.options || [])
          .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(cur) ? ' selected' : ''}>${esc(o.label || o.value)}</option>`)
          .join('');
        return `<label class="wf-pfield"><span>${label}</span><select data-arg="${id}">${opts}</select></label>`;
      }
      if (input.type === 'checkbox') {
        return `<label class="wf-pfield wf-pcheck"><input type="checkbox" data-arg="${id}"${cur === true || cur === 'yes' ? ' checked' : ''}><span>${label}</span></label>`;
      }
      if (input.type === 'range' || input.type === 'number') {
        return `<label class="wf-pfield"><span>${label}</span><input type="number" data-arg="${id}" value="${esc(cur)}"${
          input.min != null ? ` min="${input.min}"` : ''
        }${input.max != null ? ` max="${input.max}"` : ''}></label>`;
      }
      return `<label class="wf-pfield"><span>${label}</span><input type="text" data-arg="${id}" value="${esc(cur)}" placeholder="${esc(
        input.placeholder || ''
      )}"></label>`;
    }

    async function mountParams(flow) {
      const body = runner.querySelector('#wf-pbody');
      const groups = [];
      for (const [i, step] of flow.steps.entries()) {
        const keys = Object.keys(step.args || {});
        if (!keys.length) continue;
        let manifest = null;
        try {
          manifest = (await import(`/tools/${step.tool}/run.js`)).manifest;
        } catch {
          // 面板是增强功能：读不到 manifest 就不显示这一组，不影响「运行」本身
        }
        if (!manifest) continue;
        const inputs = Array.isArray(manifest.inputs) ? manifest.inputs : [];
        const fields = keys
          .map((k) => {
            const input = inputs.find((x) => x.name === k);
            if (!input) return ''; // 构建期闸门已保证 args 都对得上 manifest，这里只是兜底
            return fieldHTML(`${i}:${k}`, input, (applied[i] || {})[k] ?? step.args[k]);
          })
          .join('');
        if (fields) {
          groups.push(`<fieldset class="wf-pgroup"><legend>第 ${i + 1} 步 · ${esc(toolName(step.tool))}</legend>${fields}</fieldset>`);
        }
      }

      if (!groups.length) {
        runner.querySelector('#wf-params').hidden = true;
        return;
      }

      body.innerHTML = `
        <p class="wf-tip">流程里写死的是默认值，这里改只影响这一次和「我的流程」，不改流程定义本身。</p>
        ${groups.join('')}
        <div class="wf-psave">
          <input type="text" id="wf-save-name" maxlength="${NAME_MAX}" placeholder="给这套参数起个名字（如：公众号封面）" />
          <button type="button" class="btn ghost" id="wf-save">保存为我的流程</button>
          <button type="button" class="btn ghost" id="wf-reset">恢复默认值</button>
          <span class="wf-dim" id="wf-save-note"></span>
        </div>`;

      body.querySelector('#wf-save').onclick = () => {
        const nameEl = body.querySelector('#wf-save-name');
        const name = (nameEl.value || '').trim();
        if (!name) {
          saveNote('先起个名字再保存。');
          nameEl.focus();
          return;
        }
        const saved = loadSaved();
        // 同一条流程下同名 = 覆盖。否则用户改一次存一次，列表里很快堆满一模一样的两三条。
        const same = Object.entries(saved).find(([, v]) => v && v.flow === flow.id && v.name === name);
        if (!same && Object.keys(saved).length >= FLOW_MAX) {
          saveNote(`最多存 ${FLOW_MAX} 个，先删一个不用的。`);
          return;
        }
        const id = same ? same[0] : Date.now().toString(36);
        // 存的时候一起记下「这套参数是配着哪一版流程存的」，套用时才有东西可核。
        saved[id] = {
          name: name.slice(0, NAME_MAX),
          flow: flow.id,
          sig: sigOf(flow),
          tools: toolsOf(flow),
          args: readOverrides(),
          at: Date.now(),
        };
        if (!store.set(FLOW_KEY, saved)) {
          saveNote('存不进去（浏览器存储被禁用或已满）。');
          return;
        }
        saveNote(
          same
            ? `已覆盖同名的「${saved[id].name}」——同一条流程下重名就是覆盖，不会存成两套。`
            : `已保存「${saved[id].name}」，下次选这条流程就能套用。`
        );
        renderSaved(flow);
      };

      body.querySelector('#wf-reset').onclick = () => {
        applied = {};
        for (const el of body.querySelectorAll('[data-arg]')) {
          const [i, k] = el.dataset.arg.split(':');
          const v = flow.steps[Number(i)].args[k];
          if (el.type === 'checkbox') el.checked = v === true || v === 'yes';
          else el.value = v ?? '';
        }
        saveNote('已恢复流程默认值。要留住现在的值，得点「保存为我的流程」。');
      };
    }

    /** 「我的流程」列表：只读 localStorage，不需要 manifest，所以面板关着也照样显示 */
    function renderSaved(flow) {
      const box = runner.querySelector('#wf-saved');
      if (!box) return;
      const saved = loadSaved();
      const items = Object.entries(saved)
        .filter(([, v]) => v && v.flow === flow.id)
        .sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      if (!items.length) {
        box.innerHTML = '<p class="wf-dim">还没有存过这条流程的参数。展开下面的「参数」改几个值，起个名字就能存下来。</p>';
        return;
      }
      box.innerHTML = `
        <div class="wf-saved-head">我的流程 <span class="wf-dim">${items.length} 个 · 只存在这台设备上</span></div>
        <ul class="wf-saved">${items
          .map(
            ([id, v]) =>
              `<li><b>${esc(v.name)}</b><span class="wf-dim">${argCount(v.args)} 个参数 · ${fmtAt(v.at)}</span>
               <button type="button" class="btn ghost" data-use="${esc(id)}">用这个跑</button>
               <button type="button" class="btn ghost" data-drop="${esc(id)}">删除</button></li>`
          )
          .join('')}</ul>`;
      box.onclick = (e) => {
        const use = e.target.closest('[data-use]');
        const drop = e.target.closest('[data-drop]');
        if (use) {
          if (runBtn.disabled) return; // 正在跑，别插队
          const v = loadSaved()[use.dataset.use];
          if (!v) return;
          // 先核对「这套参数是配着哪一版流程存的」。指纹对不上（步骤换序、换工具、删参数）
          // 就只套还对得上的那部分，并且**不自动开跑**——旧参数跑出来的是「看着正常但内容错」的结果。
          const stale = !v.sig || v.sig !== sigOf(flow);
          const fit = stale ? fitArgs(v.args, v.tools, flow) : { args: v.args, dropped: 0 };
          applyArgs(fit.args);
          const nameEl = runner.querySelector('#wf-save-name');
          if (nameEl) nameEl.value = v.name;
          const input = readInput();
          const ready = flow.input.kind === 'file' ? !!input.picked : !!input.text.trim();
          if (stale) {
            const lost = fit.dropped ? `，${fit.dropped} 个对不上的参数已忽略` : '';
            out.innerHTML = `<div class="msg-warn">「${esc(v.name)}」是按旧版流程存的：这条流程后来改过步骤或参数${esc(
              lost
            )}。已把还对得上的值填进参数面板，<b>没有自动运行</b>——先核对，再点「开始运行」。${
              ready ? '' : `另外还要先${flow.input.kind === 'file' ? '选一个文件' : '把内容粘进来'}。`
            }</div>`;
            const pe = runner.querySelector('#wf-params');
            if (pe) pe.open = true; // 让用户能直接看到被填进去的是什么
            return;
          }
          saveNote(`已套用「${v.name}」。`);
          if (ready) start({});
          else {
            out.innerHTML = `<div class="msg-warn">参数已按「${esc(v.name)}」填好——先${
              flow.input.kind === 'file' ? '选一个文件' : '把内容粘进来'
            }，再点「开始运行」。</div>`;
          }
          return;
        }
        if (drop) {
          const saved2 = loadSaved();
          const name = saved2[drop.dataset.drop]?.name || '这条';
          delete saved2[drop.dataset.drop];
          store.set(FLOW_KEY, saved2);
          renderSaved(flow);
          saveNote(`已删除「${name}」。`);
        }
      };
    }

    // 面板只在第一次展开时读 manifest；之后开关都不再请求
    const paramsEl = runner.querySelector('#wf-params');
    if (paramsEl) {
      let loaded = false;
      paramsEl.addEventListener('toggle', async () => {
        if (!paramsEl.open || loaded) return;
        loaded = true;
        await mountParams(flow);
      });
    }
    renderSaved(flow);

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
      // 参数面板 / 「我的流程」套用的值；面板没动过就是空对象
      const ov = readOverrides();

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
          // 面板上改过的值并进这一份 args；workflows.json 里的定义不动
          const eff = ov[i] ? { ...step, args: { ...step.args, ...ov[i] } } : step;
          const values = buildValues(mod.manifest, eff, i, {
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
        <div class="msg-ok">${runBanner(fl.name, fl.steps.length, ms, resumedFrom)}</div>
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
  if (want) {
    if (flows.some((f) => f.id === want)) select(want);
    else {
      // 静默什么都不发生，是最难排查的一种失败：用户点了「加入流程」或别人贴来的链接，
      // 页面上看不出区别，只会以为功能坏了。所以这里明说一句，并把列表留在下面。
      const note = document.createElement('div');
      note.className = 'wf-join-note';
      note.textContent = `链接里的流程「${want}」不在这台设备的流程表里（可能已下线或改了名字）。下面是全部可用的流程。`;
      picker.before(note);
    }
  }
}
