// 工具：浏览器内置 AI —— 总结 / 翻译 / 改写（纯本地执行）
//
// 它调的是浏览器自带的模型（Chrome 138 起的 Summarizer / Translator / Rewriter），
// 权重由浏览器自己管：本站不分发、不托管、也不接触文本。模型下到本机之后断网也能用。
//
// 三条边界必须写在代码里，而不是等用户撞上：
//   1) 不是所有浏览器都有 —— 桌面版 Chrome 138+ 才有，手机与 Firefox / Safari 没有；
//   2) 首次要下载约 2GB —— create() 会静默下载几分钟，不打招呼用户会以为卡死；
//   3) 看不到下载进度 —— run() 只能最后返回一次，所以改成「先问一句、再点一次」。
export const manifest = {
  usage:
    '粘贴一段文字，选要做的事，点运行。模型是浏览器自带的（桌面版 Chrome 138 起），第一次用要先下载约 2GB；下完之后断网也能用，文本不会离开这台设备。',
  tips: [
    '内置模型的上下文只有几千字，长文档先分节，比一次贴进去效果好得多',
    '翻译需要指定源语言：内置模型不做自动识别，选错了会得到一串不通顺的结果',
    '模型以英文语料为主，中文能跑但不如英文稳；正式材料建议人工过一遍',
    '想看这台机器到底能跑多大的模型，去「本机能跑多大模型」量一遍硬件',
  ],
  scenarios: [
    { scene: '收到一封很长的英文邮件，只想知道对方要什么', how: '粘贴正文 → 选「总结要点」→ 运行', result: '几行要点，先看结论再决定要不要读全文' },
    { scene: '要发一段英文说明，但不想把内部信息贴到翻译网站', how: '粘贴 → 选「翻译」→ 源语言中文、目标英文', result: '译文在本机生成，内容没有离开这台设备' },
    { scene: '自己写的一段话太啰嗦', how: '粘贴 → 选「改写（更简洁）」', result: '删掉重复与铺垫，保留原意' },
  ],
  inputs: [
    { name: 'text', label: '要处理的文字', type: 'textarea', placeholder: '粘贴一段文字，几百字以内效果最好…' },
    {
      name: 'mode',
      label: '做什么',
      type: 'select',
      default: 'summary',
      options: [
        { value: 'summary', label: '总结要点' },
        { value: 'translate', label: '翻译' },
        { value: 'rewrite', label: '改写（更简洁）' },
      ],
    },
    {
      name: 'from',
      label: '源语言（仅翻译时生效）',
      type: 'select',
      default: 'zh',
      options: [
        { value: 'zh', label: '简体中文' },
        { value: 'en', label: '英文' },
        { value: 'ja', label: '日文' },
      ],
    },
    {
      name: 'lang',
      label: '目标语言（仅翻译时生效）',
      type: 'select',
      default: 'en',
      options: [
        { value: 'en', label: '英文' },
        { value: 'zh', label: '简体中文' },
        { value: 'ja', label: '日文' },
      ],
    },
  ],
  runLabel: '运行',
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LABEL = { summary: '总结', translate: '翻译', rewrite: '改写' };
const MAX_CHARS = 6000;

// 「已经跟用户说过要下载」的标记。模块级而非存储：它只对当前这一页有效，
// 刷新后重新问一次——下载 2GB 这件事不该被记住成「上次同意过」。
let downloadConfirmed = false;

function apiOf(mode) {
  const g = globalThis;
  if (mode === 'summary') return g.Summarizer || null;
  if (mode === 'translate') return g.Translator || null;
  if (mode === 'rewrite') return g.Rewriter || null;
  return null;
}

const NO_API =
  '这个浏览器没有内置 AI。需要桌面版 Chrome 138 或更高版本（Windows / macOS / Linux）；手机端、Firefox、Safari 目前都不支持。' +
  '想在这台机器上用 AI，可以先用下面的「本机能跑多大模型」量一遍硬件，再按结果装一个本机方案。';

function statusHint(status) {
  if (status === 'unavailable')
    return '这台设备不满足内置模型的要求。官方门槛大约是 16GB 内存、4GB 显存、22GB 空闲磁盘——差一项就是不可用，换浏览器版本也没用。可以改用装在本机的方案。';
  if (status === 'downloadable')
    return '模型还没下载到这台机器。首次使用要下载约 2GB，通常几分钟，期间这个页面不会有进度条。确认要开始，就再点一次「运行」——这一次会真的下载，请别关页面。';
  if (status === 'downloading') return '模型正在下载，等它下完再点「运行」。';
  return '当前状态：' + status;
}

// availability() 与 create() 必须收到**完全相同**的选项，否则浏览器可能按默认模型
// 报「可用」，真正创建时却因为语言或模态不同而要重新下载。
function optionsFor(mode, from, lang) {
  if (mode === 'summary') return { type: 'key-points', format: 'plain-text', length: 'short' };
  if (mode === 'translate') return { sourceLanguage: from, targetLanguage: lang };
  return { tone: 'as-is', length: 'shorter', format: 'plain-text' };
}

async function statusOf(api, opts) {
  if (typeof api.availability !== 'function') return 'unavailable';
  try {
    return await api.availability(opts);
  } catch {
    return 'unavailable';
  }
}

export async function run({ text, mode, from, lang }) {
  const src = String(text || '').trim();
  if (!src) throw new Error('先粘贴要处理的文字。');
  if (src.length > MAX_CHARS)
    throw new Error(
      `文字太长（约 ${src.length} 字）。内置模型一次只吃几千字，粘太长会因为超出上下文被截断或直接失败——先分成几段，一段一段来。`
    );
  if (mode === 'translate' && from === lang) throw new Error('源语言和目标语言一样，不用翻译。');

  const api = apiOf(mode);
  if (!api) throw new Error(NO_API);

  const opts = optionsFor(mode, from, lang);
  const status = await statusOf(api, opts);

  if (status !== 'available') {
    // downloadable 第一次只解释、不下载；确认过一次才放行。
    if (status === 'downloadable') downloadConfirmed = true;
    return { html: `<div class="msg-warn">${esc(statusHint(status))}</div>` };
  }

  let out = '';
  let session = null;
  try {
    session = await api.create(opts);
    if (mode === 'summary') out = await session.summarize(src);
    else if (mode === 'translate') out = await session.translate(src);
    else out = await session.rewrite(src);
  } catch (e) {
    // 原文抛出来：模型侧的错误五花八门（上下文超限、语言包没装、被系统策略拦），
    // 换成一句「处理失败」等于把线索扔了。
    throw new Error('模型返回了错误：' + (e && e.message ? e.message : String(e)));
  } finally {
    try {
      if (session && typeof session.destroy === 'function') session.destroy();
    } catch {
      /* 释放失败不影响结果 */
    }
  }

  const result = String(out || '').trim();
  if (!result) throw new Error('模型返回了空结果。换个说法或缩短文本再试一次。');

  return {
    html:
      `<div class="msg-ok">完成 · ${LABEL[mode]} · 输出 ${result.length} 字</div>` +
      `<pre class="ai-out">${esc(result)}</pre>` +
      `<p class="ai-note">模型由浏览器提供，这段文字没有离开这台设备。</p>`,
    text: result,
  };
}
