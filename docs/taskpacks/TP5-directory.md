# TP5 · 目录工具扩充与坏链替换

## 背景

站里有 60 个「目录工具」——不是我们自己实现的，是挑出来的第三方开源项目，每个有一条落地页（正文 + 内链 + FAQ 结构化数据）加一个直达官网的链接。这层的价值全在**选的准、链的活**。

这类活是纯数据录入 + 事实核查，最适合外包。但也是最容易做成垃圾的地方：抄一堆 README 介绍塞进去，读者点进来发现没有一句有用的。

## 输入

先读：

- `tools/directory.json`——现有 60 条的结构：`id` / `name` / `desc` / `category` / `url` / `source` / `license` / `tags` / `blurb`
- `content/directory-copy.json`——每条对应的落地页正文
- `docs/TOOL-CONTRACT.md`——了解这个站只收什么样的工具
- `scripts/health-check.mjs` 的注释部分——巡链判定口径（什么算死链、什么只是反爬）

你要改的文件（独占）：

- `tools/directory.json`（加条目）
- `content/directory-copy.json`（加正文）
- `scripts/gen-search-aliases.mjs` 生成的别名文件（由脚本生成，不要手写）

## 任务清单

### 1. 先修坏链（优先于扩充）

```bash
node scripts/health-check.mjs --json r.json --report r.md --fail-on-dead
```

`r.md` 会列出需要人工处理的链接。逐条处理：

- **真的挂了**：找官方新地址（GitHub 仓库 redirect、`releases` 页、项目迁移公告），换 `url`
- **只是反爬（401/403/429）**：不算坏链，不要动
- **项目已归档/停止维护**：不要只换链接，要在这条正文里明确写「项目已归档，最后更新于 X 年，仍可用但没有新功能」——读者有权知道

**这一步的交付必须单独说明**：哪几条换了、换成什么、依据是什么。

### 2. 扩充 12 条新工具

只收满足**全部**条件的：

1. **开源**，且 `license` 能查到（写进字段，查不到就不收）
2. **打开就能用**，不需要注册、不需要 API key、不需要部署（这是本站在首页承诺的东西）
3. **和现有 60 条不重复**（先搜站内，含拼音和别名）
4. 它填的是一个**具体的空位**：现有分类里明显缺的那类，而不是「又一个小工具集合」

字段填写要求：

| 字段 | 要求 |
|---|---|
| `desc` | ≤ 30 字，一句话说清它是什么，不要写「强大」「一站式」 |
| `blurb` | 2～3 句，写**它和其他同类比强在哪、什么场景下值得打开它**。这是落地页正文的主体，也是唯一不能敷衍的字段 |
| `source` | 真实仓库路径，能点开 |
| `license` | 精确到变体（MIT / Apache-2.0 / AGPL-3.0 / GPL-3.0-only …），别写「开源协议」 |

**反面例子**（会被打回）：`blurb` 写「XX 是一个功能强大的在线工具，支持多种格式转换，界面简洁易用。」——这句话可以套在任何一个工具上，等于没写。

### 3. 正文要过内容守卫

`verify.mjs` 对目录页有 400 字正文门槛。别用凑字数的方式过线——正文里应该出现这个工具**特有的**信息：它的限制、它的适用边界、它和站内本地工具的分工（什么时候用它的在线版更划算）。

## 不许碰

- `assets/**`、`scripts/**`（一个字符都不改）
- `tools/<id>/`（本地工具目录，当前 34 个，会随版本增长）
- `articles.json` / `i18n*.json`（那是 TP1 的地盘，会冲突）
- 现有 60 条的 id（只允许改 `url` 和正文里的事实错误，改 id 会让外链和 sitemap 一起断）

## 验收

```bash
node scripts/sync-tools.mjs --check
node scripts/build-pages.mjs          # 页面数与 sitemap 要跟着增加
node scripts/verify.mjs               # 必须「全部通过」（项数随版本增长，不按写死数字判断）
node scripts/health-check.mjs --fail-on-dead   # 不许有新增死链，原有死链要清零
node scripts/smoke-test.mjs http://127.0.0.1:8788
```

人工抽查 5 条新条目：点开落地页，读 `blurb`，再点「直达官网」，确认三件事对得上——**介绍说的、页面写的、官网实际提供的，是同一个东西。**

## 交付

- `tools/directory.json` 与 `content/directory-copy.json` 的 diff
- 坏链处理清单：原链接 → 新链接 → 依据
- 12 条新条目清单：id、名称、分类、为什么选它（一句话）
- `health-check` 与 `verify` 的实际输出
