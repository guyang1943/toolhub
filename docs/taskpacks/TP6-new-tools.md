# TP6：36 个新本地工具（任务包）

## 背景与口径

- 目标：给开发中的 ToolHub 新增 **36 个本地工具**（`runtime=browser`，纯前端，零第三方请求——立站之本，不可破）。
- 去重：已对照现有 38 个本地工具 + 62 个目录工具，无重复；v3.25 规划的 AI 中心 8 个目录工具不在此列。
- 每个工具 = `tools/<id>/` 目录（含 `tool.json` + `run.js` + `index.html`），字段按 `tools/schema.json`。
- 有 `scripts/new-tool.mjs` 脚手架，先用它建目录再填实现。

## 通用规范（实现前重读，不赘述）

- `tool.json` 必填：`id`（目录名一致，2–32 位小写/数字/连字符）、`name`、`desc`（一句话，卡片与搜索用）、`category`（9 个分类之一）、`source`（惯例"内置实现"或"内置实现 (库名)"）、`license`（MIT）。
- `run.js` 的 `manifest` 必填：`inputs`（1–10 个，超 6 个考虑拆成两个工具）、`runLabel`（动词，≤6 汉字）；`usage`/`tips`/`scenarios`/`example` 按 schema 补齐。
- `aliases` 不必手写（`gen-search-aliases.mjs` 生成）。
- 隐私红线：不发任何网络请求（含 data: URL 的 fetch 也不行，见 v3.24 qrcode 教训）；`file` 输入必须写 `accept`；大文件分块处理，页面关闭即释放。
- 工作流教训（v3.24）：输入项**不要带示例默认值**——除非你希望它被工作流引擎自动接走；`files` 返回必须含真 `blob`，不能只有 url。

## 第一批：纯计算工具（12 个，零依赖，先做）

### 1. text-encrypt｜文本加密解密
- desc: AES 加密/解密文本，密码派生密钥，全程本地
- category: 文本 / tags: 加密,AES,隐私
- inputs: text(textarea, 明文或密文), password(text, 密码), op(select: 加密/解密)
- usage: WebCrypto AES-GCM + PBKDF2 派生，密文 Base64 输出，解密需同一密码
- 验收：加密→解密 roundtrip 还原；错密码报错不崩；密码不落盘（刷新即失）

### 2. markdown-table｜Markdown 表格生成器
- desc: 可视化调行列，一键生成 Markdown 表格源码
- category: 文本 / tags: Markdown,表格
- inputs: rows(number, 行数), cols(number, 列数), header(select: 有表头/无表头), align(select: 左对齐/居中/右对齐)
- usage: 改行列数实时预览表格，复制即用
- 验收：行列增减正确；对齐语法 `:---:` 输出正确

### 3. string-escape｜字符串转义
- desc: JS/JSON/URL/HTML/Unicode 转义与反转义
- category: 文本 / tags: 转义,编码
- inputs: text(textarea), mode(select: JS/JSON/URL/HTML/Unicode), dir(select: 转义/反转义)
- usage: 复制代码里的字符串进来，转义后直接粘回源码
- 验收：转义→反转义 roundtrip；Unicode 中文 `\u4e2d` 双向正确

### 4. lorem-kit｜占位文本生成
- desc: 中英文占位文本生成，Mock 页面不用再敲"测试测试"
- category: 文本 / tags: 占位,Mock
- inputs: lang(select: 中文/英文), paras(number, 段落数), kind(select: 段落/标题/句子)
- usage: 选语言与数量，生成可直接用的占位文本
- 验收：中文不断词（按词/短语拼段落）；数量准确

### 5. token-counter｜Token 估算
- desc: 估算提示词的 Token 消耗，调用 AI 前先看成本
- category: 开发 / tags: AI,Token,LLM
- inputs: text(textarea, 提示词), model(select: GPT-4o/Claude/通用)
- usage: 轻量 heuristic 估算；**文案必须写明"近似值，计费以官方 tokenizer 为准"**
- 验收：中英文混合文本估算量级合理；超长文本不卡顿（分块计算）
- 风险：非精确分词，不得宣称精确值

### 6. url-kit｜URL 解析构造
- desc: 解析 URL 各部分，query 参数可视化增删改后重新拼装
- category: 开发 / tags: URL,调试
- inputs: url(textarea, 完整 URL)
- usage: 输出 protocol/host/path/query/hash 表格；query 参数可编辑，改完一键生成新 URL
- 验收：含中文 query 的 URL 编解码正确；hash 保留

