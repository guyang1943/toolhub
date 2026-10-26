# TP3 · 无障碍与键盘覆盖

## 目标

站已经能纯键盘走完主流程（搜索 → 进工具 → 填参数 → 运行 → 复制结果），但覆盖是**点状的**：补到哪算哪。这个包把它做成系统的。

判断标准只有一条：**拔掉鼠标，能不能做完所有事，且屏幕阅读器能说清现在在哪。**

## 输入

先读：

- `assets/app.js`——首页与内容页逻辑（搜索、筛选、分页、弹层、快捷键都在这里）
- `assets/tool-page.js`——工具详情页逻辑
- `index.html`——页面骨架（对话层、命令面板、快捷键帮助的 aria 都在这里）
- `scripts/browser-test.mjs` §9.7「键盘全流程」——现有覆盖范围，**照着它的写法加，别另起一套**

你要改的文件（独占）：

- `assets/app.js`、`assets/tool-page.js`（只加 aria 属性、焦点管理、键盘处理）
- `index.html`（只加 aria 属性与 landmark 角色）
- `scripts/browser-test.mjs`（新增断言）

## 任务清单

### 1. 分页条的键盘可用性（v3.4 新功能，优先）

首页工具列表现在是分页的：`#pager` 里是 `.pg-btn` 按钮加 `.pg-info` 说明。需要确认并在缺的时候补上：

- 当前页按钮上有 `aria-current="page"`
- `上一页 / 下一页` 有可读的 `aria-label`（不能只有 `‹` `›`）
- 键盘 Tab 能走到每个页码，Enter/Space 能翻页
- 翻页后焦点不丢：翻完页焦点应该回到页码按钮或列表首卡，**不能掉回 `<body>`**

### 2. 列表与卡片的语义

`#grid` 是一堆 `.card`，`#featured-grid` 是一堆 `.fl-row`。现在都是纯 `div` + `data-id`。需要：

- 卡片容器声明列表语义
- 每张卡有可读名称（屏幕阅读器不该只念「按钮」）
- `j` / `k` 键移动时的 `.kb-focus` 状态要能被读出来（`aria-selected` 或 `aria-current`，任选一种，说明理由）

### 3. 动态结果的可感知性

工具运行完结果出现在 `#tool-result`（已有 `aria-live`）。检查是否所有状态都覆盖：

- 加载中（Python 工具首次要下 13 MB，可能几十秒）
- 报错（`stateHTML('error', …)` 生成的那种）
- 空结果

现在的 `.state` 组件用的是 `role="alert"` / `role="status"`，确认在真实播报下不重复、不抢话。

### 4. icon-only 按钮清点

头部有 `🌐 EN` / `🌙` / `ℹ️` / `➕` / `🔍`（v3.4 新增），卡片上有 `☆`、`↗`，结果区有分享按钮。逐个确认有 `aria-label` 或可见文字。**`aria-label` 要写干什么，不要写图标名**（写「切换到深色主题」，不写「月亮」）。

### 5. `prefers-reduced-motion`

站里有动画：卡片 hover 位移、结果闪烁、分页滚动（`scrollIntoView({behavior:'smooth'})`）。在减少动效偏好下全部降级为瞬变。

### 6. 补断言

在 `browser-test.mjs` 里补至少 8 条，覆盖上面每一项。**写法和现有的一致**：`check('中文说明', 条件, 实测值)`。

## 不许碰

- 任何 `.css` 文件（TP2 正在改，串了会冲突）
- 工具的业务逻辑（`tools/*/run.js`）
- 内容文件（`articles.json` 等）
- 视觉设计（不要顺手调间距、颜色，那是另一个包的事）

## 验收

```bash
node scripts/spa-render-test.mjs                 # 49 项，不能掉
node scripts/browser-test.mjs http://127.0.0.1:8788   # 含你新加的断言
node scripts/audit.mjs http://127.0.0.1:8788     # 对比度与点击区仍然 0 高优
```

人工检查一次：只用 Tab / Shift+Tab / Enter / Esc / 方向键，从首页走完「搜索 → 打开工具 → 填表 → 运行 → 翻页 → 打开命令面板 → 关闭」。**中途焦点不能丢，也不能被困住。**

## 交付

- 代码 diff
- 一张表：每条改动 → 它解决的具体障碍（「分页按钮无 aria-label，读屏只念『‹ 按钮』」这种粒度）
- 新增断言的清单与实测输出
