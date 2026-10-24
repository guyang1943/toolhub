// Pyodide 共享运行时：所有 Python 工具复用同一个 WASM 实例，避免重复下载
// 运行时全部自托管在 /assets/vendor/pyodide/（核心四件套约 13MB + pandas 系 wheel 约 36MB，
// wheels 平铺在 indexURL 下，与官方 full/ 目录布局一致），首次下载有进度条，
// 自托管失败时自动回退 jsdelivr CDN；同一会话内后续调用瞬时返回
const LOCAL_BASE = '/assets/vendor/pyodide/';
const CDN_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

// 核心四件套（loadPyodide 启动必需）
const CORE_FILES = ['pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const CORE_TOTAL = 13765357; // 上述四件套字节合计（本地与 CDN 同批文件，大小一致）

// pandas 依赖树 wheel（loadPackage('pandas') 会按 lock 文件拉取这些）
const PANDAS_WHEELS = [
  'numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl',
  'pandas-2.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl',
  'python_dateutil-2.9.0.post0-py2.py3-none-any.whl',
  'pytz-2024.1-py2.py3-none-any.whl',
  'six-1.16.0-py2.py3-none-any.whl',
];
const PANDAS_TOTAL = 37294577; // 上述 wheel 字节合计

let pyodidePromise = null;
let progressHandler = null;

// UI 侧注册进度回调：(loaded, total, phase) —— phase: 'download' | 'init'
export function setProgressHandler(fn) {
  progressHandler = fn;
}
const report = (loaded, total, phase) => {
  if (progressHandler) progressHandler(loaded, total, phase);
};

function loadScript(src) {
  return new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => err(new Error('Pyodide 运行时加载失败，请检查网络后重试'));
    document.head.appendChild(s);
  });
}

// 预热：流式下载文件并汇报进度；下载过的文件会进入浏览器缓存，
// 随后 loadPyodide / loadPackage 的同类请求直接命中缓存，不会二次走网络
async function warmFiles(base, files, total) {
  let loaded = 0;
  for (const f of files) {
    const resp = await fetch(base + f);
    if (!resp.ok) throw new Error(`下载 ${f} 失败（HTTP ${resp.status}）`);
    if (resp.body && resp.body.getReader) {
      const rd = resp.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        loaded += value.length;
        report(loaded, total, 'download');
      }
    } else {
      loaded += total / files.length; // 无流式支持时按均摊估算
      report(loaded, total, 'download');
    }
  }
}

async function boot(base) {
  if (!window.loadPyodide) await loadScript('/assets/vendor/pyodide-loader.js');
  report(0, 0, 'init');
  return window.loadPyodide({ indexURL: base });
}

export async function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      report(0, CORE_TOTAL, 'download');
      try {
        await warmFiles(LOCAL_BASE, CORE_FILES, CORE_TOTAL);
        return await boot(LOCAL_BASE);
      } catch (e) {
        console.warn('Pyodide 本地运行时不可用，回退 jsdelivr CDN：', e);
        report(0, CORE_TOTAL, 'download');
        await warmFiles(CDN_BASE, CORE_FILES, CORE_TOTAL);
        return await boot(CDN_BASE);
      }
    })();
  }
  return pyodidePromise;
}

// 捕获 stdout/stderr 后执行代码，返回 { out, err }
export async function runPython(code) {
  const py = await getPyodide();
  let out = '';
  py.setStdout({ batched: (s) => (out += s + '\n') });
  py.setStderr({ batched: (s) => (out += s + '\n') });
  let err = null;
  try {
    await py.runPythonAsync(code);
  } catch (e) {
    err = e;
  }
  return { out, err };
}

// 按需安装纯 Python 包（pandas 等；失败时抛出可读错误）
export async function ensurePackage(name) {
  const py = await getPyodide();
  if (name === 'pandas') {
    // 先把 pandas 依赖树 wheel 预热进缓存（带进度），loadPackage 再从缓存秒读
    try {
      await warmFiles(LOCAL_BASE, PANDAS_WHEELS, PANDAS_TOTAL);
    } catch (e) {
      console.warn('pandas wheel 本地预热失败，改由 loadPackage 自行拉取：', e);
    }
  }
  try {
    await py.loadPackage(name);
  } catch {
    await py.pyimport('micropip').then((mp) => mp.install(name));
  }
  return py;
}
