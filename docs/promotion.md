# 阶段 A 推广材料（2026-10-30）

> 这些是**文案与判断**，发布必须用你本人账号。原因：Show HN / Reddit 都看账号历史，
> 新号发推广帖基本秒删；我代发既做不到，也会让账号被判为 spam。

## 先说一个修正

原计划里的「awesome-list PR」我重新判断过，**大概率不合适，建议放弃**。

这类 list（awesome-selfhosted、awesome-privacy 等）收录的是「一个软件项目」，
不是「一个项目的目录」。ToolHub 是聚合站，PR 过去通常被以 "not a project" 关掉。
而且这些 list 的 CONTRIBUTING 大多明确要求「不接受资源导航站」。

更值得花时间的是下面三个渠道，匹配度完全不是一个量级：

| 渠道 | 为什么匹配 | 门槛 |
| --- | --- | --- |
| **r/InternetIsBeautiful** | 专收「有意思的网页」，免费免注册是硬要求，我们全中 | 低 |
| **Show HN** | HN 对「本地执行 / 无后端 / 隐私」类项目明显偏爱 | 中，看当天运气 |
| **r/privacy** | 「文件不上传」是这里最硬的需求 | 中，文案不能有营销腔 |

---

## 一、Show HN

**标题**（HN 要求 `Show HN:` 开头，别加感叹号、别写 "best"）：

```
Show HN: ToolHub – 99 open-source tools that run in your browser, not on a server
```

**正文**（第一人称、讲实现、不吹）：

```
I kept needing one-off tools — compress an image, merge two PDFs, format some JSON —
and every site that offered them wanted me to upload the file or make an account.
Most of these operations don't need a server at all.

So I built ToolHub: 99 tools, 37 of which run entirely client-side. Nothing is uploaded.
Image work goes through Canvas, hashing through WebCrypto, PDF work through pdf-lib,
and a couple of Python/data tools run on Pyodide compiled to WebAssembly.

The rest (62) are links to well-known open-source projects — Squoosh, Excalidraw,
IT-Tools, CyberChef — with a short write-up of what each one actually does. I verified
every URL by hand rather than scraping.

A few things I care about:

- Zero third-party requests by default. No analytics, no fonts CDN, no tracking pixels.
- It works offline. There's a service worker + an installable PWA, so you can load it
  once and keep using it with the network off.
- The site is a static build. No backend, no database, nothing to breach.
- 185 Q&A entries across the tool pages, written per tool — I tried to cover the failure
  modes (why PNG compression barely helps, why your 13-digit timestamp is off by a
  factor of 1000) instead of generic filler.

Stack: no framework, no build step for the app itself, ~84 KB of gzipped assets on first
paint. Tests are a mix of node-driven DOM rendering, real-browser CDP runs, and a
performance budget that fails the build if first paint grows.

https://toolhub.bot.cd

Happy to answer anything about the local-execution approach or the perf work.
```

**发之前**：
- 挑美东时间周二到周四上午 8–10 点（北京时间晚上 8–10 点）。
- 发完 2 小时内要盯着回帖，HN 的排名很吃早期互动。
- **不要**让朋友去 upvote，HN 能识别投票环，会直接沉帖。

---

## 二、r/InternetIsBeautiful

这个版块规则很硬：必须免费、无需注册、标题要带特定前缀。发帖前读一遍置顶规则。

**标题**：

```
A set of 99 open-source tools that run entirely in your browser — no uploads, no sign-up
```

**正文**：

```
Most online converters upload your file to a server, process it, and hand it back. For a
lot of tasks that's unnecessary — the browser can do the work itself.

This site has 37 tools that work that way: image compression, format conversion, PDF
merging, hashing, QR codes, JSON formatting, regex testing. The file never leaves your
machine. You can verify it by turning off your wifi and using the tool anyway.

The other 62 are curated links to open-source projects with official web versions
(Squoosh, Excalidraw, IT-Tools, CyberChef, Tesseract) — each with a page explaining what
it does and where its limits are.

No account, no ads, no analytics, no paywall. It also installs as a PWA and works offline.

https://toolhub.bot.cd
```

**注意**：这个版块讨厌「我的新创业项目」腔调，所以正文里一次都没提"我做了一个产品"，
只讲「这件事本来不需要服务器」。另外它要求**不能是纯广告页**，我们 34 篇教程 + 5 篇横评
这一点反而是加分项，可以提一句。

---

## 三、r/privacy

这个版块对推广极其敏感，**唯一能过的角度是「具体的技术事实」**。不要贴链接当主贴，
把它当技术分享，链接放评论或最后一行。

**标题**：

```
Most "free online PDF tools" upload your file. Here's how to tell which ones don't.
```

**正文要点**（按这个顺序写，别倒过来）：

1. 现象：随便打开几个在线 PDF/图片工具，看 Network 面板——文件被 POST 到一个接口。
2. 判断方法（这是核心价值，不是推广）：
   - 断网后还能用 → 本地执行
   - 打开 DevTools 的 Network，操作一次，没有请求携带文件内容 → 本地执行
   - 页面能装成 PWA 离线用 → 基本可以确定是本地执行
3. 原理：Canvas / WebCrypto / WebAssembly 让浏览器能干以前必须服务端干的活。
4. 我们做了什么：37 个工具走这条路，站上没有任何第三方请求（无字体 CDN、无统计脚本）。
5. 最后一行放链接。

**这个帖子即使不带链接也有价值**——判断方法本身就是干货。带上链接反而要克制。

---

## 四、发布节奏（重要）

**同一天在多个平台群发，是最容易被判定为 spam 的做法。** 按周排：

| 时间 | 动作 |
| --- | --- |
| 第 1 周 | r/InternetIsBeautiful（门槛最低，先验证文案） |
| 第 2 周 | Show HN（挑周二至周四） |
| 第 3 周 | r/privacy（用技术分享角度） |
| 第 4 周 | V2EX / 即刻（中文，用「不传文件」的角度） |

每个平台发完记录：点击数、停留、有没有真实反馈。**没有反馈的渠道就不要重复投**。

---

## 五、发之前自查

- [ ] 手机打开首页，3 秒内可交互（GitHub Pages CDN 已确认）
- [ ] 首屏没有任何 cookie 横幅、弹窗、注册墙
- [ ] `https://toolhub.bot.cd/?q=pdf` 能直接筛出结果（分享链接要能落地）
- [ ] og:image 在社交平台预览正常（用 opengraph.xyz 之类测一次）
- [ ] 站点底部有明确的隐私说明链接

## 六、明确不要做

- **买外链 / 批量友情链接交换**：新站最容易被判作弊，一次惩罚要半年恢复。
- **Product Hunt**：受众以英文 SaaS 为主，中文站转化极低，除非先做英文版。
- **提交一堆「网址导航站」**：最低质的外链，数量涨了权重不涨。
- **找朋友刷 upvote**：HN 与 Reddit 都能识别投票环，后果比不发更糟。
