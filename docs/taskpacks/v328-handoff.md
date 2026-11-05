# v3.28 交接单

> 2026-11-05 23:10 初版。
> **聊天记录不能当真源**：产出它的那个会话从 00:36 起连跑 22 小时、被压缩 10 次，摘要套摘要。
> 以本文件 + `.workbuddy/memory/MEMORY.md` + 资料库为准。
>
> 这份文件同时是三份任务书：**T1 写教程 / T2 找工具 / T3 发版**。
> 新任务只读自己那一节 + 第五节的必读清单，就能开工。

---

## 一、现在停在哪（逐项核对过，不是猜的）

| 项 | 值 |
|---|---|
| 远端 `main` | `4f5bf84`（`ef32119` 发版 + `4f5bf84` 探活清单） |
| 线上版本 | `toolhub-v3.28`，`verify-online` 26 条路径全通 |
| 工作区 | 干净，无未提交改动，当前在 `main` |
| 本地工具 | **62** 个（`tools/registry.json` 的 order） |
| 目录收录 | **132** 条（62 本地 + 70 外链） |
| 教程 | **5 篇 / 36 步**（`content/guides.json`） |
| 首屏 | **93.2 / 94.0 KB · 9 请求**（余量 0.8 KB） |
| 离线包 | **304 地址 / 4,941,149 字节** |
| 静态页 | 188 个 / sitemap 189 条 |
| 测试规模 | `test:func` 292 条 / `test:browser` 327 条 |

**v3.28 是第一次「加内容不加首屏」**：新增的 `assets/lib/guide-text.js` 只在教程页按需加载，
不进首屏。这条经验要保住——往首屏加东西之前先看 `perf-budget.json` 末尾的账。

---

## 二、v3.28 留下的唯一结构性教训

教程正文的渲染**只有一份实现**：`assets/lib/guide-text.js`（先转义、再把 ``` 围栏换成 `<pre><code>`）。
`scripts/build-pages.mjs` 与 `assets/content-pages.js` import 的是同一个文件。

之前是两份实现（静态页原样拼 HTML、单页应用走 `esc()`），结果同一段 ```html 示例在两边是两种坏法：
静态页把 `<html>` 当真标签吃掉示例、SPA 显示字面三反引号。数据合法、结构齐全，只跑校验发现不了。
配了两道闸门，都做过故障注入确认会红：

1. `verify`：教程页 `<main>` 之内不得出现字面三反引号；有围栏的必须渲染出 `<pre><code>`。
2. `spa-render-test`：围栏要渲染成代码块、示例里的标签要被转义成文本。

**正文目前只支持围栏这一种 Markdown**。写教程别再引入第二种语法（粗体、列表、链接都不渲染，
写了就是字面字符）。要加，先改这个共享模块，再同时补两道闸门。

---

## 三、三个任务

三件事的文件所有权是分开的，但**有两处真重叠**（见第四节），所以合并有固定顺序。
`T1` 与 `T2` 可以并行，`T3` 必须等两者合并完。

### T1｜写教程（guides）

**目标**：从现有 5 篇扩到 8 篇，补齐路线图 v3.29 定的四个栏目。

**栏目现状**（`ROADMAP-2.0.md` 第 279-284 行）：

| 栏目 | 已有 | 缺口 |
|---|---|---|
| 开源部署 | tv-box-server、github-pages-first-site、cloudflare-free | 够 |
| 入门教程 | github-first-lesson、custom-domain | 够 |
| **工具用法** | 0 篇 | **完全空缺，优先** |
| **AI 应用** | 0 篇 | **完全空缺，优先** |

**建议选题**（按优先级，可换，换了在交付说明里写理由）：

1. `toolhub-image-pipeline`｜工具用法｜用本站工作流把图片压到 200KB 再转格式（覆盖 image-press → image-convert 流程，纯本地、零风险，正好验证工作流页）
2. `ollama-local-llm`｜AI 应用｜在自己电脑上跑一个本地大模型（Ollama + 可选 Open WebUI，risk=mid：要下载几 GB 模型、占内存）
3. `cloudflare-tunnel-home`｜开源部署｜把家里的服务安全暴露到公网（risk=high：这一步做错就是把内网摊开，必须写清「只暴露单一端口 + 加 Access 鉴权」与回退）

