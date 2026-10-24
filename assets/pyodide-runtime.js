// Pyodide 共享运行时：所有 Python 工具复用同一个 WASM 实例，避免重复下载
// 首次调用会从 CDN 拉取 Pyodide（约 10MB），同一会话内后续调用瞬时返回
let pyodidePromise = null;

function loadScript(src) {
  return new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => err(new Error('Pyodide 运行时加载失败，请检查网络后重试'));
    document.head.appendChild(s);
  });
}

export async function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      if (!window.loadPyodide) await loadScript('/assets/vendor/pyodide-loader.js');
      return window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
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
  try {
    await py.loadPackage(name);
  } catch {
    await py.pyimport('micropip').then((mp) => mp.install(name));
  }
  return py;
}
