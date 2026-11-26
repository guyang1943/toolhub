// 工具：本机能跑多大模型（纯本地检测）
//
// 它不下载任何东西，只当场问浏览器几个问题：有没有 WebGPU、内存多大、几个核、磁盘还剩多少，
// 然后把「模型要多大」和「你有多少」摆在一张表上。
//
// 为什么值得做一个工具：这件事在网上被答得很玄（「16G 能跑 7B 吗」），
// 而真实答案由四个数决定——参数量、量化位数、上下文长度、可用内存。
// 四个数都摆出来，结论就不需要信谁了。
//
// 一条必须说清的边界：浏览器**不告诉我们显存总量**。deviceMemory 是系统内存的粗粒度值
// （只给 0.5/1/2/4/8 这几档），所以下面按系统内存估，并在结果里标明这一点。
// 宁可把话说小，也不报一个看起来很准的假数字。
export const manifest = {
  usage:
    '选一个模型规模和量化档，运行。工具会当场量你的 WebGPU、内存与核数，算出这个组合需要多少内存，以及你这台机器跑不跑得动。全部在本机检测，不下载任何模型。',
  tips: [
    '量化是省内存最有效的一招：同一个 7B，FP16 要 14GB，Q4_K_M 只要 4.3GB 左右',
    '上下文越长越吃内存：KV cache 随上下文线性增长，32K 上下文的 7B 比 4K 多占 1GB 以上',
    '浏览器不暴露显存总量，这里按系统内存估；有独显的机器实际可用的往往比这个数更少',
    '没有 WebGPU 也能跑（走 CPU 的 WASM），只是慢：7B 大约每秒几个字',
  ],
  scenarios: [
    { scene: '想装 Ollama 跑个模型，不知道自己的电脑撑不撑得住', how: '选 7B / Q4_K_M / 4K → 运行', result: '一张需求与实测的对照表，直接给「能跑 / 勉强 / 跑不动」' },
    { scene: '想跑 32B，但只有 16GB 内存', how: '选 32B → 看四档量化的需求', result: '看清哪一档才放得下，以及差多少' },
    { scene: '准备加内存或换显卡，想知道加多少才有意义', how: '分别选目标规模运行两次，对比「差多少」', result: '一个明确的数字，而不是「大概要 32G 吧」' },
  ],
  inputs: [
    {
      name: 'size',
      label: '模型规模（参数量）',
      type: 'select',
      default: '7',
      options: [
        { value: '3', label: '3B（小模型，写作与问答够用）' },
        { value: '7', label: '7B（主流本地模型）' },
        { value: '8', label: '8B（Llama 3.1 一档）' },
        { value: '13', label: '13B' },
        { value: '32', label: '32B' },
        { value: '70', label: '70B（需要大显存）' },
      ],
    },
    {
      name: 'quant',
      label: '量化档',
      type: 'select',
      default: 'q4km',
      options: [
        { value: 'q4', label: 'Q4_0（最小，质量损失可见）' },
        { value: 'q4km', label: 'Q4_K_M（推荐，质量与体积平衡）' },
        { value: 'q8', label: 'Q8_0（接近原版，体积翻倍）' },
        { value: 'fp16', label: 'FP16（原始精度，最吃内存）' },
      ],
    },
    {
      name: 'ctx',
      label: '上下文长度',
      type: 'select',
      default: '4096',
      options: [
        { value: '2048', label: '2K（短对话）' },
        { value: '4096', label: '4K（默认）' },
        { value: '8192', label: '8K（长文档）' },
        { value: '32768', label: '32K（整篇论文）' },
      ],
    },
  ],
  runLabel: '检测并估算',
};

const ESC = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 每参数字节数。Q4_K_M 是 4.8 bit/参数（分块量化里有些权重留在更高精度），
// 不是简单的 4 bit —— 按 4 bit 算会低估 20%，正是「说能跑、跑起来 OOM」的来源。
const BPP = { q4: 0.56, q4km: 0.61, q8: 1.06, fp16: 2 };
const QNAME = { q4: 'Q4_0', q4km: 'Q4_K_M', q8: 'Q8_0', fp16: 'FP16' };
const PNAME = { 3: '3B', 7: '7B', 8: '8B', 13: '13B', 32: '32B', 70: '70B' };

