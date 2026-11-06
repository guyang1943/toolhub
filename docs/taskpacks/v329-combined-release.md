# v3.29 合并发版交代（工具第三批 + 教程第三批）

写于 2026-11-06 08:45。这份文件是给发版任务 T3 的现场交代，不是教程。

## 一、这一版为什么合成一版发

用户拍板：muse 的第三批草稿要用，并且「和 T2 合并后一起发」。所以 v3.29 是一个
跨越两条线的版本：工具第三批（T2）+ 教程第三批（T1）。T3 原先有一条「改动里混着
工具又混着教程就不要发」的纪律，本版按用户授权放宽——混杂是预期，不是异常。

## 二、main 上现在有什么

`origin/main`（96557cf）之后，main 领先 13 个提交，结构是：

- `feat/tools-candidates` 合入：新增 json-diff / expense-aa / text-to-pdf 三个零依赖工具；
  把 tools.json 的 aliases 拆到 tools/aliases.json 按需加载（首屏 93.2 → 92.5 KB）。
- `feat/guides-batch-2` 合入：教程 5 篇 → 12 篇。
  - T1 自己写：toolhub-image-pipeline、cloudflare-tunnel-home。
  - 取自已审校分支：ollama-local-ai（muse-guides-batch-2）。
  - 取自 muse 草稿：pwa-install、phone-automation、wechat-miniprogram-first、miniprogram-cloud。
- 合并后按 build:prod 整体重建产物（guides 总览标题 5 → 12、sitemap lastmod、
  feed pubDate、sw 预缓存清单）。

三个合并冲突全在生成物（guides/index.html、offline/index.html、sw.js），处理方式是
取一方后整体重建，没有人工拼接 HTML。

## 三、已经在集成分支上验过的数字

`feat/release-v329` 上跑的八套：

| 套件 | 结果 |
|---|---|
| lint | 65 个工具全过 |
| verify | 73 项 |
| test:spa | 80/80 |
| test:func | 321/321 |
| smoke | 192/192 |
| browser | 338/338 |
| perf | 92.5 KB / 9 请求（预算 94.0 / 10） |
| audit | 273 次页面检查无问题 |
| idem | 389 个产物零差异 |

T3 仍需自己复跑一遍：分支绿不等于合并后绿，这是本项目的老账。

## 四、这一版的三条硬规则（给后面写教程的人）

1. `riskNote` 只给 `risk=high` 写。mid/low 一律不写这个字段，风险提示写进 intro、
   prereqs 或对应步骤的 body，且要放在动作前面。verify 里已经加了断言钉住这件事。
2. 围栏前后必须留空行。渲染器按空行切段、整段匹配 `^```…` 才认，围栏和前一段贴在一起
   就会把三个反引号原样吐到页面上（pwa-install 第一次就是这么红的）。
3. 教程正文只支持围栏这一种 Markdown。粗体、列表、行内链接都会变成字面字符；
   需要给读者看 HTML 标签的，也放进围栏，不要裸写在段落里。

## 五、第三批四篇的已知欠账

- 四篇正文出自 muse 草稿，没有逐篇重跑流程。T1 只做了：字段与排版对齐、风险提示位置核对、
  站内工具 id 与 links 可达性实测。
- `pwa-install` 改了两处（仅格式适配，未动结论）：
  - 原外链指向 developer.chrome.com，本机 curl 与 WebFetch 均取不到，换成
    MDN 中文《制作可安装的 PWA》（实测 200，内容覆盖 manifest 必填成员、HTTPS、SW）。
  - 正文那行 `<link rel="manifest">` 包进围栏，避免被当成普通段落显示成一串转义字符。
- `phone-automation` 的 Tasker 官网 curl 取不到（返回 000），但 WebFetch 能读到页面，
  页面确实写着「7 天试用 + Play Store」，与文中一致。属于本机网络取不到，不是死链。
- 四篇的 `lastChecked` 保留草稿原值 2026-11-05；T1 今天只核了链接，没重跑注册、
  开通云环境这类有副作用的步骤，所以没有往后改日期。

## 六、T3 要做的（只有这些）

写 changelog（v3.29，分工具/教程两块）、跑 npm run check 全量、build:prod、按老规矩
核验空行产物、推送 main、线上探活、核对 README / promotion 数字、记 memory。
不要合并分支，不要改教程正文，不要重新挑工具。
