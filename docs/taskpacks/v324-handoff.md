# v3.24 交接单

> 初版 2026-11-04 23:20；23:40 补「本地已同步」；本版按「启动数据已拆」重写。
> 聊天记录不能当真源（这段任务被压缩 40+ 次，摘要套摘要），**以本文件 + `memory/MEMORY.md` + 资料库为准**。

## 一、现在停在哪（已核对，不是猜的）

| 项 | 值 |
|---|---|
| 远端 `main` | `2d7ffd2`（交接单入仓）；本次「拆启动数据」在分支上，**未合** |
| 首屏体积 | **86.1 / 88.0 KB**（拆分前 89.9 / 90.0，余量从 145 字节变成 1.9 KB） |
| 启动数据 | 36.1 / 52.4 KB（六个 JSON，见 `perf-budget.json` 的 `bootData`） |
| 版本号 | `sw.js` 仍是 `toolhub-v3.23`（**没 bump**，发版时随 `changelog.json` 一起改） |
| 离线包 | 220 个地址 / 约 3.6 MB（比拆分前多 `resources-notes.json` 一份） |
| 工作流 | 六条，线上已生效（v3.23 + v3.24 前半段） |

## 二、这一版做了什么：资源正文搬出首屏

### 为什么

`resources.json` 是首屏六个启动 JSON 之一。它的 58 条资源每条都带一段「为什么值得收藏」
（`note`），而**首页只用得到合集标题、说明和条目数量**——正文只在 `/resources/<合集>/` 那一页出现。
按 gzip 算这段正文 3.82 KB，等于每个访客都在为「他可能永远不打开的合集页」付下载与解析。

### 怎么拆的

| 文件 | 内容 | 谁读 |
|---|---|---|
| `resources.json` | 条目骨架：`name` / `url` / `source` / `license` / `tags` / `recommended` + 合集元信息 | 首屏（首页合集卡、命令面板、投稿页查重） |
| `resources-notes.json` | `{ notes: { <合集 slug>: { <条目名>: <正文> } } }` | 只在合集页，按需取 |

- 定位用「合集 slug + 条目名」，**不用数组下标**——往合集中间插一条，下标会让后面全部错位。
- 合并逻辑只有一份：`scripts/lib/resources-data.mjs` 的 `loadResources(root, {strict})`。
  **不要在别处直接读 `resources.json` 再自己拼**，那样漏一条正文不会报错，只会安静渲染出空段落。
- 运行时加载在 `assets/content-pages.js` 的 `loadResNotes()`（内容页早就按需加载，不进首屏）。
- 取不到正文文件不白屏：条目名、授权、地址仍在，页面照常可用。

### 三道闸门（都手动试过会红）

1. `verify` 的「资源正文不在首屏」：把 `note` 写回 `resources.json` 直接失败。
   这种退化页面完全看不出来，只有断言看得见。
2. `loadResources(root, {strict:true})`：构建期缺正文直接抛错并列出 `合集/条目`
   （`build-pages` 与 `check-submit-schema` 都走 strict）。
   **`schemas/resource.json` 没改**——`note` 仍是必填的编辑标准，只是校验的是合并后的视图。
3. `browser-test` 第 9.15 节：首页**不许**请求 `resources-notes.json`，合集页**必须**请求，
   且每条正文都渲染出来、不是同一段复读。

### 以后加一条资源

两份文件都要动：

```
resources.json        → items 里加骨架对象（不放 note）
resources-notes.json  → notes["<合集slug>"]["<条目名>"] = "正文"
```

漏了第二份，构建会直接失败并指出是哪一条——比在页面上发现空段落早得多。

## 三、v3.24 还剩三件事

1. **参数面板 /「保存为我的流程」**：参数集存进 `store.js` 的 `flows`，下次一键重跑。
   `csv-pick-to-json` 的 `cols` / `filterCol` / `filterVal` 现在是空串占位，就是等这个功能在运行时填。
2. **失败续跑**：第 3 步失败时，前两步产物仍可下载，并给「从这一步重试」。
   这是本地处理的天然优势（数据一直在内存里），值得写进产品文案。
