# TP8：v4.0 白标内网发行版（任务包）

> 起点：v3.33（2026-11-09 上线）+ v3.34（教程中心 v2）
> 家底：本地工具 70 · 外链 70（合计 140）· 教程 16 篇 / 127 步 · 资源 8 合集 64 条 · 测评 8 篇 · 工作流 6 条
> 产物：208 个静态页 · sitemap 209 条 · 预缓存 360 个地址 / 5.8 MB · 首屏 95.3 KB / 9 请求
> 本文是执行计划，不是愿景。每片都写「交付什么 / 拿什么验收 / 明确不做什么」。

---

## 结论先行

4.0 不是「做企业版」。企业版要账号、权限、审计、使用记录——**每一样都需要服务端**，
而本站跑在 GitHub Pages（无服务端、无安全头）。真要做等于另起一条产品线。

4.0 要做的是另一件事：**把已经做好的一站，变成「可配置 + 可裁剪 + 可交付」的一包静态文件**。
理由是这件东西已经具备条件——`scripts/lib/pages-registry.mjs` 早就把「本站有哪些页面」
收敛成了一个来源（v3.20 治「七处接线、漏一处不报错」），裁剪只要落在这一层，
下游六个脚本自动跟着走。这是 4.0 唯一便宜的地方，也是它现在才值得做的原因。

一句判断：**4.0 的成败不在配置文件写得多漂亮，在「裁掉一半页面之后，那一包里没有一条死链」。**

---

## 三条硬约束（违反即不做）

1. **不加后端。** 配置在构建期解析，产物只有静态文件。任何「运行时取配置」的设计都否决——
   那等于引入一个必须可用的服务，正是白标客户最没有的东西。
2. **隐私承诺一条不改。** 本地工具仍然 0 字节上传；外链的边界标注与证据机制原样带进包里。
   白标包最容易出的问题就是「客户把外链全放开」而证据字段是空的——闸门必须拦住。
3. **产物必须自洽。** 页面、预缓存清单、sitemap、feed、llms.txt 五处由同一份配置派生。
   任何一处单独手改，都会得到「首页能开、别的 404」那种包。

---

## 现状盘点：哪些东西现在是写死的

| 位置 | 现在写死的东西 | 影响 |
|---|---|---|
| `index.html` / 各页模板 | 站名、`<title>` 后缀、描述、og:image、JSON-LD 的 org 与 url | 白标包必须整套换 |
| `scripts/build-pages.mjs` | `BASE` 域名、sitemap/feed 的 host、CNAME 写入 | 换域名要能一处改完 |
| `scripts/lib/pages-registry.mjs` | 15 个固定页 + 6 个页面族，全部"始终存在" | **裁剪的落点** |
| 导航 `#main-nav` | 5 个入口写死在模板 | 客户不要教程/测评时要能少 |
| `assets/app.js` | 首页 hero、信任区文案、命令面板的页面条目 | 与导航同一份配置驱动 |
| `scripts/gen-sw.mjs` | 从注册表取 core/full，没问题 | 已就绪，不需改逻辑 |
| `_worker.js/`、`CNAME`、`robots.txt` | Pages 专属 | 静态包要换 nginx 口径 |

---

## 切片一：配置化（v4.0.0-alpha）

**交付**
- `toolhub.config.json`（进仓库根，作为默认站点配置）字段：
  - `site`: `name` / `shortName` / `desc` / `baseUrl` / `lang` / `logo` / `theme`（`auto|light|dark`）
  - `nav`: 五个入口的开关与顺序（`tools|workflows|resources|guides|evaluations`）
  - `pages`: 固定页开关（`about|privacy|submit|feedback|compare|changelog|topics|my|batch|offline|workflows`）
  - `families`: 页面族开关（`tools|categories|guides|topics|evaluations|resources`）
  - `directory`: `{ enabled: true, allowExternal: true }`——外链收录是否随包发出去
  - `footer`: 署名行（白标包常要写自己的主体）
- `scripts/lib/site-config.mjs`：读配置 → 校验（未知键报错）→ 导出 `SITE_META`。
  **构建期读一次**，注入模板；不在运行时 fetch。
- 所有消费方改为读 `SITE_META`，不再有第二处硬编码站名。

**闸门**
- `verify` 新增「配置即事实」：`index.html` 的 `<title>`、og:url、canonical、JSON-LD 的 `name/url`、
  `CNAME`、sitemap 的 host、`robots.txt` 的 sitemap 行，七处必须与 `baseUrl` 一致。
  （这一条即使不做白标也该有——现在只靠人记得。）
- 配置里出现未知键 → 构建失败。白标客户改错一个键名，最怕的是"静默无效"。

**不做**：不做多套配置的继承/覆盖（`config.prod.json` 那类）。一份配置一个包，够用。

---

## 切片二：按配置裁剪（v4.0.0-beta）

**落点**：`pages-registry.mjs` 增加一层 `enabled(config)`：
`STATIC_PAGES` 每项带 `key`，`PAGE_FAMILIES` 每项带 `key`，`corePages()/fullPages()/auditPages()/
smokePages()/pagePatterns()/staticPaths()` 全部先过滤再返回。
下游六个消费方（gen-sw / verify / audit / smoke / build-pages）**一行都不用改**。

