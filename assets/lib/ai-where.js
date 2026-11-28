/**
 * 「这件事该在哪跑」决策表（v3.44）
 *
 * 一张按任务 × 数据敏感度排的表，不是按产品排。同样的任务，合同和新闻稿的答案不一样——
 * 市面上的选型指南大多不区分这一点，所以它们只能给出「都行」。
 *
 * 两条硬规矩：
 *   1. **每行的「去哪」必须指向真实存在的工具页或教程页**。构建期不校验的话，半年后就是一堆 404；
 *      verify 里有一条专门数它（tools/<id>/ 与 guides/<slug>/ 都要在磁盘上）。
 *   2. **不给「推荐」，给「代价」**。这一页回答「你愿意付哪一样」，不回答「哪个最好」——
 *      后者取决于你手里的合同值多少钱，那不是我能替你判断的。
 */

/** 敏感度三档。用文字而不是颜色：颜色在这张表里会被读成「好坏」，而它表达的是「要求」。 */
export const SENSITIVITY = {
  高: '泄露会有人担责：合同、病历、证件、客户名单、未公开的内部文档。',
  中: '不是秘密，但不想被拿去训练：个人邮件、代码、草稿。',
  低: '本来就要公开，或只是公开信息的改写：翻译一封通知、给商品图换个底色。',
};

/**
 * rows 的字段：
 *   task   你的任务（按人话写，不按工具名）
 *   level  敏感度（高 / 中 / 低 / —）
 *   how    建议（一句，含代价）
 *   links  [{ href, label }]，构建期与 verify 都会核产物存在
 */
export const WHERE_ROWS = [
  {
    task: '总结一份内部合同，或从里面挑出要改的条款',
    level: '高',
    how: '本机 7B（8GB 内存起步）或浏览器内置模型。慢一点，但文件不用出门；别用「上传 PDF 帮你读」的网页服务。',
    links: [
      { href: '/guides/ollama-local-ai/', label: '本机跑一个模型' },
      { href: '/tools/ai-local/', label: '浏览器内置模型' },
    ],
  },
  {
    task: '从一叠 PDF 里找某几条约定',
    level: '高',
    how: '先在本机切分、再检索，只把命中的几段交给模型。整本塞进上下文既贵又容易漏——而且等于把整份文件交出去。',
    links: [
      { href: '/guides/ollama-local-ai/', label: '本机对话' },
      { href: '/guides/pdf-scan-searchable/', label: '先让 PDF 可搜索' },
    ],
  },
  {
    task: '给证件、车牌、人脸打码',
    level: '高',
    how: '站内 ONNX（4.8 MB 权重 + 10 MB 引擎，首次下载，之后断网可用）。图片全程不出浏览器，这是这一页里唯一能「点开就用」的高敏感方案。',
    links: [
      { href: '/tools/face-blur/', label: '人脸打码' },
      { href: '/tools/bg-remove/', label: '去背景' },
    ],
  },
  {
    task: '翻译一封邮件或一条通知',
    level: '中',
    how: '浏览器内置翻译，零成本、零安装。它翻不了长文与技术文档，那种再考虑本机模型。',
    links: [{ href: '/tools/ai-local/', label: '浏览器内置模型' }],
  },
  {
    task: '写简历、周报、方案',
    level: '中',
    how: '云端或浏览器内置都行，区别是「要不要留底」。公有云默认会用你的输入改进服务（可在设置里关），在意就换本机。',
    links: [
      { href: '/guides/ai-prompts-resume/', label: '提示词写法' },
      { href: '/tools/ai-local/', label: '浏览器内置模型' },
    ],
  },
  {
    task: '重构一段代码',
    level: '中',
    how: '云端 Agent 更稳：本机 32B 以下做多文件改动容易改坏，而代码通常不是最敏感的那类数据。真要本地做，看下面那篇。',
    links: [
      { href: '/guides/local-ai-coding/', label: '本地模型写代码' },
      { href: '/tools/ai-local/', label: '浏览器内置模型' },
    ],
  },
  {
    task: '几十张商品图批量改尺寸、去底色、加水印',
    level: '低',
    how: '站内批量页，一次拖进来跑完打包下载。不上传、不排队、不用注册——这类活最没必要交给别人的服务器。',
    links: [
      { href: '/batch/', label: '批量处理图片' },
      { href: '/guides/ai-batch-media/', label: '批量处理的做法' },
    ],
  },
  {
    task: '先搞清楚自己这台机器能跑多大',
    level: '—',
    how: '别猜。量一遍 WebGPU、内存与核数，它会按四档量化给出「能跑 / 勉强 / 跑不动」。不下载任何模型。',
    links: [{ href: '/tools/ai-hw-check/', label: '量一下' }],
  },
];

export const WHERE_LEAD =
  '同一件事，合同和新闻稿的答案不一样。这张表的第一列是任务、第二列是数据敏感度，' +
  '不按产品排——按产品排出来的选型指南，最后都会变成「都行」。';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function whereBody() {
  const rows = WHERE_ROWS.map((r) => {
    // 每个入口单独一行：这一列的标签长短不一（「本机对话」 vs 「先让 PDF 可搜索」），
    // 用「·」串起来在窄列里会从词中间折行——读起来像两个碎词，而不是两个入口。
    const links = r.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('');
    return (
      `<tr>` +
      `<th scope="row">${esc(r.task)}</th>` +
      `<td class="w-lv" data-lv="${esc(r.level)}">${esc(r.level)}</td>` +
      `<td class="w-how">${esc(r.how)}</td>` +
      `<td class="w-go">${links}</td>` +
      `</tr>`
    );
  }).join('');

  return `
      <div class="w-sum">
        <p><b>${WHERE_ROWS.length}</b> 行 · 按任务分，不按产品分。同一件事，合同和新闻稿的答案不一样。</p>
      </div>

      <h2>怎么判断敏感度</h2>
      <ul class="w-levels">
        <li><b>高</b> —— ${esc(SENSITIVITY['高'])}</li>
        <li><b>中</b> —— ${esc(SENSITIVITY['中'])}</li>
        <li><b>低</b> —— ${esc(SENSITIVITY['低'])}</li>
      </ul>
      <p>拿不准的时候就当「高」。判断错的代价不对称：当成高，最多是本机慢一点；当成低，东西已经出去了，
      收不回来，也没有「删除」按钮——对方说删了，你也验不了。</p>

      <h2>按任务查</h2>
      <div class="w-wrap"><table class="w-table">
        <thead><tr><th scope="col">你的任务</th><th scope="col">敏感度</th><th scope="col">建议与代价</th><th scope="col">去哪</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <h2>四条路各自的代价</h2>
      <p>这张表只排「去哪」，不排「哪个好」——因为四条的代价不是同一种东西：浏览器内置付的是能力上限，
      本机付的是内存与速度，自建付的是一台常开的机器，云端付的是钱和「内容已经出去了」这件事。
      四路的逐项对照在 <a href="/ai/#routes">AI 中心那一页</a>。</p>

      <h2>这一页不做什么</h2>
      <p>不按产品推荐，不排「最佳 AI 工具」，也不猜你没说出口的需求。同一个人上午写周报、下午读合同，
      两件事就该走两条路——所以这里的第一列是任务，不是工具名。</p>`;
}