3. **工具页「接着做」升级**：从单跳变成「加入流程」。

**闸门要求**：失败续跑单独一条断言（故意传坏文件，断言前两步产物仍可取）；新交互都要真浏览器点。

三件事都落在 `/workflows/` 与 `/tools/*`，不占首屏——但**别再往首屏加东西**：
1.9 KB 余量是留给「确实必须在首屏」的改动，加之前先看 `perf-budget.json` 末尾那几条账。

## 四、遗留问题

### 1. `sw.js` 没 bump，老访客看到的还是旧缓存

缓存策略是缓存优先，`resources.json` / `workflows.json` 都在预缓存清单里。
新访客 / 无痕窗口正常。v3.24 整体发版时 bump 版本号一并刷新。

### 2. 老缓存的过渡期

老访客缓存里的 `resources.json` 是带 `note` 的旧版，而新前端从 `resources-notes.json` 取正文——
第一秒可能看到空正文，后台更新完刷新即可。**不值得为此写兼容代码**：`sw.js` bump 之后
预缓存整体换新，过渡只有一次。真要兜，就在 `loadResNotes` 失败时回退 `c.items[].note`，两行的事。

### 3. 远端留着两个无用分支

`origin/feat/v324-three-flows`（内容已在 main）、`origin/muse-v324-flows`（只有草稿 JSON）。
发版时一起清：`git push origin --delete feat/v324-three-flows muse-v324-flows`

### 4. 还能从启动数据里抠 723 字节（暂时不做）

`tools/directory.json` 的 `evidence`（62 个外链 × 2 个对象）运行时一个字节都不用，
但删它要动 `check-links` / `build-pages` / `verify` / `tool-meta` / `evidence` 五个脚本。
为 723 字节动五个脚本不值当，等真需要空间再说。

## 五、开工前的必读清单（按顺序，约 50 KB）

```
1. .workbuddy/memory/MEMORY.md                      全文（工程铁律都在这里）
2. .workbuddy/memory/<最近一份日报>                  尾部 ~100 行
3. ROADMAP-2.0.md 第 188-201 行                      v3.24 范围
4. changelog.json entries[0]                         v3.23 做了什么
5. perf-budget.json 的 budgets + note 末尾两条         预算怎么算、这次为什么收回 88.0
6. git log --oneline -10 && git status && git branch
```

**不要整份读**：`README.md`（123 KB）、`ROADMAP.md`（65 KB，已被 ROADMAP-2.0 取代）、
12 篇日报全量（150 KB）。需要时 grep 单行即可。

资料库四份真源（跨任务查时用，ID 见 MEMORY.md）：
版本记录 `6EprCKM8a2hXdvelPgCgEh`、质量基线 `FNzh7ODLWDJlhoEPG1AdCS`、
路线图 `D6YKmSFWuhFRKv1Cz2iIu2`、总览 `6QV5OlrCBfOx9uoEk4cPU1`。

## 六、常用命令

```bash
npm run serve:fresh        # 本地预览（8765，--no-sw，改完立刻看到）
npm run build:prod         # 重建全部页面（产物不手改，改数据源）
npm run check              # 八套全量验收
npm run perf               # 首屏预算
npm run check:submit       # 投稿规范与真实数据是否还对得上
npm run online             # 线上核对（远端 HEAD 查不到时跳过，不判「没推」）
```

沙箱里跑浏览器套件要先 `export NO_PROXY="127.0.0.1,localhost"`，否则本机代理会让 CDP 连不上。
SSH 权限、产物合并、提交信息写文件、测试不 sleep 轮询等坑见 `MEMORY.md` 的「发布链路」一节。

## 七、纪律

- 一版一个主题，不夹带。八套全绿才发版，体验改动必须落到断言。
- 走分支 + PR，不直接推 `main`。
- 新页面必须同时有「入口」和「闸门」：做了页面却进不去，等于没做。
- 浏览器端存储一律走 `assets/lib/store.js`，键名登记在 `store-keys.js`。
- 加/删工具后 README 头部会红（工具总数由数据推导），`docs/promotion.md` 两处要手改。
