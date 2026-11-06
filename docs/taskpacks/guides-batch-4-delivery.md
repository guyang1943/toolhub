# 教程第四批交付：12 → 15 篇

> 2026-11-06 18:58，分支 `feat/guides-batch-4`（worktree `../toolhub-guides-b4`，本地预览 8794）。
> 基线 `origin/main` = `171ef06`（v3.29 发版之后），草稿来源 `origin/muse-guides-batch-4` 的 `3e7fc92`。
> 未推 `main`、未合并、未发版、未开 PR。下面每一条都是实际跑过的。

## 一、三篇是什么

| slug | 标题 | risk | 步数 | tools | lastChecked |
|---|---|---|---|---|---|
| `github-actions-deploy` | 用 GitHub Actions 实现推代码即上线 | low | 8 | — | 2026-11-05 |
| `ai-prompts-resume` | 零基础用 AI 写简历、周报和方案 | low | 7 | token-counter / word-count | 2026-11-05 |
| `ai-batch-media` | 免费 AI 工具批量处理图片和文档 | low | 8 | image-compress / image-convert / img-to-pdf / pdf-merge / image-resize | 2026-11-05 |

- 全部按用户指定顺序追加在第 12 篇 `miniprogram-cloud` 之后。
- **正文一字未改**，只按 `content/guides.json` 的手写排版重排字段顺序（`fmt()` 生成新块）。
  老条目字节不动，唯一改动是给原第 12 篇的收尾 `}` 补了一个逗号（`+272 / -0` 行）。
- 三篇都是 `risk=low`，**没有 `riskNote`**（规则：只有 high 才写这个字段）。
- `lastChecked` **保留草稿原值 2026-11-05**：本批只核了站内工具 id 与草稿自带链接，没有重跑步骤，
  不往后改日期。`updated` 已是 `2026-11-06`（基线自带），等于改成今天，无需重写该行。
- 站内工具 id 全部存在（65 个本地工具 + 70 条外链），`verify` 的「教程引用工具」断言逐条查过。

## 二、构建

`npm run build:prod`（带 `https://toolhub.bot.cd`，**没有**直接跑 `node scripts/build-pages.mjs`）：

- 教程总览 1 + **15 篇**；静态页 **202** 个 / sitemap **203** 条；
- `sw.js` 仍是 `toolhub-v3.29`（版本由 changelog 派生，本分支不发版），预缓存 **334 个地址 / 约 5.3 MB**；
- 三篇的 `guides/<slug>/index.html`、`guides/<slug>.json` 都由构建生成，总览、`index.json`、
  sitemap、sw 清单、`offline/index.html` 统计一并更新。

**构建噪声**：202 个文件只有「多一两个空行 / CRLF 行尾」差异，逐条用 `git diff -U0` 核验
「无删除行、新增行全空白」后 `git checkout --` 还原；工作区只留 9 个真改动 + 6 个新增产物。
`feed.xml`、`llms.txt`、`robots.txt`、`privacy/index.html` 这次没有内容变化，同样还原。

## 三、两道新闸门

1. `scripts/verify-online.mjs` 的 `PATHS` 加 3 条新教程页（现共 **32** 条）。
   没有只抽样：这一批正文里有整段 YAML 和提示词模板，渲染坏了的表现是「页面少一段」而不是 404。
   这 3 条要等发版后线上才有，本分支不跑 `npm run online`。
2. `scripts/browser-test.mjs` 补 **12 条**断言（3 篇 × 4）：从 `/guides/` 总览按 `href`
   找到那一行**真点一次**（不是 `goto` 直达）、路径正确、步骤数与 `guides.json` 一致、
   `risk=low` 不长出 `.guide-risk` 块。总数 338 → **350**。

## 四、八套验收（本机 8794）

