// 工具：汉字转拼音（浏览器执行，按需加载自建包 assets/vendor/pinyin.min.js / MIT）
//
// 数据源是仓库里的 scripts/vendor/tiny-pinyin/dist，由 scripts/build-pinyin-bundle.mjs
// 打成浏览器全局脚本。这份字典只给「音节」，不给声调，也不做词组消歧：
//   · 声调：不猜。同音不同调（ma → mā / má / mǎ / mà）必须按字查表，
//     这份数据包里没有，硬凑一个默认调只会给出看似正确实则随机的结果。
//   · 多音字：取字典里的常用读法，例如「重庆」会拼成 zhong qing 而不是 chong qing。
// 这两条都写在页面与结果区，不藏着。要词组级/带声调的转写，需要另一份更大的词库。
//
// 非汉字（英文单词、数字、标点）按原文整段保留，不逐字符拆开加分隔符。
//
// 数据边界：文本只在本机内存里转换，不发请求、不上传、不写本地存储。

const VENDOR = '/assets/vendor/pinyin.min.js';
const LATIN = 1;
const PINYIN = 2;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = resolve;
    sc.onerror = () => reject(new Error('拼音数据没加载成功（' + src + '）。断网时请确认已下载离线包，然后刷新重试'));
    document.head.appendChild(sc);
  });
}

async function loadPinyin() {
  if (typeof window !== 'undefined' && window.TinyPinyin) return window.TinyPinyin;
  if (typeof document === 'undefined') throw new Error('当前环境没有 document，无法按需加载拼音数据；请在浏览器里运行这个工具');
  await loadScript(VENDOR);
  if (!window.TinyPinyin) throw new Error('拼音包加载后没找到入口，请刷新重试');
  return window.TinyPinyin;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shape(syllable, mode, caseMode) {
  let v = String(syllable).toLowerCase();
  if (mode === 'initials') v = v.charAt(0);
  if (caseMode === 'upper') return v.toUpperCase();
  if (caseMode === 'capitalize') return v.charAt(0).toUpperCase() + v.slice(1);
  return v;
}

export const manifest = {
  usage:
    '把汉字转成拼音，可选全拼或首字母、大小写与分隔符；英文和数字按原文保留。字典只给音节、不带声调，也不猜声调；多音字取常用读法（如「重庆」→ zhong qing），页面上写明了这个口径。',
  tips: [
    '不带声调：数据源只有音节，同音不同调必须按字查表，硬凑默认调会给出随机结果，所以不猜',
    '多音字取常用读法：「重庆」会拼成 zhong qing；地名、人名里的特殊读音请手工改',
    '英文单词和数字按原文整段保留，不会拆成 H e l l o；分隔符只加在相邻汉字之间',
    '「首字母 + 无分隔符」就是常见的缩写形式，例如「中华人民共和国」→ zhrmghg',
    '拼音包由仓库内的 tiny-pinyin 字典构建，约 15 KB，只在点「转换」时按需加载，不占首屏',
    '文本只在本机内存里转换，不发请求、不上传、不写本地存储',
  ],
  scenarios: [
    { scene: '给中文姓名生成用户名', how: '模式选「全拼」、分隔符选「无」、大小写选「小写」', result: '拿到一串连续拼音，可直接拼进账号' },
    { scene: '做检索用的首字母索引', how: '模式选「首字母」、分隔符选「无」', result: '得到 zhrmghg 这类缩写，适合做分组键' },
    { scene: '给中文混排的句子注音', how: '保留非汉字选「保留」，分隔符选「空格」', result: '汉字变拼音，英文单词与数字原样留在原位' },
  ],
  inputs: [
    { name: 'text', label: '中文文本', type: 'textarea', placeholder: '中华人民共和国\n或：Hello 中国 2026' },
    { name: 'mode', label: '输出模式', type: 'select', default: 'full', options: [
      { value: 'full', label: '全拼（zhong guo）' },
      { value: 'initials', label: '首字母（z g）' },
    ] },
    { name: 'caseMode', label: '大小写', type: 'select', default: 'lower', options: [
      { value: 'lower', label: '全小写' }, { value: 'upper', label: '全大写' }, { value: 'capitalize', label: '首字母大写' },
    ] },
    { name: 'sep', label: '汉字之间的分隔符', type: 'select', default: 'space', options: [
      { value: 'space', label: '空格' }, { value: 'hyphen', label: '连字符 -' }, { value: 'none', label: '无（连写）' },
    ] },
    { name: 'keepOther', label: '非汉字（英文/数字/标点）', type: 'select', default: 'keep', options: [
      { value: 'keep', label: '按原文保留' }, { value: 'drop', label: '去掉，只留拼音' },
    ] },
  ],
  example: { text: '中华人民共和国', mode: 'full', caseMode: 'lower', sep: 'space', keepOther: 'keep' },
  runLabel: '转换',
};

export async function run({ text, mode, caseMode, sep, keepOther }) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) throw new Error('请输入要转换的中文文本');
  if (raw.length > 5000) throw new Error('输入超过 5000 字符；请分成几段转换');

  const m = mode === 'initials' ? 'initials' : 'full';
  const cm = ['lower', 'upper', 'capitalize'].includes(caseMode) ? caseMode : 'lower';
  const sepChar = sep === 'hyphen' ? '-' : sep === 'none' ? '' : ' ';
  const keep = keepOther !== 'drop';

  const P = await loadPinyin();
  let tokens;
  try {
    if (!P.isSupported()) throw new Error('当前浏览器缺少 zh-CN 的 Intl.Collator 支持');
    tokens = P.parse(raw);
  } catch (e) {
    throw new Error('拼音转换失败：' + String((e && e.message) || e));
  }

  const out = [];
  let prevPinyin = false;
  let han = 0;
  let other = 0;
  for (const t of tokens) {
    if (t.type === PINYIN) {
      if (prevPinyin && sepChar) out.push(sepChar);
      out.push(shape(t.target, m, cm));
      prevPinyin = true;
      han++;
    } else {
      if (keep) out.push(t.source);
      prevPinyin = false;
      if (t.type === LATIN || t.type === 3) other++;
    }
  }
  const result = out.join('');
  if (!result.trim()) throw new Error('这段文本里没有可转换的汉字，结果为空');

  const boundary =
    '<p style="margin-top:10px;padding:10px 12px;background:var(--bg-alt,#f6f7f9);border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:13px">' +
    '口径：本包只提供<strong>音节，不带声调</strong>，也不猜声调（同音不同调必须按字查表）；' +
    '<strong>多音字取常用读法</strong>，例如「重庆」→ zhong qing，地名人名里的特殊读音请手工改。' +
    '共转换 ' + han + ' 个汉字，' + (keep ? '原样保留 ' : '已去掉 ') + other + ' 个非汉字字符。</p>';

  return {
    html:
      '<div class="msg-ok">✅ 转换完成（' + han + ' 个汉字）</div>' +
      boundary +
      '<pre style="white-space:pre-wrap;word-break:break-all;padding:12px;margin-top:8px;background:var(--bg-alt,#f6f7f9);border:1px solid var(--border);border-radius:6px;font-family:var(--mono);font-size:14px;line-height:1.7">' +
      esc(result) + '</pre>',
    text:
      '口径：只给音节、不带声调，不猜声调；多音字取常用读法（重庆 → zhong qing）。\n' + result,
  };
}
