// 工具：英文转 ASCII 艺术字（浏览器执行，按需加载 vendor figlet 1.12.0 / MIT）
//
// 字体体积先量后定：figlet 1.12.0 的 Standard / Slant / Small 三份 .flf 实测
// 58,489 B 原始 / 9,819 B gzip，连同 figlet 核心（39 KB）也远低于单工具 200 KB，
// 所以三种全留，不砍。字体数据打成 figlet-fonts.js 由 parseFont() 注册，
// 不走 fetch —— 工具的 run.js 里不允许出现任何网络 API。
//
// 长文本用 figlet 自带的 width + whitespaceBreak：按渲染宽度折行、只在空格处断，
// 不会把一个单词劈成两半。中文明确报错，不静默出方块或乱码。
//
// 数据边界：文字只在本机内存里排版，不发请求、不上传、不写本地存储。

const FONT_NAMES = { standard: 'Standard', slant: 'Slant', small: 'Small' };
const FONT_LABELS = { standard: 'Standard（标准）', slant: 'Slant（斜体）', small: 'Small（紧凑）' };
const SCRIPTS = ['/assets/vendor/figlet.min.js', '/assets/vendor/figlet-fonts.js'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = resolve;
    sc.onerror = () => reject(new Error('字体引擎没加载成功（' + src + '）。断网时请确认已下载离线包，然后刷新重试'));
    document.head.appendChild(sc);
  });
}

async function loadFiglet() {
  if (typeof document === 'undefined') throw new Error('当前环境没有 document，无法按需加载字体引擎；请在浏览器里运行这个工具');
  if (!window.figlet) await loadScript(SCRIPTS[0]);
  if (!window.FIGLET_FONTS) await loadScript(SCRIPTS[1]);
  if (!window.figlet || !window.FIGLET_FONTS) throw new Error('字体引擎或字体数据没加载成功，请刷新重试');
  return window.figlet;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const manifest = {
  usage:
    '把英文 / 数字转成 ASCII 艺术字，三种字体（Standard / Slant / Small）可选，宽度够长时自动在空格处折行、不拆单词。只支持 ASCII 字符，遇到中文会明确报错而不是输出乱码。',
  tips: [
    '长文本自动按宽度折行，只在空格处断（whitespaceBreak），不会把单词劈成两半',
    '宽度按渲染后的字符数算，不是输入字符数：同一个词在 Small 字体里比 Standard 占得少',
    '只支持英文 / 数字 / ASCII 标点；中文、Emoji 不在字体包里，会直接提示而不是输出方块',
    '三种字体实测 58.5 KB 原始 / 9.8 KB gzip，连同引擎也远低于 200 KB 上限，所以三种全留',
    '字体引擎与字体数据只在点「生成」时按需加载，不进首屏；文字不出本机',
  ],
  scenarios: [
    { scene: '给 README 加个大标题', how: '输入项目名，字体选 Standard，宽度 80', result: '复制等宽字符画，贴进 Markdown 代码块' },
    { scene: '终端启动横幅', how: '字体选 Small，宽度调到终端列数', result: '紧凑的艺术字，窄屏也不会被折得乱七八糟' },
    { scene: '一句长标语排版', how: '输入整句，宽度设 60', result: '按空格自动分成几行，每行都是一个完整单词' },
  ],
  inputs: [
    { name: 'text', label: '英文 / 数字（中文不支持）', type: 'text', placeholder: 'Hello ToolHub', default: '' },
    { name: 'font', label: '字体', type: 'select', default: 'standard', options: [
      { value: 'standard', label: 'Standard（标准）' },
      { value: 'slant', label: 'Slant（斜体）' },
      { value: 'small', label: 'Small（紧凑）' },
    ] },
    { name: 'width', label: '折行宽度（20–200 字符）', type: 'number', min: 20, max: 200, default: 80 },
    { name: 'layout', label: '字符间距', type: 'select', default: 'default', options: [
      { value: 'default', label: '默认（紧排）' },
      { value: 'fitted', label: '贴合（更紧凑）' },
      { value: 'full', label: '全宽（拉开）' },
    ] },
  ],
  example: { text: 'Hello ToolHub', font: 'standard', width: 80, layout: 'default' },
  runLabel: '生成',
};

export async function run({ text, font, width, layout }) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) throw new Error('请输入要转换的英文 / 数字；中文和 Emoji 不在字体包里');
  if (/[^\x00-\x7F]/.test(raw)) {
    throw new Error('输入里有非 ASCII 字符（中文、Emoji 或全角标点）。这套 .flf 字体只有英文字形，不转换——换纯英文再试，别让工具吐一堆方块');
  }
  if (raw.length > 200) throw new Error('输入最多 200 个字符，当前 ' + raw.length + ' 个；ASCII 艺术字适合短标题，长句请拆成几段');

  const key = FONT_NAMES[font] ? font : 'standard';
  const name = FONT_NAMES[key];
  const w = Math.min(200, Math.max(20, Math.floor(Number(width) || 80)));
  const lay = ['default', 'fitted', 'full'].includes(layout) ? layout : 'default';

  const figlet = await loadFiglet();
  const data = window.FIGLET_FONTS[name];
  if (!data) throw new Error('字体数据里没有「' + name + '」，请刷新重试');
  figlet.parseFont(name, data);

  let art;
  try {
    art = figlet.textSync(raw, {
      font: name,
      width: w,
      whitespaceBreak: true, // 关键：长文本在空格处折行，不切断单词
      horizontalLayout: lay,
      verticalLayout: 'default',
    });
  } catch (e) {
    throw new Error('字体渲染失败：' + String((e && e.message) || e));
  }
  if (!art || !art.replace(/\s/g, '')) throw new Error('这个字体里没有这些字符的字形，结果为空；换 Standard 字体或只用英文字母数字再试');

  const lines = art.replace(/\s+$/gm, '').split('\n');
  return {
    html:
      '<div class="msg-ok">✅ ' + esc(FONT_LABELS[key]) + ' · 折行宽度 ' + w + ' · ' + lines.length + ' 行（长文本按空格折行，不拆单词）</div>' +
      '<pre style="overflow-x:auto;padding:12px;margin-top:8px;background:var(--bg-alt,#f6f7f9);border:1px solid var(--border);border-radius:6px;font-family:var(--mono);font-size:12px;line-height:1.15">' +
      esc(lines.join('\n')) + '</pre>',
    text: lines.join('\n'),
  };
}