// KV cache：每 1K 上下文、每 7B 参数约占 0.06GB（FP16）。粗估，误差 ±20%。
const kvGB = (params, ctx, quant) => (ctx / 1024) * (params / 7) * 0.06 * (quant === 'fp16' ? 1 : 0.5);

// 权重 + KV + 运行时开销（图、缓冲、分词器）。开销按权重线性给一点，固定给 0.4GB。
const needGB = (params, quant, ctx) => {
  const w = params * BPP[quant];
  return w + kvGB(params, ctx, quant) + 0.4 + w * 0.05;
};

const gb = (n) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + ' GB';

async function probe() {
  const g = globalThis;
  const nav = g.navigator || {};
  const r = {
    gpu: false,
    vendor: '',
    arch: '',
    maxBuf: 0,
    mem: Number(nav.deviceMemory) || 0,
    cores: Number(nav.hardwareConcurrency) || 0,
    quota: 0,
    usage: 0,
    isolated: !!g.crossOriginIsolated,
  };
  if (nav.gpu && typeof nav.gpu.requestAdapter === 'function') {
    try {
      const ad = await nav.gpu.requestAdapter();
      if (ad) {
        r.gpu = true;
        const info = ad.info || {};
        r.vendor = info.vendor || '';
        r.arch = info.architecture || '';
        const lim = ad.limits || {};
        r.maxBuf = Number(lim.maxBufferSize) || 0;
      }
    } catch {
      /* 有 navigator.gpu 但拿不到 adapter：按没有 GPU 处理 */
    }
  }
  if (nav.storage && typeof nav.storage.estimate === 'function') {
    try {
      const e = await nav.storage.estimate();
      r.quota = Number(e.quota) || 0;
      r.usage = Number(e.usage) || 0;
    } catch {
      /* 配额查不到不影响主结论 */
    }
  }
  return r;
}

// 可用预算。有 WebGPU 走显存（但我们看不到总量，只能按系统内存打折），
// 没有 GPU 走内存 + CPU，能跑但慢。
function budgetOf(hw) {
  if (hw.gpu) {
    const base = hw.mem ? hw.mem * 0.55 : 8; // 没报内存时按 8GB 假设，并在结果里标注
    return { gb: base, how: hw.mem ? '按系统内存的 55% 估可用显存' : '未报告内存，按 8GB 假设' };
  }
  const base = hw.mem ? hw.mem * 0.5 : 4;
  return { gb: base, how: hw.mem ? '按系统内存的 50% 估（CPU 推理）' : '未报告内存，按 4GB 假设' };
}

// 三档按 1.15 / 0.85 划，而不是 1.0 一刀切。
// 理由：8GB 内存的机器跑 7B Q4（约 5GB）在现实中是**能加载**的，只是要换页、慢得明显；
// 按 need 一刀切会把它判成「跑不动」，等于劝退一批其实能用的人。
// 反过来 0.85 以下基本是加载阶段就失败，那才是真的跑不动。
function verdict(need, budget) {
  if (budget >= need * 1.15) return { tag: '能跑', cls: 'yes', note: '留了余量，边跑边开别的程序也不会立刻炸' };
  if (budget >= need * 0.85) return { tag: '勉强', cls: 'mid', note: '能加载，但会换页、明显变慢；关掉别的程序会好一些' };
  return { tag: '跑不动', cls: 'no', note: '差 ' + gb(need - budget) + '，要么降量化要么换小模型' };
}

