/**
 * 成本页（v3.44）：公式 + 三个反直觉点 + 换算器 + 官方入口。
 *
 * 这一页**不做价格表**。价格是周级变化的东西：抄一张表，上线两周就开始撒谎，
 * 三个月后整站不可信。所以这里给的是算法、参数、以及「你自己去官方页抄两个数」的入口。
 *
 * 默认单价只给核到的那一家（DeepSeek，2026-11-28 取自官方 pricing 页）。
 * Anthropic 的文档站被区域限制、OpenAI 的价页被 Cloudflare 拦、Gemini 的价页抓不到——
 * 这三家就没有默认值，页面上直接写明「没核到」，不拿记忆里的数字凑。
 * 这和能力矩阵里留 `?` 是同一条规矩：承认不知道，比给一个看起来很像的假数字便宜。
 *
 * 三条硬规矩（用户拍板的第二条）：
 *   1. 每个默认值必须带 source 与 checkedAt；
 *   2. 必须有「恢复默认」——人改完能退回去；
 *   3. 必须明写「以官方页为准」，且默认值不许长得像实时价格。
 */

export const COST_LEAD =
  '这一页没有价格表。价格是周级变化的东西，抄一次就错一次；这里给公式、三个反直觉点和一个换算器，' +
  '单价你自己填，或者用核对过日期的那几个默认值。';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 单位：美元 / 每百万 token。cacheHit 是「输入命中缓存」的单价。 */
export const PRESETS = [
  {
    id: 'ds-flash-off',
    name: 'DeepSeek V4.1 Flash · 空闲时段',
    in: 0.15,
    out: 0.6,
    hit: 0.003,
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    checkedAt: '2026-11-28',
    note: '工作日 01–04 与 06–10 UTC 是高峰，单价翻倍',
  },
  {
    id: 'ds-flash-peak',
    name: 'DeepSeek V4.1 Flash · 高峰时段',
    in: 0.3,
    out: 1.2,
    hit: 0.006,
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    checkedAt: '2026-11-28',
    note: '同一个模型、同一个请求，只是换了个钟点，账单差一倍',
  },
  {
    id: 'ds-pro-off',
    name: 'DeepSeek V4 Pro · 空闲时段',
    in: 0.66,
    out: 1.98,
    hit: 0.022,
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    checkedAt: '2026-11-28',
    note: '大模型贵在输入与输出的倍数关系，不在绝对值',
  },
];

/** 表单默认值。刻意保守：一次请求 2K 输入 / 500 输出，一个月一万次。 */
export const DEFAULTS = { inTok: 2000, outTok: 500, reqs: 10000, inPrice: 0.15, outPrice: 0.6, hitRate: 0, hitPrice: 0.003 };

/**
 * 纯函数：给定参数算成本。抽出来是为了让 verify 能直接算一遍——
 * 计算器里最容易被改坏的不是界面，是「命中率乘错了位置」这种账。
 * 单位：token 数、美元/百万 token、百分比。
 */
export function costOf({ inTok, outTok, reqs, inPrice, outPrice, hitRate = 0, hitPrice = 0 }) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const hit = Math.min(100, Math.max(0, n(hitRate))) / 100;
  const missIn = n(inTok) * (1 - hit);
  const hitIn = n(inTok) * hit;
  const perReq = (missIn * n(inPrice) + hitIn * n(hitPrice) + n(outTok) * n(outPrice)) / 1e6;
  const monthly = perReq * n(reqs);
  const outShare = perReq > 0 ? (n(outTok) * n(outPrice)) / 1e6 / perReq : 0;
  return {
    perReq,
    monthly,
    outShare,
    inTokensMonth: n(inTok) * n(reqs),
    outTokensMonth: n(outTok) * n(reqs),
  };
}

const usd = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  if (v < 0.01) return '$' + v.toFixed(5);
  if (v < 1) return '$' + v.toFixed(4);
  if (v < 1000) return '$' + v.toFixed(2);
  return '$' + Math.round(v).toLocaleString('en-US');
};
const num = (v) => Math.round(v).toLocaleString('en-US');

/**
 * 结果区。构建期与运行时共用一段：静态页里的数字必须和打开后算出来的一致，
 * 否则「禁用 JS 时看到一个数、启用后变另一个数」，读者会以为整页都在编。
 */
