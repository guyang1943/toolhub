# 自动化记忆 · T1 写教程（guides 第二批）

## 2026-11-05 首次执行（完成）

- 分支 `feat/guides-batch-2`（worktree 实际落在
  `D:/.../2026-10-20-10-57-11/toolhub-guides`，不是字面上的 `../toolhub-guides` 相对 C 盘路径——
  主工作区是 junction 到 D 盘），已 push，未合并、未推 main。
- 教程 5 → 8 篇 / 36 → 61 步。新增 `toolhub-image-pipeline`(low,7)、`ollama-local-ai`(mid,8,
  取自 muse-guides-batch-2)、`cloudflare-tunnel-home`(high,10)。
- 新增两道闸门：verify 的「mid 不得带 riskNote」、browser-test 的「从总览真点新教程」。
  verify-online PATHS 26 → 28。
- 八套全绿（lint/verify/spa 80/func 292/smoke 189/browser 334/perf/audit 264）。

## 下次要记住的坑

- `npm run serve:fresh` 写死 8765；自定义端口用 `node scripts/serve.mjs --port N`。
  **不要加 `--no-sw`**：它把 /sw.js 换成开发桩，smoke 会红「缺预缓存清单」。只有人工预览才加。
- `content/guides.json` 工作区是 CRLF、仓库是 LF（autocrlf=true）。定点插入必须按 CRLF 生成，
  否则整份文件会被当成重写。收尾形状是 `\r\n  ]\r\n}\r\n`。
- 每次 build 会给 180+ 个产物各加两行空白。逐条核验「新增行全空白」后 `git checkout --` 还原，
  别整目录还原（会丢真改动）。
- origin/main 上 `cloudflare-free` 是 mid 带 riskNote（死数据）；主工作区有一份未提交的修法。
  本分支已修（内容并入 prereqs）+ 加断言，合并时两边只能留一份。
- muses 分支会随时新增（这次 fetch 冒出了 batch-3）。

交付说明在 `docs/taskpacks/v329-guides-delivery.md`。

## 2026-11-06 追加（用户改口径：muse 草稿要用、与 T2 合并一起发）

- 四篇 muse 草稿入库，教程 8 → 12 篇：pwa-install / phone-automation /
  wechat-miniprogram-first / miniprogram-cloud（全 low 或 mid，均不带 riskNote）。
- 集成分支 `feat/release-v329` = tools-candidates + guides-batch-2，冲突只在生成物，
  取一方后整体重建；八套在集成分支上全绿后合入本地 main，推送交给 T3。
- T3 的口径已改成「合并发版 v3.29」，不再因工具/教程混杂拒发；T3 不改正文、不合并分支。
- 本自动化已 PAUSED，转为 toolhub 空间下的常规任务（需要时手动重跑）。
- 新坑：围栏前后必须留空行，否则渲染层吐字面三反引号（`guide-text.js` 按空行切段）。

