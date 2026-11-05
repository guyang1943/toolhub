/**
 * 工具页（v3.3 从 app.js 拆出）
 *
 * 为什么单独成模块：表单渲染 + 结果区 + 分享/草稿/加密分享只有 /tools/* 用到，
 * 首页（以及只逛内容页的用户）不该为它付首屏字节。
 *
 * 依赖由 app.js 的 bindToolPage() 注入：模块级 let 在 bind 时赋值，
 * 于是迁移过来的代码基本保持原样（不必在每个函数里写 deps.xxx），
 * 也避免与主模块循环引用。Node 测试与浏览器跑的是同一份实现。
 */
// v3.20：本地事件底座。它是纯函数模块、不依赖 app.js 的任何东西，所以直接静态 import，
// 不走 bindToolPage 的依赖注入——注入是为了避免与主模块循环引用，而这里没有那个风险。
// 顺带把 app.js 的预算留出来（它只剩 0.8 KB）。
import { record } from './lib/events.js';
import * as store from './lib/store.js';

let $, $$, esc, t, toolMeta, catName, navigate, loadRegistry, loadI18n, loadArticles, loadArticle;
let kbLink, pushRecent, usageMap, pushUsage, cmpList, toggleCompare, CAT_ICONS, SITE, renderNavActive;
let getRegistry, getLang, getD18N, getSeoBody, stateHTML;
let CHAINS, setHandoff, takeHandoff, setProgressHandler, ensureCss;

export function bindToolPage(ctx) {
  ({
    $, $$, esc, t, toolMeta, catName, navigate, loadRegistry, loadI18n, loadArticles, loadArticle,
    kbLink, pushRecent, usageMap, pushUsage, cmpList, toggleCompare, CAT_ICONS, SITE, renderNavActive,
    getRegistry, getLang, getD18N, getSeoBody, stateHTML,
    CHAINS, setHandoff, takeHandoff, setProgressHandler, ensureCss,
  } = ctx);
}

/* ---------- 工具页 ---------- */
/* ---------- 工具页样式（v3.5：从 style.css 拆成 style.tool.css，按需加载） ---------- */
// 首页不再为工具页样式付字节，所以从首页点卡片进来时这张表还是缺的。
// 走 app.js 的 ensureCss（和批量 / 离线 / 提交三页共用同一套加载逻辑），但这里要 await：
// 拿不到样式就不画——宁可多等一个本地缓存往返，也别让用户看见一堆裸结构先闪出来。
// 整页加载 /tools/<id>/ 时构建期已经写好 <link>，ensureCss 直接命中。
const TOOL_CSS = '/assets/style.tool.css';

/* ---------- 工具输入：URL 参数 / 草稿 / 分享链接 ---------- */
// v3.22：键名去掉 `toolhub:` 前缀——前缀由 store 统一加。带着前缀传进去会写成
// `toolhub:toolhub:draft:<id>`，迁到 store 时最容易犯的就是这种「前缀加了两遍」。
const DRAFT_PREFIX = 'draft:';

// 收集当前表单值（文件类不参与序列化）
function collectValues(manifest) {
  const values = {};
  for (const inp of manifest.inputs) {
    const el = document.getElementById('f-' + inp.name);
    if (!el) continue;
    values[inp.name] =
      inp.type === 'file' ? (inp.multiple ? Array.from(el.files || []) : el.files[0]) : el.value;
  }
  return values;
}

// 把一组值写回表单；按 manifest 顺序写，顺带触发 change 以便联动字段先就位
function applyValues(manifest, data) {
  let applied = 0;
  for (const inp of manifest.inputs) {
    if (inp.type === 'file' || !(inp.name in data)) continue;
    const el = document.getElementById('f-' + inp.name);
    if (!el) continue;
    const v = String(data[inp.name]).slice(0, 500);
    if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === v)) continue;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    applied++;
  }
  return applied;
}

function saveDraft(id, values) {
  try {
    const plain = {};
    for (const [k, v] of Object.entries(values)) if (typeof v === 'string' && v !== '') plain[k] = v;
    if (!Object.keys(plain).length) return;
    // 先序列化是为了判「超没超 4 KB」——不先量一遍就存，等于把上限交给运气。
    // 代价是 store.set 内部会再 stringify 一次；≤4 KB 的对象量两次是微秒级，
    // 换回来的是「上限判断」与「写入」用同一份数据，不会各算各的。
    if (JSON.stringify(plain).length > 4000) return;
    store.set(DRAFT_PREFIX + id, plain);
  } catch {}
}

function loadDraft(id) {
  return store.get(DRAFT_PREFIX + id, null);
}

// 把当前输入编码进 URL，便于把「算好的结果」直接发人
function shareUrlOf(id, manifest) {
  const url = new URL(location.origin + '/tools/' + id + '/');
  const hasFile = manifest.inputs.some((i) => i.type === 'file');
  for (const [k, v] of Object.entries(collectValues(manifest))) {
    if (typeof v !== 'string' || v === '') continue;
    if (v.length > 500) continue;
    url.searchParams.set(k, v);
  }
  if (!hasFile) url.searchParams.set('run', '1'); // 收到链接即自动算一遍
  return url.toString();
}