function statsHTML(v) {
  const c = costOf(v);
  const pct = Math.round(c.outShare * 100);
  // 命中率 0 时给一个「如果 80% 命中」的对照：这一条比任何文案都能说明缓存的价值
  let cacheTip = '';
  if (v.hitRate <= 0 && v.hitPrice > 0) {
    const c80 = costOf({ ...v, hitRate: 80 });
    const save = c.monthly > 0 ? 1 - c80.monthly / c.monthly : 0;
    if (save > 0.01) cacheTip = `<p class="c-tip">如果输入里 80% 能命中缓存，月账单约 ${usd(c80.monthly)}（省 ${Math.round(save * 100)}%）——靠的是把前缀固定住。</p>`;
  }
  return (
    `<div class="c-stats">` +
    `<div><span class="c-k">单次请求</span><b>${usd(c.perReq)}</b></div>` +
    `<div><span class="c-k">每月</span><b>${usd(c.monthly)}</b></div>` +
    `<div><span class="c-k">输出占总成本</span><b>${pct}%</b></div>` +
    `<div><span class="c-k">每月 token</span><b>${num(c.inTokensMonth + c.outTokensMonth)}</b></div>` +
    `</div>` +
    `<p class="c-hint">${num(v.inTok)} 输入 + ${num(v.outTok)} 输出，每月 ${num(v.reqs)} 次。` +
    (pct >= 50
      ? `输出承担了 ${pct}% 的成本——缩短回答比压缩输入更省钱。`
      : `输入占了大头，看看能不能靠复用前缀把它变成缓存命中。`) +
    `</p>` +
    cacheTip
  );
}

/** 一个输入行。七行都是同一形状，写成函数免得改一处漏一行（漏的那行会没有 id，计算器静默当 0）。 */
function field(id, name, value, unit, step, mode = 'numeric', extra = '') {
  return (
    `<label><span class="c-name">${name}</span>` +
    `<input type="number" id="${id}" min="0" step="${step}" value="${value}" inputmode="${mode}"${extra}>` +
    `<span class="c-unit">${unit}</span></label>`
  );
}

