# ToolHub — 开源项目工具化平台（v2.3）

把 GitHub 上好用的开源工具"工具化"：无需安装环境、无需命令行，打开网页填参数即出结果。

**当前收录 88 个工具**：28 个本地执行（浏览器内完成，数据不上传）+ 60 个在线直达（知名开源项目官网，URL 已逐个拨测验证）。另有 6 个资源合集（50 条）、10 个专题、5 篇工具横评、28 篇使用教程。

## 架构（可扩展核心）

- **平台本体零工具**：所有工具通过 **Manifest 规范** 接入，平台自动渲染表单 UI 与结果区。
- **纯浏览器执行**：所有计算在用户本地完成，数据不上传（隐私卖点 + 零服务器成本）。
- **接新工具 = 新建目录**：`tools/<工具id>/run.js`，导出 `manifest`（声明输入参数）和 `run()`（执行逻辑），平台代码零改动。

```
toolhub/
├── index.html            # SPA 骨架（History API 路由）
├── assets/
│   ├── style.css
│   ├── app.js            # 注册表 / 搜索 / Manifest→表单渲染 / 路由 / 命令面板
│   ├── pyodide-runtime.js  # Pyodide 共享运行时（多 Python 工具复用）
│   └── vendor/           # 本地化的开源库（qrcode / marked / purify / jsQR / pdf-lib / pyodide）
├── tools/
│   ├── tools.json        # 本地工具注册表（Manifest 元信息，28 个）
│   ├── directory.json    # 在线目录：60 个开源项目官网（URL 已验证）
│   └── <工具id>/run.js   # 每个工具一个目录
├── topics.json           # 10 个专题（按场景打包工具 + 资源 + FAQ）
├── evaluations.json      # 5 篇工具横评（隐私/速度/功能取舍）
├── articles.json         # 28 个本地工具的长尾教程（简介+步骤+常见错误+FAQ）
├── resources.json        # 6 个资源合集 / 50 条（逐条标注授权）
├── changelog.json        # 更新日志数据
├── scripts/              # build-pages / verify / smoke-test / health-check / release / spa-render-test / new-tools-test
├── topics/ evaluations/ resources/ tools/<id>/   # 构建生成的静态 SEO 页
└── wrangler.toml         # Cloudflare Workers 静态资源部署配置
```

## Manifest 字段

输入类型：`text` / `textarea` / `number` / `select` / `range` / `file`（`multiple: true` 支持多选）
工具可选导出 `onForm(form)`：表单渲染后做联动（如单位换算的「类型 → 单位」下拉、PDF 工具的按模式显隐字段）
运行时：`browser` / `pyodide`（浏览器内 Python）

## 本地运行

```bash
cd toolhub
python -m http.server 8765
# 打开 http://localhost:8765
```

## 部署

直接把整个目录作为静态站点上传 Cloudflare（Workers Upload assets / Pages Direct Upload 均可）。

## 路线图

- [x] MVP：骨架 + Manifest 加载器 + 3 个本地工具
- [x] v0.2：9 个本地工具 + 46 个在线开源工具目录（URL 全验证）+ 混合展示（本地优先排序、双徽章）
- [x] v1.x：双语 / PWA / SEO 静态页 / 资源库 / 工具对比 / 命令面板 / 专题
- [x] v2.x：内容纵深（10 专题 + 5 篇横评 + 24 篇教程）
- [ ] 服务端沙箱（B 类运行时，支持 CLI/Python 项目）
- [ ] 工具提交通道 + 自动抓取 GitHub 元信息
- [ ] 目录链接定期健康检查（可挂定时任务）
- [ ] 绑定自定义域名（tools.sitool.eu.org，等用户确认）

## v0.6 更新（2026-10-24）
- 深色/浅色主题切换（记忆偏好，默认跟随系统）
- ⭐ 收藏：本地 localStorage 保存，卡片右上角星标，chips 出现"⭐ 收藏"筛选
- 新增页面：`#/about`（关于/架构说明）、`#/submit`（推荐工具标准与模板）
- SEO：description / Open Graph / SVG favicon / theme-color，工具页动态更新标题
- 体验：分类写入 URL（刷新保持）、搜索时隐藏推荐区、空结果一键重置、卡片等高（line-clamp）、`/` 聚焦搜索、`Esc` 清空、回到顶部按钮

