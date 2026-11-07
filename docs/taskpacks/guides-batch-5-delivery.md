# 教程第五批交付说明｜用 WorkBuddy 搭一个带后台的工作台

> 分支 `feat/guides-batch-5`，基线 `origin/main@0cae9d5`，2026-11-07。
> 本批只有一篇，自写，不是 muse 草稿分支取来的。

## 一、这一批做了什么

新增第 16 篇 `workbuddy-workbench`《用 WorkBuddy 搭一个带后台的工作台》：
把资料库里「结构化数据表当后台 + 绑定它的页面当门面 + 资料添加到任务让 Agent 接力 +
发布成链接」这条路径，从头到尾写成 9 步的入门教程。此前 15 篇讲的多是发网站、跑本机服务、
用在线 AI 工具，这是第一篇讲「用 AI 工作台把资料和流程收在一处」的。

内容依据 WorkBuddy 官方功能文档四页（简介 / 资料库 / 内容管理 / 多人多 Agent 协作），
四个链接写进 `links` 前逐个探过 200。术语照官方叫法：我的文档、团队空间、添加到任务、
发布为网站、四档权限（查看 / 编辑 / 管理 / 无权限）、MD 修订建议、结构化数据表。

## 二、数据怎么写进去的

- `content/guides.json` 是手写排版，用**定点插入**：`+99 / -1`，老条目一个字节没动，
  只把 `updated` 从 `2026-11-06` 改成 `2026-11-07`。没有用 `JSON.stringify` 重排。
- 字段：入门 / 30 分钟 / `risk=mid` / 9 步 / `lastChecked=2026-11-07`。
  **没有 `riskNote`**——它只给 high 用。按任务书规矩，风险提示写进 `intro`、`prereqs` 第 1 条
  和第 7 步正文，且都放在动作前面：先说「资料库在云端、公开链接不需要登录、发错要取消发布」，
  再给动作。
- 正文两段「一句话示例」用 ```` ```text ```` 围栏包住，围栏前后各留一个空行。
  `verify` 的两道闸门都过：有围栏必须渲染出 `<pre><code>`、有缩进行却没围栏必须报错。
- 站内工具引用 5 个（`csv-json` / `json-format` / `markdown-preview` / `image-compress` /
  `qrcode`），逐个确认 `tools/<id>/tool.json` 存在，产物里都渲染成链接。

## 三、入口与闸门（新页面不能只加数据）

- `scripts/verify-online.mjs` 的 `PATHS` **41 → 42**，补 `/guides/workbuddy-workbench/`。
  注释写明为什么探这一篇：正文有两段围栏，且是首篇讲云端资料库与公开发布权限的 mid 风险篇。
- `scripts/browser-test.mjs` 新增 4 条，照第四批的写法**从总览按 href 真点一次**，不 `goto` 直达：
  总览有入口、点进详情路径对、步骤数与 `content/guides.json` 一致、mid 风险不长出 `.guide-risk`。

## 四、构建产物

`npm run build:prod`（不是 `build-pages.mjs` 裸跑，避免 dev 域名）：

- 208 个静态页面 / 209 条 sitemap / 离线包 355 个地址约 5.7 MB / 教程 **16 篇 127 步**。
- `sw.js` 版本仍是 `toolhub-v3.29`：**本批不是发版**，`changelog.json` 一个字没动。
- 生成 `guides/workbuddy-workbench.json` 与 `guides/workbuddy-workbench/index.html`，
  `guides/index.html`、`guides/index.json`、`index.html`、`offline/index.html`、`sitemap.xml`、
  `sw.js` 随数据更新。
- 构建后 214 个 diff 文件里 **205 个是纯空白/CRLF 噪声**，逐条按 `git diff -U0` 分类后
  `git checkout --` 还原；另有 5 个（`api/tools.json` / `feed.xml` / `llms.txt` / `robots.txt` /
  `tools/tools.json`）是本机行尾归一化残留，`git diff --numstat` 为空，不进提交。
  真正提交的只有 9 个改动 + 2 个新文件。

## 五、验收（2026-11-07，八套全绿）

`PORT=8899 NO_PROXY="127.0.0.1,localhost" MSYS_NO_PATHCONV=1 node scripts/check-all.mjs`，
用的是**不带 `--no-sw` 的完整本地服务**（`--no-sw` 会把 `/sw.js` 换成自杀脚本，
冒烟与浏览器里的 SW / 离线包断言会假红）。一次跑完 8 套，耗时 16m57s：

| 套件 | 结果 |
| --- | --- |
| lint（单独跑） | 70 个工具 manifest 全通过 |
| verify | 75 项全通过，教程 **16 篇 / 127 步** |
| spa | 80/80，指南总览列出 16 篇 |
| func | 321/321 |
| perf | 首屏 **94.2 KB / 9 请求**，预算 97,280 B 未动 |
| flow | 114 项 |
| smoke | 通过（含 SW 版本常量与预缓存清单） |
| browser | **364/364**，比合并基线 360 多 4 条，正是第五批新增的入口闸门 |
| audit | 288 次页面检查，0 问题 |

日志留在 `_out/check-all.log`，不入库。

## 六、没有实测的部分（如实登记）

- 本环境**无法实际操作 WorkBuddy 资料库界面**：建团队空间、一句话建数据表、生成绑定数据表的页面、
  发布为网站、邀请成员与四档权限、导出 CSV、把资料添加到任务——这些步骤均按官方功能文档撰写，
  没有在界面里逐项点过。任务书要求「没实际见过的别写死」，所以正文明确写了
  「功能名照官方叫法，具体按钮位置与文案以你当前版本的界面为准」，没有编造按钮名和命令输出。
- `lastChecked=2026-11-07` 指的是**官方文档与四个链接已核对**，不是「UI 全流程实测」。
  四个 links 均已探 200；界面步骤待有条件时按第 8 步的三件验收动作实跑一遍再改这个日期。
- 教程里提到的「加一条记录刷新页面」「改状态看筛选」等成功标志，是给读者的验收动作，
  不是本批在 CI 里跑过的断言。

## 七、边界

不推 main、不改 `changelog.json`、不动 `perf-budget.json`、不开 PR、不发版；
验收全绿后只推 `feat/guides-batch-5`，等 Guyang 开 PR。