### 7. subnet-calc｜子网计算器
- desc: IP + 掩码算网段、广播、可容纳主机数
- category: 网络 / tags: IP,子网,运维
- inputs: ip(text, 如 192.168.1.10), mask(text, 如 24 或 255.255.255.0)
- usage: 输出网络地址/广播地址/可用 IP 数/掩码互转，非法输入给人话报错
- 验收：24/16/8 位常规用例正确；掩码两种写法都认

### 8. xml-format｜XML 格式化
- desc: XML 美化/压缩/合法性校验
- category: 开发 / tags: XML,格式化
- inputs: xml(textarea), mode(select: 美化/压缩), indent(select: 2/4)
- usage: 贴接口返回的 XML，一键美化；非法 XML 指出行号
- 验收：嵌套缩进正确；非法输入报错位置准确

### 9. http-code｜HTTP 状态码速查
- desc: 输入状态码，看含义、常见场景与排查方向
- category: 开发 / tags: HTTP,手册
- inputs: code(text, 如 404)
- usage: 纯数据手册；支持模糊搜（如"超时"反查 408/504）
- 验收：1xx–5xx 全覆盖；常用码（401/403/404/500/502/504）有排查建议

### 10. radix-convert｜进制转换
- desc: 2/8/10/16/36 进制批量互转
- category: 数据 / tags: 进制,转换
- inputs: numbers(textarea, 每行一个), from(select), to(select)
- usage: 每行一个数字批量转，非法行标出不中断
- 验收：大数（>2^53）用 BigInt 不丢精度

### 11. env-parser｜.env 解析
- desc: 解析 .env 文件，标重复键与格式错误，转 JSON/export
- category: 开发 / tags: env,配置
- inputs: text(textarea, .env 内容), out(select: JSON/shell export)
- usage: 贴 .env，重复键标红，合法的一键转 JSON 或 export 语句
- 验收：引号/注释/空行处理正确；重复键定位到行

### 12. css-unit｜CSS 单位换算
- desc: px/rem/em/vw/vh 互转，基准字号可设
- category: 开发 / tags: CSS,前端
- inputs: value(number), from(select), to(select), base(number, 基准 px，默认 16)
- usage: 前端切图时 px→rem 一键换算
- 验收：rem 换算按 base 正确；vw/vh 按 1920×1080 视口折算并注明假设

## 第二批：Canvas / 文件 / 媒体（12 个）

