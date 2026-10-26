# TP2 · 移动端适配专项（375px）

## 背景

站里 34 个本地工具的表单都是**从 manifest 自动生成**的：`assets/tool-page.js` 把 `tool.json` 的 `inputs` 铺成一列 `.field`。这套结构在桌面没问题，但在 375px 上没有专门优化过——有些工具 6～8 个字段，一屏只放得下两个半，用户看不到「运行」按钮在哪。

这个包**只改 CSS**，不动任何 JS 和 HTML 结构。这是刻意限制：结构一改，61 个工具页、49 项 SPA 渲染测试全都要重新验证，风险远超收益。

## 输入

先读：

- `assets/style.css` 的 `@media (max-width: 900px)` 与 `@media (max-width: 560px)` 两段——**现有移动端断点都在这里**
- `assets/tool-page.js` 第 537 行附近：`#tool-fields` 的渲染结构（只读，不要改）
- `docs/TOOL-CONTRACT.md` §2：`inputs` 支持哪些字段类型（text / number / select / textarea / checkbox / file / …）

你要改的文件（独占）：

- `assets/style.css`
- `assets/style.batch.css`、`assets/style.offline.css`、`assets/style.submit.css`（这三份只在各自页面加载）

## 任务清单

### 1. 长表单在 375px 上要可读完

现状与目标：

- 现状：`.field { margin-bottom: 16px }`，字段标签在输入框上方，textarea `min-height: 160px`。
- 目标：窄屏下压缩无效留白（字段间距、panel 内边距），让「运行」按钮在大多数工具里进入前两屏。

**注意**：不要把字号压到 13px 以下，也不要把点击区压到 24px 以下（WCAG 2.5.8 硬线，体检脚本会报）。

### 2. 分段表单的视觉分组

字段多的工具（`tax-calc`、`mortgage-calc`、`unit-convert`、`img-to-pdf`、`pdf-merge`）在窄屏下应该能看出「这几个是一组」。用 CSS 实现：给连续字段之间加分组间距即可，**不要改 DOM**。

### 3. 结果区在窄屏不被挤压

`.result-actions .btn` 目前有 `white-space: nowrap` + `max-width: 100%`。窄屏下多个动作按钮会挤成一行两三个，文字被省略号截断。改成窄屏下按钮等宽换行。

### 4. 表格类结果横向滚动

部分工具输出表格（`.cmp-table`、单位换算全量表）。窄屏下必须**在容器内横向滚动**，不能让整页横向溢出——体检脚本会量页面宽度，溢出直接报高优问题。

### 5. 触摸目标尺寸

所有可点元素（`.chip`、`.share-btn`、`.star`、`.pg-btn`、`.route-card` 上的链接）窄屏下不小于 24×24 CSS px，舒适线 28×28。体检脚本按这两档分别报。

## 不许碰

- 任何 `.js` 文件
- `index.html` 及所有生成页的结构（只允许改 CSS）
- 桌面断点（> 900px）的既有规则——**不要为了窄屏好看去动桌面样式**，很可能把桌面搞坏

## 验收

```bash
node scripts/audit.mjs http://127.0.0.1:8788 --pages "/tools/" 
```

体检会按 375px 视口逐页检查横向溢出、文字对比度、点击区尺寸。**要求：0 高优、0 中优。**

再手动看一眼这三类页面（375px）：

1. 字段最多：`/tools/tax-calc/`
2. 有表格输出：`/tools/unit-convert/`
3. 有多文件下载：`/tools/pdf-merge/`

## 交付

- CSS diff
- 一张对照说明：每个改动的规则服务哪个问题（不要写「优化移动端体验」这种话，要写「`.field` 间距 16px → 10px，因为 tax-calc 有 8 个字段，间距吃掉 128px」）
- 体检输出末尾（含 0 高优 0 中优那行）