/* ---------- 统一结果出口：复制文本 / 下载文件 / 分享链接 ----------
   run() 返回 { html, text?, files?: [{ name, blob?, url? }] }
   平台据此渲染统一操作条，工具内不再自绘复制/下载按钮。 */
let RESULT_URLS = [];
function releaseResultUrls() {
  for (const u of RESULT_URLS) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* 已被浏览器回收 */
    }
  }
  RESULT_URLS = [];
}
function blobUrlOf(f) {
  if (f.url) return f.url;
  if (!f.blob) return null;
  const u = URL.createObjectURL(f.blob);
  RESULT_URLS.push(u);
  return u;
}
function legacyCopy(str) {
  const ta = document.createElement('textarea');
  ta.value = str;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
async function copyWithFeedback(str, btn, okText) {
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  let ok = true;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(str);
    else ok = legacyCopy(str);
  } catch {
    ok = legacyCopy(str);
  }
  btn.textContent = ok ? okText : t('复制失败，请手动选中', 'copyFail');
  setTimeout(() => (btn.textContent = label), 1600);
}
function triggerDownload(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 120);
}
/** 把这次产物收成可接力的载荷；产物只有 url 时先取回 blob（同一次会话，不发往服务器） */
async function payloadOf(files, out) {
  const payload = { files: [], text: out.text || '' };
  for (const f of files) {
    let blob = f.blob;
    if (!blob) {
      try {
        blob = await (await fetch(f.url)).blob();
      } catch {
        continue;
      }
    }
    payload.files.push({ name: f.name, blob });
  }
  return payload;
}

/* ---------- 加入流程（v3.24） ----------
   单跳「→ 再压缩体积」只能一次走一步。真实需求常常是「压完转格式再合成 PDF」，
   那本来就是一条链。这里把这次的产物直接送进一条已有流程的入口，剩下的步骤由
   流程引擎跑完。

   两个边界，都写死在这里：
   1. **只有以当前工具为第 1 步的流程才算候选。** 流程入口只收一份文件或一段文本，
      「把产物塞进第 3 步」不是接力，是改流程定义——那属于 workflows.json。
   2. **产物类型必须和流程入口对得上。** 文件型流程要有文件、文本型流程要有文本，
      文件型还要求 MIME 落在 accept 里。构建期的 check-workflows 只保证了「入口类型
      与第一步工具的输入类型一致」，管不到「这次真的产出了那种东西」——所以运行时
      再判一次。列一个点进去发现喂不进去的流程，比不列更糟。

   不预取 workflows.json：只看一眼结果的人不该为这个按钮多付一次请求，按下才去拿。 */
