// 工具：Token 估算（纯浏览器执行）
//
// 这里**不做真实分词**。真正的 tokenizer 是各家自己的 BPE 词表（cl100k、o200k、Claude 的私有表），
// 把词表搬进浏览器是几百 KB 到几 MB 的代价，而且厂商会换版本——今天准的明天就不准了。
// 所以本工具按字符类别做经验折算：中文约 1.5 字/token、英文约 4 字符/token、数字约 3 字符/token，
// 再给三套口径的区间。够用来判断「这条提示词是 800 token 还是 8000 token」，不足以拿来对账。
//
// 计费必须以官方 tokenizer 为准。这句话写在结果第一行，不是备注。
const CHUNK = 20000;

const PROFILES = {
  'gpt-4o': { label: 'GPT-4o（o200k 量级）', cjk: 1.6, latin: 4.0, digit: 3.0, other: 2.0, note: '中文压缩率较好' },
  claude: { label: 'Claude（私有词表）', cjk: 1.3, latin: 3.8, digit: 3.0, other: 2.0, note: '中文更碎，同样字数更多 token' },
  generic: { label: '通用估算', cjk: 1.5, latin: 4.0, digit: 3.0, other: 2.0, note: '取上面两者的中间值' },
};

export const manifest = {
  usage:
    '按字符类别估算一段提示词会消耗多少 token：中文、英文、数字、标点分别折算，再给出三种常见口径的对比区间。**这是近似值，计费以官方 tokenizer 为准**——它用来判断量级，不能拿来对账。',
  tips: [
    '结果是近似值，计费以官方 tokenizer 为准；同样一段话，不同厂商、不同模型版本算出来都不一样',
    '三种口径并排显示，是为了让你看到误差范围——差一倍以上就该按大的那个准备',
    '超长文本按 2 万字符分块统计，几十万字的文档也不会卡住页面',
    '代码与表格里的符号多，估算会偏低，这类内容建议再往上留 20% 余量',
  ],
  scenarios: [
    { scene: '要把一份长文档喂给模型', how: '粘贴全文 → 看 token 区间', result: '先判断会不会超上下文，再决定删减还是分段' },
    { scene: '估算一次批量调用的成本', how: '看单条 token × 条数', result: '按官方价格换算，避免预算超支' },
    { scene: '中英混写的提示词', how: '看分类明细', result: '知道哪部分更占 token，优先压缩它' },
  ],
  inputs: [
    { name: 'text', label: '提示词 / 文本', type: 'textarea', placeholder: '粘贴要估算的提示词或文档' },
    {
      name: 'model',
      label: '按哪家口径估算',
      type: 'select',
      options: [
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'claude', label: 'Claude' },
        { value: 'generic', label: '通用' },
      ],
    },
  ],
  runLabel: '估算',
};

function countChunk(s) {
  let cjk = 0;
  let latin = 0;
  let digit = 0;
  let space = 0;
  let other = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) space++;
    else if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff)) cjk++;
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) latin++;
    else if (code >= 48 && code <= 57) digit++;
    else other++;
  }
  return { cjk, latin, digit, space, other };
}

function estimate(c, p) {
  return c.cjk / p.cjk + c.latin / p.latin + c.digit / p.digit + c.other / p.other;
}

const nf = (n) => n.toLocaleString('zh-CN');

export async function run({ text, model }) {
  if (!text || !text.trim()) throw new Error('请先输入要估算的文本');
  const key = PROFILES[model] ? model : 'gpt-4o';

  // 分块统计：一次性扫几十万字会让主线程卡住，按 2 万字符切开逐块累计
  const total = { cjk: 0, latin: 0, digit: 0, space: 0, other: 0 };
  for (let i = 0; i < text.length; i += CHUNK) {
    const c = countChunk(text.slice(i, i + CHUNK));
    total.cjk += c.cjk;
    total.latin += c.latin;
    total.digit += c.digit;
    total.space += c.space;
    total.other += c.other;
  }

  const main = Math.round(estimate(total, PROFILES[key]));
  const rows = Object.entries(PROFILES).map(([k, p]) => {
    const v = Math.round(estimate(total, p));
    return `<tr style="border-bottom:1px solid var(--border)${k === key ? ';font-weight:700' : ''}">
      <td style="padding:6px 4px">${p.label}${k === key ? ' ← 当前' : ''}</td>
      <td style="padding:6px 4px;font-family:var(--mono);text-align:right">${nf(v)}</td>
      <td style="padding:6px 4px;color:var(--muted);font-size:12.5px">${p.note}</td>
    </tr>`;
  });

  const tooLong = main > 32000 ? '<div class="msg-warn">⚠️ 已超过多数模型的单次上下文上限（常见 8k / 32k / 128k），需要分段或先做摘要</div>' : '';
  return {
    html: `<div class="msg-ok">✅ 估算约 <b style="font-size:18px;font-family:var(--mono)">${nf(main)}</b> tokens（${PROFILES[key].label}）</div>
      <div class="msg-warn" style="margin-top:8px">⚠️ 近似值，计费以官方 tokenizer 为准。本工具按字符类别折算，不加载任何厂商词表。</div>
      ${tooLong}
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:12px">
        <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:12.5px">
          <th style="padding:6px 4px;text-align:left">口径</th><th style="padding:6px 4px;text-align:right">tokens</th><th style="padding:6px 4px;text-align:left">说明</th>
        </tr>
        ${rows.join('')}
      </table>
      <p style="margin:12px 0 6px;color:var(--muted);font-size:13px">字符构成（估算依据）：</p>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        ${[
          ['中文字符', total.cjk, `约 ${PROFILES[key].cjk} 字 / token`],
          ['英文字母', total.latin, `约 ${PROFILES[key].latin} 字符 / token`],
          ['数字', total.digit, `约 ${PROFILES[key].digit} 字符 / token`],
          ['标点与其他符号', total.other, '约 2 字符 / token，估算偏差主要来自这里'],
          ['空白字符', total.space, '基本不占 token，但影响分词边界'],
        ]
          .map(
            ([k, v, n]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted)">${k}</td><td style="padding:6px 4px;font-family:var(--mono);text-align:right">${nf(v)}</td><td style="padding:6px 4px;color:var(--muted);font-size:12.5px">${n}</td></tr>`
          )
          .join('')}
      </table>`,
    text: `估算 ${main} tokens（${PROFILES[key].label}）\n近似值，计费以官方 tokenizer 为准\n其中：中文 ${total.cjk} 字 / 英文 ${total.latin} 字母 / 数字 ${total.digit} 字符 / 其他 ${total.other} 字符`,
  };
}
