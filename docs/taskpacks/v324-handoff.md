# v3.24 交接单

> 初版 2026-11-04 23:20；23:40 补「本地已同步」；按「启动数据已拆」重写；
> 11-05 00:25 补「PR #2 已合并」；01:40 补「PR #3 已合并、失败续跑已完成」；
> 07:20 补「PR #4 已合并、保存为我的流程已完成」；07:55 补「PR #5 已合并、加入流程已完成」。
> 聊天记录不能当真源（这段任务被压缩 40+ 次，摘要套摘要），**以本文件 + `memory/MEMORY.md` + 资料库为准**。

## 一、现在停在哪（已核对，不是猜的）

| 项 | 值 |
|---|---|
| 远端 `main` | `9ae00b2`（PR #5 合并，2026-11-05 07:20：参数面板 +「保存为我的流程」） |
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

## 三、v3.24 进度：三件事全部完成

### ✅ 已完成：失败续跑（2026-11-05，分支 `feat/v324-resume-fail`）

`assets/workflow.js` 的 `bindRunner` 拆成三块：`start({resumeFrom, prev, input})`、
`renderPartial()`、`render()`。要点：

- 每步跑完存一份快照 `snapshots[i] = { carry, out }`；失败那一步的**入口** `carry` 存进 `checkpoint`。
- 失败面板列出已完成步骤的产物（标注「第 N 步」，同一份文件不重复列），并给「从第 N 步重试」。
- 续跑只跑 `from..end`，前序 `snapshots` 原样复用；断点只在内存里，**不写 localStorage**。
- 输入一改（`change`/`input`）断点立即作废、按钮撤掉——防止「前半段吃旧文件、后半段吃新文件」。
- 第 1 步就失败时不显示重试按钮（没有可复用的东西）。

**闸门**（`browser-test.mjs` 9.13b，8 条）：合成 JPEG（元数据可读、扫描数据解不开）让
`image-publish` 第 2 步必然失败 → 断言第 1 步产物仍可下载、重试只跑第 2 步、
改输入后出口消失。其中「只碰第 2 步」用 `MutationObserver` 记录每步 `data-state` 翻转，
**只看最终状态是骗人的**（重跑一遍最后也还是 done/fail/idle）。

已验闸门会红：把 `from` 写死为 0 → `0:running,0:done` 被抓；把产物循环改成 `i < 0` → 产物缺失被抓。

### ✅ 已完成：保存为我的流程（2026-11-05，分支 `feat/v324-save-flow`）

- 新键 `flows`（`store-keys.js`，group=library，cap 20）→ 隐私页与 `/my/` 表格都由清单渲染，
  构建后自动多一行；`check:storage-keys` 现在报 12 个键。
- `workflow.js` 新增参数面板（`<details>` 默认折叠，展开才 import 各工具 `run.js` 读 manifest；
  只是看流程的人不多下载三个模块）。
- 面板只摊 `args`，**不摊 `bind`**：bind 是流程内部接线，改它等于改流程定义，那属于 `workflows.json`。
- 存的是整套参数（`{ stepIdx: {k: v} }`）+ 名字 + 时间；同名同流程覆盖，超过 20 个拒绝并提示。
- 「我的流程」列表常驻显示（只读 localStorage，不依赖面板展开），支持「用这个跑」/「删除」。
- 运行取值顺序：`applied`（用这个跑套下来的）→ 面板输入 → 流程默认值；**不改 `workflows.json`**。
- 面板改过的值只在这一次运行与保存里生效，`workflows.json` 里的定义一字未动。

**闸门**（`browser-test.mjs` 9.13c，9 条）：面板默认折叠；摊开的是 args 不含 bind；
改了参数后产物真的只剩两列/一行；保存写进 `flows` 且不含文件与产物；刷新后仍在；
没填输入时「用这个跑」只套参数不启动；**面板关着时「用这个跑」也套用存下的参数**；删除后列表与键同时清掉。

已验闸门会红：把 `eff` 写回 `step`（忽略面板参数）→ 两条断言当场报出三列数据。

### ✅ 已完成：「接着做」升级为「加入流程」（2026-11-05，分支 `feat/v324-join-flow`）

原来结果条只有单跳（`→ 接着转格式`），一次只走一步；而「压完转格式再合成 PDF」本来就是一条链。
现在旁边多一个「＋ 加入流程」：这批产物直接成为某条既有流程的入口，剩下的步骤由流程引擎跑完。

- 候选在**按下按钮那一刻**才去取 `workflows.json`（几 KB 本地静态文件）——只看一眼结果的人
  不该为这个按钮多付一次请求。
- 两个边界：**只列以当前工具为第 1 步的流程**（流程入口只收一份文件或一段文本，「塞进第 3 步」
  是改流程定义，不是接力）；**产物类型必须与入口对得上**（文件型要有文件、文本型要有文本，
  文件型还要求 MIME 落在 `accept` 里）。构建期 `check-workflows` 只管「入口类型与第一步输入类型
  一致」，管不到「这次真的产出了那种东西」，所以运行时再判一次。
- 跳转用 `?flow=<id>` 深链，产物走同一个会话级 handoff（`assets/pipeline.js`，首屏已加载，无新请求）。
  流程页 `applyJoinHandoff()` 把文件塞进 `#wf-file`、文本塞进 `#wf-text`，显示来源行，
  **不自动运行**——流程页有参数面板，先跑一遍再改参数等于白跑一次（与工具页接力一致）。
- 没有候选时不装死：说清为什么（入口只收一份文件或一段文本），并给出 `/workflows/` 的链接。

**闸门**（`browser-test.mjs` 9.13d，8 条）：文本产物接进 `b64-to-json`（URL 带 flow、
入口文本真的是上一步的 Base64、自动选中、来源提示、直接跑完得到格式化 JSON）；
文件产物接进 `image-publish`（`#wf-file.files.length === 1`，DataTransfer 构造 FileList 这条最易坏）；
`sha256-hash` 没有任何流程以它为第 1 步时给出解释与入口链接。

已验闸门会红：`payload.flow` 置空 → 4 条断言同时红；去掉「以本工具为第 1 步」过滤 →
`sha256-hash` 误列 4 个候选，被断言抓出。

三件事都落在 `/workflows/` 与 `/tools/*`，**首屏一字节没动**（全是按需加载模块）。
但**别再往首屏加东西**：1.9 KB 余量是留给「确实必须在首屏」的改动，加之前先看
`perf-budget.json` 末尾那几条账。

## 四、遗留问题

### 1. `sw.js` 没 bump，老访客看到的还是旧缓存

缓存策略是缓存优先，`resources.json` / `workflows.json` 都在预缓存清单里。
新访客 / 无痕窗口正常。v3.24 整体发版时 bump 版本号一并刷新。

### 2. 老缓存的过渡期

老访客缓存里的 `resources.json` 是带 `note` 的旧版，而新前端从 `resources-notes.json` 取正文——
第一秒可能看到空正文，后台更新完刷新即可。**不值得为此写兼容代码**：`sw.js` bump 之后
预缓存整体换新，过渡只有一次。真要兜，就在 `loadResNotes` 失败时回退 `c.items[].note`，两行的事。

### 3. 远端留着三个无用分支（都已合入 main）

`origin/feat/v324-three-flows`、`origin/feat/v324-split-boot`（内容都在 main）、
`origin/muse-v324-flows`（只有草稿 JSON）。发版时一起清：

```bash
git push origin --delete feat/v324-three-flows feat/v324-split-boot muse-v324-flows
```

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