## v0.7 更新（2026-10-24）
- 新增 4 个本地工具（共 16 本地 / 76 总计）：
  - Cron 解析（零依赖实现：人话解释 + 未来执行时间，已通过算法测试）
  - JWT 解码（Base64URL 解码 + exp/iat 过期提醒 + 明确不校验签名警告）
  - CSV ↔ JSON（正确处理引号包裹的逗号/换行，双向转换）
  - 图片缩放（等比缩放到最大边长，输出 JPEG/PNG/WebP）
- 最近使用：自动记录最近 8 个本地工具，首页提供 🕘 快捷入口
- PWA：`site.webmanifest` + `sw.js`（HTML 网络优先、静态资源缓存优先），可离线使用、可安装到桌面
  - ⚠️ 每次发布更新时请递增 `sw.js` 里的 `VERSION`，否则浏览器可能读到旧缓存
- 工具页：🔗 一键复制分享链接、Ctrl/⌘ + Enter 快捷执行

## 已知限制
- `*.workers.dev` 在中国大陆不可直连，需绑定自定义域名（如 tools.sitool.eu.org）
- Python 运行器首次使用需下载 Pyodide WASM（约 10MB），且离线时不可用

## v0.8 更新（2026-10-24）
- 🐞 修复：首页"高频推荐"卡片无法跳转（`bindCards` 只匹配 `.card`，漏了 `.featured-card`，已统一改为按 `[data-id]` 绑定）
- 🔥 最常用：本地统计每个工具的运行次数（localStorage），chips 出现"🔥 最常用"按次数排序；工具页显示"本机用过 N 次"
- 关于页新增「数据与隐私」说明：无后端数据库、统计仅存本地、访问统计不用 Cookie
- `sw.js` VERSION → toolhub-v0.8

## v0.9 更新（2026-10-24）
- 工具页新增「📖 使用场景」（可折叠）：每个场景 = 场景 → 做法 → 结果，已覆盖 9 个核心工具
- 首页 Hero 统计条：精选工具数 / 本地执行数 / 分类数 / 数据上传 0，附「🎲 随便看看」随机发现
- 卡片显示「用过 N 次」角标（本机统计）
- 工具页新增「🌐 同类在线工具」推荐（跳转目录工具的官网）
- `sw.js` VERSION → toolhub-v0.9
- 任务导向入口「我想…」：图片处理 / PDF / 编解码 / 调试接口 / 数据转换 / 写文档 / 画图 / 跑代码（不依赖分类概念，直击需求）

## v1.0 更新（2026-10-24）
- **中英双语（浏览层）**：右上角 🌐 切换，记忆偏好。覆盖首页/分类/任务入口/卡片名称与简介/徽章/空态/页脚，**76 个工具全部英译**
  - 工具详情页的说明/贴士/场景/表单标签目前仍为中文，英文模式下会显式提示（下一版本补齐）
- 16 个本地工具全部补齐「📖 使用场景」（每个 3 条：场景 → 做法 → 结果）
- 搜索同时匹配中英文名称与简介
- `sw.js` VERSION → toolhub-v1.0

## v1.1 更新（2026-10-24）
- **详情页全英译**：新增 `i18n-detail.json`，18 个本地工具的 usage/tips/scenarios/表单标签/按钮全部英译；英文模式不再出现"仅中文"提示
- **Pyodide 共享运行时** `assets/pyodide-runtime.js`：多 Python 工具复用同一 WASM 实例，避免重复下载
- **新增 2 个"白名单"Python 工具**（共 18 本地 / 78 总计）：
  - 数值统计 `py-stats`：Python statistics 计算均值/中位数/标准差/四分位（标准库，无额外下载）
  - CSV 数据体检 `pandas-csv`：pandas 分析行列数/类型/缺失值/统计摘要（首次加载 pandas ~20-40s）
