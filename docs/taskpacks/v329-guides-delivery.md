# T1 交付：教程 5 → 8 篇

> 2026-11-05 夜，分支 `feat/guides-batch-2`（worktree `../toolhub-guides`，端口 8791）。
> 未推 `main`、未合并、未删分支。下面每一条都是跑过的，没跑过的单列在第 6 节。

## 1. 三篇是什么、从哪来

| slug | 标题 | 栏目 | risk | 步数 | 来源 |
|---|---|---|---|---|---|
| `toolhub-image-pipeline` | 把一张图压到 200KB，再转成要的格式 | 工具用法 | low | 7 | **自己写** |
| `ollama-local-ai` | 在自己电脑上跑一个离线 AI 对话（Ollama 篇） | AI 应用 | mid | 8 | **取 origin/muse-guides-batch-2** |
| `cloudflare-tunnel-home` | 把家里的服务安全地放到公网（Cloudflare Tunnel） | 开源部署 | high | 10 | **自己写** |

栏目是路线图里的分类口径，`content/guides.json` 没有 `category` 字段、构建也不渲染它——
所以没有为此新增一个「写了也没人看」的字段。要按栏目分区展示，得先改 `build-pages.mjs` 的总览渲染，
那是另一件事。

`ollama-local-ai` 的处理：只做格式适配（字段顺序、排版风格走 `fmt()`），正文一字未改，slug 未换。
它取自的那一版本来就是 `risk=mid` 且没有 `riskNote`，符合第一节的规则，不需要改。

## 2. 顺手修掉的已知遗留（需要你确认）

`cloudflare-free` 是 `risk=mid` 却带着 `riskNote`。构建只在 `high` 时渲染这个字段，
所以那段「改 NS 前先备份」的警告在两个版本里都是**没人看得见的死数据**。

处理：删掉 `riskNote`，内容并进它的 `prereqs` 第一条（顺序仍是「先说风险、再说动作」），
并在 `verify.mjs` 加断言把它钉住——以后谁给 mid 加 `riskNote`，`verify` 直接红并告诉他该写去哪。

> 注意：主工作区 `main` 上有一份**未提交**的同类改动（`verify.mjs` 的同一段断言 + `guides.json` 的同一处删除，
> 另有 184 个产物文件各多两行空白）。我这份与它等价，但没有动 `main`。你合并时，要么先用主工作区那份、
> 要么用我的，别两边都提交——会撞。

## 3. 新增的闸门

- `verify.mjs`：`risk !== 'high'` 时不得有 `riskNote`。
- `browser-test.mjs`：从总览页按 `href` 找到两篇新的行，**真点一次**再断言（不是 `goto` 直达）；
  高风险篇额外断言 `.guide-risk` 块存在、步骤数与数据源一致。总数 327 → 334。
- `verify-online.mjs`：`PATHS` 补 `/guides/toolhub-image-pipeline/`、`/guides/cloudflare-tunnel-home/`，26 → 28 条。
  这两篇线上坏掉的表现是「少一段」而不是 404，只能靠探活发现。

## 4. 验收（2026-11-05 夜，本机 8791）

| 套件 | 结果 |
|---|---|
| `npm run lint` | ✅ 62 个工具 |
| `npm run verify` | ✅ 73 项 |
| `npm run test:spa` | ✅ 80/80 |
| `npm run test:func` | ✅ 292/292 |
| `npm run test:smoke` | ✅ 189/189 |
| `npm run test:browser` | ✅ 334/334 |
| `npm run perf` | ✅ 首屏 93.2 KB / 9 请求（预算 94.0 / 10） |
| `npm run audit` | ✅ 264 次页面检查无问题 |
| 四道前置闸门 | `check-tool-meta` / `check-submit-schema` / `check-storage-keys` / `check-workflows` 全部 exit 0 |
| `npm run idem` | ✅ 连跑两次 371 个产物零差异 |

`npm run online` **没跑**：新路径要等发版后才有，现在跑只会红，那是 T3 的事。

产物侧：184 个文件只有「多两行空白」的差异（`perf-budget` 之外的老毛病），已逐条核验后还原，
没有混进提交。`offline/index.html` 的字节数与 `sw.js` 的清单随构建更新，属真改动。

## 5. 命令与坑（这次遇到的）

- `npm run serve:fresh` 写死 8765。本轮用 `node scripts/serve.mjs --port 8791`。
- **但 `--no-sw` 会让 `smoke` 红**：它把 `/sw.js` 换成 459 字节的开发桩，冒烟断言「sw.js 缺预缓存清单」。
  跑套件要用不带 `--no-sw` 的 server；只有人工预览才加它。
- `check-all.mjs` 的端口取自 `PORT`（默认 8788），会自己起服务。我按套件逐个指定 `http://127.0.0.1:8791`。
- `content/guides.json` 在工作区是 CRLF、仓库里是 LF（`core.autocrlf=true`）。定点插入要按 CRLF 生成行，
  否则整份文件会被判定为改写。

## 6. 没实测的部分（照实说）

**图片篇**：界面文案、参数档位、产物命名全部对着 `tools/*/run.js` 的 manifest 与 `assets/workflow.js`
读过（不是凭印象），但**没有真的用一张 4MB 照片跑完整条链**去验证「默认参数一定落进 200KB」。
正文因此写成条件句（看结果区体积、超了就降档），没有承诺具体数字。

**Tunnel 篇**：命令与按钮取自 Cloudflare 官方文档（今日抓取：`create-remote-tunnel`、
`self-hosted-public-app`、`downloads`、`remote-tunnel-permissions` 四页），**没有在自己账号里点一遍**。
已知不确定性写在正文里：

- 面板路径有两套叫法（`Networking → Tunnels` 与 `Networks → Connectors → Cloudflare Tunnels`），
  创建按钮 `Create a tunnel` / `Create tunnel`，加路由 `Add route` / `Complete setup`——正文并列写了两套，
  并注明「以你当前面板显示的为准」。
- `service install` 命令原文由面板生成，我只写了形态（Linux `sudo cloudflared service install <令牌>`、
  Windows `cloudflared.exe service install <令牌>`），没有写死版本号或令牌。
- Access 面板的 `Create new application → Self-hosted and private` 是 2026-04 文档的写法，
  旧版是 `Add an application → Self-hosted`，正文同样给了两套。

**Ollama 篇**：正文不是我写的，我**没有重跑**它描述的安装与拉模型流程；只核了字段完整性与
「mid 不带 riskNote」这条规则。它写到的版本号形态（`ollama version is 0.x.x`）与模型名
（`llama3.2:3b`、`qwen2.5:7b`）沿用原文，未复核当前是否仍在模型库里。

## 7. 要你拍板的

1. **第 2 节那处 `cloudflare-free` 的修法**：接受「删字段、内容并进 prereqs」，还是你另有打算？
   （`main` 工作区那份未提交的改动与我的等价，两边只能留一份。）
2. **栏目要不要落成数据字段**。现在四个栏目只活在文档里；要做分区展示得改总览渲染，
   并且得同时补一条闸门（否则又是「写了没人看」）。
3. **`muse-guides-batch-3`**：今晚 `git fetch` 时新出现的分支，里面有 PWA / 手机自动化 / 小程序注册 /
   小程序云开发四篇草稿。这批不在我的任务范围里，没动。下一批要不要用、用哪几篇，你定。
4. **发版节奏**：这三篇是独立主题（内容变厚），`perf` 首屏没动（93.2 KB，余量 0.8 KB）。
   要不要和 T2 的工具批次一起发，还是先发教程。
