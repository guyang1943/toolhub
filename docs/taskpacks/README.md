# 可外包任务包

这几个月这个项目最耗时间的不是写代码，是「内容量」和「边界情况」。这两类活可以拆出去交给别的工具或人做，但有一个前提：**任务包必须自包含**——拿到包的人不需要看我们之前的对话、不需要理解整个架构，也能做出能合并的交付物。

## 怎么用

1. 挑一个包，整份发给执行方（AI 工具或人）。
2. 执行方只在自己的分支 / 自己的工作区里改，**不要碰包里没列的文件**。
3. 交付物按包里的「交付形式」交回来。
4. 我这边按「验收命令」跑一遍，绿了就合并。

> **递什么、怎么递、要求对方怎么交回来**，看 [`HANDOFF.md`](./HANDOFF.md)。
> 内容型任务（TP1 / TP5）只发说明书就够；代码型任务（TP2 / TP3 / TP4）必须连项目快照一起给，
> 命令是一行 `git archive --format=zip -o ../toolhub-TP2.zip HEAD`。

## 五个包互不重叠

并行发出去也不会打架，因为文件所有权是分开的：

| 包 | 干什么 | 独占的文件 | 不许碰 |
|---|---|---|---|
| TP1 | 内容与文案补全 | `content/`、`articles.json`、`i18n.json`、`i18n-detail.json` | `assets/`、`scripts/`、`tools/<id>/` |
| TP2 | 移动端适配（375px 长表单） | `assets/style.css`、`assets/style.tool.css`、`assets/style.*.css` | 任何 `.js`、任何 `.html` 结构 |
| TP3 | 无障碍与键盘覆盖 | `assets/app.js`、`assets/tool-page.js`、`index.html` 的 aria 属性 | 任何 `.css` |
| TP4 | 新增本地工具 ×3 | `tools/<新id>/`、`tools/registry.json` | `assets/`、`content/`、现有工具 |
| TP5 | 目录工具扩充与坏链替换 | `tools/directory.json`、`content/directory-copy.json` | `assets/`、`scripts/`、本地工具 |

> TP1 和 TP4 都会碰 `articles.json` / `i18n*.json`。**别同时发这两个包**，或者先看下节。

### 需要同时发 TP1 和 TP4 时

先发 TP4（新增工具），等它合并后再发 TP1（统一补文案）。顺序反过来的话，TP1 补完的文案会因为新工具缺条目而再次全红。

## 所有包通用的三条纪律

1. **不要为了让测试变绿而改测试。** 测试红说明有真问题；真要改断言，必须在交付说明里单独写一条「为什么这条断言本身是错的」。
2. **不要手改产物。** `index.html`、`changelog/index.html`、`*/index.html` 里的静态内容多半是 `node scripts/build-pages.mjs` 生成的，改数据源后重新构建即可。唯一例外是模板本体（`index.html` 自身的骨架）。
3. **不要加第三方依赖。** 这个站是零运行时依赖的静态站，加一个包会影响首屏预算和离线包体积。

## 统一验收

不管哪个包，合并前都要跑：

```bash
node scripts/sync-tools.mjs --check        # 注册表与工具目录同步
node scripts/lint-tools.mjs                # 各工具 manifest 合规
node scripts/build-pages.mjs               # 构建（含首页静态化与 sw.js）
node scripts/verify.mjs                    # 结构与内容校验（项数随版本增长，只认「全部通过」）
node scripts/spa-render-test.mjs           # 渲染逻辑
node scripts/new-tools-test.mjs            # 工具功能
node scripts/perf-budget.mjs               # 首屏体积预算
node scripts/serve.mjs 8788                # 另开一个终端
node scripts/smoke-test.mjs http://127.0.0.1:8788
node scripts/browser-test.mjs http://127.0.0.1:8788
node scripts/audit.mjs http://127.0.0.1:8788
```

全绿才算完成。任何一项红着交回来，都会被退回。

### 环境提示

- Node 22。项目**故意**没有 `"type": "module"`（第三方 UMD 库会崩），所以 `.mjs` 才是 ESM。
- `new-tools-test.mjs` 里有几段用 Python 生成二维码做真实解码校验，需要 `pip install "qrcode[pil]"`。没装会报 `ModuleNotFoundError`，那不是代码问题。
- 浏览器相关测试默认找本机 Chromium，可用环境变量 `BROWSER_PATH` 指定。

## 交付形式

优先给**可以直接 `git apply` 的 diff**，一个包一个 patch。给不了 patch 就给完整文件 + 明确的落位路径（哪个目录、什么文件名）。不要给「粘贴到某处」这种模糊指令。

交付说明里必须包含：

1. 改了哪些文件，每个文件一句话说清改了什么
2. 新增了什么内容/工具，它们的 id 和标题
3. 验收命令的实际输出（贴末尾几行就行，别只写「通过了」）
4. 你自己遇到但没解决的问题，单独列一节