/** 正文。静态页与 SPA 共用；计算器的交互在 mountCost() 里。 */
export function costBody() {
  const presetRows = PRESETS.map(
    (p) =>
      `<tr><th scope="row">${esc(p.name)}</th><td class="c-num">$${p.in}</td><td class="c-num">$${p.out}</td>` +
      `<td class="c-num">$${p.hit}</td><td class="c-num">${esc(p.checkedAt)}</td></tr>`
  ).join('');

  return `
      <h2>先记住这一条公式</h2>
      <p class="c-formula">成本 = 输入 tokens × 输入单价 + 输出 tokens × 输出单价</p>
      <p>看起来平平无奇，但三件让人意外的事全藏在这三个乘号里。另外，<b>token 不等于字数</b>：
      中文大约 1 个字 ≈ 0.6–1 个 token，各家分词器不一样；英文大约 1 个词 ≈ 1.3 个 token。
      想知道你那段话到底多少 token，用 <a href="/tools/token-counter/">站内的 token 计数器</a>量一下最快。</p>

      <h2>三个反直觉的点</h2>
      <ol class="c-points">
        <li><b>输出比输入贵，而且贵得不少。</b>按 DeepSeek 的公开价，输入 $0.15 / 输出 $0.60（每百万 token，
        空闲时段）——4 倍。也就是说，让模型「详细说说」比「读你几千字」更容易把账单推上去。</li>
        <li><b>推理模型的思考 token 按输出计费。</b>它先想一段再回答，想的那段也是钱，而且常常比答案还长。
        同一条问题，「思考模式」的账单可以是普通模式的几倍——这不是它偷偷多收，是它真的输出了那些 token。</li>
        <li><b>命中缓存能便宜一个数量级。</b>同一个模型：缓存命中 $0.003，未命中 $0.15——差 50 倍。
        所以系统提示词、长文档前缀、同一个文件的第二轮追问，都应该尽量复用，而不是每轮重新粘贴。</li>
      </ol>
      <p>还有一条不算反直觉，但比上面三条更贵：<b>峰谷差</b>。DeepSeek 的高峰时段单价是空闲时段的两倍，
      而高峰只占工作日的一小段。批量任务挪到夜里跑，账单直接砍半——这一条不需要改任何代码。</p>

      <h2>算一下你自己的账</h2>
      <p>下面的数都是<b>示例初始值</b>，请按你合同或官方页上的单价改。所有计算在你这台机器上完成，
      数字不会发到任何地方，刷新即还原。</p>
      <form class="c-calc" id="cost-app" autocomplete="off">
        <div class="c-grid">
          ${field('c-in-tok', '每次请求输入', DEFAULTS.inTok, 'token', 100)}
          ${field('c-out-tok', '每次请求输出', DEFAULTS.outTok, 'token', 50)}
          ${field('c-reqs', '每月请求数', DEFAULTS.reqs, '次', 100)}
          ${field('c-in-price', '输入单价', DEFAULTS.inPrice, '$/百万', 0.001, 'decimal')}
          ${field('c-out-price', '输出单价', DEFAULTS.outPrice, '$/百万', 0.001, 'decimal')}
          ${field('c-hit-rate', '缓存命中比例', DEFAULTS.hitRate, '%', 5, 'numeric', ' max="100"')}
          ${field('c-hit-price', '命中时单价', DEFAULTS.hitPrice, '$/百万', 0.001, 'decimal')}
        </div>
        <div class="c-presets">
          <span class="c-label">一键填入（默认单价）：</span>
          ${PRESETS.map((p) => `<button type="button" class="c-chip" data-preset="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
          <button type="button" class="c-chip c-reset" id="c-reset">恢复默认</button>
        </div>
        <div class="c-out" id="cost-out" aria-live="polite">${statsHTML(DEFAULTS)}</div>
        <p class="c-src" id="cost-src"></p>
      </form>

      <h2>默认单价从哪来</h2>
      <div class="c-wrap"><table class="c-table">
        <thead><tr><th scope="col">模型 / 时段</th><th scope="col">输入</th><th scope="col">输出</th><th scope="col">缓存命中</th><th scope="col">核对日期</th></tr></thead>
        <tbody>${presetRows}</tbody>
      </table></div>
      <p>单位：美元 / 每百万 token。三项都取自官方定价页（链接在下面），<b>核对日期 ${PRESETS[0].checkedAt}</b>。
      这一页不会跟着官方调价自动更新——<b>价格会变，以官方页为准</b>；你看到与官方不一致，就是这里过期了。</p>
      <p>Anthropic、OpenAI、Google 三家这次<b>没有给默认值</b>：写这一页的时候，Anthropic 的文档站按地区拒绝访问、
      OpenAI 的价页被安全策略拦下、Gemini 的价页抓取失败。我没有拿记忆里的数字去填——那种数字最像真的，
      也最容易让人算错预算。要用这几家，点下面的官方入口抄两个数填进计算器，一样能算。</p>

      <h2>官方定价入口</h2>
      <ul class="c-links">
        <li><a href="https://api-docs.deepseek.com/quick_start/pricing" target="_blank" rel="noopener">DeepSeek · Models &amp; Pricing ↗</a>（有峰谷价，页面写明时段）</li>
        <li><a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener">Anthropic · Pricing ↗</a></li>
        <li><a href="https://platform.openai.com/docs/pricing" target="_blank" rel="noopener">OpenAI · Pricing ↗</a></li>
        <li><a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noopener">Google · Gemini API Pricing ↗</a></li>
      </ul>
      <p class="c-note">只给链接、不抄数字，是这一页的设计，不是偷懒：抄一次就错一次，而错的价格会被人当真拿去报价。
      链接至少能保证你看到的是对方此刻的说法。</p>

      <h2>省钱的三件事，按性价比排</h2>
      <ol class="c-points">
        <li><b>先把要问的东西问清楚。</b>一次问不明白、来回五轮，比单价贵五倍更伤。这一条不花钱，只花几分钟。</li>
        <li><b>复用前缀。</b>系统提示词、长文档、同一份代码，放在每轮对话的开头并保持不变，命中缓存就是 50 倍差价。</li>
        <li><b>把批量活挪到空闲时段。</b>不需要改代码，只需要改运行时间。</li>
      </ol>
      <p>反过来，最不值的三件事：为了省 token 把问题写得含含糊糊（换来更多轮）、拿便宜模型硬做它做不了的事
      （换来重做）、以及「先买年付套餐再想需求」。</p>

      <h2>这一页不做什么</h2>
      <p>不预测你会用多少、不替你选模型、也不做「哪家最便宜」的排行榜——那要每周重排一次，排完还是会被调价打脸。
      这里的立场很简单：<b>算法是稳的，数字是变的</b>。所以给你算法和入口，数字你自己填。</p>`;
}

/**
 * 这一页的三条硬规矩，落成可校验的函数而不是文案承诺（构建期与 verify 都调它）：
 *   1. 每个默认单价带 source 与合法 checkedAt（且不能是未来日期）；
 *   2. 正文里必须有「恢复默认」这个出口，并且有至少一个可点的一键填入；
 *   3. 必须明写「以官方页为准」，且必须交代哪几家没给默认值。
 * 缺一条就是「看起来像实时报价的静态数字」——那比不写更糟。
 */
export function validateCost({ today } = {}) {
  const errors = [];
  const body = costBody();
  if (!PRESETS.length) errors.push('PRESETS 是空的：没有默认值时，正文里那张表会是空表');
  for (const p of PRESETS) {
    if (!/^https:\/\//.test(String(p.source || ''))) errors.push(`${p.id}：source 必须是 https 链接`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.checkedAt || ''))) errors.push(`${p.id}：checkedAt 必须是 YYYY-MM-DD`);
    else if (today && String(p.checkedAt) > today) errors.push(`${p.id}：checkedAt 在未来（${p.checkedAt} > ${today}）`);
    for (const k of ['in', 'out', 'hit']) {
      if (!Number.isFinite(p[k]) || p[k] < 0) errors.push(`${p.id}：${k} 必须是非负数`);
    }
    if (!body.includes(`href="${p.source}"`)) errors.push(`${p.id}：正文里没有指向官方定价页的链接`);
  }
  if (!body.includes('id="c-reset"')) errors.push('缺少「恢复默认」（id="c-reset"）');
  if (!body.includes('data-preset=')) errors.push('缺少一键填入的预设按钮');
  if (!body.includes('以官方页为准')) errors.push('缺少「以官方页为准」的声明');
  if (!body.includes('没有给默认值')) errors.push('没有交代哪几家没给默认值——那等于暗示表里就是全部');
  return { errors, presets: PRESETS.length };
}

/**
 * 挂载计算器。静态页与 SPA 都调这一个——两边只要有一份自己算的账，
 * 就会出现「爬虫看到 0.0006、用户看到 0.0009」这种谁也说不清的情况。
 */
export function mountCost(root) {
  if (!root) return;
  const q = (id) => root.querySelector('#' + id);
  const fields = {
    inTok: 'c-in-tok',
    outTok: 'c-out-tok',
    reqs: 'c-reqs',
    inPrice: 'c-in-price',
    outPrice: 'c-out-price',
    hitRate: 'c-hit-rate',
    hitPrice: 'c-hit-price',
  };
  const read = () => {
    const v = {};
    for (const [k, id] of Object.entries(fields)) {
      const el = q(id);
      v[k] = el ? Number(el.value) || 0 : 0;
    }
    return v;
  };
  const write = (v) => {
    for (const [k, id] of Object.entries(fields)) {
      const el = q(id);
      if (el) el.value = v[k];
    }
  };
  const out = q('cost-out');
  const src = q('cost-src');

  const render = () => {
    const v = read();
    if (!out) return;
    out.innerHTML = statsHTML(v);
  };

  root.addEventListener('input', render);
  root.addEventListener('change', render);

  root.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = PRESETS.find((x) => x.id === btn.dataset.preset);
      if (!p) return;
      write({ ...read(), inPrice: p.in, outPrice: p.out, hitPrice: p.hit });
      if (src) {
        src.innerHTML =
          `默认单价来自 <b>${esc(p.name)}</b>，核于 ${esc(p.checkedAt)}（<a href="${esc(p.source)}" target="_blank" rel="noopener">官方页 ↗</a>）。` +
          `${esc(p.note)}。<b>价格会变，以官方页为准。</b>`;
      }
      render();
    });
  });

  const reset = q('c-reset');
  if (reset) {
    reset.addEventListener('click', () => {
      write(DEFAULTS);
      if (src) src.textContent = '已恢复默认：2000 输入 / 500 输出 / 每月一万次，单价为示例值，请按官方页改。';
      render();
    });
  }

  if (src) src.textContent = '当前是示例单价（$0.15 / $0.60），不是报价。点上面的「一键填入」用核对过的官方价，或直接改成你合同上的数。';
  render();
}
