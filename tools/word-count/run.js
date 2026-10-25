// 工具：字数统计（中英文分别统计，纯浏览器执行）
export const manifest = {
  usage: '统计字符数（含/不含空格）、中文字数、英文单词数、段落数、行数，并估算阅读时长。适合公众号、论文、投稿的字数限制核对。',
  tips: ['中文字数按汉字个数算，英文按空格分隔的单词算，与多数平台的统计口径接近', '阅读时长按中文 400 字/分钟估算，仅作参考', '标点统计包含中英文标点，可用于检查全半角混用'],
  scenarios: [
    { scene: '公众号要求 800 字以内', how: '粘贴正文 → 看中文字数', result: '一眼确认是否超标，避免发布前返工' },
    { scene: '论文摘要限制 300 字', how: '粘贴 → 看字符数（不含空格）', result: '按学校口径核对更准' },
    { scene: '估算演讲稿时长', how: '看阅读时长估算', result: '按 3 分钟准备内容更靠谱' },
  ],
  inputs: [
    { name: 'text', label: '正文内容', type: 'textarea', placeholder: '粘贴需要统计的文本…', default: 'ToolHub 是一个把开源工具变得更好用的平台。\nIt runs entirely in your browser, with no upload needed.' },
  ],
  runLabel: '统计',
};

export async function run({ text }) {
  if (!text) throw new Error('请先输入文本');
  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, '').length;
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  const punct = (text.match(/[\u3000-\u303f\uFF00-\uFFEF!-/:-@[-\`{-~]/g) || []).length;
  const lines = text.split('\n').length;
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const readMin = Math.max(1, Math.round(cjk / 400 + words / 200));
  const rows = [
    ['字符数（含空格）', chars],
    ['字符数（不含空格）', charsNoSpace],
    ['中文字数', cjk],
    ['英文单词数', words],
    ['标点符号数', punct],
    ['行数', lines],
    ['段落数', paras],
    ['预计阅读时长', readMin + ' 分钟'],
  ];
  return {
    html: `<div class="msg-ok">✅ 共 ${chars} 字符</div>
      <table style="width:100%;font-size:13.5px;border-collapse:collapse;margin-top:10px">
        ${rows
          .map(
            ([k, v], i) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 4px;color:var(--muted);width:55%">${k}</td><td style="padding:7px 4px;font-family:var(--mono)">${v}</td></tr>`
          )
          .join('')}
      </table>`,
    text: rows.map(([k, v]) => `${k}：${v}`).join('\n'),
  };
}