**数据侧裁剪**（同一份配置驱动）：
- `tools.json` / `directory.json` 按 `families.tools` 与 `directory.enabled` 过滤后再落盘
- 首页入口卡的数字、`/categories/` 的分类、`/compare/` 的候选，全部从**裁剪后**的数据算
- 教程里的 `tools` 引用若指向被裁掉的工具：**构建失败**，不许静默少一行
  （这正是「死链」最隐蔽的来源：教程页里那条 chip 指向一个不存在的页面）

**闸门（这一片的核心）**
- `verify:dist`——用一份**最小配置**（5 个工具、关掉教程/测评/专题/资源/对比、不开外链）
  跑完整构建，然后对产物做静态爬取：
  1. 每个 `.html` 里的站内 `href` 与 `src` 都能在产物里找到对应文件（含 `#anchor` 的页内锚点）
  2. `sw.js` 的预缓存清单与磁盘文件**双向**一致（多一条 = 装到桌面后 404，少一条 = 断网缺页）
  3. `sitemap.xml` / `feed.xml` / `llms.txt` 的条数与产物页数一致
  4. 产物里不出现被裁掉页面的任何引用（导航、页脚、命令面板条目、JSON-LD 的 `hasPart`）
- 反向闸门：最小配置下 `verify`（全量口径）必须**跳过而不是失败**——它守的是主站，不是客户包。

**不做**：不做运行时开关。裁掉就是构建期不生成，页面不存在比 JS 藏起来诚实。

---

## 切片三：打包与交付（v4.0.0）

**交付**
- `npm run dist:dist` → `dist/<name>-<version>.zip`，内含：
  - `site/`（静态产物，含 `sw.js` 与 `offline/`）
  - `nginx.conf`（gzip、缓存头、`sw.js` 不缓存、SPA 回退、**安全头**——这是 GitHub Pages 给不了的那块）
  - `Dockerfile`（`nginx:alpine` + 拷贝，两行）
  - `DEPLOY.md`：《内网部署与校验清单》，含「装完怎么验」的五步（打开首页 / 断网刷新 /
    搜一个词 / 跑一个工具 / 看 `sw.js` 版本）
  - `CHANGELOG.md`（从 `changelog.json` 取最近 3 版，客户要知道这包是哪一天的）
- `dist` 前强制跑 `verify:dist`，不过不出包。

**闸门**
- 打包脚本产出的 zip 要能被**解压后直接跑起来**：CI 里解压到一个临时目录，起 `nginx -t` 校验
  配置语法，并用 `python -m http.server` 起服务跑一遍 `verify-online` 的子集（10 个关键路径全 200）。
- zip 里不许出现源码（`scripts/`、`content/` 原始 JSON、`.git`）。白标客户拿到的是站点，不是仓库。

**不做**：不做在线许可校验、不做远程升级检查、不做遥测。

---

## 风险清单（按「会怎么坏」排）

| 风险 | 会怎么坏 | 处理 |
|---|---|---|
| 五处一致性 | 页面裁了、sitemap 没裁 → 搜索引擎收录 404 | 全部从 `SITE_META` + 注册表派生，闸门 4 条 |
| 死链 | 教程引用了被裁的工具、专题引用了被裁的页面 | 构建期解析引用，缺了就失败 |
| 预缓存 | `offline/` 统计与实际文件不一 | `gen-sw` 已按磁盘扫，闸门做双向比对 |
| i18n | 白标包只留中文，`i18n.json` 却还在发 | `lang` 单语时构建期不产出另一语言文案 |
| Pages 假设 | `_worker.js/`、`CNAME`、`404.html` 口径 | 静态包不带 `_worker.js`，`404.html` 改 nginx `error_page` |
| 证据字段 | 客户加了外链但没核边界 | `allowExternal` 打开时，未核条目必须带 UI 标记（已有机制，闸门要带上） |

---

## 排期建议

| 版本 | 内容 | 验收 |
|---|---|---|
| v4.0.0-alpha | 切片一：配置化 + 「配置即事实」闸门 | 主站零视觉变化，`verify` 全绿 |
| v4.0.0-beta | 切片二：裁剪 + `verify:dist` | 最小配置构建出包，静态爬取 0 死链 |
| v4.0.0 | 切片三：打包、nginx、Dockerfile、部署清单 | 解压即跑，10 条关键路径 200 |

**在 4.0 之前必须先关的三笔账**（它们都随包发出去，包发出去就很难改）：
1. **边界证据**：41/70 仍是 `imported`（2026-11-03 同批写入）。白标包的立站承诺依赖它。
2. **`since` 字段**：34/70 缺失且全仓无读取方——决定「用起来」还是「删掉」，不要带进包里当悬空字段。
3. **探活清单**：新增页面（如 `/guides/` 的分类锚点）要进 `verify-online.mjs` 的 `PATHS`，
   否则包发出去之后没有一条路径被线上验过。

---

## 明确不做

- 账号 / 权限 / 审计日志 / 使用统计：另一条产品线，需要服务端。
- 多租户 SaaS、按客户动态换肤、远程配置下发。
- 把外链收录做成"可运营的目录"（那需要后端与编辑后台）。

这三件写在最前面，是为了挡住「4.0 顺便把企业版做了」这种自然的膨胀。
