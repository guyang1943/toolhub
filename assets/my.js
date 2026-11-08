/**
 * 「我的数据」面板（v3.22，/my/ 页面，按需加载）
 *
 * 这一页要回答的问题不是「我收藏了什么」——那些在首页已经看得到。
 * 它要回答的是三件平时没人说清楚的事：
 *   ① 这些东西到底存在哪？（localStorage 里哪个键，占多少字节）
 *   ② 存了些啥？（是不是真的只有 id，没有我填的内容）
 *   ③ 怎么删？能不能只删其中一类，而不是「清除全部站点数据」一刀切？
 *
 * 第 ③ 点是这一页存在的理由。只会喊「清除全部数据」的话，用户面临的选择是
 * 「全留」或者「全丢」——而人一旦怕丢，就会选全留。所以必须能按类删：
 * 偏好、我的工具、本机统计、输入草稿，各删各的。
 *
 * 另一个原则：**显示实测值，不显示承诺值**。
 * 「最多 200 条」是上限，页面同时给出「现在 37 条 / 4.2 KB」。
 * 两者不一致时（比如上限写着 4 KB、实际显示 6 KB），说明代码有 bug——那正是该被看见的事。
 */
import * as store from './lib/store.js';
import { byGroup, clearableGroups, fullKey } from './lib/store-keys.js';
import { summary } from './lib/events.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n) => (!n ? '—' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

const SETS_MAX = 20;
const SET_TOOLS_MAX = 30;

let NAMES = new Map(); // 工具 id → 名字，去掉「查不到就显示 id」的突兀
let ALL_TOOLS = []; // [{id, name}]，给集合的输入提示用
let box = null;

/* ---------- 数据读取 ---------- */