**每篇必须四件套，缺一项构建失败**：前置条件（`prereqs`）、操作过程（`steps`）、
风险（`risk` 只能 `low`/`mid`/`high`）、回退方法（`fallback`）。
另按现有 5 篇的字段补齐：`slug` `icon` `title` `tagline` `difficulty` `minutes`
`lastChecked` `intro` `why` `pitfalls` `faq` `tools` `links`。

**写之前必须知道的四件事**：

- `riskNote` **只在 `risk=high` 时渲染**。`mid` 写了就是死数据（`cloudflare-free` 现在就是这样，
  这是已知遗留，别照抄）。`mid` 的风险提示写进 `intro` 或对应的 `steps[].body`。
- 正文没有富文本。`steps[].body` 是一整段纯文本，换行不生效，代码只能靠 ``` 围栏。
- `lastChecked` 填今天；这是「最后核对日期」，不是发布日期。
- `faq` 少于 2 条会让 `verify` 红（`t.guides.length < 2` 那条断言）。

**追加方式（别偷懒）**：`content/guides.json` 是**手写排版**——`tools`、`links` 内联，
其余数组一行一项。`JSON.stringify(…, null, 2)` 会把老条目从 117 行撑到 137 行，产生巨大无意义 diff。
用定点插入：先按原风格 `fmt()` 生成新块，再插在数组收尾前，**老条目字节不动**。
`updated` 改成当天。

**独占文件**：`content/guides.json`、`guides/*`（产物）、`scripts/build-pages.mjs`、
`assets/lib/guide-text.js`、`assets/content-pages.js`、`scripts/verify.mjs`、`scripts/browser-test.mjs`。
**不许碰**：`tools/`、`articles.json`、`i18n*.json`、`perf-budget.json`。

**交付**：

- 分支 `feat/guides-batch-2`（在独立 worktree 里做，见第四节）
- `npm run build:prod` 重新生成页面（**不是** `node scripts/build-pages.mjs`，不带域名会把
  `robots.txt` 写成 dev 域名、全站 URL 写错）
- 全量八套绿：`npm run lint` / `verify` / `test:spa` / `test:func` / `test:smoke` / `test:browser` / `perf` / `audit`
- 新页面必须同时有「入口」和「闸门」：总览页列得出、点得进去、`browser-test` 真点一次。
  `goto('/guides/xxx/')` 直达测试对链接一无所知，全绿也可能用户根本到不了。
- 离线清单要补：`scripts/verify-online.mjs` 的 `PATHS` 加新教程页（现在 26 条，每批补 1–2 条）；
  `gen-sw.mjs` 会扫目录自动收，不用手加。
- 不推 `main`、不开合并。交付时给分支名 + 测试通过数。

---

### T2｜找工具（目录扩充 / 新增本地工具）

**目标**：给下一版定「加什么」。这一版的重点是**找**，不是一口气加完。

**实际口径（与 prompt 一致，别读岔）**：

1. **必做**：产出一份 `docs/taskpacks/TP7-tool-candidates.md`，12 条候选，每条带「跑在哪 / 数据边界 /
   实现成本 / 预算影响 / 先决条件」。
2. **能落地就落地**：从清单里挑 3 个「零依赖、纯计算、无先决条件」的做出来，跑全量八套。
   挑不出来或预算不允许，就只交清单——**半成品不许塞进来**。
3. 下面两个方向是清单的**来源**，不是二选一的任务：

**方向 A：目录外链扩充**（`TP5-directory.md`，内容型，快）

- 目标 70 → 找 8–12 条新的开源/可自部署项目，补进 `tools/directory.json`。
- **每条必须能回答「跑在哪」**：浏览器 / 本地客户端 / 自部署 / 需 API Key。四种用徽标、不用颜色区分。
- 纯云服务（要注册、要 Key、数据必然离开本机）只进资源库，不进工具目录。
- 每条要有 `desc` / `privacyNote` / `promptNote` / `evidence`（谁、何时、怎么核的）。
- **加之前先算账**：`directory.json` 是首屏启动数据之一。v3.25 加 8 条把首屏推了 3.1 KB、
  抬了一次 total。**这次加之前必须先拆 `evidence` 到按需加载**（v3.21 就欠下的账，723 字节但要动五个脚本），
  否则 `perf` 会红。

**方向 B：TP6 第三批 12 个工具**（`docs/taskpacks/TP6-new-tools.md` 第 191-281 行，代码型，重）

- 12 个 id：`json-yaml` / `json-diff` / `sql-format` / `mock-data` / `ascii-art` / `ua-parse` /
  `pdf-stamp` / `text-to-pdf` / `note-local` / `expense-aa` / `pomodoro-kit` / `pinyin-convert`。
- **每个都有先决条件，实现前逐条确认**，拿不准的在交付说明里写取舍。已定的两条：
  - `text-to-pdf` 首期**仅英文/数字**，用内置 Helvetica、0 新增字节；出现中文给明确提示，不静默出乱码。
  - `pinyin-convert` 数据源用 `scripts/vendor/tiny-pinyin/dist` 打 ~16 KB 包到 `assets/vendor/pinyin.min.js`。
- **赊账到期，这次必须先还**：v3.27 写死了「之后任何新工具批次，必须先把 `tools.json` 的 aliases
  （压缩后 1.8 KB）挪到 `tools/aliases.json` 按需加载，否则不许再动 total」。
  这一批的第一步就是拆 aliases，拆完再谈加工具。

**通用规范（两个方向都适用）**：

- 三件套 `tools/<id>/tool.json` + `run.js`（`export const manifest` / `export async function run`），
  `index.html` 由构建生成、不手改。
- `manifest` 必填 `inputs`（1–10 项）+ `runLabel`（动词 ≤6 汉字）。
- **输入项不许带示例默认值**（v3.24 教训：默认值会让「没填」和「填了默认」分不清）。
- `file` 类型必须写 `accept`。`aliases` 不手写，由 `gen-search-aliases.mjs` 生成。
- 加完只需 `node scripts/sync-tools.mjs` + `npm run build:prod`，**别跑 `gen-search-aliases.mjs`**
  （它会把只装 70 条外链的 `tools/directory.json` 别名改瘦）。
- 新增工具后 `README.md` 头部会红（三处导语要手改：中文/繁体/英文；英文那句是「本地在前、总数在后」，
  与另两处相反）。

**独占文件**：`tools/`、`tools/registry.json`、`articles.json`、`articles/<id>.json`、`i18n.json`、
`i18n-detail.json`、`README.md`、`perf-budget.json`、`scripts/verify.mjs`、`scripts/browser-test.mjs`、
`scripts/new-tools-test.mjs`。
**不许碰**：`content/guides.json`、`assets/lib/guide-text.js`。

**交付**：分支 `feat/tools-candidates`（worktree `../toolhub-tools`，端口 8792）；全量八套绿；
PR 描述写清「清单路径 + 实际落地哪几个 + 每项先决条件结论 + 预算账（代码变胖还是内容变厚）」。不推 `main`。

---

### T3｜发版（release）

**这不是一个可以随便并行的任务**：它把 `main` 推到 GitHub Pages，40 秒后线上就变了。
所以它有硬前置：

1. 当前在 `main`，工作区干净。落后 `origin/main` 就 `git pull --ff-only`（用户可能在网页上合并了
   PR，本地落后是正常状态）；不能快进或工作区脏，就停下报告。
2. `changelog.json` 的 `entries[0].version` 记为 V，线上版本记为 W
   （`curl -s https://toolhub.bot.cd/sw.js` 里的 `toolhub-vX.YY`）。
   **正常待发状态是 `V == W`**——changelog 顶部还停在上一版，本版还没写。
   `V != W` 说明有人写了 changelog 却没发出去，停下报告，别重复写。
3. 「有没有内容可发」：上一个发版提交之后，除了 changelog / 产物 / 纯文档，得真有代码或内容改动。
   没有就报告「当前无待发内容」。
4. 改动里混着不属于同一主题的东西（比如既改工具又改教程）→ **不发**，列出来让人定版本号与拆法。

版本号由 T3 自己算：W 的末位 +1（`v3.28 → v3.29`）。但 changelog 文案必须基于真实 diff 写，
并在报告里单列「版本号 + 文案」供人复核。

**发版步骤（按顺序，别跳）**：

```bash
# 0. 合并后先跑全量，红着不发布
npm run check
# 1. 插 changelog（LF 换行，顶部插 entries[0]，版本号从它派生到 sw.js）
# 2. 重建产物（必须带域名）
npm run build:prod
# 3. 判断哪些文件真变了
git diff --numstat
# 4. 提交（changelog/perf-budget/产物：sw.js offline/ changelog/ api/tools.json feed.xml sitemap.xml）
git add -A && git commit -F <提交信息文件>
# 5. 直推 main
git push origin main
# 6. 等 40 秒再探活
npm run online -- --wait 120
```

第 0 步不能省：**分支上绿不等于合并后绿**。两条分支各改各的 `verify.mjs`，单看都过，
合到一起可能撞断言或撞节号。

**发版时必做的三件核验**：

- `llms.txt` / `privacy/index.html` / `robots.txt` **按 `git diff --numstat` 判断**：
  输出为空 = 只有换行差异，直接 `git checkout --` 还原；有数字 = 内容真变了，必须带上。
- 构建产物有「多一个空行」的老毛病（v3.25 起每版 180+ 个文件各多 1–2 行空白）。
  用 `git diff -U0 <file>` 逐条核验「新增行全是空白」后还原，别整目录 `checkout`（会丢真改动）。
  这条**不要在发版当口去治**，成因在 `build-pages.mjs` 的 JSON-LD 区块剥离/注入。
- 提交信息写文件再 `git commit -F`，别用 `-m` 传多行。

**发版后必做**：

- `README.md` 三处导语数字、`docs/promotion.md` 两处手改数字。
- 资料库两份文档同步：版本记录 `6EprCKM8a2hXdvelPgCgEh`（每版加一节、改页头版本号）、
  质量基线 `FNzh7ODLWDJlhoEPG1AdCS`（数字变就更新，补「上一版 → 本版增量」）。
  **读回正文 → 末尾追加 → 提交，别全量覆盖**（会毁块 ID）。
- `.workbuddy/memory/<日期>.md` 追加本版记录。

---

## 四、并发与合并顺序（重要）

三个任务如果同时在主工作区跑，会互相踩。**T1 与 T2 必须各自开 worktree**：

```bash
cd "C:/Users/huwei/WorkBuddy/2026-10-20-10-57-11/toolhub"
git worktree add ../toolhub-guides -b feat/guides-batch-2 origin/main
git worktree add ../toolhub-tools  -b feat/tools-candidates origin/main
```

| 时间 | T1 教程 | T2 工具 | T3 发版 |
|---|---|---|---|
| 并行期 | `../toolhub-guides` | `../toolhub-tools` | 等 |
| 合并 | 先合 | 后合（解冲突） | 合并完才开始 |

**真实重叠点**（先合的一方先改，后合的一方手工解）：

- `scripts/verify.mjs`（各加各的断言，冲突在文件尾部）
- `scripts/browser-test.mjs`（同上，节号会撞）
- `perf-budget.json`（T2 会抬 total，T1 不该动）

**合并顺序固定的理由**：T2 会改 `README.md` 工具数与 `perf-budget.json`，
T1 不该碰这两个文件；若先合 T1，T2 的 perf 数字还是对的。

**产物冲突不手工合 HTML**：重建 + 数据源取对方，重建后重跑全部测试。

---

## 五、开工前的必读清单（按任务裁剪，别整份读）

**三个任务都读**：

```
1. .workbuddy/memory/MEMORY.md                      全文（工程铁律都在这，约 8 KB）
2. .workbuddy/memory/2026-11-05.md                  尾部 ~120 行
3. git status && git log --oneline -8 && git branch -a
```

**T1 加读**：

```
4. content/guides.json                              只读最后 1 篇（看字段与排版风格）
5. assets/lib/guide-text.js                         全文（40 行，正文渲染唯一实现）
6. scripts/verify.mjs 第 1264-1300 行                教程页闸门
7. ROADMAP-2.0.md 第 279-284 行                      v3.29 教程体系定位
```

**T2 加读**：

```
4. docs/TOOL-CONTRACT.md                            工具契约
5. docs/taskpacks/TP6-new-tools.md 第 191-281 行      第三批 12 个的规格与先决条件
6. perf-budget.json 的 budgets + note 末尾 3 段        预算怎么算、赊账到哪一步
7. tools/registry.json                              现有 62 个 id，别重名
```

**T3 加读**：

```
4. changelog.json entries[0]                        上一版写了什么、格式长什么样
5. perf-budget.json 的 budgets                       发版后填实测数字
```

**不要整份读**：`README.md`（123 KB）、`ROADMAP.md`（65 KB，已被 `ROADMAP-2.0.md` 取代）、
全部日报（150 KB）。需要时 grep 单行。

---

## 六、命令与已知坑

```bash
npm run serve:fresh        # 本地预览 8765，--no-sw；改完刷新就是新的（别用 npm run serve）
npm run build:prod         # 重建全部页面（产物不手改，改数据源）
npm run check              # 八套全量验收
npm run perf               # 首屏预算
npm run online             # 线上探活（三态，查不到跳过，不判「没推」）
```

| 坑 | 表现 | 处理 |
|---|---|---|
| 本地预览用 `serve` | 改完刷到旧页面 | 一律 `serve:fresh` |
| `git push` 超时 | `ssh.github.com:443 Connection timed out` | 重试，别动密钥（`~/.ssh/config` 已把 github.com 指向 443，删了立刻全超时） |
| 沙箱跑浏览器套件 | CDP 连不上 | `export NO_PROXY="127.0.0.1,localhost"` |
| `spawn` 调 `curl` | Windows exit 23 | `-o /dev/null` 换平台空设备 |
| 脚本里写绝对路径 | CI（ubuntu）红 | 一律相对 `root` |
| `node --check` 逐个查工具 | 11.5s | 用 `scripts/lib/parse-tools.cjs`（vm 单进程 0.25s） |
| 测试用固定 `sleep` | 偶发假红 | `waitForCount(选择器, N)` 轮询 |
| 浏览器存储裸写 | `verify` 红 | 走 `assets/lib/store.js`，键名登记 `store-keys.js` |

**CI 与线上**：GitHub Pages 托管（不是 Workers），推 `main` 即发布。**绝不加 `.nojekyll`**
（`_worker.js/` 会被发布，Pages 没有 `env.ASSETS`，会打挂全站）。生产环境没有安全头，这是唯一的
「本地绿、线上缺」，不用查。

---

## 七、纪律

- 一版一个主题，不夹带。八套全绿才发版，体验改动必须落到断言。
- 走分支，不直接推 `main`。**PR 只能用户点**（无 PAT、无 `gh`），交付到「分支 + 全绿」为止。
- 新页面必须有「入口」+「闸门」：导航/总览有链接、verify 断言链接在、browser 真点一次。
- 测试红了先判断是真问题还是断言本身错了。要改断言，必须在交付说明里单列「为什么这条断言是错的」。
- 预算超了先分账：**代码变胖要优化，内容变厚可抬 total**（须在 note 与提交信息写清是哪种账）。
- 不加 `"type": "module"`（UMD 崩）。安全头只改 `assets/lib/security-headers.js`。

---

## 八、无人值守时补的交代

T1 23:25 / T2 23:40 / T3 次日 09:30 都是**无人值守**自动跑的。跑起来之后没人能救场，
所以下面这些不是建议，是硬规矩。三份 prompt 里都写死了，改 prompt 时别弄丢：

**1. 增量提交。** 写完一篇教程（过 build + verify）就 commit 一次，落地一个工具就 commit 一次。
任务随时可能被中断，攒到最后一次性提交等于全丢。半成品分支比空目录有用。

**2. 不许编造。** 版本号、按钮名、命令输出、界面文案，没实际见过的不要写死。教程里没法实测的
步骤要写明「以你当前版本界面为准」，并在报告里单列「哪几步没有实测」。本站的立站之本是实测，
写错比少写更糟。候选清单里的外链必须真访问过（`curl -sI`），404 直接剔除；许可证、最近提交查不到
就写「未核实」，不许估。

**3. 遇审批 / 权限 / SSH 失败：停下，不绕过。** 不改密钥、不改 `~/.ssh/config`、不关沙箱、
不换 `dangerouslyDisableSandbox`。把原始报错写进报告。这条尤其重要——为了「把活干完」去动发布链路，
是把一次失败换成一堆故障。

**4. `git` 报 `index.lock`：** 另一个任务在同时 `worktree add`，等 5 秒重试一次即可。

**5. 并发下的假红。** 两个任务同时跑浏览器套件会拖慢甚至超时。先确认 serve 还活着、端口是自己的
（T1 8791 / T2 8792），重试一次再判定。**别把「慢」当「坏」，更不要因此改断言。**

**6. 90 分钟止损。** 到点没全绿就停，commit 已完成的部分，交付「做到哪、卡在哪、报错原文」。

**7. 高风险教程的回退必须真能撤销。** `risk=high` 那篇（把家里服务暴露到公网）每一步要写清
「做错会怎样」；`fallback` 得是删 Tunnel、撤 DNS 记录、关 Access 策略这种可执行动作，
不能写「重新配置一下」。

**8. worktree 复用要小心。** 目录已存在时先 `cd` 进去 `git status`，有未提交改动先 commit，
再 `git worktree remove --force`。别把上一个任务没提交的劳动直接删掉。