async function joinCandidates(id, payload) {
  let data;
  try {
    data = await (await fetch('/workflows/workflows.json')).json();
  } catch {
    return { error: true, list: [] };
  }
  const acceptOk = (accept, blob) => {
    const type = (blob && blob.type) || '';
    return String(accept || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .some((a) => (a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : a.startsWith('.') ? false : a === type));
  };
  const list = (data.flows || []).filter((f) => {
    if (!f.steps || !f.steps.length || f.steps[0].tool !== id) return false;
    if (f.input && f.input.kind === 'file') {
      const f0 = payload.files[0];
      if (!f0) return false;
      // accept 写了通配符之外的 MIME（如只收 image/jpeg）时，PNG 产物不能硬塞进去
      return !f.input.accept || !f0.blob || acceptOk(f.input.accept, f0.blob);
    }
    return !!payload.text;
  });
  return { error: false, list };
}

function renderResultActions(out, box, id, manifest, toolLabel) {
  const files = (Array.isArray(out.files) ? out.files : [])
    .map((f) => ({ name: f.name || 'output', kind: f.kind || '', blob: f.blob || null, url: blobUrlOf(f) }))
    .filter((f) => f.url);
  const hasText = typeof out.text === 'string' && out.text.length > 0;
  if (!files.length && !hasText) return null;

  // 图片产物：预览也走平台，工具不再自建 objectURL（否则无法统一回收）
  const imgs = files.filter((f) => f.kind === 'image');
  if (imgs.length) {
    const wrap = document.createElement('div');
    wrap.className = 'result-preview';
    wrap.innerHTML = imgs.map((f) => `<img src="${f.url}" alt="${esc(t('生成结果预览', 'previewAlt'))}" loading="lazy">`).join('');
    box.appendChild(wrap);
  }

  const bar = document.createElement('div');
  bar.className = 'result-actions';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t('结果操作', 'resultActions'));
  const parts = [];
  if (hasText) parts.push(`<button type="button" class="btn ghost" data-act="copy">${t('📋 复制结果', 'copyResult')}</button>`);
  if (files.length === 1) parts.push(`<a class="btn ghost" data-act="download" href="${files[0].url}" download="${esc(files[0].name)}">${t('⬇ 下载', 'download')} ${esc(files[0].name)}</a>`);
  if (files.length > 1) {
    parts.push(`<button type="button" class="btn ghost" data-act="download-zip">${t('📦 打包下载 zip', 'downloadZip')}（${files.length}）</button>`);
    parts.push(`<button type="button" class="btn ghost" data-act="download-all">${t('⬇ 逐个下载', 'downloadAll')}</button>`);
  }
  // 工具链：把这次产出直接交给下游工具，不用先下载再上传
  // v3.24 起它只是半个答案：单跳只能一次只走一步，而「压完还要转格式再合成 PDF」
  // 这种真实需求本来就是一条链。所以旁边再给一个「加入流程」，把这批产物直接
  // 送进一条已经写好的流程的入口——两步都留着，各管各的场景。
  const chains = (CHAINS && typeof CHAINS === 'object' && CHAINS[id]) || [];
  for (const c of chains) parts.push(`<button type="button" class="btn ghost" data-go="${c.to}">→ ${esc(c.label)}</button>`);
  parts.push(`<button type="button" class="btn ghost" data-act="join">＋ 加入流程</button>`);
  parts.push(`<button type="button" class="btn ghost" data-act="share">${t('🔗 分享此结果', 'shareResult')}</button>`);
  // 加密分享：内容走 URL 片段，服务器与 CDN 日志里看不到明文（v3.0 E2）
  parts.push(`<button type="button" class="btn ghost" data-act="share-enc">${t('🔒 加密分享', 'shareEnc')}</button>`);
  parts.push(`<span class="ra-note">${t('全程在本机完成，文件不会上传', 'localNote')}</span>`);
  bar.innerHTML = parts.join('');

  const copyBtn = bar.querySelector('[data-act="copy"]');
  if (copyBtn) copyBtn.onclick = () => copyWithFeedback(out.text, copyBtn, t('✓ 已复制', 'copied'));
  const allBtn = bar.querySelector('[data-act="download-all"]');
  if (allBtn) allBtn.onclick = () => files.forEach((f, i) => setTimeout(() => triggerDownload(f.url, f.name), i * 350));
  const shareBtn = bar.querySelector('[data-act="share"]');
  if (shareBtn) shareBtn.onclick = () => copyWithFeedback(shareUrlOf(id, manifest), shareBtn, t('✓ 链接已复制', 'linkCopied'));

  const zipBtn = bar.querySelector('[data-act="download-zip"]');
  if (zipBtn)
    zipBtn.onclick = async () => {
      zipBtn.disabled = true;
      const label = zipBtn.textContent;
      zipBtn.textContent = t('打包中…', 'zipping');
      try {
        const { zipBlob } = await import('/assets/lib/zip.js');
        const entries = [];
        for (const f of files) {
          let blob = f.blob;
          if (!blob) {
            try {
              blob = await (await fetch(f.url)).blob();
            } catch {
              continue;
            }
          }
          entries.push({ name: f.name, data: blob });
        }
        const zip = await zipBlob(entries);
        triggerDownload(URL.createObjectURL(zip), `${id}-${entries.length}files.zip`);
        setTimeout(() => URL.revokeObjectURL(zip), 4000);
        zipBtn.textContent = t('✓ 已打包', 'zipDone');
      } catch (e) {
        zipBtn.textContent = t('打包失败', 'zipFail');
        console.warn('打包失败：', e);
      }
      setTimeout(() => {
        zipBtn.disabled = false;
        zipBtn.textContent = label;
      }, 1800);
    };

  const encBtn = bar.querySelector('[data-act="share-enc"]');
  if (encBtn)
    encBtn.onclick = async () => {
      const pass = await askPassphrase(t('加密分享', 'shareEnc'), t('可以留空：密钥会放进链接。设置口令后，链接和口令需要分开发。', 'encHint'));
      if (pass === null) return; // 取消
      encBtn.disabled = true;
      try {
        const { createShare } = await import('/assets/lib/secure-share.js');
        const frag = await createShare({ id, values: collectValues(manifest), ts: Date.now() }, pass);
        const url = location.origin + '/tools/' + id + '/' + '#' + frag;
        await copyWithFeedback(url, encBtn, t('✓ 加密链接已复制', 'encCopied'));
      } catch (e) {
        encBtn.textContent = t('加密失败', 'encFail');
        console.warn('加密分享失败：', e);
      }
      setTimeout(() => {
        encBtn.disabled = false;
      }, 600);
    };
  bar.querySelectorAll('[data-go]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const payload = await payloadOf(files, out);
      if (!payload.files.length && !payload.text) {
        btn.disabled = false;
        return;
      }
      payload.from = id;
      setHandoff(payload);
      navigate('/tools/' + btn.dataset.go + '/');
    };
  });

  // 「加入流程」：产物直接成为某条流程的入口，中间不下载、不上传。
  // 候选在按下那一刻才去取（几 KB 的本地 JSON），选定后带着 flow id 跳转，
  // 由流程页消费 handoff 把文件/文本填进入口。
  const joinBtn = bar.querySelector('[data-act="join"]');
  if (joinBtn)
    joinBtn.onclick = async () => {
      const old = bar.parentElement.querySelector('.join-menu');
      if (old) {
        old.remove(); // 再点一次收起
        return;
      }
      joinBtn.disabled = true;
      joinBtn.textContent = '读取流程…';
      const payload = await payloadOf(files, out);
      const { error, list } = await joinCandidates(id, payload);
      joinBtn.disabled = false;
      joinBtn.textContent = '＋ 加入流程';

      const menu = document.createElement('div');
      menu.className = 'join-menu';
      if (error) {
        menu.innerHTML = `<p>流程定义没读到（离线包里可能缺了 workflows.json）。</p>`;
      } else if (!list.length) {
        // 说清为什么没有，别让人以为是坏了：入口类型对不上是最常见的原因
        menu.innerHTML = `<p>还没有以「${esc(toolLabel || id)}」为第 1 步的流程。
          ${payload.files.length ? '这次产出的是文件，' : ''}流程入口只收一份文件或一段文本，
          所以只能接在第 1 步。 <a href="/workflows/">看看现有的流程 →</a></p>`;
      } else {
        menu.innerHTML = `<p>把这次结果直接接进一条流程（不用先下载再上传）：</p>
          <ul>${list
            .map(
              (f) =>
                `<li><div><b>${esc(f.name)}</b><span class="jm-goal">${esc(f.goal || '')}</span></div>
                 <button type="button" class="btn ghost" data-join="${esc(f.id)}">接进去</button></li>`
            )
            .join('')}</ul>`;
        menu.querySelectorAll('[data-join]').forEach((b) => {
          b.onclick = () => {
            payload.from = id;
            payload.flow = b.dataset.join;
            setHandoff(payload);
            navigate('/workflows/?flow=' + encodeURIComponent(b.dataset.join));
          };
        });
      }
      bar.after(menu);
    };

  box.appendChild(bar);
  return bar;
}

