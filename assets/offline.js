/**
 * 离线包页面控制器（v3.0 E1）
 *
 * 三件事：
 *   1. 告诉用户现在的离线状态（SW 装了没、缓存了多少）
 *   2. 「下载离线包」——让 SW 把全部本地工具页与执行文件抓进 Cache Storage，带进度
 *   3. 「安装到桌面」——消费 beforeinstallprompt（由 app.js 全局捕获后挂到 window.__INSTALL_PROMPT__）
 */

const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

/** 离线包规模：静态页首访由构建期注入；SPA 内部跳转时没有，就从 sw.js 现读（唯一真源） */
async function resolveMeta() {
  const m = window.__OFFLINE_META__;
  if (m && m.files) return m;
  try {
    const txt = await fetch('/sw.js', { cache: 'no-cache' }).then((r) => r.text());
    const hit = txt.match(/const FULL = (\[[\s\S]*?\n\]);/);
    return { version: (txt.match(/const VERSION = "([^"]+)"/) || [])[1] || null, files: hit ? JSON.parse(hit[1]).length : 0, bytes: 0 };
  } catch {
    return { version: null, files: 0, bytes: 0 };
  }
}

async function currentVersion() {
  const keys = await caches.keys();
  return keys.find((k) => k.startsWith('toolhub-')) || null;
}

async function cacheStats() {
  const v = await currentVersion();
  if (!v) return { version: null, count: 0, bytes: 0 };
  const cache = await caches.open(v);
  const keys = await cache.keys();
  let bytes = 0;
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const len = res.headers.get('content-length');
    if (len) bytes += Number(len);
    else bytes += (await res.clone().blob()).size;
  }
  return { version: v, count: keys.length, bytes };
}

export async function mountOffline(root) {
  if (!root) return;
  const meta = await resolveMeta();
  const sizeText = meta.bytes ? `${meta.files} 个地址 · 约 ${(meta.bytes / 1048576).toFixed(1)} MB` : `${meta.files} 个地址`;
  const supported = 'serviceWorker' in navigator;
  const reg = supported ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
  let stats = supported ? await cacheStats().catch(() => ({ count: 0, bytes: 0 })) : { count: 0, bytes: 0 };
  const prompt = window.__INSTALL_PROMPT__ || null;

  root.innerHTML = `
    <div class="off-grid">
      <div class="off-card">
        <b>${supported ? (reg ? '✅ 已在离线模式就绪' : '⏳ Service Worker 注册中') : '❌ 此浏览器不支持'}</b>
        <p>${reg ? '断网后仍可打开已缓存页面与本地工具。' : '首次访问后会自动注册，稍等片刻刷新本页。'}</p>
        <div class="off-stat" id="off-stat">${
          stats.count ? `已缓存 ${stats.count} 个文件 · 约 ${kb(stats.bytes)}` : '尚未下载完整离线包'
        }</div>
      </div>
      <div class="off-card">
        <b>📦 完整离线包</b>
        <p>${sizeText}。含全部本地工具页与执行脚本（Python 运行时按需下载，不计入）。</p>
        <div class="off-bar"><div class="off-fill" id="off-fill"></div></div>
        <div class="off-stat" id="off-progress"></div>
        <div class="row">
          <button class="btn" id="off-download">下载离线包</button>
          <button class="btn ghost" id="off-clear">清除缓存</button>
        </div>
      </div>
      <div class="off-card">
        <b>🖥️ 安装成应用</b>
        <p>${prompt ? '可以安装到桌面 / 主屏幕，像本地应用一样打开。' : '用 Chrome / Edge 打开时会出现安装入口；iOS 请用「分享 → 添加到主屏幕」。'}</p>
        <div class="row">
          <button class="btn ghost" id="off-install" ${prompt ? '' : 'disabled'}>${prompt ? '安装到桌面' : '当前浏览器未提供安装'}</button>
        </div>
      </div>
    </div>
    <div class="off-note">
      <b>离线包包含什么？</b> 首页、全部分类与本地工具页、工具的 <code>run.js</code>、i18n 与工具注册表、界面样式与脚本。
      <b>不包含</b>第三方官网（目录工具）——那些是别人的站点，本来就不可能离线；也不包含 Python 运行时（13MB 起），它会在第一次用 Python 工具时单独下载并缓存。
    </div>`;

  const $ = (id) => root.querySelector('#' + id);
  const stat = $('off-stat');
  const prog = $('off-progress');
  const fill = $('off-fill');

  if (!supported) return;

  // 进度消息来自 sw.js
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'PRECACHE_PROGRESS') {
      fill.style.width = Math.round((d.done / d.total) * 100) + '%';
      prog.textContent = `已缓存 ${d.done} / ${d.total} · ${kb(d.bytes)}`;
    } else if (d.type === 'PRECACHE_DONE') {
      fill.style.width = '100%';
      prog.textContent = d.failed.length
        ? `完成 ${d.done} / ${d.total}，${d.failed.length} 个失败（可能是网络抖动，可再点一次）`
        : `✅ 离线包已就绪：${d.total} 个文件 · ${kb(d.bytes)}`;
      currentVersion().then(cacheStats).then((s) => (stat.textContent = `已缓存 ${s.count} 个文件 · 约 ${kb(s.bytes)}`));
    }
  });

  $('off-download').onclick = async () => {
    const btn = $('off-download');
    btn.disabled = true;
    btn.textContent = '下载中…';
    prog.textContent = '准备中…';
    const ready = await navigator.serviceWorker.ready;
    // 首次注册时 controlling 可能还是空的，用 ready.active 兜底
    const target = navigator.serviceWorker.controller || ready.active;
    if (!target) {
      prog.textContent = 'Service Worker 还没接管本页，刷新一次再试';
      btn.disabled = false;
      btn.textContent = '下载离线包';
      return;
    }
    target.postMessage({ type: 'PRECACHE_ALL' });
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '再次检查/补全';
    }, 6000);
  };

  $('off-clear').onclick = async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    stat.textContent = '已清除全部离线缓存';
    prog.textContent = '';
    fill.style.width = '0';
  };

  const installBtn = $('off-install');
  if (installBtn && prompt) {
    installBtn.onclick = async () => {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      installBtn.textContent = outcome === 'accepted' ? '✅ 已开始安装' : '已取消';
    };
  }
}