### 13. image-watermark｜图片水印
- desc: 图片加文字水印，位置/透明度/大小可调
- category: 图片 / tags: 水印,版权
- inputs: file(file, accept=image/*), text(text, 水印文字), position(select: 九宫格), opacity(range 0-100), size(range)
- usage: 发公众号/小红书前打水印，Canvas 本地合成
- 验收：九宫格位置正确；透明度实时预览；导出 PNG

### 14. image-merge｜图片拼接
- desc: 多图横向/纵向/网格拼接
- category: 图片 / tags: 拼接,长图
- inputs: files(file, multiple, accept=image/*), dir(select: 横向/纵向/网格), gap(number, 间距), bg(text, 背景色 HEX)
- usage: 聊天记录拼长图、对比图二合一
- 验收：多尺寸图片按最大边对齐；网格列数自适应

### 15. image-filter｜图片滤镜调色
- desc: 亮度/对比度/饱和度/灰度/复古/模糊，一键调色
- category: 图片 / tags: 滤镜,调色
- inputs: file(file, accept=image/*), preset(select: 原图/灰度/黑白/复古/冷色/暖色), brightness(range), contrast(range), saturate(range)
- usage: Canvas 滤镜，发朋友圈前简单调色（inputs 共 6 个，未超上限）
- 验收：预设与手动参数叠加正确；大图（>4K）不卡死（分块或降采样预览）

### 16. image-round｜图片圆角
- desc: 图片变圆角/圆形，加描边
- category: 图片 / tags: 圆角,头像
- inputs: file(file, accept=image/*), shape(select: 圆角/圆形), radius(range), border(number, 描边宽度), borderColor(text)
- usage: 头像/封面快速做圆角
- 验收：圆形按短边裁切；透明底 PNG 保留透明通道

### 17. image-info｜图片信息查看
- desc: 看图片尺寸/格式/体积/EXIF 关键字段，只读不改图
- category: 图片 / tags: EXIF,信息
- inputs: file(file, accept=image/*)
- usage: 收到的图先看尺寸体积再决定压不压；EXIF 显示拍摄时间/机型/GPS 有无
- 验收：HEIC 等不支持格式给人话提示；GPS 只显示"有/无"不展开坐标（隐私）

### 18. palette-extract｜图片取色
- desc: 上传图片提取主色板，输出色卡 + HEX/RGB
- category: 设计 / tags: 取色,配色
- inputs: file(file, accept=image/*), count(select: 4/6/8)
- usage: 做 PPT/海报时从参考图取配色，一键复制色值
- 验收：主色与视觉观感一致（量化算法，中位数切分即可）

### 19. gradient-gen｜CSS 渐变生成器
- desc: 可视化调渐变，输出 CSS background
- category: 设计 / tags: CSS,渐变
- inputs: c1(text, HEX), c2(text, HEX), angle(range 0-360), type(select: linear/radial)
- usage: 实时预览，复制 CSS 即用
- 验收：角度/类型切换实时生效；输出 CSS 语法正确

### 20. shadow-gen｜CSS 阴影生成器
- desc: box-shadow/text-shadow 可视化调参
- category: 设计 / tags: CSS,阴影
- inputs: x(number), y(number), blur(number), spread(number), color(text), kind(select: box/text)
- usage: 拖参数实时看效果，复制 CSS
- 验收：正负偏移正确；inset 选项可加（计入 10 个上限内）

### 21. media-info｜音视频信息
- desc: 本地读取音视频时长/分辨率/编码/体积，不上传
- category: 音视频 / tags: 媒体,信息
- inputs: file(file, accept=video/*,audio/*)
- usage: 发视频前先看码率时长是否超标（video/audio 元素 loadedmetadata）
- 验收：mp4/mp3/webm 常见格式正确；损坏文件给人话报错

### 22. barcode-gen｜条形码生成
- desc: 生成 Code128 / EAN-13 条形码，下载 PNG
- category: 开发 / tags: 条码,商品
- inputs: text(text, 条码内容), format(select: Code128/EAN-13)
- usage: 商品/物料贴条码（JsBarcode，轻量可 vendor）；EAN-13 非法长度给人话报错
- 验收：扫码枪可识别（校验位自动计算）

### 23. date-calc｜日期计算器
- desc: 算两个日期间隔天数，或日期加减 N 天/工作日
- category: 效率 / tags: 日期,计算
- inputs: d1(text, YYYY-MM-DD), d2(text, 可空), op(select: 间隔天数/加减天数/加减工作日), n(number)
- usage: 算项目周期、截止日期；工作日模式跳过周六日
- 验收：闰年 2 月正确；工作日算法排除周末（法定节假日不做，文案注明）

### 24. bmi-calc｜BMI 计算
- desc: 身高体重算 BMI 与体重区间判定
- category: 效率 / tags: 健康,BMI
- inputs: height(number, cm), weight(number, kg)
- usage: 输出 BMI + 偏瘦/正常/超重判定（中国标准）
- 验收：边界值判定正确；非法输入（0/负数）拦截

## 第三批：需第三方库或有风险项（12 个，先确认再做）

> 本批每个条目有"先决条件"，实现前必须先确认，不确定的先问。
> 2026-11-05 已定两条：#32 text-to-pdf 首期仅英文/数字（不嵌字体）；#36 pinyin-convert 运行时数据源用 `tiny-pinyin/dist` 打成的 16 KB 包。其余条目按批次实现时逐条确认。

### 25. json-yaml｜JSON⇄YAML 互转
- desc: JSON 与 YAML 双向转换
- category: 数据 / tags: YAML,转换
- inputs: text(textarea), dir(select: JSON→YAML/YAML→JSON)
- usage: 写 CI 配置、K8s 清单时互转
- 先决条件：引入 js-yaml（轻量，vendor 进仓库，体积计入预算）
- 验收：锚点/多文档等复杂 YAML 不崩，给人话报错

### 26. json-diff｜JSON 语义对比
- desc: 按 key 递归对比两个 JSON，标出增删改
- category: 数据 / tags: 对比,JSON
- inputs: a(textarea), b(textarea)
- usage: 对比接口新旧返回、配置文件 diff（text-diff 是纯文本行对比，这个是语义级）
- 验收：嵌套/数组差异定位到路径（如 `a.b[2].c`）

### 27. sql-format｜SQL 格式化
- desc: SQL 美化/压缩，方言可选
- category: 数据 / tags: SQL,格式化
- inputs: sql(textarea), dialect(select: 通用/MySQL/PostgreSQL), mode(select: 美化/压缩)
- 先决条件：引入 sql-formatter（轻量 vendor）
- 验收：子查询缩进正确；关键字大写可选

### 28. mock-data｜假数据生成
- desc: 生成姓名/手机/邮箱/地址等测试假数据
- category: 数据 / tags: Mock,测试
- inputs: kind(select: 姓名/手机号/邮箱/地址/身份证号), count(number), format(select: 每行一个/CSV/JSON)
- usage: 填表测试、接口联调造数据
- 先决条件：**身份证号必须随机生成且文案醒目标注"仅供测试，非真实号码"**
- 验收：手机号段符合现行号段规则；数量准确

### 29. ascii-art｜ASCII 艺术字
- desc: 英文转 ASCII 艺术字，多种字体
- category: 开发 / tags: ASCII,趣味
- inputs: text(text, 限英文数字), font(select: 3–5 种)
- 先决条件：figlet 精简字库 vendor（只打包 3–5 种字体，控制体积）
- 验收：长文本自动换行不断字

### 30. ua-parse｜UA 解析
- desc: 解析 User-Agent，看浏览器/OS/设备，附复制本机 UA
- category: 开发 / tags: UA,调试
- inputs: ua(textarea, 留空=解析本机)
- usage: 排查兼容性问题时先看 UA；纯正则实现无依赖
- 验收：主流 Chrome/Safari/微信内置浏览器识别正确

### 31. pdf-stamp｜PDF 水印页码
- desc: PDF 加文字水印 / 页码
- category: 文档 / tags: PDF,水印
- inputs: file(file, accept=.pdf), text(水印文字), kind(select: 水印/页码), opacity(range)
- 先决条件：**先确认 pdf-merge 用的 PDF 引擎**（若是 pdf-lib 则复用，不得另引一套）
- 验收：多页 PDF 逐页加；原文字可选状态不变（水印不压坏文本层）

### 32. text-to-pdf｜文本转 PDF
- desc: 纯文本排版生成 PDF
- category: 文档 / tags: PDF,导出
- inputs: text(textarea), title(text), fontSize(select), margin(select)
- 先决条件（已定，2026-11-05）：**首期仅英文/数字**。用 PDF 内置的 Helvetica，不嵌字体、0 新增字节；输入里出现中文时，结果区明确提示「首期仅支持英文/数字」，不静默出乱码。中文子集化方案（fontkit + 中文字体子集）体积约 1.1 MB、且需重编码，暂不采用。
- 验收：分页不切断段落；中文输入给明确提示而不是乱码

### 33. note-local｜本地便签
- desc: 浏览器本地便签，多条、导出、清空
- category: 效率 / tags: 便签,本地
- inputs: （主界面即编辑器，inputs 可仅 1 个 search）
- 先决条件：**必须走 v3.22 统一存储层 `assets/lib/store.js`**（带版本与迁移），不得自建 localStorage 键；隐私页键清单会自动收录
- 验收：刷新不丢失；导出为文本；一键清空走统一清除逻辑

### 34. expense-aa｜AA 分摊
- desc: 聚餐 AA 算账，多退少补一键算清
- category: 效率 / tags: AA,记账
- inputs: bill(textarea, 每行"人名 金额"), payer(text, 垫付人)
- usage: 纯计算，输出谁转谁多少钱（最小转账笔数）
- 验收：3 人以上场景转账方案正确；金额保留两位小数

### 35. pomodoro-kit｜番茄钟
- desc: 专注/休息循环计时，本地提醒
- category: 效率 / tags: 专注,计时
- inputs: focus(number, 分钟), break(number, 分钟), rounds(number)
- usage: setInterval 计时；Notification 需用户授权，**拒绝授权时降级为页面内+标题栏提醒**
- 验收：切后台计时不漂（用时间戳差值而非 tick 计数）

### 36. pinyin-convert｜汉字转拼音
- desc: 汉字转拼音，声调/数字/首字母可选
- category: 文本 / tags: 拼音,中文
- inputs: text(textarea), style(select: 带声调/数字声调/无声调/首字母)
- 先决条件（已定，2026-11-05）：运行时数据源 = `scripts/vendor/tiny-pinyin/dist`（已在仓库里），用 `build-pinyin-bundle.mjs` 打包成 `assets/vendor/pinyin.min.js`，preflight 实测约 16 KB。该预研目录（字体、fontkit、预生成包）已在 v3.25 前清出仓库，**第三批实现时按上述路径重写打包脚本再搬运**，数据源与方案不再重新设计。多音字取常用读法并文案注明。
- 验收：常用 3500 字覆盖；声调标注正确

## 分批与验收链

1. 按第一批→第二批→第三批顺序做，每批一个分支（`feat/tp6-batch-N`），不直接推 main。
2. 每批做完跑全量：`npm run lint`、`npm run verify`、`npm run test:browser`、`npm run test:smoke`、`npm run perf`，全绿才开 PR。
3. 第三批的"先决条件"每项实现前先确认，拿不准的在 PR 描述里写明取舍。
4. 新工具上线后，`README` 工具数与首页统计由构建期闸门同步（v3.22 已有防漂闸门，不要手改数字）。

## 交付

- 本任务包：`docs/taskpacks/TP6-new-tools.md`
- 实现分支：`feat/tp6-batch-{1,2,3}`
- PR 描述里写：本批工具列表 + 验收链结果 + 第三批各项先决条件的确认结论。