/* ---------- 口令弹层（加密分享用） ----------
   返回 Promise<string | null>：空字符串表示不设口令，null 表示取消。
   不用 window.prompt：无法定制文案、会被部分浏览器拦截、样式也不受控。 */
function askPassphrase(title, hint = '') {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'enc-mask';
    mask.innerHTML = `
      <div class="enc-modal" role="dialog" aria-modal="true" aria-labelledby="enc-title">
        <h3 id="enc-title">${esc(title)}</h3>
        <p>${esc(hint)}</p>
        <input id="enc-pass" type="password" autocomplete="new-password" placeholder="${esc(t('口令（可留空）', 'encPlaceholder'))}" />
        <div class="enc-row">
          <button type="button" class="btn ghost" id="enc-cancel">${t('取消', 'cancel')}</button>
          <button type="button" class="btn" id="enc-ok">${t('生成链接', 'encGenerate')}</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const input = mask.querySelector('#enc-pass');
    const done = (v) => {
      mask.remove();
      resolve(v);
    };
    mask.querySelector('#enc-cancel').onclick = () => done(null);
    mask.querySelector('#enc-ok').onclick = () => done(input.value.trim());
    mask.addEventListener('click', (e) => {
      if (e.target === mask) done(null);
    });
    mask.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') done(input.value.trim());
    });
    setTimeout(() => input.focus(), 30);
  });
}

function fieldHTML(inp) {
  const ph = inp.placeholder ? `placeholder="${esc(inp.placeholder)}"` : '';
  const dv = inp.default != null ? esc(inp.default) : '';
  switch (inp.type) {
    case 'textarea':
      return `<textarea id="f-${inp.name}" ${ph}>${dv}</textarea>`;
    case 'select':
      return `<select id="f-${inp.name}">${inp.options
        .map((o) => `<option value="${esc(o.value)}" ${o.value === inp.default ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>`;
    case 'range':
      return `<input type="range" id="f-${inp.name}" min="${inp.min}" max="${inp.max}" value="${dv || 75}" style="width:100%">`;
    case 'file':
      return `<input type="file" id="f-${inp.name}" accept="${esc(inp.accept || '*')}"${inp.multiple ? ' multiple' : ''} />`;
    case 'number':
      return `<input type="number" id="f-${inp.name}" value="${dv}" ${ph} />`;
    default:
      return `<input type="text" id="f-${inp.name}" value="${dv}" ${ph} />`;
  }
}

/* ---------- 接收加密分享（v3.0 E2） ----------
   链接形如 /tools/tax-calc/#enc=xxx，片段不会发给服务器。
   返回 true 表示已用分享内容填好表单，跳过 URL 参数与草稿恢复。 */
async function applyEncryptedShare(meta, manifest, doRun) {
  if (!location.hash.startsWith('#enc=')) return false;
  let mod;
  try {
    mod = await import('/assets/lib/secure-share.js');
  } catch {
    return false;
  }
  const env = mod.peekShare();
  if (!env) return false;

  let pass = '';
  if (env.pass) {
    pass = await askPassphrase(t('这个分享链接已加密', 'encNeedPass'), t('输入分享者另发给你的口令', 'encNeedPassHint'));
    if (pass === null) return false; // 用户取消：保持空白表单
  }
  const res = await mod.openShare(location.hash, pass);
  if (!res.ok) {
    const note = document.createElement('div');
    note.className = 'pipe-note enc-note-bad';
    note.textContent = '⚠️ ' + (res.error || t('解密失败', 'decFail'));
    const box = document.getElementById('tool-fields');
    if (box) box.insertBefore(note, box.firstChild);
    return false;
  }
  const data = res.data || {};
  if (data.id && data.id !== meta.id) {
    // 链接指向别的工具：直接跳过去，避免用户对着错的表单发呆
    navigate('/tools/' + data.id + '/', true);
    return true;
  }
  const applied = applyValues(manifest, data.values || {});
  history.replaceState(null, '', location.pathname + location.search); // 清掉片段，刷新不再重复解密
  const note = document.createElement('div');
  note.className = 'pipe-note enc-note-ok';
  note.textContent = '🔓 ' + t('已解密分享内容（内容从未经过服务器，片段不随请求发送）', 'decOk');
  const box = document.getElementById('tool-fields');
  if (box) box.insertBefore(note, box.firstChild);
  if (applied && !manifest.inputs.some((i) => i.type === 'file')) setTimeout(() => doRun(), 80);
  return true;
}

export async function openTool(id) {
  const cssReady = ensureCss(TOOL_CSS); // 和下面的注册表请求并行，别串成两步等
  const reg = await loadRegistry();
  await loadI18n();
  // 依赖快照必须放在「注册表 / 多语言」加载之后：REGISTRY 与 D18N 都是加载完成后才赋值，
  // 放在函数入口会拿到 null，后面 REGISTRY.tools 会直接抛错（v3.3 拆分时踩到的坑）。
  const REGISTRY = getRegistry();
  const LANG = getLang();
  const D18N = getD18N();
  const SEO_BODY = getSeoBody();
  const meta = reg.tools.find((tool) => tool.id === id);
  // 样式就位前不翻视图：翻了就是一次裸结构闪烁
  await cssReady;
  // v3.4：告诉 CSS 现在在工具页 —— 首页会收起头部搜索框，这里得把它放出来
  document.body.dataset.view = 'tool';
  $('#view-home').style.display = 'none';
  $('#view-page').style.display = 'none';
  $('#view-tool').style.display = '';
  if (!meta) {
    $('#tool-body').innerHTML = stateHTML('empty', { title: '工具不存在', detail: '可能已下线，或链接有误。' });
    return;
  }
  document.title = LANG === 'en' ? `${toolMeta(meta).name} · ToolHub` : `${meta.name} · ${SITE}`;
  renderNavActive('/');

  // 目录工具：站内详情页 + 跳转官网（页面本身可用于搜索引擎收录）
  if (meta.runtime === 'link') {
    const m = toolMeta(meta);
    const icon2 = CAT_ICONS[meta.category] || '🧰';
    const relLocal = REGISTRY.tools.filter((x) => x.runtime !== 'link' && x.category === meta.category).slice(0, 4);
    const relDir = REGISTRY.tools.filter((x) => x.runtime === 'link' && x.id !== meta.id && x.category === meta.category).slice(0, 4);
    $('#tool-body').innerHTML = `
      <div class="panel">
        <div class="tool-head">
          <h1><span class="h-icon">${icon2}</span>${m.name}<button class="share-btn" id="share-btn" title="复制链接">🔗</button></h1>
          <p class="desc">${m.desc}</p>
          <p class="src">✦ ${t('来源', 'sourceLabel')}：${esc(meta.source)} · License: ${meta.license} · ${t('分类', 'categoryLabel')}：${catName(meta.category)}</p>
        </div>
        <div class="dir-cta">
          <div class="dir-cta-text">
            <b>${t('官方在线版', '') || '官方在线版'}</b>
            <div style="font-size:13px;color:var(--muted);margin-top:4px">
              这是第三方开源项目的官方在线版，点击将在新标签页打开 <code>${esc(new URL(meta.url).hostname)}</code>
            </div>
          </div>
          <a class="btn" href="${esc(meta.url)}" target="_blank" rel="noopener">打开官网 ↗</a>
        </div>
        <div class="panel usage" style="margin-top:16px">
          📘 <b>说明</b>　本页是 ToolHub 对该开源项目的整理与推荐，工具本体由项目作者维护，版权与数据均归原作者所有。
          如果官网无法访问，可能是临时故障或网络限制，可稍后重试或在项目仓库反馈。
        </div>
        ${
          meta.blurb
            ? `<div class="panel tips" style="margin-top:12px">✍️ <b>编辑推荐</b>　${meta.blurb}</div>`
            : ''
        }
      </div>
      ${
        relLocal.length || relDir.length
          ? `<div class="section-title" style="margin-top:22px">🔗 <span>${t('相关工具', 'relatedLocal')}</span></div>
             <div class="related-row">
               ${relLocal
                 .map((x) => `<div class="related-chip" data-id="${x.id}">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div>`)
                 .join('')}
               ${relDir
                 .map((x) => `<div class="related-chip" data-id="${x.id}">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div>`)
                 .join('')}
             </div>`
          : ''
      }
      ${
        SEO_BODY
          ? `<div class="panel doc-body" style="margin-top:18px">${SEO_BODY}</div>`
          : ''
      }`;
    $('#tool-body').querySelectorAll('.related-chip[data-id]').forEach((el) => {
      kbLink(el, () => navigate('/tools/' + el.dataset.id + '/'));
    });
    const sb2 = $('#share-btn');
    if (sb2) {
      sb2.onclick = async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          sb2.textContent = '✅';
          setTimeout(() => (sb2.textContent = '🔗'), 1600);
        } catch {
          sb2.textContent = '❌';
          setTimeout(() => (sb2.textContent = '🔗'), 1600);
        }
      };
    }
    return;
  }

  pushRecent(meta.id);
  $('#tool-body').innerHTML = `
    <div class="panel" id="tool-form"></div>
    <div class="panel result" id="tool-result" style="display:none" role="region" aria-live="polite" aria-label="运行结果"></div>
    <div id="tool-docs"></div>
    <div id="related-panel"></div>`;

  let mod;
  try {
    mod = await import(`/tools/${id}/run.js`);
  } catch (e) {
    $('#tool-body').innerHTML = stateHTML('error', { title: '工具加载失败', detail: e.message });
    return;
  }
  if (!mod.manifest || !mod.run) {
    $('#tool-body').innerHTML = stateHTML('error', { title: '工具不可用', detail: '缺少 manifest 或 run 定义。' });
    return;
  }
  const manifest = mod.manifest;
  const icon = CAT_ICONS[meta.category] || '🧰';
  const used = usageMap()[meta.id] || 0;
  const usedNote = used
    ? LANG === 'en'
      ? ` · ${used} ${t('次', 'usedLocal')}`
      : ` · 本机用过 ${used} 次`
    : '';
  // 英译覆盖（缺失时回退中文）
  const d = LANG === 'en' && D18N ? D18N[meta.id] : null;
  const usageText = (d && d.usage) || manifest.usage;
  const tipList = (d && d.tips) || manifest.tips;
  const scenarioList = (d && d.scenarios) || manifest.scenarios;
  const labelOf = (inp) => (d && d.labels && d.labels[inp.name]) || inp.label;
  const runLabel = (d && d.runLabel) || manifest.runLabel || t('运行', 'runDefault');

  let blocks = '';
  if (usageText) blocks += `<div class="panel usage">📘 <b>${t('使用说明', 'detailUsage')}</b>　${usageText}</div>`;
  if (scenarioList && scenarioList.length) {
    blocks += `<details class="panel scenarios" open>
      <summary>📖 ${t('使用场景', 'detailScenarios')}（${scenarioList.length}）</summary>
      <div class="scenario-list">${scenarioList
        .map(
          (s, i) => `<div class="scenario-item">
            <div class="sc-title"><span class="sc-num">${i + 1}</span>${s.scene}</div>
            <div class="sc-flow">${t('做法', 'how')}：${s.how}</div>
            <div class="sc-result">${t('结果', 'result')}：${s.result}</div>
          </div>`
        )
        .join('')}</div>
    </details>`;
  }
  if (tipList && tipList.length)
    blocks += `<div class="panel tips">💡 <b>${t('小贴士', 'detailTips')}</b><ul>${tipList.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;

  // 长尾教程（步骤 + 常见错误，中文模式展示；英文详情见 i18n-detail）
  // v3.10：只取本工具那一篇（平均 1.2 KB），不再拉整份 articles.json
  const article = await loadArticle(meta.id);
  if (article && LANG !== 'en') {
    if (article.steps && article.steps.length)
      blocks += `<div class="panel tutorial"><b>📝 使用步骤</b><ol class="tut-steps">${article.steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`;
    if (article.pitfalls && article.pitfalls.length)
      blocks += `<div class="panel tutorial"><b>⚠️ 常见错误</b><div class="pitfall-list">${article.pitfalls
        .map((p) => `<div class="pitfall-item"><b>${p.title}</b><span>${p.body}</span></div>`)
        .join('')}</div></div>`;
  }

  $('#tool-form').innerHTML =
    `<div class="tool-head">
      <h1><span class="h-icon">${icon}</span>${toolMeta(meta).name}<button class="share-btn" id="share-btn" title="复制带当前输入的链接">🔗</button><button class="share-btn" id="cmp-btn" title="加入对比">⇄ 加入对比</button><button class="share-btn" id="eg-btn" title="填入示例数据">⌨ 示例</button><button class="share-btn" id="embed-btn" title="复制嵌入代码">&lt;/&gt; 嵌入</button></h1>
      <p class="desc">${toolMeta(meta).desc}</p>
      <p class="src">✦ ${t('来源', 'sourceLabel')}：${meta.source} · License: ${meta.license} · ${t('分类', 'categoryLabel')}：${catName(meta.category)}${usedNote}</p>
      ${LANG === 'en' && !d ? '<p class="src" style="color:#c2570a">⚠️ Detailed instructions are currently available in Chinese only.</p>' : ''}
    </div>
    <div class="panel" id="tool-fields">${manifest.inputs.map((inp) => `<div class="field"><label>${labelOf(inp)}</label>${fieldHTML(inp)}</div>`).join('')}
      <div class="row"><button class="btn" id="run-btn">${runLabel}</button></div></div>`;

  // 教程正文放在结果之后：先让用户能用，再解释怎么用
  const docs = $('#tool-docs');
  if (docs) docs.innerHTML = blocks;

  $('#run-btn').onclick = async () => {
    await doRun();
  };

  // 工具可选钩子：表单渲染完成后做联动（如单位换算的「类型 → 单位」下拉联动）
  if (typeof mod.onForm === 'function') {
    try {
      mod.onForm($('#tool-form'));
    } catch (e) {
      console.warn('onForm 钩子执行失败：', e);
    }
  }

  // 输入回填：加密分享 > URL 参数（可分享「算好的结果」）> 本机上次输入
  (async function restoreInputs() {
    if (await applyEncryptedShare(meta, manifest, doRun)) return;
    const params = new URLSearchParams(location.search);
    const fromUrl = {};
    for (const [k, v] of params) if (k !== 'embed' && k !== 'run') fromUrl[k] = v;
    // run=1 时收到链接即自动算一遍（文件类工具无法自动跑）
    const wantRun = params.get('run') === '1' && !manifest.inputs.some((i) => i.type === 'file');
    if (Object.keys(fromUrl).length && applyValues(manifest, fromUrl)) {
      if (wantRun) setTimeout(() => doRun(), 60);
      return;
    }
    // 只带 run=1（无字段参数）：按默认值直接运行
    if (wantRun) {
      setTimeout(() => doRun(), 60);
      return;
    }
    const draft = loadDraft(meta.id);
    if (!draft) return;
    if (!applyValues(manifest, draft)) return;
    const bar = document.createElement('div');
    bar.className = 'draft-note';
    bar.innerHTML = `${t('已恢复上次输入', 'draftRestored')} <button type="button" id="draft-clear">${t('清空', 'draftClear')}</button>`;
    const fields = document.getElementById('tool-fields');
    if (fields) fields.insertBefore(bar, fields.firstChild);
    document.getElementById('draft-clear').onclick = () => {
      store.del(DRAFT_PREFIX + meta.id);
      bar.remove();
      openTool(meta.id);
    };
  })();

  // 工具链接力：把上一步的产出直接填进本次表单（同一次会话内，不上传）
  (function applyPipelineHandoff() {
    const h = takeHandoff();
    if (!h) return;
    const inputs = manifest.inputs || [];
    const fileInp = inputs.find((i) => i.type === 'file');
    const fileEl = fileInp ? document.getElementById('f-' + fileInp.name) : null;
    let injected = 0;
    if (fileEl && h.files && h.files.length) {
      try {
        const dt = new DataTransfer();
        h.files.forEach((f) => dt.items.add(new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' })));
        fileEl.files = dt.files;
        injected = h.files.length;
      } catch {
        injected = 0; // 老浏览器不支持构造 FileList，退回手动选择
      }
    }
    if (!injected && h.text) {
      const txtInp = inputs.find((i) => i.type === 'textarea') || inputs.find((i) => i.type === 'text');
      const txtEl = txtInp ? document.getElementById('f-' + txtInp.name) : null;
      if (txtEl && !txtEl.value) {
        txtEl.value = h.text;
        injected = 1;
      }
    }
    if (!injected) return;
    const note = document.createElement('div');
    note.className = 'pipe-note';
    // 来源不同，说法要不同：拖进来的文件说「上一步的结果」会让人以为是工具链接力
    const lead = h.from === 'drop' ? t('已放入你拖进来的文件', 'dropLoaded') : t('已带入上一步的结果', 'handoffNote');
    note.innerHTML = `↪ ${lead}${
      injected > 1 ? `（${injected} ${t('个文件', 'filesUnit')}）` : ''
    }，${t('确认参数后点运行即可', 'handoffHint')}`;
    const fields = document.getElementById('tool-fields');
    if (fields) fields.insertBefore(note, fields.firstChild);
  })();

  async function doRun() {
    const values = collectValues(manifest);
    saveDraft(meta.id, values);
    const box = $('#tool-result');
    box.style.display = '';
    if (meta.runtime === 'pyodide') {
      // Python 工具：首次需下载自托管运行时，展示确定性进度条
      box.innerHTML = `<div class="py-load"><div class="py-load-bar"><div class="py-load-fill" id="py-fill"></div></div><div class="py-load-txt" id="py-txt">正在准备 Python 运行时…</div></div>`;
      setProgressHandler((loaded, total, phase) => {
        const fill = document.getElementById('py-fill');
        const txt = document.getElementById('py-txt');
        if (!fill || !txt) return;
        const mb = (n) => (n / 1048576).toFixed(1);
        if (phase === 'init') {
          fill.style.width = '100%';
          txt.textContent = '正在初始化 Python 环境…';
          return;
        }
        fill.style.width = (total ? Math.min(100, Math.round((loaded / total) * 100)) : 0) + '%';
        const label = total > 20000000 ? 'pandas 数据处理库' : 'Python 运行时';
        txt.textContent = `正在下载${label} ${mb(loaded)} / ${mb(total)} MB（仅首次，之后可离线使用）`;
      });
    } else {
      box.innerHTML = stateHTML('loading', { title: t('处理中…', 'processing') });
    }
    try {
      const out = await mod.run(values);
      releaseResultUrls();
      box.innerHTML = out.html;
      renderResultActions(out, box, meta.id, manifest, toolMeta(meta).name);
      if (out.after) out.after(box);
      pushUsage(meta.id); // 仅本机计数
      record(meta.id, 'ok'); // v3.20：只记「跑成了」，不记输入
      focusResult(box);
    } catch (e) {
      box.innerHTML = stateHTML('error', { title: t('出错了', 'errorPrefix'), detail: e.message });
      // 失败也记一条：没有分母就算不出完成率，而「哪些工具在真实使用中经常跑挂」
      // 正是最该被看见的信号。只记工具与事件，不记 e.message（可能带用户输入）。
      record(meta.id, 'err');
      focusResult(box);
    } finally {
      setProgressHandler(null);
    }
  }

  // 结果出现后把焦点送到结果区：键盘用户不必再猜结果在哪，读屏也会朗读内容。
  // 用 tabindex=-1 让它可编程聚焦但不进 Tab 序列。
  function focusResult(box) {
    if (!box || box.style.display === 'none') return;
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
    try {
      box.focus({ preventScroll: false });
    } catch {
      /* 老浏览器不支持 options 参数 */
      box.focus();
    }
    box.classList.remove('result-flash');
    void box.offsetWidth; // 强制重排，保证动画能重放
    box.classList.add('result-flash');
  }

  // Ctrl/⌘ + Enter 快捷执行（textarea 内）
  $('#tool-form').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.tagName === 'TEXTAREA') {
      e.preventDefault();
      doRun();
    }
  });

  // 填入示例数据
  const eg = $('#eg-btn');
  if (eg) {
    eg.onclick = () => {
      for (const inp of manifest.inputs) {
        const el = document.getElementById('f-' + inp.name);
        if (!el || inp.type === 'file') continue;
        const v = (manifest.example && manifest.example[inp.name] !== undefined) ? manifest.example[inp.name] : inp.default;
        if (v !== undefined && v !== null && v !== '') el.value = v;
      }
      eg.textContent = '✓ 已填入';
      setTimeout(() => (eg.textContent = '⌨ 示例'), 1500);
    };
  }

  // 复制嵌入代码
  const eb = $('#embed-btn');
  if (eb) {
    eb.onclick = async () => {
      const code = `<iframe src="${location.origin}/tools/${meta.id}/?embed=1" width="100%" height="680" style="border:1px solid #e3e6ea;border-radius:12px" title="${meta.name} · ToolHub" loading="lazy"></iframe>`;
      try {
        await navigator.clipboard.writeText(code);
        eb.textContent = '✓ 已复制';
        setTimeout(() => (eb.textContent = '</> 嵌入'), 1600);
      } catch {
        eb.textContent = '复制失败';
        setTimeout(() => (eb.textContent = '</> 嵌入'), 1600);
      }
    };
  }

  // 加入对比
  const cb = $('#cmp-btn');
  if (cb) {
    const on = cmpList().includes(meta.id);
    cb.textContent = on ? '✓ 已加入对比' : '⇄ 加入对比';
    cb.classList.toggle('on', on);
    cb.dataset.cmpId = meta.id;
    cb.onclick = () => toggleCompare(meta.id);
  }

  // 复制分享链接
  const sb = $('#share-btn');
  if (sb) {
    sb.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrlOf(meta.id, manifest));
        sb.textContent = '✅';
        setTimeout(() => (sb.textContent = '🔗'), 1600);
      } catch {
        sb.textContent = '❌';
        setTimeout(() => (sb.textContent = '🔗'), 1600);
      }
    };
  }

  const related = REGISTRY.tools
    .filter((t) => t.id !== meta.id && (t.category === meta.category || t.hot) && t.runtime !== 'link')
    .slice(0, 4);
  const relatedDir = REGISTRY.tools
    .filter((t) => t.id !== meta.id && t.runtime === 'link' && t.category === meta.category)
    .slice(0, 4);
  const rp = $('#related-panel');
  let relHTML = '';
  if (related.length) {
    relHTML += `<div class="section-title">🔗 <span>${t('相关工具', 'relatedLocal')}</span></div>
      <div class="related-row">${related
        .map((x) => `<div class="related-chip" data-id="${x.id}">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name}</div>`)
        .join('')}</div>`;
  }
  if (relatedDir.length) {
    relHTML += `<div class="section-title">🌐 <span>${t('同类在线工具', 'relatedDir')}</span><em>${t('第三方开源项目官网', 'relatedDirSub')}</em></div>
      <div class="related-row">${relatedDir
        .map(
          (x) =>
            `<a class="related-chip" href="${esc(x.url)}" target="_blank" rel="noopener">${CAT_ICONS[x.category] || '🧰'} ${toolMeta(x).name} ↗</a>`
        )
        .join('')}</div>`;
  }
  rp.innerHTML = relHTML;
  rp.querySelectorAll('.related-chip[data-id]').forEach((el) => {
    kbLink(el, () => navigate('/tools/' + el.dataset.id + '/'));
  });
}