- `sw.js` 缓存清单补齐 i18n 与运行时模块，VERSION → toolhub-v1.1

## 已知技术债（重要）
1. **hash 路由不利于 SEO**：`#/tool/xxx` 不会被搜索引擎独立收录，`document.title` 的 JS 动态修改爬虫也常忽略 → 需改为 path 路由 + SPA fallback，或为每个工具生成静态落地页
2. 缺 `sitemap.xml` / `robots.txt`
3. 目录链接巡检脚本需手动运行（可挂 GitHub Action 定时）
4. i18n 覆盖率无自动校验（工具新增时容易漏翻译）

## v1.2：SEO 地基（2026-10-24）
- **路由改为 History API**：`/tools/json-format/`、`/about/`、`/submit/`（旧 `#/tool/x` 链接自动 301 到新路径）
- **静态页面生成器** `scripts/build-pages.mjs`：为 18 个工具 + 关于/提交页生成独立 HTML（独立 title/description/OG/canonical + 爬虫可见正文），并输出 `sitemap.xml` 与 `robots.txt`
- 爬虫正文块 `#seo-static`：JS 接管后自动移除，不影响用户体验
- 域名绑定后必须重跑：`node scripts/build-pages.mjs https://你的域名`（更新 canonical/sitemap）
- `sw.js` VERSION → toolhub-v1.2

## v1.3：P2–P4 内容、反馈与品牌（2026-10-24）
**P2 内容层**
- 新增 `content/articles.json`：18 个本地工具各一篇原创长尾正文（是什么 + 2 条 FAQ，约 500 字/页）
- 构建脚本把正文 + FAQ 注入静态页 `#seo-static`，并为每页注入 **JSON-LD**（SoftwareApplication + FAQPage）
- sitemap 扩至 22 条（含 /feedback/）

**P3 反馈入口**
- 新增 `/feedback/` 页面：反馈模板一键复制 + 邮件发送（无后端方案，不采集任何数据）
- 页脚新增反馈入口

**P4 品牌差异化**
- 首页新增「🔒 为什么本地执行更放心」信任区（3 条卖点）
- 关于页新增四维对比表（ToolHub 本地工具 vs 普通工具站 vs 自己装环境）

**工程改进**
- `health-check.mjs` 增加重试机制（每 URL 2 次 + 800ms 间隔），误报从 7 个降到 2 个（剩余 2 个为检查机出口限制）
- `smoke-test.mjs` 覆盖 34 条关键路径
- `sw.js` VERSION → toolhub-v1.3

## v1.4：目录页 + 6 个新工具（2026-10-24）
- **目录工具也生成独立页面**：84 个工具全部有 `/tools/<id>/`（含 title/description/canonical/JSON-LD），sitemap 88 条
- 卡片交互调整：目录工具点击进站内详情页（利于收录），卡片右上角 ↗ 可直接打开官网；详情页有大号"打开官网"按钮与第三方归属说明
- **新增 6 个本地工具（本地 24 / 总计 84）**：正则测试器、命名风格转换、文本去重排序、字数统计、图片转 Base64、颜色对比度检查
- 这 6 个工具同步补齐：中英名称简介、英文详情（24/24）、长尾内容（24/24）
- `sw.js` VERSION → toolhub-v1.4

## 待补充清单（已知）
- 社交分享无预览图（缺 og:image）
- 无 iOS 用 PNG 图标（当前仅 SVG data URI）
- 无 404 页面
- 无安全响应头（CSP 等，可用 Cloudflare `_headers`）
- 校验脚本未接入 CI（本地手动跑）

## v1.5：社交预览图 + 404 + 安全头 + 全检脚本（2026-10-24）
- **og:image**：`scripts/build-og.py`（Pillow 本地绘制，不消耗图像生成额度）生成 `assets/og.png`(1200×630)、`og-en.png`、`icon-512.png`、`icon-180.png`
  - 页面统一接入 `og:image`（绝对地址）、`twitter:card=summary_large_image`、`apple-touch-icon`
