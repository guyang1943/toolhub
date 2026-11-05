// 工具：占位文本生成（中英文，纯浏览器执行）
//
// 中文占位最怕「断词」——用随机汉字拼出来的句子读起来像乱码，拿去做设计稿反而干扰判断。
// 所以这里不是随机汉字，而是按短语词库拼句：主语/动作/对象/收尾各取一个短语，中间不加空格，
// 逗号与句号按中文标点走。生成结果读得通，但不构成任何真实信息，正好当占位。
//
// 随机数用固定种子（由段落数与类型算出来），同样的参数每次生成同一段文本——
// 截图、评审、比对时不会因为「刷新一下换了内容」而对不上。
const ZH_SUBJECT = ['这套方案', '产品团队', '新版页面', '这次改版', '后台系统', '移动端体验', '内容结构', '协作流程', '数据看板', '用户反馈'];
const ZH_VERB = ['围绕', '聚焦于', '重新梳理了', '简化了', '补齐了', '打通了', '拆分了', '稳定了', '打磨了', '重排了'];
const ZH_OBJECT = ['核心路径', '信息层级', '权限模型', '加载性能', '导入导出', '边界情况', '命名规范', '错误提示', '空状态', '埋点口径'];
const ZH_TAIL = ['减少了来回确认的成本', '让新手也能一次做对', '把模糊的地方说清楚了', '避免了重复劳动', '留出了后续扩展的位置', '让问题更早暴露', '把责任边界划清了', '让结果可被复核'];

const EN_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ' +
  'enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure ' +
  'in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident ' +
  'sunt culpa qui officia deserunt mollit anim id est laborum'
).split(' ');

export const manifest = {
  usage:
    '生成中英文占位文本：中文按短语词库拼句（不会出现随机汉字那种读不通的串），英文用 Lorem Ipsum 词库。可选段落、标题、单句三种形态，段落数与类型定下来后每次生成的内容一致。',
  tips: [
    '中文占位按短语拼接、不在词中间插空格，直接放进设计稿不会被误读成排版错误',
    '段落与标题二选一：标题只出一行短语，不会带句号',
    '同样的参数生成同样的文本（固定种子），适合反复截图与评审比对',
    '这些文字没有任何真实含义，只用于占位；对外发布前记得替换',
  ],
  scenarios: [
    { scene: '做设计稿缺正文', how: '选中文、段落、6 段', result: '得到读得通的中文段落，不用手敲测试测试' },
    { scene: '英文版页面排版', how: '选英文、段落、4 段', result: 'Lorem Ipsum 段落，长度接近真实英文' },
    { scene: '列表页需要一批标题', how: '选中文、标题、8 条', result: '8 行短标题，不带标点' },
  ],
  inputs: [
    {
      name: 'lang',
      label: '语言',
      type: 'select',
      options: [
        { value: 'zh', label: '中文' },
        { value: 'en', label: '英文' },
      ],
    },
    { name: 'paras', label: '数量（段落/标题/句子数）', type: 'number', min: 1, max: 30, placeholder: '留空按 3' },
    {
      name: 'kind',
      label: '形态',
      type: 'select',
      options: [
        { value: 'para', label: '段落' },
        { value: 'title', label: '标题' },
        { value: 'sentence', label: '单句' },
      ],
    },
  ],
  runLabel: '生成文本',
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function zhSentence(rand) {
  const a = pick(rand, ZH_SUBJECT);
  const b = pick(rand, ZH_VERB);
  const c = pick(rand, ZH_OBJECT);
  const d = pick(rand, ZH_TAIL);
  const mid = rand() < 0.45 ? '，' : '';
  return `${a}${b}${c}${mid}${d}。`;
}

function enSentence(rand) {
  const len = 8 + Math.floor(rand() * 9);
  const words = Array.from({ length: len }, () => pick(rand, EN_WORDS));
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

function zhTitle(rand) {
  const a = pick(rand, ZH_OBJECT);
  const tails = ['的三个要点', '怎么定', '背后的取舍', '先看这几点', '为什么变慢了', '的常见误解'];
  return `${a}${pick(rand, tails)}`;
}

function enTitle(rand) {
  const len = 3 + Math.floor(rand() * 3);
  const words = Array.from({ length: len }, () => pick(rand, EN_WORDS));
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function run({ lang, paras, kind }) {
  const n = paras === undefined || paras === null || String(paras).trim() === '' ? 3 : Number(paras);
  if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error(`数量要填 1–30 的整数（填的是 ${paras}）`);
  const l = lang === 'en' ? 'en' : 'zh';
  const k = ['para', 'title', 'sentence'].includes(kind) ? kind : 'para';
  const rand = mulberry32(n * 7919 + l.length * 131 + k.length * 17 + 20261105);

  const blocks = [];
  for (let i = 0; i < n; i++) {
    if (k === 'title') {
      blocks.push(l === 'zh' ? zhTitle(rand) : enTitle(rand));
    } else if (k === 'sentence') {
      blocks.push(l === 'zh' ? zhSentence(rand) : enSentence(rand));
    } else {
      const count = 3 + Math.floor(rand() * 3);
      const sentences = Array.from({ length: count }, () => (l === 'zh' ? zhSentence(rand) : enSentence(rand)));
      blocks.push(l === 'zh' ? sentences.join('') : sentences.join(' '));
    }
  }

  // 中文段落之间空一行，英文段落之间也是空行；标题一行一条
  const sep = k === 'para' ? '\n\n' : '\n';
  const out = blocks.join(sep);
  const unit = k === 'para' ? '段' : k === 'title' ? '条标题' : '句';

  return {
    html: `<div class="msg-ok">✅ 已生成 ${n} ${unit}（${l === 'zh' ? '中文' : '英文'}）</div>
      <pre style="white-space:pre-wrap;word-break:break-word;margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:13.5px;line-height:1.85">${out
        .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">同样的参数每次生成的内容一致，方便反复截图比对；这些文字没有真实含义，发布前记得替换。</p>`,
    text: out,
  };
}
