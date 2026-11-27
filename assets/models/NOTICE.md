# 站内模型与来源（v3.41）

这两个权重是**仓库里的文件**，不是运行时从第三方拉的。页面第一次用到时才下载，之后由 Service Worker 收进缓存，断网也能跑。

| 文件 | 用途 | 大小 | 来源 | 许可 |
|---|---|---|---|---|
| `u2netp.onnx` | 去背景（分割） | 4,574,861 B | [rembg releases v0.0.0](https://github.com/danielgatis/rembg/releases/tag/v0.0.0)（U²-Net 轻量版，作者 Xuebin Qin） | Apache-2.0 |
| `yunet.onnx` | 人脸检测 | 232,589 B | [opencv_zoo / face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) 2023mar | MIT（Shiqi Yu） |

校验和（sha256），重新下载时请对得上：

```
309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8  u2netp.onnx
8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  yunet.onnx
```

## 为什么不用 176 MB 的完整版 u2net

完整版效果好一点，但单文件 176 MB 已经超过「一次下载能接受」的范围，且 GitHub 仓库单文件上限 100 MB。
`u2netp` 是同一套结构的轻量版，1.1M 参数，320×320 输入，实测本机单张约 3 秒——够用，且能进仓库。

## 为什么不量化成 int8

`yunet` 有官方 int8 版（100 KB，比 fp32 省一半），但打码这件事**漏检的代价是脸露着**，
不值得为 127 KB 冒召回率下降的风险。`u2netp` 若量化到 int8 约 1.1 MB，能省 3.4 MB，
但需要额外引一条量化链路且质量要逐图核对，留到以后按需要做。