- **404 页**：`404.html`（跟随系统深色、返回首页 + 反馈 + 6 个常用工具入口）
  - ⚠️ Cloudflare Worker 需把 Not found handling 设为 `404-page` 才会生效
- **安全响应头**：`_headers`（nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy + 缓存策略）
- **全量校验脚本** `scripts/verify.mjs`：17 项检查（数据完整性、覆盖度、静态页 meta、sitemap 一致性、资源存在、占位残留、sw 版本），失败退出码 1 可接 CI
- `sw.js` VERSION → toolhub-v1.5

## 发布前检查清单（一条命令）
```bash
node scripts/build-pages.mjs        # 生成静态页与 sitemap
node scripts/verify.mjs             # 24 项全量校验
node scripts/spa-render-test.mjs    # SPA 渲染测试（需先起本地服务器）
node scripts/smoke-test.mjs <URL>   # 部署后 59 条路径冒烟
node scripts/health-check.mjs       # 110 个链接健康巡检
```

## v1.6：一键发布 + 编辑推荐语（2026-10-24）
- `scripts/release.mjs`：一条命令完成「生成静态页 → 17 项校验 → 自动递增 sw 版本 → 打包到桌面」
  - 用法：`node scripts/release.mjs [https://正式域名] [--skip-build]`
  - Windows 可直接双击 `release.bat`（已写好，带暂停便于看结果）
- 15 个热门目录工具新增「编辑推荐」文案：讲清它解决什么问题、适合什么场景（如 Squoosh 的左右对比、BentoPDF 的本地处理）
  - 站内详情页与静态页正文都会展示，提升内容厚度与收录质量

## v1.7：工具对比（2026-10-24）
- 新增 `/compare/` 页面：最多 4 个工具并排对比，维度 = 运行方式 / 数据流向 / 离线可用 / 是否需要注册 / 输入形式 / 主要输出 / 开源协议 / 来源 / 分类 / 打开入口
- 底部「对比栏」：任意工具页点「⇄ 加入对比」→ 底部浮出已选清单 → 一键进入对比页（localStorage 持久化，最多 4 个）
- 选择器联动 URL（`/compare/?ids=a,b,c`），可分享对比结果
- 默认无选择时给出 3 个同类工具示例（图片压缩 / Squoosh / 图片缩放），避免空白页
- 静态页 + sitemap 同步（89 条）；`/compare/` 已加入冒烟测试（41 条路径）

## v1.8：资源库板块（2026-10-24）
- 新增一级板块 `/resources/`：与「工具」并列。定位差异 = 工具用来「做事」，资源用来「拿来用 / 下载 / 参考」
- 首期 3 个合集 **共 26 条资源**（全部 URL 实测 + 逐条标注授权与来源）：
  - 免费图标库（10）：Lucide / Icones / Simple Icons / Tabler / Iconify / Remix / Heroicons / Phosphor / Feather / Iconfont
  - 免费商用字体（8）：阿里普惠体 / MiSans / HarmonyOS Sans / 得意黑 / 站酷 / Inter / JetBrains Mono / Font Squirrel
  - 配色方案（8）：Radix Colors / Open Color / ColorBrewer / OKLCH / Tailwind / UI Colors / Color Hunt / Huemint
- 每个合集包含：编辑导语、✦ 编辑精选、全部来源（授权徽章 + 推荐理由）、「怎么选」、配套工具、授权说明
- **版权策略**：只做整理与外链，不镜像不托管；每条强制标注 license；接入 `verify.mjs` 的 3 项强制检查（结构 / 授权标注 / 静态页）
- 静态页 + sitemap 同步（92 页 / 93 条）；`/resources/` 系列加入冒烟（45 条路径）

## v1.9：资源库扩充到 6 合集 / 50 条（2026-10-24）
- 新增 3 个合集（各 8 条，全部 URL 实测 + 逐条授权标注）：
  - 📘 学习路线与免费课程：roadmap.sh / freeCodeCamp / MDN / 廖雪峰 / CS50 / Exercism / 中国大学 MOOC / 菜鸟教程
  - 🌟 值得收藏的开源项目清单：HelloGitHub / 阮一峰周刊 / OSS Insight / Trendshift / LibHunt / 开源中国 / Gitee / GitCode
  - 📑 模板与设计素材站：吾道 / 稿定 / Slidesgo / 优品PPT / 第一PPT / Overleaf / ProcessOn / Canva
