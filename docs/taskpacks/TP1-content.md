# TP1 · 内容与文案补全

## 目标

站里 30 多个本地工具、50 条资源、5 篇评测（具体数字以 `tools/registry.json` / `resources.json` 为准，会随版本增长）——**功能都在，内容厚薄不齐**。这个包只做内容，不改一行代码逻辑。

做完之后要求达到：任何一个工具页打开，读者能看懂「这东西解决什么问题、我该点哪、哪些地方容易踩坑」，而且英文界面下不会掉回中文。

## 输入

只读、不要改动的参考：

- `docs/TOOL-CONTRACT.md` §5「还需要补的三份内容」——**这是本包的验收口径，先读完再动手**
- `tools/<id>/tool.json`——每个工具的能力边界（参数、输出类型）
- `tools/registry.json`——工具 id 与分类的权威列表

你要改的文件（这几个文件由你独占）：

- `articles.json`——工具页正文：`intro` / `steps` / `faq` / `pitfalls`
- `i18n.json`——`en.tools["<id>"]` 的 `name` 与 `desc`
- `i18n-detail.json`——`en["<id>"]` 的 `usage` / `tips` / `scenarios` / `labels`
- `content/directory-copy.json`——60 个目录工具的落地页正文

## 任务清单

### 1. 补齐 `articles.json` 的硬门槛

`verify.mjs` 会卡这几条，现在的存量条目大多达标，但新增或偏薄的条目会被拦：

| 字段 | 门槛 | 内容要求 |
|---|---|---|
| `intro` | ≥ 60 字 | 说清「这个东西在解决什么真实问题」，不要复述功能名 |
| `steps` | ≥ 3 条 | 每步一个动作，能照着点 |
| `faq` | ≥ 2 条 | 一问一答，问句要像人会问的（"会不会改坏我的文件"），不要"什么是 XX" |
| `pitfalls` | ≥ 2 条 | 每条含 `title` + `body`，写**真实会踩的坑**，不是免责声明 |

**反面例子**（会被打回）：`intro` 写成「本工具用于格式化 JSON，支持美化和压缩。」——这是功能列表，不是内容。

### 2. 英文内容补齐

逐个对照 `tools/registry.json` 里的 id，检查三份文件是否齐全：

- `i18n.json` → `en.tools["<id>"].name` / `.desc`
- `i18n-detail.json` → `en["<id>"].usage` / `.tips` / `.scenarios` / `.labels`

缺的补上。**不要机翻腔**：`usage` 是给人看的使用说明，不是字段说明。

### 3. 目录工具落地页正文

`content/directory-copy.json` 里 60 个目录工具，检查是否有：

- 正文过短（`verify` 里目录页有 400 字门槛）
- 明显的模板痕迹（几个工具正文只换了名字，其余一模一样）

挑最弱的 10 个重写。**要求写这个工具自己的东西**：它的定位、和其他同类比的差别、什么场景下它比我们的本地工具更合适。

### 4. 一个自查工具

`verify.mjs` 只卡字数，卡不住「凑字数」。交付前自己扫一遍：

```bash
node -e "
const a=require('./articles.json');
for (const [id,v] of Object.entries(a)) {
  const i=v.intro||'';
  if (i.length<80) console.log('偏短', id, i.length);
  if (/本工具用于|该工具支持/.test(i)) console.log('模板腔', id);
}
"
```

不够 80 字的、模板腔的，都要重写。

## 不许碰

- `assets/**`、`scripts/**`（一个字符都不要改）
- `tools/<id>/tool.json` 与 `tools/<id>/run.js`（工具能力不归这个包管）
- `tools/directory.json`（那是 TP5 的地盘）
- 现有条目的 id 与键名（只改内容，不改结构）

## 验收

```bash
node scripts/verify.mjs          # 必须「全部通过」（项数随版本增长，不要按写死的数字判断）
node scripts/build-pages.mjs     # 必须成功，页面数不少于 126
```

另外人工抽查：随便挑 3 个你改过的工具页，在浏览器里从首页点进去，读一遍。**如果你自己读着像 SEO 农场，那就还得改。**

## 交付

- `articles.json` / `i18n.json` / `i18n-detail.json` / `content/directory-copy.json` 的改动 diff
- 一份清单：改了哪些 id，每个 id 一句话说明改了什么
- `verify` 与 `build-pages` 的实际输出末尾几行
