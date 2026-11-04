// 资源投稿表单（/submit/ 专用，按需动态加载，不进首屏）
//
// 目的：让「我收藏了一个好东西」到「它能进资源库」只差一次粘贴。
//
// 三个设计决定，都是被现实逼出来的：
//   1. **不设接收端**。本站是纯静态托管（GitHub Pages），收不了 POST。与其接第三方
//      表单服务（那等于把「0 字节上传服务器」这句话作废），不如把表单填的内容拼成
//      一条 GitHub Issue 的预填链接——用户点一下就到 GitHub，内容已经在括号里了。
//   2. **查重不额外发请求**。resources.json 本来就是首屏六个启动 JSON 之一，
//      50 条资源此刻已经在内存里，拿它比对是免费的。
//   3. **校验复用构建期那一份**。用的是 assets/lib/json-schema.js + schemas/resource.json，
//      和 check-submit-schema.mjs 完全相同——「这里通过」等于「构建不会拦」。

import { validate } from './lib/json-schema.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const REPO = 'guyang1943/toolhub';

/** 表单呈现顺序。这一份是「设计」不是「发现」——schema 的键序改不动人的阅读顺序。 */
const ORDER = ['collection', 'item.name', 'item.url', 'item.source', 'item.license', 'item.note', 'item.tags', 'conflict', 'submitter'];

