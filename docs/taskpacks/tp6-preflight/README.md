# TP6 两个前置决策：已验证的结论（2026-11-05）

两个问题都已按仓库现状逐项验证，不用再"评估"，直接拍板即可。
本目录文件都在分支 `muse-tp6-preflight` 下（`docs/taskpacks/tp6-preflight/`），是 staging，
WorkBuddy 实现时再搬到正式位置（`assets/vendor/` 等）。

---

## 决策一：text-to-pdf 中文要不要做

**结论：做，技术上已端到端验证通过。备选是首期仅英文（0 成本）。**

### 验证过的事实

1. PDF 引擎确认是 **pdf-lib**（`tools/pdf-merge/run.js` 在用，`/assets/vendor/pdf-lib.min.js` 525KB，
   MIT，已是懒加载模式）。text-to-pdf 复用同一套，不另引引擎。
2. 中文需要两样东西：(a) CJK 字体文件；(b) **fontkit**（pdf-lib 挂自定义字体必须
   `registerFontkit`，仓库 `assets/vendor/` 里还没有，本目录附了 `fontkit.umd.min.js`，MIT）。
3. 子集字体已生成并验证（本目录 `NotoSansSC-subset.ttf`，1.17MB）：
   - 来源：Noto Sans SC（OFL 1.1，允许子集化/嵌入/再分发，许可证见 `OFL.txt`）
   - 取 wght=400 静态实例（源文件是可变字体，默认实例是 Thin，必须先实例化；
     可变字体 pdf-lib 也不会做二次子集——实测会把 1.8MB 整个嵌进去）
   - 字符集：通用规范汉字表**一级字表 3500 字** + ASCII + CJK/全角/半角标点 = 4106 字形，
     3500 字 0 缺失（cmap 逐字验过）
4. 端到端验证（node，pdf-lib + @pdf-lib/fontkit，与仓库版本同系列）：
   `embedFont(bytes, { subset: true })` → 44 字中文测试 0 缺字形 →
   输出 PDF **7.2KB**（只含用到的字形），Type0 + CIDFontType2 + ToUnicode（文字可选可复制）。
5. **两个坑，已踩过**：
   - `embedFont` 对自定义字体默认 `subset: false`，不传 `{ subset: true }` 会把 1.17MB 整个嵌进每个 PDF。
   - 首屏预算零影响：`perf-budget.mjs` 只量首屏资源；字体和 fontkit 都是工具运行时懒加载
     （已有 pdf-lib 525KB、jsQR 257KB 懒加载先例；vendor 库本来就不允许进首屏）。
6. 体积账：fontkit 758KB（~250KB gzip）+ 字体 1.17MB（~500KB gzip），合计约 1.9MB，
   text-to-pdf 首次用中文时一次性懒加载，之后走缓存。

### 给 WorkBuddy 的接入规格（Guyang 选"做中文"后执行）

1. 把 `NotoSansSC-subset.ttf`、`fontkit.umd.min.js` 搬到 `assets/vendor/`（许可证文字随包：OFL.txt 放字体旁）。
2. `run.js` 里懒加载（照抄 `tools/pdf-merge/run.js` 的 `loadPdfLib` 模式）：
   先加载 fontkit（挂 `window.fontkit`），再 fetch 字体得 ArrayBuffer。
3. `pdfDoc.registerFontkit(window.fontkit)`；
   `const font = await pdfDoc.embedFont(fontBytes, { subset: true })` —— subset:true 必写。
4. 中英文分流：`/[一-鿿]/.test(text)` 才走自定义字体；纯英文/数字继续用 Helvetica（0 新增字节）。
5. 缺字处理：3500 字以外的生僻字，fontkit 查不到字形时给人话提示（"含未覆盖的生僻字"），
   不静默出 tofu。
6. 验收：一段中文长文输出的 PDF < 50KB；ToUnicode 存在（`pdftotext` 能提出文字）；
   英文路径不触发字体/fontkit 加载。

### 备选（Guyang 选"首期仅英文"）