- ⚠️ 模板合集在导语与「怎么选」中明确警示：**免费 ≠ 可商用**，商用须确认单模板授权
- 健康巡检升级：覆盖 110 个链接（工具 60 + 资源 50）、并发 8 路、3 次重试（1s/2s 退避）、状态分三档（✅正常 / 🟡疑似反爬 / ⛔需处理）
- 静态页 95 页 / sitemap 96 条；冒烟 48 条路径

## 🚀 部署方式（已打通 CLI 部署）
**方式一：双击 `deploy.bat`**（构建 → 校验 → 部署，一步到位）

**方式二：命令行**
```bash
cd toolhub
node scripts/build-pages.mjs          # 生成静态页
node scripts/verify.mjs               # 20 项校验，失败会中断
npx wrangler deploy --config wrangler.toml
```
- 账号：guyang1966@hotmail.com（Account ID `14de3bc0539c3b72a5ee6a6db19f820f`）
- 凭证保存在 `C:/Users/huwei/AppData/Roaming/xdg.config/.wrangler/config/default.toml`
- `wrangler.toml` 已配置 `not_found_handling = "404-page"`（404 页生效）与 `html_handling = "auto-trailing-slash"`（目录索引生效）
- `.assetsignore` 排除 scripts/、README 等开发文件，不发布到公网（数据 JSON 在根目录，需发布）
- 撤销授权：Cloudflare → My Profile → Connected Apps

## v2.0：首页改版 + 命令面板 + 专题 + 更新日志 + API/RSS（2026-10-24）
- **首页轻改**：搜索移到首屏中央（与头部搜索双向同步）、新增「三类内容」路由卡（工具/资源库/对比）、主导航加「专题」、页脚加更新日志入口
- **⌘K / Ctrl+K 命令面板**：一次搜索工具（本地/在线分类标注）、资源合集与页面；↑↓ 选择、Enter 打开、Esc 关闭、点击遮罩关闭
- **专题合集**：`/topics/` + 3 个专题（前端调试工具包、图片处理全流程、数据清洗与转换），含「按顺序用」步骤、配套资源、常见问题
- **更新日志**：`/changelog/`，数据在 `changelog.json`，含 5 个版本记录
- **示例数据一键填入**：工具页「⌨ 示例」按钮，按 manifest.example 或 default 填充（文件输入跳过）
- **嵌入模式**：工具页「</> 嵌入」复制 iframe 代码；`?embed=1` 隐藏站点外壳，可被第三方页面引用
- **公开 API**：`/api/tools.json`（84 条，含 id/name/desc/category/runtime/url/source/license/tags）
- **RSS**：`/feed.xml`（最新 12 个工具）
- 校验扩到 **23 项**，冒烟 **53 条**；sitemap 101 条，静态页 100 个
- 部署：wrangler v `ac5906fa`，线上验证 `/`、`/topics/`、`/changelog/`、`/api/tools.json`、`/feed.xml`、`?embed=1` 全部 200

## v2.1：专题扩到 10 个 + 工具评测板块（2026-10-24）
- **专题 3 → 10**：新增写作工具箱、接口联调试探、开源替代品清单、职场效率工具包、开发者速查手册、隐私与安全工具箱、设计与配色；专题可混合引用本地与目录工具（目录工具显示「官网」徽章）
- 校验升级：每个专题强制「常见问题 ≥2 条」+ 静态页必须存在
- **新增「工具评测」板块** `/evaluations/`：5 篇同类工具横向实测（图片压缩 / Markdown 编辑器 / PDF 工具 / 密码工具 / JSON 工具），每篇含结论框、逐项隐私徽章（完全本地/本地为主/需上传）、优势短板对比与详细解读
- 评测数据在根目录 `evaluations.json`（运行时加载）；静态页带 Review JSON-LD，进 sitemap
- 主导航、首页路由卡（3→4 张）、命令面板全部接入评测入口
- 新增 `scripts/spa-render-test.mjs`：DOM 桩 + 模块钩子真实加载 app.js 驱动路由，15+ 项渲染断言（首次引入）
- 静态页 113 个 / sitemap 114 条 / 校验 24 项 / 冒烟 59 条