export async function run({ size, quant, ctx }) {
  const params = Number(size) || 7;
  const q = BPP[quant] ? quant : 'q4km';
  const ctxLen = Number(ctx) || 4096;
  const hw = await probe();
  const budget = budgetOf(hw);

  const need = needGB(params, q, ctxLen);
  const v = verdict(need, budget.gb);

  // 同规模四档量化的对照：这才是「换一档能省多少」的直接答案
  const rows = ['q4', 'q4km', 'q8', 'fp16']
    .map((k) => {
      const n = needGB(params, k, ctxLen);
      const vv = verdict(n, budget.gb);
      return `<tr><td>${QNAME[k]}${k === q ? '（当前）' : ''}</td><td>${gb(n)}</td><td class="${vv.cls}">${vv.tag}</td></tr>`;
    })
    .join('');

  const hwRows = [
    ['WebGPU', hw.gpu ? '有' : '没有'],
    ['适配器', hw.gpu ? [hw.vendor, hw.arch].filter(Boolean).join(' / ') || '浏览器未提供型号' : '—'],
    ['单缓冲上限', hw.maxBuf ? gb(hw.maxBuf) : '—'],
    ['系统内存（粗粒度）', hw.mem ? hw.mem + ' GB' : '浏览器未报告'],
    ['CPU 核心', hw.cores ? hw.cores + ' 核' : '浏览器未报告'],
    ['磁盘可用（本站配额）', hw.quota ? gb((hw.quota - hw.usage) / 1073741824) : '未知'],
    ['跨源隔离', hw.isolated ? '已开启（可用多线程 WASM）' : '未开启'],
  ]
    .map(([k, val]) => `<tr><td>${k}</td><td>${ESC(val)}</td></tr>`)
    .join('');

  // 建议按结论分三支写，避免「能跑」也配一句没用的安慰
  let advice;
  if (!hw.gpu) {
    advice =
      '这台机器的浏览器没开 WebGPU，只能走 CPU。' +
      (v.tag === '跑不动'
        ? '所选组合在 CPU 上也放不下，先把量化降到 Q4_0 或把规模降到 3B。'
        : '能跑但会慢：7B 通常每秒几个字，适合不赶时间的读写。真要快，得换支持 WebGPU 的浏览器或别的推理方式。');
  } else if (v.tag === '跑不动') {
    advice =
      `差 ${gb(need - budget.gb)}。三条路：量化降一档（Q8 → Q4_K_M 大约省一半）、` +
      '规模降一档（13B → 7B 也是大约一半）、或者把上下文从 32K 降到 4K。';
  } else if (v.tag === '勉强') {
    advice = '能加载，但没有余量。跑之前关掉别的吃内存的程序；如果它开始卡，先降量化，不要先降上下文——上下文对质量的影响反而更小。';
  } else {
    advice = `还有 ${gb(budget.gb - need)} 余量，可以放心跑。想同时开多个模型或拉长上下文，也还撑得住。`;
  }

  return {
    html:
      `<div class="msg-ok">${PNAME[params]} · ${QNAME[q]} · ${ctxLen / 1024}K 上下文 → <b>${v.tag}</b>（需要 ${gb(need)}，可用约 ${gb(budget.gb)}）</div>` +
      `<p class="ai-note">${ESC(v.note)}。${ESC(advice)}</p>` +
      `<h3>这台机器的实测值</h3><table class="cmp-table"><tr><th>项目</th><th>结果</th></tr>${hwRows}</table>` +
      `<p class="ai-note">可用预算：${ESC(budget.how)}。<b>浏览器不暴露显存总量</b>，所以这里给的是估算区间，不是显卡规格书上那个数。</p>` +
      `<h3>同规模换量化的差别</h3><table class="cmp-table"><tr><th>量化档</th><th>需要内存</th><th>结论</th></tr>${rows}</table>` +
      `<p class="ai-note">按权重 + KV cache + 运行时开销估算，误差约 ±20%；实际以跑起来为准。下载模型前记得看一眼磁盘：一个 7B 的 Q4 文件大约 4.4GB。</p>`,
    text: `${PNAME[params]} · ${QNAME[q]} · ${ctxLen / 1024}K → ${v.tag}（需要 ${gb(need)}，可用约 ${gb(budget.gb)}）`,
  };
}