Helvetica 内置字体，0 新增字节；text-to-pdf 的文案写明"首期仅英文/数字"，
中文输入给明确提示。本分支文件届时直接删掉即可。

### 字体再生命令（复现用，不用记，备查）

```bash
# 1. 下载 Noto Sans SC（OFL）
curl -L -o NotoSansSC.ttf "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
# 2. 准备字符集：通用规范汉字表一级字表 3500 字 + ASCII(0x20-0x7E) + CJK 标点(0x3000-0x303F)
#    + 全角(0xFF00-0xFFEF) + 常用标点(0x2000-0x206F) + Latin-1(0xA0-0xFF) -> subset-text.txt
# 3. 实例化为 wght=400 静态字体（可变字体默认是 Thin，不能直接子集）
python3 -c "
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont
f = TTFont('NotoSansSC.ttf')
instantiateVariableFont(f, {'wght': 400}).save('NotoSansSC-Regular.ttf')"
# 4. 子集化
python3 -m fontTools.subset NotoSansSC-Regular.ttf --text-file=subset-text.txt \
  --output-file=NotoSansSC-subset.ttf --layout-features='*' --no-hinting --desubroutinize
```

---

## 决策二：pinyin-convert 运行时拼音数据源

**结论：复用仓库已 vendor 的 tiny-pinyin（MIT），构建期打成浏览器包（本目录已打好）；
但输入里的"带声调/数字声调" v1 做不了——字典里物理上就没有声调数据。**

### 验证过的事实

1. `scripts/vendor/tiny-pinyin` 已在构建期使用（`scripts/gen-search-aliases.mjs` 给工具生成拼音别名），
   MIT 协议，复用它 = 零新增依赖、零第三方请求，符合本地工具红线。
2. 字典逐项验证：411 个音节，**0 个带声调数字**（脚本扫过 `PINYINS` 数组）。
   所以"带声调/数字声调"用这个库做不出来——不是工作量问题，是数据源没有。
3. 覆盖：6763 常用字（上游 README 声明）；多音字不支持，取常用读法（任务包验收里已写"文案注明"）。
4. 浏览器包已生成并验证（本目录 `pinyin.min.js`，16.8KB 未压缩，远小于任务包定的 100KB 目标）：
   - 打包方式：`build-pinyin-bundle.mjs` 把 dist 下 6 个 CJS 文件拼成一个 IIFE，
     极简 require shim，挂 `window.Pinyin`（Safari 补丁逻辑原样保留）。
   - 实测：`Pinyin.convertToPinyin('中文测试', ' ', true)` → `zhong wen ce shi`；
     非汉字字符原样透传；`isSupported()` 在现代浏览器为 true。

### 给 WorkBuddy 的接入规格（Guyang 定范围后执行）

1. 跑 `scripts/build-pinyin-bundle.mjs`（本目录这份拷过去）生成 `assets/vendor/pinyin.min.js`，
   或直接用本目录打好的包。
2. `run.js` 懒加载 `pinyin.min.js`，调 `Pinyin.convertToPinyin(text, ' ', true)`；
   首字母 = 每段拼音取首字母。
3. **输入 style 下拉收敛为两档：无声调 / 首字母**。"带声调""数字声调" v1 不做，
   工具页文案如实写"数据源无声调数据"（诚实比硬凑重要）。
4. 验收：常用 3500 字抽查无错；多音字文案注明"取常用读法"。

### 如果 Guyang 坚持要声调

那 tiny-pinyin 这条路走不通，需要新的带声调字典数据源（量级完全不同：要么上 pinyin-pro
这类 MB 级库，要么自建 3500 字声调表并逐字校对）。建议 v1 先不做，等工具有人用再说。

---

## Guyang 要拍的板（两句话就行）

1. text-to-pdf：**做中文**（文件已备好，WorkBuddy 按上面规格接）/ **首期仅英文**（分支删掉）
2. pinyin-convert：**无声调+首字母先上**（包已打好）/ **必须带声调**（那就另行评估数据源，v1 先不上这个工具）
