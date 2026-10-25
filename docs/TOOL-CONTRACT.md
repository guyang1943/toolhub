# ToolHub 工具接入契约

> 适用版本：v2.8 起。机器可读的规范在 [`tools/schema.json`](../tools/schema.json)，
> 本文件是给人看的那份：为什么这么规定、踩过哪些坑、怎么自查。

一个新工具 = **一个目录**，不碰任何公共文件：

```
tools/<id>/
├─ tool.json     身份与收录信息（必填）
├─ run.js        表单清单 + 执行函数（必填）
└─ index.html    构建产物（由 build-pages.mjs 生成，不要手写）
```

`tools/tools.json` 是这些分片合并出来的**派生产物**，由 `scripts/sync-tools.mjs` 生成。
以前新增工具要改这个中心文件，两个人同时加工具必冲突；现在各写各的目录。

---

## 一、三条硬规则

| 规则 | 为什么 | 不满足会怎样 |
|---|---|---|
| **不发起任何网络请求** | 本地执行是这个站唯一的差异化承诺。一个工具偷偷 `fetch`，整站的可信度就没了 | 构建期直接失败（`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon` / `import('http…')`） |
| **单工具体积 ≤ 200KB** | 一个工具塞进几 MB 的模型或字典，首屏和离线包都会被拖垮 | 构建期失败 |
| **manifest 是对象字面量** | 构建期要静态解析它生成表单、算出错行号 | 解析失败 → 无法构建 |

体积只算你提交的文件（`run.js`、`tool.json` 以及你放进去的素材），**不含** `index.html`。
确实需要的第三方库，先讨论：站内已有 `pdf-lib`、`jsQR`、`marked`、`DOMPurify`、`Pyodide`，
优先复用 `/assets/vendor/` 里的副本，而不是再带一份。

---

## 二、`tool.json`

```json
{
  "id": "exif-strip",
  "name": "照片元数据剥离",
  "desc": "查看并删除照片里的 GPS 定位、机型与拍摄时间，无损不重编码",
  "category": "图片",
  "source": "社区贡献 · 纯浏览器实现（无第三方依赖）",
  "license": "MIT",
  "runtime": "browser",
  "tags": ["exif", "隐私", "图片"],
  "author": "你的 GitHub 用户名",
  "since": "v2.8"
}
```

- `id` 必须等于目录名，且符合 `^[a-z][a-z0-9-]{1,31}$`。改 id 等于换 URL，不要随意改。
- `category` 只接受 `tools/registry.json` 里列出的九个分类。
- `runtime`：`browser`（纯前端）/ `pyodide`（需要先加载 Python WASM，首次联网）/ `link`（外链，只用于 `directory.json`）。
- `author` / `homepage` / `since` 可选。写了 `author`，工具页会显示「社区贡献：xxx」，方便溯源。
- `aliases` 不要手写，跑 `node scripts/gen-search-aliases.mjs` 自动生成。

## 三、`run.js` 的 manifest

```js
export const manifest = {
  inputs: [
    { name: 'files', label: '选择照片（可多选）', type: 'file', accept: 'image/jpeg', multiple: true },
    { name: 'mode', label: '处理方式', type: 'select', default: 'strip', options: [
      { value: 'inspect', label: '只看元数据' },
      { value: 'strip', label: '剥离并下载' },
    ] },
  ],
  runLabel: '开始处理',
  usage: '一句话说明怎么用',
  tips: ['一条真正能帮上忙的提示'],
  scenarios: [{ scene: '什么情况下会用到', how: '怎么操作', result: '得到什么' }],
};
```

字段类型与可用属性：

| type | 额外属性 | 说明 |
|---|---|---|
| `text` | `placeholder`、`default` | 单行输入 |
| `textarea` | `placeholder`、`default` | 多行输入，`Ctrl/⌘+Enter` 可直接运行 |
| `number` | `min`、`max`、`default` | 数字输入 |
| `range` | `min`、`max`、`default`（**必填 min/max**） | 滑杆 |
| `select` | `options`（**必填**）、`default`（必须在选项里） | 下拉 |
| `file` | `accept`（**必填**）、`multiple` | 文件选择 |

会被构建期拦下的写法：

- 写了规范里没有的字段（比如 `help`、`step`）——渲染器不认，写了等于骗自己
- `select` 的默认值不在 `options` 里，或 `options` 的 `value` 重复
- `range` 缺 `min` / `max`，或默认值超出区间
- 字段名重复（`run()` 只收到一个键）

## 四、`run()` 的返回契约

```js
export async function run({ ...values }) {
  return {
    html: '<div class="msg-ok">✅ 完成</div>',   // 必填：结果区展示
    text: '纯文本结果',                            // 可选：给「复制结果」按钮
    files: [{ name: 'out.pdf', blob, kind: 'file' }], // 可选：给「下载」按钮
  };
}
```

- **不要在工具里自己画下载链接或复制按钮**。平台统一渲染操作条，并负责回收 `objectURL`；
  自绘的链接会导致内存泄漏，`verify.mjs` 也会报错。
- `kind: 'image'` 的产物会自动显示预览。
- 文件类工具（多文件输出）走 `files` 数组，平台会渲染「全部下载」。
- 错误用 `throw new Error('人话')`，平台会把消息显示给用户。不要 `alert`，不要静默返回空。

可用样式类：`.msg-ok`（成功）/ `.msg-warn`（提醒）/ `.cmp-table`（表格）/ `.empty`（空态）。

## 五、还需要补的三份内容

工具能跑 ≠ 可以上线。`verify.mjs` 会检查：

| 文件 | 内容 | 为什么 |
|---|---|---|
| `articles.json` | `intro`（≥60 字）、`steps`（≥3）、`faq`（≥2）、`pitfalls`（≥2，含 title/body） | 长尾搜索的落地内容，也是工具页正文 |
| `i18n.json` | `en.tools["<id>"]` 的 `name` 与 `desc` | 英文界面与语言切换 |
| `i18n-detail.json` | `en["<id>"]` 的 `usage`、`tips`、`scenarios`、`labels` | 英文详情页；缺了会退回中文并提示 |

## 六、自查流程

```bash
node scripts/lint-tools.mjs <id>       # 1. 清单合规（秒级，改一行跑一次）
node scripts/gen-search-aliases.mjs    # 2. 生成搜索别名
node scripts/build-pages.mjs           # 3. 生成 /tools/<id>/ 静态页（顺带跑全量清单闸门）
node scripts/verify.mjs                # 4. 全量校验（含内容、内链、结构化数据）
```

也可以直接用提交页的生成器：`/submit/` 上半部分填表单 → 下载 zip → 解压到 `tools/` 下。
生成器用的校验代码与构建期是同一份（`assets/lib/json-schema.js` + `tools/schema.json`），
所以「页面里没报错」基本等于「构建不会拦你」。

## 七、常见拒绝原因

1. **偷偷联网**：换用本地实现，或把数据交给用户自己下载后再处理。
2. **只做外壳**：`run()` 里 `return { html: '敬请期待' }` —— 不接受未完成的工具。
3. **和已有工具重复**：先搜一遍站内（含拼音搜索），重复的只在功能明显更强时合并。
4. **依赖账号或密钥**：需要 API key 的工具不放本地目录（与「不上传数据」冲突）。
5. **正文凑字数**：`articles.json` 里复制功能说明当正文，会被内容守卫打回（目录页 400 字门槛同理）。
