# v3.32 · 目录证据字段拆出首屏（feat/slim-boot-data）

> 交付人：Craft（分支 + 验收）｜合并人：Guyang｜开 PR：Muse
> 分支：`feat/slim-boot-data`（从 `main` = `fd303a9` 切出，后合并 `1e2ee5c` 保持 clean）
> 状态：**八套全绿，等开 PR**。本批不含 changelog 条目、不含 `since`——那是发版任务的活。

**2026-11-08 08:25 追记（合并 main 后复跑）**：分支切出后 main 前进了 `feat/guides-realrun`
（PR #16，教程实跑复验，合并提交 `1e2ee5c`），已 `--no-ff` 合入本分支（`6187eeb`）。
冲突 5 个全是构建产物（四篇教程静态页 + `/offline/`），按定式暂存 main 侧后整体 `build:prod`
重建覆盖，数据源全取两边之和；`api/tools.json` / `feed.xml` / `sitemap.xml` 的日期前移是构建日
行为，已还原不带入。合并后八套重跑全绿：verify 77 · spa 80 · func 321 · perf 93.1 KB/9 ·
flow 122 · smoke ✅ · browser 366 · audit 288。

## 一、为什么要拆

首屏 94.2 KB / 预算 95.0 KB，只剩 0.8 KB。TP7 剩的 4 个工具（`sql-format` / `pdf-stamp` /
`note-local` / `pomodoro-kit`）要进站，元数据按 4 条约 560 B 估，塞不进去。

这笔账从 v3.21 就写在 `perf-budget.json` 的 note 里：「再往 directory.json 加字段，先把
evidence 拆成按需加载」。v3.24 量过一次是 723 B，结论是「为它动五个脚本不值当」；TP7 时按
Guyang 的口径抬了 total。**这次先量后定，账变了**（外链 62 → 70 条）。

## 二、先量后定（gzip，LF 归一，与 perf-budget 同口径）

| 候选 | 拆掉后启动省 | 判断 |
|---|---|---|
| `tools.json` · desc | 2,680 B | **不能拆**：首页卡片与搜索都在读它，拆成独立文件后净省为负（-636） |
| `tools.json` · tags | 895 B | 同上，搜索 haystack 在用 |
| `directory.json` · evidence | **1,007 B** | 可拆：`assets/` 下一次都没读 |
| `directory.json` · linkStatus | 59 B | 同上（死链标记只在构建期写进详情页） |
| `directory.json` · desc | 1,792 B | 不能拆：目录卡片在首页渲染 |
| `directory.json` · privacyNote / blurb | 2,103 / 2,206 B | 不能拆：SPA 工具页的边界行与「编辑推荐」在读 |

结论：拆 `evidence` + `linkStatus`，合计 1,051 B。`total` 一分没抬。

## 三、做法：不是「按需加载」，是「构建期派生」

量完发现浏览器侧**从来不读**这两个字段（读写方全在构建期与校验脚本：`build-pages` 写详情页、
`lib/evidence.mjs` 统计、`check-links` 回写、`check-tool-meta` 校验）。所以没有照抄
aliases 的按需 fetch——那会白搭一个请求，还得把 1 KB 塞进离线包。

改成：构建期由 `tools/directory.json` 派生 `tools/directory-boot.json`（去掉这两个字段），
浏览器取这一份。**源文件结构一动不动**——证据的写入口散在五个脚本里，动源结构等于同时改五个
写入口，这才是 v3.24 说「不值当」的那笔账。派生逻辑只有一处：`scripts/lib/directory-boot.mjs`。

改动的运行面：
- `assets/app.js`、`assets/my.js` → 取 `/tools/directory-boot.json`
- `scripts/gen-sw.mjs` → 预缓存换成启动副本（源文件不再进包），动态缓存正则补 `directory-boot`
- `perf-budget.json` → bootData 换文件 + 记一笔账

## 四、闸门（verify 77 项，新增 1 条）

`目录证据不在首屏`，五种退化各有断言：

1. 启动数据又列回源文件 `tools/directory.json`
2. 启动副本里出现 `evidence` / `linkStatus`
3. 副本与源不同步（源改了没重建）
4. `app.js` / `my.js` 又去取源文件
5. 离线清单装错文件（没装副本 / 还在装源文件）

故障注入两种，确认会红：
- 往副本里塞一条 `evidence` → 报「启动副本里还有构建期字段：excalidraw.evidence」
- 把 `app.js` 改回取源文件 → 报「app.js / my.js 又去取源文件了」

## 五、账（perf-budget，实测）

| 项 | 拆前 | 拆后 |
|---|---|---|
| 首屏合计 | 96,414 B（94.154 KB） | **95,297 B（93.06 KB）** |
| 启动数据 | 43,647 B（42.6 KB） | 42,424 B（41.4 KB） |
| `directory.json` / 启动副本 | 12,327 B | **11,104 B** |
| 脚本 `app.js` | 31,632 B | 31,687 B（+55，换路径与注释） |
| 余量 | 866 B | **1,983 B** |

余量 1.98 KB，按 4 条元数据约 560 B 估，TP7 剩下 4 个工具进站不必再动 total。
`scripts` 仍是 31,744 上限（实测 31,687，余 57 B）：本版只换了取数据的路径，上限一个数没动，
下次真要改 `app.js` 得先拆一块。

## 六、顺手还的两笔（同一分支，独立提交）

1. **探活清单 42 → 51 路**：补 6 篇从没被线上探过的教程（`tv-box-server` / `cloudflare-free` /
   `github-first-lesson` / `ollama-local-ai` / `phone-automation` / `miniprogram-cloud`，至此 16 篇全探），
   补 `tools/io.json`、`assets/lib/tool-io.js`（v3.31 加的两个按需文件一直没进清单），补
   `tools/directory-boot.json`。
2. **构建空白噪音**：`build-pages.mjs` 剥 `<--hs:-->` 区块的正则改成 `\r?\n?`。本机检出是 CRLF，
   原来的 `\n?` 匹配不到 `\r`，每块都留一个「假空行」，于是每次构建 207 个产物各多一两行空白、
   发版时要手工 `git checkout` 还原（这笔账记了十几个版本）。修完再把产物对齐生成器，此后
   **本机构建不再产生任何 diff**（构建是幂等的，`idem` 已验证 415 个产物零差异）。

## 七、验收（八套全绿）

| 套件 | 结果 |
|---|---|
| lint | 70 个工具通过 |
| verify | **77 项** |
| SPA 渲染 | 80/80 |
| 工具功能 | 321/321 |
| 首屏预算 | 93.1 KB / 9 请求，通过 |
| 工作流 | 122 项 |
| 冒烟 | ✅ |
| 真浏览器 | **366/366** |
| 全站体检 | 288 次页面检查，0 问题 |

## 八、留给下一批的欠账

- **54 条外链的边界证据仍是 `imported`**（`boundary.method`），来源是上游清单照抄，没有一条
  真打开页面核过。TTL 是 90 / 180 天 → 2027-02-01 起报警、2027-05-02 集体 fail。按分类：
  开发 15 / 文档 9 / 数据 9 / 设计 8 / 图片 5 / 效率 4 / 音视频 2 / 网络 2。这件事只能人逐条看，
  建议一批 9 条、按分类聚着做。
- TP7 剩余 4 个工具进站（余量够，无需再动 total）。
- `scripts` 预算余量 57 B，低于「实测 + 约 1 KB」的政策余量；下次改 `app.js` 前要么拆一块，
  要么按政策重定 scripts 上限（total 是刹车，不会因此变）。
