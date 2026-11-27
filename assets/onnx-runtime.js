/**
 * 站内 ONNX 推理（v3.41）
 *
 * 为什么单独一个文件：内核 10.06 MB、权重 4.36 MB + 0.23 MB，都按需取，不放首屏。
 * 首屏预算 98 KB，和这里差两个数量级——混进去就是把「秒开」换成「等三秒」。
 *
 * 为什么不进离线包的预缓存清单：进了就从 6.3 MB 变 16.5 MB，「下载离线包」按钮会变得没人敢按。
 * 但 Service Worker 的 fetch 处理器会把第一次取到的文件收进缓存，所以**用过一次之后断网也能跑**。
 *
 * 一处硬约束：本站部署在 GitHub Pages，响应头不由我们控制，设不了 COOP/COEP，
 * 于是 SharedArrayBuffer 不可用、wasm 多线程起不来。所以下面把 numThreads 钉成 1——
 * 不钉的话 ORT 会先试着开线程再回退，控制台留一堆红字，看起来像坏了。
 */
const BASE = '/assets/vendor/onnx/';

/** 两个权重都在仓库里（assets/models/NOTICE.md 记了来源、许可与 sha256） */
export const MODELS = {
  bg: '/assets/models/u2netp.onnx',
  face: '/assets/models/yunet.onnx',
};

let ortPromise = null;
/** 会话按模型路径缓存：同一页里连处理几张图，不该每次都重建会话（重建约 1 秒） */
const sessions = new Map();

export function loadOrt() {
  if (ortPromise) return ortPromise;
  ortPromise = new Promise((resolve, reject) => {
    const done = () => {
      const ort = globalThis.ort;
      if (!ort) return reject(new Error('推理引擎没有挂上来，可能是脚本被扩展拦了'));
      ort.env.wasm.wasmPaths = BASE;
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = 'error';
      resolve(ort);
    };
    if (globalThis.ort) return done();
    const s = document.createElement('script');
    s.src = BASE + 'ort.wasm.min.js';
    s.onload = done;
    s.onerror = () =>
      reject(new Error('推理引擎下载失败（约 10 MB）。请检查网络后重试；若是公司网络或扩展拦截了本站脚本，换个网络试试'));
    document.head.appendChild(s);
  });
  // 失败别把坏 promise 留住：用户重试时应该重新下载，而不是立刻再拿到同一个错误
  ortPromise.catch(() => {
    ortPromise = null;
  });
  return ortPromise;
}

export async function getModel(key) {
  const url = MODELS[key] || key;
  if (sessions.has(url)) return sessions.get(url);
  const p = loadOrt().then((ort) => ort.InferenceSession.create(url, { executionProviders: ['wasm'] }));
  sessions.set(url, p);
  // 同样的道理：会话建失败（比如权重 404）不该被永久缓存
  p.catch(() => sessions.delete(url));
  return p;
}

/**
 * 预热：工具页表单渲染完就调它，用户选图那几秒正好把 10 MB 拉完。
 * 不抛错——预热失败不影响正事，真正跑的时候 getModel 会再报一次，而且那时候用户看得到错误。
 */
export const warm = () => loadOrt().catch(() => {});
