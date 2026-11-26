# T2 找工具 — 执行记录

## 2026-11-06（本轮，含收尾）

- 资源库：「都进」拍板后新增第 8 个合集 `dev-clients`「本地优先的开发者客户端」6 条
  （Bruno MIT / Hoppscotch MIT / Yaak MIT / drawDB AGPL-3.0 / DbGate GPL-3.0 / DBeaver Apache-2.0）。
  verify 有「合集 ≥6 条」的硬闸门，所以从 4 条补到 6 条（加了 Yaak、DBeaver，都实地核过许可证与站点）。
- 顺带修一处旧 bug：模板只归一中文「N 条资源」，英文「N resources」永远是 50。
  改成两种语言都从 TOTAL_RES 推。
- 推送与合并：`feat/tools-candidates` → main（`--no-ff`），冲突只在 `offline/index.html` 的
  `__OFFLINE_META__`（两边都是旧构建产物），取 HEAD 后整站重建。
- main 上与 T1 的教程批次合流，重建产物 199 页 / 200 条 sitemap / 离线包 328 个地址。
- 八套在 main 上重跑全绿：lint 65 / verify 73 / spa 80 / func 321 / smoke 192 / browser 338 / perf 93.4 KB·9 / audit 273。
- ssh 推 main 首次超时（ssh.github.com:443），重试一次成功：96557cf..addd5a6。
- 定时任务处理：删除 `ba04d9b8`（ToolHub T2 找工具，一次性 2026-11-05T23:40），
  内容改为常规任务书 `docs/taskpacks/T2-找工具.md`，放在 toolhub 项目内随时手动重开。

## 已知欠账

- drawdb AGPL-3.0 仅外链；hoppscotch 网页版存储位置、dbgate / dbeaver 上报范围标「未核实」。
- 首屏余量 0.6 KB，下一批工具前要先想清楚怎么腾。
