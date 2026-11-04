# v3.24 交接单

> 写于 2026-11-04 23:20。上一段任务已连续运行 15 天、被压缩 43 次，
> 聊天记录里的早期细节不可信，**以本文件 + `memory/MEMORY.md` + 资料库为准**。

## 一、现在停在哪（已核对，不是猜的）

| 项 | 值 |
|---|---|
| 远端 `main` | `c015358 Merge pull request #1 from guyang1943/feat/v324-three-flows`（11-04 23:15） |
| 该合并的 tree | `d57c751…`，与分支提交 `3165edb` **完全一致** —— 合并没改动任何文件 |
| 本地仓库 | 已同步：`main` = `origin/main` = `c015358`，本地分支 `feat/v324-three-flows` 已删 |
| 线上 | `https://toolhub.bot.cd/workflows/workflows.json` 已返回 **6 条**流程 |
| 版本号 | `sw.js` 仍是 `toolhub-v3.23`（刻意没 bump，见遗留 2） |
| 工作区 | 干净（11-04 23:40 提交本文件后为 0 个未提交改动） |

`workflows/workflows.json` 现有六条：`image-publish`、`photo-to-pdf`、`b64-to-json`、
`csv-pick-to-json`、`dedupe-count`、`qr-embed`。

## 二、四条遗留问题（按优先级）

### 1. `git fetch` 曾报「Host key verification failed」（11-04 23:40 已解决）

- 现象：`git fetch origin` 报 `Host key verification failed` / `Permission denied (publickey)`。
- 真因：**不是密钥问题**，是权限规则拦了 `C:\Users\huwei\.ssh\` 的读取（config / known_hosts / id_ed25519）。
  公钥指纹始终是 `SHA256:id0CNSSh/9pZxPzxAzdqF4g9+YQZWMxNeMdncAkCjk`，没被撤过。
- 处理（已完成）：`~/.workbuddy/settings.json` 里把
  `sandbox.orderedRules.file.customized` 置 `true`，并把 `file-preset-1`（`~/.ssh/`）
  的 `read` 从 `ask` 改成 `allow`（write / delete 仍为 `ask`），**重启客户端**后生效。
- **这条要记住**：权限规则只在启动时读一次。改完不重启，等于没改，还会一路往密钥方向误判。
- 重启后的核验命令：

  ```bash
  git fetch origin && git checkout main && git merge --ff-only origin/main
  git branch -d feat/v324-three-flows      # 已合并，可删
  ```

- **不先同步就开工，等于基于 3 条流程的旧基座改代码，回头必冲突。**

### 2. `sw.js` 没 bump，老访客还是只看到 3 条流程

- 缓存策略是缓存优先，`workflows.json` 在预缓存清单里（219 个地址）。
- 新访客 / 无痕窗口正常看到 6 条；访问过老版本的人会继续用客户端缓存。
- 这不算 bug，是「一支只做了一半的版本」的预期代价。**v3.24 整体发版时 bump 版本号，一并刷新。**

### 3. 首屏预算只剩 145 字节（89.9 / 90.0 KB）

- 上限 90.0 KB 是 11-04 因为内容变厚（第 7 个合集，`resources.json` +8 条 → +2.0 KB）才从 88.0 抬上来的，
  `perf-budget.json` 里写明了「这是内容的账，不是代码的账」。
- **v3.24 无论做什么，第一步都要先拆启动数据**：把 `directory.json` / `resources.json` 的正文改成按需加载。
  不拆的话，参数面板那点 JS 一进去就超。
- 抬 `total` 不是首选。真要抬，必须同一次提交里在 `perf-budget.json` 的 note 写清是哪种账。

### 4. 远端留着两个无用分支

- `origin/feat/v324-three-flows` → `3165edb`，内容已在 main 里，可删。
- `origin/muse-v324-flows` → 只放着草稿 `docs/taskpacks/v324-flows-draft.json`（三条流程的原始描述），
  内容已落进 main，留着的唯一价值是「当初的草案长什么样」。
- 删除命令（可选，不影响功能，等 v3.24 发版时一起清）：
  `git push origin --delete feat/v324-three-flows muse-v324-flows`

## 三、v3.24 的范围（来自 `ROADMAP-2.0.md` 第 188–201 行）

已做完的（上一段任务，已在 main）：六条流程、构建期闸门、真浏览器 fixture、失败即停。

**还没做的三件**：

1. **参数面板 /「保存为我的流程」**：参数集存进 `store.js` 的 `flows`，下次一键重跑。
   `csv-pick-to-json` 的 `cols` / `filterCol` / `filterVal` 现在是空串占位，就是等这个功能在运行时填。
2. **失败续跑**：第 3 步失败时，前两步产物仍可下载，并给「从这一步重试」。
   这是本地处理的天然优势（数据一直在内存里），值得写进产品文案。
3. **工具页「接着做」升级**：从单跳变成「加入流程」。

**闸门要求**：六条流程在真浏览器里用 fixture 跑通；失败续跑单独一条断言
（故意传坏文件，断言前两步产物仍可取）。

## 四、开工前的必读清单（按顺序，约 50 KB）

```
1. .workbuddy/memory/MEMORY.md                      全文（工程铁律都在这里）
2. .workbuddy/memory/2026-11-04.md                  尾部 ~100 行（今天发生了什么）
3. ROADMAP-2.0.md 第 188-201 行                      v3.24 范围
4. changelog.json entries[0]                         v3.23 做了什么
5. perf-budget.json 的 budgets + 最后一条 note        预算怎么算的
6. git log --oneline -10 && git status && git branch
```

**不要整份读**：`README.md`（123 KB）、`ROADMAP.md`（65 KB，已被 ROADMAP-2.0 取代）、
12 篇日报全量（150 KB）。需要时 grep 单行即可。

资料库四份真源（要跨任务查时用，ID 见 MEMORY.md）：
版本记录 `6EprCKM8a2hXdvelPgCgEh`、质量基线 `FNzh7ODLWDJlhoEPG1AdCS`、
路线图 `D6YKmSFWuhFRKv1Cz2iIu2`、总览 `6QV5OlrCBfOx9uoEk4cPU1`。

## 五、常用命令

```bash
npm run serve:fresh        # 本地预览（8765，--no-sw，改完立刻看到）
npm run build:prod         # 重建全部页面（产物不手改，改数据源）
npm run check             # 八套全量验收
npm run check:workflows   # 工作流静态闸门
npm run perf              # 首屏预算
npm run online            # 线上核对（远端 HEAD 查不到时跳过，不判「没推」）
```

发版链路与坑（SSH 权限、产物合并、提交信息写文件、测试不 sleep 轮询）见 `MEMORY.md`
的「发布链路与产物合并」一节，**开工前务必过一遍**。

## 六、纪律

- 一版一个主题，不夹带。八套全绿才发版，体验改动必须落到断言。
- 走分支 + PR，不直接推 `main`。
- 新页面必须同时有「入口」和「闸门」：做了页面却进不去，等于没做。
- 浏览器端存储一律走 `assets/lib/store.js`，键名登记在 `store-keys.js`。
- 加/删工具后 README 头部会红（工具总数由数据推导），`docs/promotion.md` 两处要手改。