## v2.2：24 个工具教程升级（2026-10-24）
- 每个本地工具详情页新增「📝 使用步骤」（3-5 步）与「⚠️ 常见错误」（2-3 条）两个教程板块
- 长尾正文结构升级为：简介 + 使用步骤 + 常见错误 + FAQ；SPA 与 SEO 静态页消费同一份 `articles.json`
- `articles.json` 从 `content/` 移到根目录（`.assetsignore` 原本会把它排除出部署包，导致运行时 404）
- 校验加强：步骤 <3 或常见错误 <2 无法通过构建
- 静态页 113 个 / sitemap 114 条 / 校验 24 项 / 冒烟 59 条 / SPA 渲染测试 17 项
- 部署：wrangler v `f4140c68`

## v2.3：4 个高频刚需本地工具 + 坏链修复 + 无障碍基础（2026-10-25）
- **新增 4 个本地工具**（本地 24 → 28，全站 84 → 88）：
  - **个税计算器** `tax-calc`：工资薪金按累计预扣法逐月计算，含子女教育/婴幼儿照护/赡养老人/住房/继续教育五项专项附加扣除，输出当月个税、税后到手与全年 12 个月预测表（合计 = 年度应纳税额）
  - **单位换算** `unit-convert`：长度/面积/体积/质量/温度/速度/时间/数据/压力/功率/能量/角度 12 类 70+ 单位；温度走线性公式而非系数；附带同类单位全量对照表
  - **二维码解析** `qr-decode`：jsQR 本地解码，图片不上传；识别网址/WiFi/vCard 等内容类型，在原图上红框标注识别位置，支持反色码
  - **PDF 合并拆分** `pdf-merge`：pdf-lib 本地处理，支持多文件合并（按选择顺序）、按页码提取（`1,3,5-8`）、按固定页数拆分；加密文件友好报错
- **平台能力**：`file` 输入支持 `multiple`；新增 `onForm` 渲染后联动钩子；jsQR（257KB）与 pdf-lib（525KB）按需注入，不给每个页面增加负担
- **测试**：新增 `scripts/new-tools-test.mjs` 41 项功能测试——个税数学手工核算（含高税率档、起征点以下）、单位换算精度（含绝对零度/2 进制容量）、真实 pdf-lib 合并/提取/拆分（含越界与非法片段）、真实 jsQR 解码（Python 生成二维码 + 反色 + 噪声图）
- **坏链**：巡检 110 条（104 正常 / 3 反爬 / 3 异常）。`playground.prettier.io` → `prettier.io/playground/`；CyberChef 镜像 → 官方 `cyberchef.org`；HackMD（国内不可达）→ **CryptPad**（端到端加密协作，AGPL），同步更新横评与 i18n
- **无障碍**：skip link + main landmark、导航/搜索/按钮/命令面板 aria-label、结果区 `aria-live`、`:focus-visible` 焦点样式、`prefers-reduced-motion`；工具卡片由 `div+onclick` 升级为 `role=link + tabindex + Enter/Space`（原先键盘完全无法打开）
- 静态页 117 个 / sitemap 118 条 / 校验 25 项 / 冒烟 61 条 / SPA 渲染 34 项 / 功能测试 41 项
- `sw.js` VERSION → toolhub-v2.3
- **部署**：wrangler v `766b484a`。首次部署发现 `.git/` 被当作静态资产上传（1044 个资产，公网可下载完整提交历史），已在 `.assetsignore` 补 `.git/ .wrangler/ node_modules/` 并重新部署（189 个资产），verify 增加第 26 项「部署安全」守卫
- 本机网络无法直连 `*.workers.dev`（DNS 污染）与代理白名单限制，`smoke-test.mjs` 需在可访问网络或绑定 `sitool.eu.org` 后执行