/** URL 归一化：协议、www、末尾斜杠、大小写都不该影响「是不是同一个站」 */
const normUrl = (u) =>
  String(u || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/* ---------------- 输出构造 ---------------- */

/** 投稿包 → 入库用的那一条（去掉投稿元信息，只留 item 本体） */
const toItem = (v) => {
  const out = {};
  for (const [k, val] of Object.entries(v.item || {})) {
    if (val === '' || val === undefined) continue;
    if (Array.isArray(val) && !val.length) continue;
    out[k] = val;
  }
  return out;
};

/** Issue 正文：人读的字段 + 一个供维护者直接复用的 JSON 折叠块 */
function buildBody(v, meta) {
  const it = toItem(v);
  const rows = [
    ['资源名称', it.name],
    ['网址', it.url],
    ['开源仓库', it.source || '（无）'],
    ['授权方式', it.license],
    ['挂到合集', meta.collectionTitle],
    ['为什么值得收藏', it.note],
    ['标签', (it.tags || []).join(' / ')],
    ['利益相关', meta.conflictLabel],
    ['投稿人', v.submitter || '（匿名）'],
  ];
  const head = rows.map(([k, val]) => `### ${k}\n${val || '—'}`).join('\n\n');
  const json = JSON.stringify({ collection: v.collection, item: it }, null, 2);
  // v3.24 起条目分两处存：骨架进 resources.json（首屏要），正文 note 进 resources-notes.json（合集页才取）。
  // 这块 JSON 是给维护者直接复用键名的，所以要把「贴哪儿」写在标签上——不然 note 会被贴进骨架文件，
  // 页面看不出来，首屏却悄悄变胖。
  return `${head}\n\n<details>\n<summary>JSON（维护者用：骨架进 resources.json，note 进 resources-notes.json）</summary>\n\n\`\`\`\`json\n${json}\n\`\`\`\`\n\n</details>\n`;
}

/**
 * GitHub 预填链接。
 * 刻意**不带 template 参数**：issue form（.github/ISSUE_TEMPLATE/*.yml）会忽略 body，
 * 于是用户在模板里看到的是空白字段——那正是这个表单要消灭的重复劳动。
 * 走无模板的 new issue + title/body/labels，内容才真的预填成功。
 */
function buildIssueUrl(v, meta) {
  const q = new URLSearchParams({
    title: `[资源] ${v.item.name}`,
    body: buildBody(v, meta),
    labels: 'resource,submission',
  });
  return `https://github.com/${REPO}/issues/new?${q}`;
}

/* ---------------- 渲染 ---------------- */

export async function mountResourceSubmit(box, ctx = {}) {
  const [schema, res] = await Promise.all([
    ctx.schema || fetch('/schemas/resource.json').then((r) => r.json()),
    ctx.resources || fetch('/resources.json').then((r) => r.json()),
  ]);

  const collections = res.collections || [];
  const total = collections.reduce((n, c) => n + c.items.length, 0);
  // 已收录的 URL 索引。首屏数据里现成的，不需要额外请求。
  const seen = new Map();
  for (const c of collections) for (const it of c.items || []) seen.set(normUrl(it.url), { ...it, collection: c.title });

  const val = {}; // 表单值，形如 { collection: 'icons', item: { name: ... }, conflict: 'none' }
  const dirty = new Set(); // 碰过的字段才显示错误，避免一进页面满屏红字

  const readField = (path) => getPath(val, path);
  const writeField = (path, v) => {
    const parts = path.split('.');
    let o = val;
    for (const k of parts.slice(0, -1)) o = o[k] = o[k] || {};
    o[parts.at(-1)] = v;
  };

  const el = document.createElement('div');
  el.className = 'su';
  el.innerHTML = `
    <div class="su-head">
      <h2>📚 推荐一条资源</h2>
      <p>图标库、字体、配色、学习路线、模板站——资源库现在有 <b>${total}</b> 条，
      你这一步会先拿它查重。填完在浏览器里校验，再把内容带进提交流程，全程不经过任何服务器。</p>
    </div>
    <form class="su-form" novalidate autocomplete="off"></form>
    <div class="row su-actions">
      <button type="button" class="btn" id="su-check">校验并生成提交内容</button>
      <button type="button" class="btn ghost" id="su-reset">清空重填</button>
    </div>
    <div class="su-out" id="su-out" aria-live="polite"></div>`;

  const form = el.querySelector('.su-form');
  const out = el.querySelector('#su-out');

  /* ---- 字段渲染 ---- */

  function fieldHTML(path) {
    const s = getPath(schema, path) || {};
    const f = s['x-form'] || {};
    if (f === false) return '';
    const id = 'su-' + path.replace(/\./g, '-');
    const label = f.label || path;
    const hint = f.hint ? `<p class="su-hint">${esc(f.hint)}</p>` : '';
    const ph = f.ph ? `placeholder="${esc(f.ph)}"` : '';
    const req = (getPath(schema, 'required') || []).includes(path.split('.').at(-1)) ? ' <em>必填</em>' : '';

    let input;
    if (f.kind === 'select') {
      const opts = (s.enum || [])
        .map((k) => `<option value="${esc(k)}">${esc((f.labels && f.labels[k]) || k)}</option>`)
        .join('');
      input = `<select id="${id}" data-path="${path}"><option value="">请选择…</option>${opts}</select>`;
    } else if (f.kind === 'textarea') {
      input = `<textarea id="${id}" data-path="${path}" rows="4" ${ph}></textarea>
        <span class="su-count" data-for="${id}"></span>`;
    } else {
      input = `<input id="${id}" data-path="${path}" type="text" ${ph} />`;
    }
    return `<label class="su-field" data-f="${path}">
      <span class="su-label">${esc(label)}${req}</span>
      ${input}
      ${hint}
      <span class="su-err" data-err="${path}"></span>
    </label>`;
  }

  form.innerHTML = ORDER.map(fieldHTML).join('');

  /* ---- 校验 ---- */

  const fieldSchema = (path) => {
    if (path === 'collection') return schema.properties.collection;
    if (path === 'submitter') return schema.properties.submitter;
    if (path === 'conflict') return schema.properties.conflict;
    return schema.$defs.item.properties[path.split('.').at(-1)];
  };

  function showErr(path, msgs) {
    const box = form.querySelector(`[data-err="${path}"]`);
    const wrap = form.querySelector(`[data-f="${path}"]`);
    if (!box) return;
    box.textContent = msgs.length ? msgs.map((m) => m.message).join('；') : '';
    if (wrap) wrap.dataset.bad = msgs.length ? '1' : '';
  }

  function checkOne(path, silent) {
    const v = readField(path);
    // 空数组也按「没填」算：否则清空标签框会立刻弹「数组元素数应 ≥ 1」，那是术语，不是人话
    if (v === '' || v === undefined || (Array.isArray(v) && !v.length)) {
      // 必填但没填 → 交给 required 规则；选填留空视为合规
      const req = (getPath(schema, 'required') || []).includes(path.split('.').at(-1));
      const msgs = req ? [{ message: '这一项必填' }] : [];
      if (!silent) showErr(path, msgs);
      return !msgs.length;
    }
    const msgs = validate(v, fieldSchema(path), schema, path);
    if (!silent) showErr(path, msgs);
    return !msgs.length;
  }

  /* ---- 事件 ---- */

  form.addEventListener('input', (e) => {
    const t = e.target.closest('[data-path]');
    if (!t) return;
    const path = t.dataset.path;
    dirty.add(path);
    const raw = t.value;

    if (path === 'item.tags') {
      writeField(path, raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean));
    } else {
      writeField(path, raw);
    }

    // 字数提示：note 有 20 字下限，让人知道还差多少，比事后报错友好
    const counter = form.querySelector(`[data-for="${t.id}"]`);
    if (counter) {
      const n = raw.trim().length;
      const s = fieldSchema(path);
      counter.textContent = `${n} / ${s.maxLength || '∞'} 字`;
      counter.dataset.ok = n >= (s.minLength || 0) ? '1' : '';
    }
  });

  form.addEventListener('change', (e) => {
    const t = e.target.closest('[data-path]');
    if (t && t.tagName === 'SELECT') dirty.add(t.dataset.path);
  });

  // 失焦即查重：网址这一栏是整张表单唯一能自动回答「有没有收过」的字段
  form.addEventListener(
    'blur',
    (e) => {
      const t = e.target.closest('[data-path]');
      if (!t) return;
      const path = t.dataset.path;
      if (dirty.has(path)) checkOne(path);

      if (path !== 'item.url') return;
      const raw = String(t.value || '').trim();
      const hit = raw && seen.get(normUrl(raw));
      const box = form.querySelector('[data-err="item.url"]');
      if (hit) {
        showErr(path, []);
        if (box) {
          box.dataset.dup = '1';
          box.textContent = `已收录过：${hit.name}（在「${hit.collection}」）。重复提交不会被打回，但会合并到那一条。`;
        }
      } else if (box) {
        box.dataset.dup = '';
      }

      // github.com 链接顺手填进「开源仓库」，省一次输入
      const m = raw.match(/^https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/?/i);
      const srcInput = form.querySelector('[data-path="item.source"]');
      if (m && srcInput && !srcInput.value.trim()) {
        srcInput.value = `github.com/${m[1]}/${m[2]}`;
        writeField('item.source', srcInput.value);
      }
    },
    true
  );

  /* ---- 提交 ---- */

  const conflictLabel = (k) => (schema.properties.conflict['x-form'].labels || {})[k] || k;

  function collect() {
    // 空值必须**剔除**，不能填成空字符串。
    // 可选字段一旦存在就要满足约束，填个 '' 会让 source 的 pattern 报「格式不符」——
    // 而用户什么都没做错，只是没填而已。剔除之后，必填项缺失会由 required 报
    // 「缺少必填字段」，这才是人能看懂的说法。
    const payload = { ...val, item: { ...(val.item || {}) } };
    for (const k of Object.keys(payload.item)) {
      const v = payload.item[k];
      if (v === '' || v === undefined || (Array.isArray(v) && !v.length)) delete payload.item[k];
    }
    for (const k of ['collection', 'conflict', 'submitter']) {
      if (payload[k] === '' || payload[k] === undefined) delete payload[k];
    }
    return payload;
  }

  function runCheck() {
    const payload = collect();
    const errs = validate(payload, schema, schema);

    // 逐项标红，让红字落在对应的输入框下面而不是堆在结果区
    for (const p of ORDER) {
      dirty.add(p);
      checkOne(p);
    }

    if (errs.length) {
      out.innerHTML = `<div class="msg-warn">⚠ 还有 ${errs.length} 处要改：</div>
        <ul class="builder-errs">${errs.map((e) => `<li>${esc(e.path || '(整体)')} — ${esc(e.message)}</li>`).join('')}</ul>`;
      return;
    }

    const meta = {
      collectionTitle: collections.find((c) => c.slug === payload.collection)?.title || payload.collection,
      conflictLabel: conflictLabel(payload.conflict),
    };
    const issue = buildIssueUrl(payload, meta);
    const body = buildBody(payload, meta);
    const json = JSON.stringify({ collection: payload.collection, item: toItem(payload) }, null, 2);
    const dup = seen.get(normUrl(payload.item.url));

    out.innerHTML = `
      <div class="msg-ok">✓ 校验通过，内容已生成。</div>
      ${dup ? `<p class="su-dup">这条网址已经收过（${esc(dup.name)}），提交后会合并到原有条目，不会重复占位。</p>` : ''}
      <p class="su-tip">下一步选一个：有 GitHub 账号就走第一个，内容会直接预填进新 issue；没有就复制正文发邮件。</p>
      <div class="row">
        <a class="btn" href="${esc(issue)}" target="_blank" rel="noopener">去 GitHub 提交（已预填）</a>
        <button type="button" class="btn ghost" data-copy="${esc(body)}" data-ok="正文已复制">复制正文</button>
        <button type="button" class="btn ghost" data-copy="${esc(json)}" data-ok="JSON 已复制">复制 JSON</button>
      </div>
      <details class="su-preview"><summary>看一眼要提交的内容</summary><pre class="builder-pre">${esc(body)}</pre></details>`;

    out.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
          const txt = b.textContent;
          b.textContent = b.dataset.ok;
          setTimeout(() => (b.textContent = txt), 1600);
        } catch {
          out.querySelector('.su-preview')?.setAttribute('open', '');
          b.textContent = '复制失败，请从下方展开手动选';
        }
      };
    });
  }

  el.querySelector('#su-check').onclick = runCheck;
  el.querySelector('#su-reset').onclick = () => {
    form.reset();
    for (const k of Object.keys(val)) delete val[k];
    dirty.clear();
    form.querySelectorAll('[data-bad]').forEach((n) => (n.dataset.bad = ''));
    form.querySelectorAll('[data-err]').forEach((n) => {
      n.textContent = '';
      n.dataset.dup = '';
    });
    out.innerHTML = '';
  };

  box.appendChild(el);
}