function loadSets() {
  const v = store.get('sets', {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function saveSets(sets) {
  store.set('sets', sets);
}

function toolName(id) {
  return NAMES.get(id) || id;
}

/** 收藏 / 最近 / 对比里的 id 逐个还原成条目；查不到的（工具已下架）明确标出来，不静默丢弃 */
function resolve(ids) {
  return ids.map((id) => ({ id, name: toolName(id), known: NAMES.has(id) }));
}

/* ---------- 渲染：概览 ---------- */

function cards() {
  const favs = store.get('favs', []);
  const recent = store.get('recent', []);
  const usage = store.get('usage', {});
  const runs = Object.values(usage).reduce((a, b) => a + (Number(b) || 0), 0);
  const evs = store.get('events', []);
  const one = (n, label, href) =>
    `<a class="my-card" href="${href}"><b>${n}</b><span>${label}</span></a>`;
  return (
    '<div class="my-cards">' +
    one(favs.length, '收藏的工具', '#my-favs') +
    one(recent.length, '最近打开过', '#my-recent') +
    one(runs, '本机运行次数', '#my-usage') +
    one(evs.length, '运行记录条数', '#my-runs') +
    '</div>'
  );
}

/* ---------- 渲染：各类列表 ---------- */

function empty(text) {
  return `<p class="my-empty">${text}</p>`;
}

function toolList(rows, { delAttr }) {
  if (!rows.length) return empty('这里还是空的。');
  return (
    '<ul class="my-list">' +
    rows
      .map(
        (r) =>
          `<li>` +
          (r.known
            ? `<a href="/tools/${esc(r.id)}/">${esc(r.name)}</a>`
            : `<span class="my-gone">${esc(r.id)} <em>（已不在收录列表）</em></span>`) +
          `<button class="my-x" ${delAttr}="${esc(r.id)}" title="从这一项里移除">×</button>` +
          `</li>`
      )
      .join('') +
    '</ul>'
  );
}

function favsBlock() {
  return section(
    'my-favs',
    '收藏',
    toolList(resolve(store.get('favs', [])), { delAttr: 'data-unfav' }),
    '在工具卡片上点 ★ 就会收藏到这里。移除只影响这一条，不影响别处。'
  );
}

function recentBlock() {
  const ids = store.get('recent', []);
  return section(
    'my-recent',
    '最近打开过',
    toolList(resolve(ids), { delAttr: 'data-unrecent' }),
    '只留最近 8 个，用来在首页给你一条「接着做」的快捷入口。'
  );
}

function usageBlock() {
  const usage = store.get('usage', {});
  const rows = Object.entries(usage)
    .map(([id, n]) => ({ id, n: Number(n) || 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);
  if (!rows.length) return section('my-usage', '运行次数', empty('还没运行过工具。'), '');
  const max = rows[0].n;
  const body =
    '<ul class="my-bars">' +
    rows
      .map(
        (r) =>
          `<li><span class="my-bar-name">${esc(toolName(r.id))}</span>` +
          `<span class="my-bar"><i style="width:${Math.max(4, Math.round((r.n / max) * 100))}%"></i></span>` +
          `<b>${r.n}</b></li>`
      )
      .join('') +
    '</ul>';
  return section('my-usage', '运行次数', body, '只统计「成功跑完一次」，用于首页的「最常用」排序。数字只在这台设备上。');
}

function runsBlock() {
  const rows = summary();
  if (!rows.length) {
    return section(
      'my-runs',
      '运行记录',
      empty('还没有记录。跑一次本地工具就会出现在这里。'),
      '记录只含工具 id、结果与时间，<b>不含任何输入内容</b>，也不含报错原文——报错文本里可能带着你粘贴的东西。'
    );
  }
  const body =
    '<ul class="my-runs">' +
    rows
      .slice(0, 12)
      .map(
        (r) =>
          `<li><span>${esc(toolName(r.tool))}</span>` +
          `<span class="my-rate">${
            r.rate === null ? `<em title="样本少于 3 次不报比例——一次失败就报 0% 是在骗人">样本 ${r.runs} 次</em>` : `成功 ${r.rate}%（${r.runs} 次）`
          }</span></li>`
      )
      .join('') +
    '</ul>';
  return section('my-runs', '运行记录', body, '样本少于 3 次不显示成功率——那不是一个比例，是一次偶然。');
}

/* ---------- 渲染：存储明细 ---------- */

function storeRows() {
  const live = store.allKeys();
  const out = [];
  for (const g of byGroup()) {
    for (const k of g.keys) {
      if (k.kind === 'prefix') {
        const hits = live.filter((x) => x.startsWith(k.id));
        const bytes = hits.reduce((a, x) => a + store.size(x), 0);
        out.push({ ...k, group: g.label, bytes, count: hits.length, target: `prefix:${k.id}` });
      } else {
        const bytes = store.size(k.id);
        const v = store.get(k.id, null);
        const count = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : null;
        out.push({ ...k, group: g.label, bytes, count, target: k.id });
      }
    }
  }
  return out;
}

function storeTable() {
  const rows = storeRows();
  const total = rows.reduce((a, r) => a + r.bytes, 0);
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td><code>${esc(fullKey(r))}</code></td>` +
        `<td class="my-what">${r.what}${r.tail ? `<br><em>${r.tail}</em>` : ''}</td>` +
        `<td class="my-num">${r.count === null ? '—' : `${r.count} ${r.kind === 'prefix' ? '条' : '项'}`}</td>` +
        `<td class="my-num">${fmt(r.bytes)}</td>` +
        `<td class="my-num">${
          r.bytes ? `<button class="my-x" data-wipe="${esc(r.target)}" title="清空这一项">清除</button>` : '<span class="my-dim">空</span>'
        }</td>` +
        `</tr>`
    )
    .join('');
  return (
    '<div class="my-table-wrap"><table class="my-table">' +
    '<tr><th>键名</th><th>存了什么</th><th>条数</th><th>占用</th><th></th></tr>' +
    body +
    `<tr class="my-total"><td colspan="3">合计</td><td class="my-num">${fmt(total)}</td><td></td></tr>` +
    '</table></div>'
  );
}

/* ---------- 渲染：自定义集合 ---------- */

function setsBlock() {
  const sets = loadSets();
  const ids = Object.keys(sets).sort((a, b) => (sets[b].at || 0) - (sets[a].at || 0));
  const list = ids.length
    ? ids
        .map((sid) => {
          const s = sets[sid];
          const members = (s.tools || []).map((id) => ({
            id,
            name: toolName(id),
            known: NAMES.has(id),
          }));
          return (
            `<div class="my-set" data-set="${esc(sid)}">` +
            `<div class="my-set-head"><b>${esc(s.name)}</b><span class="my-dim">${members.length} 个工具</span>` +
            `<button class="my-x" data-set-del="${esc(sid)}" title="删掉这个集合">删除集合</button></div>` +
            toolList(members, { delAttr: 'data-set-rm' }) +
            `<div class="my-set-add"><input type="text" list="my-tool-names" placeholder="输入工具名加入集合，回车确认" data-set-input="${esc(sid)}"></div>` +
            `</div>`
          );
        })
        .join('')
    : empty('还没有集合。建一个试试——把「发一篇文章要用的那几个工具」放一组，下次就不用翻目录了。');

  const datalist =
    `<datalist id="my-tool-names">${ALL_TOOLS.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>`;
  return (
    section(
      'my-sets',
      '我的工具集合',
      list +
        `<div class="my-set-new"><input type="text" id="my-set-name" placeholder="给新集合起个名字（如：图片发布包）" maxlength="20">` +
        `<button class="btn ghost" id="my-set-create">新建集合</button></div>` +
        datalist,
      `集合只是把工具 id 归了个组，不做流程编排、不存任何工具输出。最多 ${SETS_MAX} 个集合，每个最多 ${SET_TOOLS_MAX} 个工具。`
    )
  );
}

/* ---------- 渲染：清除 ---------- */

function clearBlock() {
  // 按钮由清单生成，不手写那四组——手写就意味着「新增一个键，清除按钮里少它一个」，
  // 而那种漏法不会报错，只会让「按类清除」变成「按类清掉大部分」。
  const btns = clearableGroups()
    .map(
      (g) =>
        `<button class="btn ghost my-wipe" data-group="${g.group}">清除${g.label}` +
        `<em>${g.keys.map((k) => k.id.replace(':', '')).join(' / ')}</em></button>`
    )
    .join('');
  return section(
    'my-clear',
    '按类清除',
    `<div class="my-wipes">${btns}</div>`,
    '不比「清除全部站点数据」更弱：清完就真的没有了，我们也没有备份能还给你——因为本来就不存在别处。'
  );
}

/* ---------- 布局 ---------- */

function section(id, title, body, note) {
  return (
    `<section class="my-sec" id="${id}"><h2>${title}</h2>` +
    body +
    (note ? `<p class="my-note">${note}</p>` : '') +
    `</section>`
  );
}

function render() {
  box.innerHTML =
    cards() +
    favsBlock() +
    recentBlock() +
    usageBlock() +
    runsBlock() +
    setsBlock() +
    section('my-store', '存了什么，存在哪', storeTable(), '这一行的数字是当场量的，不是配置里写的上限。两者对不上，就是代码有 bug。') +
    clearBlock();
}

/* ---------- 交互 ---------- */

function tidy() {
  // 清完立刻重画：用户看到数字归零，才相信真的删了
  render();
}

function handleClick(e) {
  const t = e.target.closest('button');
  if (!t || !box.contains(t)) return;

  if (t.dataset.unfav !== undefined) {
    store.set('favs', store.get('favs', []).filter((x) => x !== t.dataset.unfav));
    return tidy();
  }
  if (t.dataset.unrecent !== undefined) {
    store.set('recent', store.get('recent', []).filter((x) => x !== t.dataset.unrecent));
    return tidy();
  }
  if (t.dataset.wipe !== undefined) {
    const target = t.dataset.wipe;
    if (target.startsWith('prefix:')) {
      const p = target.slice(7);
      for (const k of store.allKeys()) if (k.startsWith(p)) store.del(k);
    } else {
      store.del(target);
    }
    return tidy();
  }
  if (t.dataset.group !== undefined) {
    wipeGroup(t.dataset.group);
    return;
  }
  if (t.dataset.setDel !== undefined) {
    const sets = loadSets();
    delete sets[t.dataset.setDel];
    saveSets(sets);
    return tidy();
  }
  if (t.dataset.setRm !== undefined) {
    const sid = t.closest('.my-set').dataset.set;
    const sets = loadSets();
    if (sets[sid]) sets[sid].tools = (sets[sid].tools || []).filter((x) => x !== t.dataset.setRm);
    saveSets(sets);
    return tidy();
  }
  if (t.id === 'my-set-create') {
    const input = document.getElementById('my-set-name');
    const name = (input.value || '').trim();
    if (!name) return input.focus();
    const sets = loadSets();
    if (Object.keys(sets).length >= SETS_MAX) {
      alert(`最多 ${SETS_MAX} 个集合。先删掉一个不用的。`);
      return;
    }
    const id = Date.now().toString(36);
    sets[id] = { name: name.slice(0, 20), tools: [], at: Date.now() };
    saveSets(sets);
    return tidy();
  }
}

/** 按组清除。prefs 清完要提示刷新：主题已经画在页面上了，不刷新看不出变化。 */
function wipeGroup(group) {
  const keys = byGroup()
    .filter((g) => g.group === group)
    .flatMap((g) => g.keys);
  let n = 0;
  for (const k of keys) {
    if (k.kind === 'prefix') {
      for (const live of store.allKeys()) {
        if (live.startsWith(k.id)) {
          store.del(live);
          n++;
        }
      }
    } else if (store.has(k.id)) {
      store.del(k.id);
      n++;
    }
  }
  tidy();
  if (!n) return;
  if (group === 'prefs') {
    // 主题与语言已经作用在当前的 DOM 上，不重载看不到变化。
    // 与其让用户以为「没清掉」，不如直接重载——反正这一页没有正在填的内容。
    location.reload();
  }
}

function handleKey(e) {
  if (e.key !== 'Enter') return;
  const input = e.target.closest('input[data-set-input]');
  if (!input) return;
  e.preventDefault();
  const sid = input.dataset.setInput;
  const q = (input.value || '').trim().toLowerCase();
  if (!q) return;
  const hit =
    ALL_TOOLS.find((x) => x.name === input.value.trim()) ||
    ALL_TOOLS.find((x) => x.name.toLowerCase().includes(q) || x.id === q);
  if (!hit) {
    input.value = '';
    input.placeholder = '没找到这个工具，试试输入全名';
    return;
  }
  const sets = loadSets();
  const s = sets[sid];
  if (!s) return;
  s.tools = s.tools || [];
  if (s.tools.includes(hit.id)) {
    input.value = '';
    input.placeholder = '已经在集合里了';
    return;
  }
  if (s.tools.length >= SET_TOOLS_MAX) {
    alert(`一个集合最多 ${SET_TOOLS_MAX} 个工具。`);
    return;
  }
  s.tools.push(hit.id);
  s.at = Date.now();
  saveSets(sets);
  render();
}

/* ---------- 挂载 ---------- */

export async function mountMy(el, reg) {
  box = el;
  const tools = (reg && reg.tools) || [];
  for (const t of tools) NAMES.set(t.id, t.name);
  ALL_TOOLS = tools.map((t) => ({ id: t.id, name: t.name }));

  // 目录工具（62 条外链）也可能被收藏，名字在另一份数据里。
  // 只在「有 id 查不到名字」时才去取——本地工具已覆盖大部分情况，不必为一个名字多等一次请求。
  // （第一版这里写的是 NAMES.size < tools.length，而那个条件恒不成立，等于永远不取。）
  const wanted = [
    ...store.get('favs', []),
    ...store.get('recent', []),
    ...Object.values(loadSets()).flatMap((s) => s.tools || []),
  ];
  if (wanted.some((id) => !NAMES.has(id))) {
    try {
      // v3.32：同 app.js，取启动副本（只少 evidence / linkStatus，名字一个不少）。
      const dir = await (await fetch('/tools/directory-boot.json')).json();
      for (const d of dir.tools || []) if (!NAMES.has(d.id)) NAMES.set(d.id, d.name);
    } catch {
      /* 取不到就用 id 显示，不影响任何操作 */
    }
  }

  box.addEventListener('click', handleClick);
  box.addEventListener('keydown', handleKey);
  render();
}