| 套件 | 结果 |
|---|---|
| `npm run lint` | ✅ 65 个工具 |
| `npm run verify` | ✅ 73 项（含 15 篇教程的页面/步骤/互链/风险块断言） |
| `npm run test:spa` | ✅ 80/80 |
| `npm run test:func` | ✅ 321/321 |
| `npm run test:smoke -- http://127.0.0.1:8794` | ✅ 192/192，离线包与可安装性段全绿 |
| `npm run test:browser -- http://127.0.0.1:8794` | ✅ 350/350 |
| `npm run perf` | ✅ 93.4 KB / 9 请求（预算 94.0 / 10） |
| `npm run audit -- http://127.0.0.1:8794` | ✅ 273 次页面检查 0 问题 |

**跑测试的坑（写在这里免得下批重踩）**：`serve.mjs --no-sw` 会把 `/sw.js` 换成「自杀脚本」
（清缓存 + 注销自己），于是 `smoke` 的「缺版本常量 / 缺预缓存清单」和 `browser` 的
「SW 已注册 / 离线包下载 / 缓存整包 / 断网可用」共 6 条断言会假红，且离线包测试会长时间卡住。
**跑八套必须用不带 `--no-sw` 的完整服务**（本批 8794）；`--no-sw` 只适合人工预览时避免缓存。
另外本机要给三个浏览器/冒烟套件设 `NO_PROXY=127.0.0.1,localhost`。
`audit` 第一次单跑撞了 `CDP 超时: Emulation.setDeviceMetricsOverride`（脚本固定 30s），
**单跑重试一次即 273 次检查 0 问题**，不是断言回归；按项目惯例「早退先单跑一次再判回归」处理。

## 五、与 `feat/fix-v329-gaps` 的合并注意

本分支从 `origin/main`（`171ef06`）切出，创建时 `feat/fix-v329-gaps`（`251147b`）**尚未合入 main**，
且它那一个提交没有动 `content/guides.json`（实测纠错还在另一条线上改）。

- 两边改的是同一文件**不同位置**：它在老条目里纠错，我在数组末尾追加。
- 合并时**用定点插入**，不要整文件覆盖，也不要用 `JSON.stringify(…, null, 2)` 重排
  （会把老条目从 1250 行撑开，产生巨大无意义 diff，并把对方的纠错冲掉）。
- 若它先合进 main：先 `git merge origin/main`（或 rebase），再核对第 12 篇之后的新块还在、
  `updated` 与三篇字段没被覆盖，然后重跑 `npm run build:prod` 与全部八套。
- 产物冲突（`guides/index.html`、`sw.js`、`offline/index.html`）不要手工合 HTML，重建即可。

## 六、没有实测的 / 待拍板

1. **三篇步骤没有重跑**，外链没有重新 `curl`（沿用草稿 2026-11-05 的核对结论），
   所以 `lastChecked` 保持原值。只核了站内工具 id 与页面渲染。
2. **`github-actions-deploy` 第 3 步的整段 YAML 没有 ``` 围栏**。教程正文目前只支持围栏这一种
   Markdown，`guide-text.js` 按空行切段，单换行在 `<p>` 里会被 HTML 折叠 —— 页面上那段
   `name: / on: / permissions: / jobs:` 会挤成一整段，读者没法照抄。
   按项目规则应当把 YAML 包进围栏（前后各留一个空行），但那属于**改正文**，本批按
   「三个对象原样追加」执行，没有擅自改。确认后只需一处改动，并在 `browser-test` 补一条
   「Actions 篇渲染出 `<pre><code>`」的断言即可。
3. 本分支不改 `changelog.json`、不抬版本、不推 main、不开 PR。发版后 `verify-online`
   新增的 3 条路径才会真正生效；资料库版本记录 / 质量基线两份文档等发版时再同步。

## 七、给 Muse

分支 `feat/guides-batch-4`，基线 `origin/main@171ef06`，八套全绿（数字见第四节），
产物已随构建重建、纯空白噪声已还原。PR 由用户开。
合并前先按第五节确认 `feat/fix-v329-gaps` 的位置；第六节第 2 条是要拍板的唯一内容问题。
