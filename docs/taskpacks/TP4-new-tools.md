# TP4 · 新增 3 个本地工具

## 目标

按现有契约新增 3 个**纯本地、零依赖、明确有人需要**的小工具。这个包最适合外包：入库门槛写得很清楚，做完能自证。

**先看清楚**：站里已经有 34 个本地工具（`json-format`、`regex-tester`、`case-convert`、`text-dedupe`、`image-compress`、`image-resize`、`csv-json`、`pdf-merge`、`sha256-hash`…）。下面三个是**确认过还没有**的空位，不要换成已有的东西，也不要换题。

| id | 名称 | 分类 | 做什么 | 为什么是空位 |
|---|---|---|---|---|
| `img-crop` | 图片裁剪 | 图片 | 拖拽或输入坐标裁剪，支持等比锁定、圆角、导出 PNG/JPEG/WebP | 图片类已有压缩/缩放/转格式，唯独没有裁剪——这是最高频的图片操作 |
| `file-hash` | 文件哈希校验 | 开发 | 拖入文件算 MD5 / SHA-1 / SHA-256 / SHA-512，可与官方提供的校验值比对 | 现有的 `sha256-hash` 只算文本；下载大文件后核对校验值是真实刚需 |
| `csv-columns` | CSV 选列与重排 | 数据 | 选列、拖动排序、按列值过滤、导出新 CSV，支持自定义分隔符与引号 | `csv-json` 是格式互转，不解决「这张表 40 列我只想要 6 列」 |

## 输入

必读，读不完不要动手：

- `docs/TOOL-CONTRACT.md`——**全文**。`tool.json` 字段、`run()` 返回契约、三条硬规则、七种拒绝原因都在里面
- 对照抄结构：`image-resize`（图片类、需 canvas、产出文件）、`csv-json`（数据类、文本解析）、`sha256-hash`（哈希类、多字段）
- `tools/schema.json`——manifest 的机器可读约束

你要产出的文件（独占，可新建）：

- `tools/<id>/tool.json`
- `tools/<id>/run.js`
- `tools/registry.json` 里的登记（`order` 数组，脚手架会加）
- `articles.json` / `i18n.json` / `i18n-detail.json` 里**只加你这三个工具的条目**
- `scripts/new-tools-test.mjs` 里加三个测试区块

## 任务清单

### 1. 生成骨架

```bash
node scripts/new-tool.mjs img-crop    --name "图片裁剪"     --cat 图片
node scripts/new-tool.mjs file-hash   --name "文件哈希校验" --cat 开发
node scripts/new-tool.mjs csv-columns --name "CSV 选列与重排" --cat 数据
```

脚手架会生成最小可跑实现并登记进 registry，末尾会**故意**提示缺长尾内容——那是让你别忘了第 3 步。

### 2. 写实现（`run.js`）

三个工具共同的硬要求：

- **不许联网**。不许 `fetch`、不许引 CDN 库、不许 `eval` 外部字符串。
- **返回契约**：文本结果 `{ html, text }`；文件结果 `{ html, files: [{ name, blob, kind }] }`。不要自己画复制/下载按钮，平台统一渲染。
- **报错用人话**：`throw new Error('裁剪框超出了图片范围（图片 800×600，你填的是 1000×700）')`，不要 `throw new Error('invalid crop')`。
- **边界必须有反馈**：空输入、超大输入、非法参数都要明确提示，不能静默返回空。

各自的要点：

**`img-crop`**
- 裁剪框要 clamp 在图片范围内，越界时给提示而不是产出空白图
- 原图不透明时导出 JPEG 用质量 0.92；PNG 保留透明；WebP 同理
- 显示「原图 W×H → 裁剪后 W×H」和文件体积变化
- 圆角是可选参数，0 表示不裁圆角

**`file-hash`**
- 算法下拉：MD5 / SHA-1 / SHA-256 / SHA-512（`crypto.subtle` 只支持后三种，MD5 必须自己实现——写成纯函数，不要引库）
- **大文件不能一次读进内存**：用 `FileReader` 分片或 `Blob.stream()`，并显示进度
- 有「校验值」输入框时，比对结果要明确说「一致 / 不一致」，不一致时把两个值的差异位置标出来
- 空文件也要能算（有确定的哈希值）

**`csv-columns`**
- 必须正确处理引号内的逗号、换行、双写引号（`"a,b"`、`"line1\nline2"`、`""""`）
- 分隔符可自定义（逗号 / 制表符 / 分号 / 竖线）
- 过滤是「列值包含某字符串」，不是正则（避免又一个正则坑）
- 输出时保留原引号风格，别把 `"a,b"` 写成 `a,b`

### 3. 补三份长尾内容

`verify.mjs` 会卡，缺一个就红：

| 文件 | 加什么 |
|---|---|
| `articles.json` | `<id>` 的 `intro`（≥60 字）、`steps`（≥3）、`faq`（≥2）、`pitfalls`（≥2，含 `title`/`body`） |
| `i18n.json` | `en.tools["<id>"].name` / `.desc` |
| `i18n-detail.json` | `en["<id>"].usage` / `.tips` / `.scenarios` / `.labels` |

写作要求见 TP1。一句话：**写这个工具自己的东西，不要写能套在任何一个工具上的套话。**

### 4. 加功能测试

在 `scripts/new-tools-test.mjs` 里照着现有小节加三个区块，每个工具至少 6 条断言：

- 正常路径 2 条（典型输入 → 期望输出，**数字要精确**，比如哈希值要对上公开测试向量）
- 边界 2 条（空输入、越界/非法输入）
- 特性 2 条（这个工具区别于同类的那一点）

`file-hash` 必须包含：空文件哈希、MD5 与公开测试向量一致。
`csv-columns` 必须包含：引号内含逗号/换行不被打散。

## 不许碰

- `assets/**`（平台代码不归这个包管）
- `content/**`
- 现有 34 个工具的任何文件
- `scripts/**` 里除了 `new-tools-test.mjs` 之外的任何脚本（尤其不要改 `verify.mjs` 和 `build-pages.mjs`）

## 验收

```bash
node scripts/lint-tools.mjs img-crop
node scripts/lint-tools.mjs file-hash
node scripts/lint-tools.mjs csv-columns
node scripts/gen-search-aliases.mjs
node scripts/build-pages.mjs
node scripts/verify.mjs             # 必须 44/44
node scripts/new-tools-test.mjs     # 必须 ≥161 + 你新增的条数，全绿
node scripts/perf-budget.mjs        # 首屏不能因为新工具超预算（工具不入首屏，理论上不受影响，但要跑）
```

再手动过一遍：启动 `node scripts/serve.mjs 8788`，首页搜「裁剪」「哈希」「CSV 列」，三个都能搜到并打开；每个工具用真实输入跑一次，把产物下载出来打开确认能看。

## 交付

- `tools/<id>/` 三个目录的完整文件
- 三份内容 json 的 diff
- `new-tools-test.mjs` 的 diff
- 验收命令实际输出
- **每个工具一句话说明：什么人在什么场景下会打开它**（不能写「补全分类」）
