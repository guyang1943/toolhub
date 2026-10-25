/**
 * 全局拖放路由（v3.1）
 *
 * 行为：
 *   把文件拖到窗口**任意位置** → 全屏提示「松手，帮你找工具」→ 松手后列出 2–3 个候选，
 *   点一个就带着文件跳过去（文件在内存里接力，不经过网络）。
 *
 * 三个刻意的取舍：
 *   1. 只拦「拖文件」。拖一段文字或一个链接进页面是浏览器默认行为（选中、打开），不该被我们改写。
 *   2. 拖到 <input type="file"> 上不拦。浏览器原生填充支持多选与 accept 校验，比我们做得更好。
 *   3. 候选只来自注册表里构建期派生的 `accepts`（由各工具 manifest 算出），
 *      不做「名字里有 PDF 就推荐」的猜测——猜错的代价是用户点进去发现拖不进去。
 */

import { routeFiles, fileKind } from './lib/drop-route.js';

const KIND_LABEL = {
  image: '图片',
  pdf: 'PDF',
  json: 'JSON',
  csv: '表格',
  text: '文本',
  media: '音视频',
  archive: '压缩包',
  other: '文件',
};

let overlay = null;
let panel = null;
let dragDepth = 0;
let busy = false;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'drop-mask';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="drop-zone">
      <div class="dz-icon">📥</div>
      <div class="dz-title">松手，帮你找工具</div>
      <div class="dz-sub">文件不会离开你的电脑，只是交给本地工具处理</div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.className = 'drop-panel-mask';
  panel.innerHTML = `<div class="drop-panel" role="dialog" aria-modal="true" aria-labelledby="dp-title">
      <div class="dp-head" id="dp-title"></div>
      <div class="dp-list"></div>
      <div class="dp-foot"></div>
    </div>`;
  document.body.appendChild(panel);
  panel.addEventListener('click', (e) => {
    if (e.target === panel) closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (!panel || panel.style.display === 'none') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    } else if (e.key === 'Enter') {
      const first = panel.querySelector('.dp-item');
      if (first) {
        e.preventDefault();
        first.click();
      }
    }
  });
  return panel;
}

function closePanel() {
  if (!panel) return;
  panel.style.display = 'none';
  panel.removeAttribute('data-open');
  document.body.classList.remove('dp-lock');
}

function openPanel(routes, files, onPick) {
  const box = ensurePanel();
  const kinds = [...new Set(files.map(fileKind))];
  const kindText = kinds.length === 1 ? KIND_LABEL[kinds[0]] || '文件' : '混合文件';
  const partial = routes.length && routes[0].partial;
  box.querySelector('.dp-head').innerHTML =
    `<b>${files.length} 个${kindText}</b><span>${partial ? '类型不一致，只用第 1 个试试' : '选一个工具，文件会直接带过去'}</span>`;

  const list = box.querySelector('.dp-list');
  list.innerHTML = routes.length
    ? routes
        .map(
          (r) =>
            `<button type="button" class="dp-item" data-id="${r.id}" data-take="${r.multiple ? 'all' : 'one'}">
               <b>${r.name}</b><span>${r.why}${r.multiple && files.length > 1 ? ' · 支持多选' : ''}</span>
             </button>`
        )
        .join('')
    : `<div class="dp-empty">站内还没有能处理这种文件的本地工具。
         ${kinds.includes('archive') ? '压缩包可以先解压，再拖里面的文件进来。' : '换个入口试试：'}<a href="/batch/">批量处理图片</a></div>`;

  box.querySelector('.dp-foot').innerHTML = routes.length
    ? `<span>Enter 用第一个 · Esc 关闭</span><a href="/batch/">一次处理多张？批量模式 →</a>`
    : `<span>Esc 关闭</span><a href="/tools/">浏览全部工具 →</a>`;

  list.querySelectorAll('.dp-item').forEach((btn) => {
    btn.onclick = () => {
      const takeAll = btn.dataset.take === 'all';
      closePanel();
      onPick(btn.dataset.id, takeAll ? files : files.slice(0, 1));
    };
  });

  box.style.display = '';
  box.setAttribute('data-open', '1');
  document.body.classList.add('dp-lock');
  const first = list.querySelector('.dp-item');
  if (first) setTimeout(() => first.focus(), 30);
}

/**
 * 挂载全局拖放。
 * @param {{getTools: () => Promise<Array<object>>|Array<object>, onPick: (id:string, files:File[]) => void}} opts
 */
export function initDropRoute(opts) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const getTools = opts.getTools || (() => []);
  const onPick = opts.onPick || (() => {});

  const hasFiles = (e) => {
    const dt = e.dataTransfer;
    if (!dt) return false;
    const types = dt.types ? Array.from(dt.types) : [];
    return types.includes('Files');
  };

  // 拖到文件输入框上：交给浏览器原生处理（它支持多选与 accept 校验）
  const overFileInput = (e) => {
    const t = e.target;
    return !!(t && t.closest && t.closest('input[type="file"]'));
  };

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    if (overFileInput(e)) return;
    e.preventDefault();
    dragDepth++;
    if (busy) return;
    const m = ensureOverlay();
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
  });

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    if (overFileInput(e)) return;
    // 不 preventDefault 的话浏览器会「打开文件」而不是给我们 drop
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // 模块可能是在这次拖拽开始之后才加载完的（首次访问时按需 import）：
    // 那时错过了 dragenter，就在 dragover 里补显一次，否则用户会觉得「拖了半天没反应」。
    if (!busy && overlay && !overlay.classList.contains('show')) {
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
    }
  });

  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    // 离开窗口才收起：在页面内部划过子元素也会触发 dragleave，靠深度计数抵消
    if (dragDepth === 0 && overlay) {
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
    }
  });

  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    if (overFileInput(e)) return; // 原生填充
    e.preventDefault();
    dragDepth = 0;
    if (overlay) {
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
    }
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length || busy) return;
    busy = true;
    try {
      const tools = await getTools();
      openPanel(routeFiles(files, tools || []), files, onPick);
    } finally {
      busy = false;
    }
  });
}
