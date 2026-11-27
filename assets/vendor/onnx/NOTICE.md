# onnxruntime-web 1.17.3（裁剪版）

只放两件东西，没有 npm 包里的其余文件：

| 文件 | 大小 | 作用 |
|---|---|---|
| `ort.wasm.min.js` | 145,070 B | 胶水层（`ort` 全局对象） |
| `ort-wasm-simd.wasm` | 10,551,547 B | CPU 推理内核（SIMD，单线程） |

来源：npm `onnxruntime-web@1.17.3` 的 `dist/` 目录，取自 jsDelivr。许可：MIT（Microsoft）。

```
654435ead2d823e56d5893ec53be49f6ddb7e827096561aae63501071470cf23  ort.wasm.min.js
6783fcd6647ce1b426a527c31412a9c40894552faa609e9c931b3239a3438071  ort-wasm-simd.wasm
```

## 为什么是 1.17.3 而不是最新版

最新版（1.20）的 CPU 内核是 10.73 MB，且只提供多线程版；1.17.3 的 `ort-wasm-simd.wasm` 是
10.06 MB 的非多线程版，**更小且不需要 SharedArrayBuffer**。本站部署在 GitHub Pages 上，
无法设置 COOP/COEP 响应头，`SharedArrayBuffer` 不可用——多线程内核在这里不但没用，还会在初始化时报警告。

## 为什么不带 WebGPU 内核

`ort-wasm-simd-threaded.jsep.wasm`（WebGPU 用）是 20.66 MB，是 CPU 内核的两倍。
为一个 3 秒的抠图任务多下 10 MB，不划算；WebGPU 版本留作以后「真要加速」时的选项。

## 这两份不参与离线包

它们合计 10.2 MB，进 `sw.js` 的预缓存清单会让「下载离线包」从 6.3 MB 变成 16.5 MB。
现在的做法是：第一次用到时按需下载，Service Worker 的 fetch 处理器会顺手把它收进缓存，
**所以用过一次之后，断网也能跑**。
