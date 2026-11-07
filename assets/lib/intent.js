/**
 * 本地意图解析（v3.0 E4 起，v3.31 升级为「建议一条流程」）：
 *   把「把这张图压到 200KB」这样的话，映射到工具与预填参数；
 *   若这句话指向的工具是某条流程的后半段，就改推整条流程（见 recommend）。
 *
 * 为什么不用大模型：
 *   本站的立身之本是「输入不上传」。为了猜工具把用户输入发给第三方 API，等于把最核心的承诺换掉。
 *   而工具选择这件事本身是有限集合（70 个本地工具 + 6 条流程），规则 + 关键词足够覆盖绝大多数说法，
 *   而且完全离线、零延迟、可被测试断言。
 *
 * 边界（写在这里以免过度期待）：
 *   - 不处理复杂句法：一句话里同时说两件事，只会命中先匹配到的那条规则
 *   - 参数只填「有把握」的字段（质量、金额），其余靠用户自己确认
 *   - 不现场拼链：理由见 recommend 上方
 */
import { canFeed } from './tool-io.js';

const RULES = [
  // —— 图片 ——（更具体的写在前面，避免被宽泛规则抢走）
  {
    id: 'image-base64',
    re: /(图|图片|照片).{0,6}base64|base64.{0,6}(图|图片|照片)/,
  },
  {
    id: 'img-to-pdf',
    re: /(图|图片|照片|截图).{0,8}(转|做成|生成|合成).{0,4}pdf|pdf.{0,6}(图|图片|照片)/,
  },
  {
    id: 'exif-strip',
    re: /(exif|元数据|拍摄信息|位置信息|gps).{0,8}(去掉|清除|剥离|删除|查看)|(去掉|清除|删除).{0,6}(exif|元数据)/,
  },
  {
    id: 'image-compress',
    re: /压缩.{0,6}(图|图片|照片|截图|png|jpg|webp)|(图|图片|照片|截图).{0,8}(压缩|压到|压成|变小|压小|缩小|瘦身|太大)|压到\s*\d+\s*(kb|mb)/,
    params: (q) => {
      const pct = q.match(/(\d{1,2})\s*%/);
      if (pct) return { quality: clamp(+pct[1], 10, 95) };
      const kb = q.match(/(\d+(?:\.\d+)?)\s*(kb|k|mb|m)\b/i);
      if (kb) {
        const kbVal = kb[2].toLowerCase().startsWith('m') ? +kb[1] * 1024 : +kb[1];
        // 目标越小，画质越激进；只是粗略映射，用户仍能在表单里调
        return { quality: clamp(Math.round(kbVal <= 100 ? 35 : kbVal <= 300 ? 60 : kbVal <= 800 ? 75 : 85), 10, 95) };
      }
      return {};
    },
  },
  {
    id: 'image-resize',
    re: /(改|调|缩|限制).{0,4}(尺寸|大小|宽度|高度|分辨率|边长)|最大边|\d{2,5}\s*(px|像素)|resize/i,
    params: (q) => {
      const px = q.match(/(\d{2,5})\s*(px|像素)/i) || q.match(/宽(?:度)?\s*(\d{2,5})/);
      if (!px) return {};
      // 该工具的「最大边长」是离散选项，取不小于目标的最近一档，免得缩得比用户要的更小
      const allowed = [256, 512, 1200, 1920];
      const pick = allowed.find((v) => v >= +px[1]) ?? allowed[allowed.length - 1];
      return { max: String(pick) };
    },
  },
  {
    id: 'image-convert',
    re: /(转|换|改).{0,6}(webp|png|jpe?g|avif|格式)|格式.{0,4}(转|换)/i,
  },
  {
    id: 'pdf-merge',
    re: /(合并|拼接|拆分).{0,6}pdf|pdf.{0,6}(合并|拼接|拆分)/i,
  },
  {
    id: 'qr-decode',
    re: /(识别|解码|扫描?|读取).{0,6}(二维码|qr)|(二维码|qr).{0,6}(识别|解码)/i,
  },
  {
    id: 'qrcode',
    re: /(生成|做|制作|来一个).{0,6}(二维码|qr)|(二维码|qr).{0,6}(生成|图片)/i,
  },
  // —— 文本 / 数据 ——
  {
    id: 'json-format',
    re: /json.{0,8}(格式|美化|校验|压缩|排版|查看)|(格式化|美化|校验).{0,8}json/i,
  },
  {
    id: 'csv-columns',
    re: /csv.{0,12}(列|提列|筛选|抽)|(提取|筛选|抽).{0,6}列/,
  },
  {
    id: 'csv-json',
    re: /csv.{0,10}(json|转)|(json|转).{0,10}csv/i,
  },
  {
    id: 'timestamp',
    re: /(时间戳|unix|timestamp).{0,8}(转|换|格式|日期)?|(\d{10,13}).{0,6}(转|日期|时间)/i,
  },
  {
    id: 'timezone-convert',
    re: /(时区|时差|utc|gmt).{0,8}(换|转换|对照|换算)?|(纽约|伦敦|东京|洛杉矶|旧金山).{0,4}时间/i,
  },
  {
    id: 'unit-convert',
    re: /(单位|换算).{0,8}|(英寸|厘米|毫米|华氏|摄氏|公斤|磅|市斤|亩).{0,6}(换算|等于|多少)/,
  },
  {
    id: 'tax-calc',
    re: /(个税|个人所得税|税后|到手|工资|月薪)/,
    params: (q) => {
      const m = q.match(/(\d+(?:\.\d+)?)\s*(万|w|k|千)?/i);
      if (!m) return {};
      let n = +m[1];
      const unit = (m[2] || '').toLowerCase();
      if (unit === '万' || unit === 'w') n *= 10000;
      else if (unit === 'k' || unit === '千') n *= 1000;
      return n >= 1000 ? { salary: Math.round(n) } : {};
    },
  },
  {
    id: 'mortgage-calc',
    re: /(房贷|月供|按揭|贷款).{0,8}|(等额本息|等额本金)/,
  },
  {
    id: 'jwt-decode',
    re: /(jwt|token).{0,8}(解析|解码|查看|decode)?|(解析|解码).{0,6}(jwt|token)/i,
  },
  {
    id: 'regex-tester',
    re: /(正则|regexp?|regex).{0,10}(测试|调试|匹配)?/i,
  },
  {
    id: 'word-count',
    re: /(字数|词数|字符数|统计.{0,4}字)/,
  },
  {
    id: 'text-diff',
    re: /(对比|比较|diff|差异).{0,8}(文本|文字|两段|两版|文件)|(文本|文字).{0,6}(对比|差异)/i,
  },
  {
    id: 'text-dedupe',
    re: /(去重|删除重复|重复行)/,
  },
  {
    id: 'case-convert',
    re: /(大小写|驼峰|下划线|短横线|命名风格|camel|snake|kebab)/i,
  },
  {
    id: 'base64-url',
    re: /base64.{0,8}(编码|解码|url|转换)?|(编码|解码).{0,6}base64/i,
  },
  {
    id: 'sha256-hash',
    re: /(sha256|sha-256|哈希|hash|摘要|md5)/i,
  },
  {
    id: 'password-gen',
    re: /(生成|随机|来一个).{0,6}(密码|口令)|(密码|口令).{0,6}(生成|随机)/,
  },
  {
    id: 'uuid-gen',
    re: /uuid|唯一标识|唯一 id/i,
  },
  {
    id: 'cron-parser',
    re: /(cron|定时任务|定时表达式|执行时间)/i,
  },
  {
    id: 'id-validate',
    re: /(身份证|统一社会信用代码|组织机构代码)/,
  },
  {
    id: 'color-contrast',
    re: /(对比度|可读性|wcag|无障碍.{0,4}颜色)/i,
  },
  {
    id: 'color-convert',
    re: /(颜色|色值|hex|rgb|hsl|oklch).{0,8}(转|换|转换|格式)?/i,
  },
  {
    id: 'markdown-preview',
    re: /(markdown|md).{0,8}(预览|渲染|排版)?|(预览|渲染).{0,6}(markdown|md)/i,
  },
  {
    id: 'python-run',
    re: /(运行|跑|执行).{0,6}(python|py|代码)|(python|py).{0,8}(代码|脚本|运行)/i,
  },
  {
    id: 'pandas-csv',
    re: /(pandas|csv).{0,10}(分析|统计|处理|聚合)/i,
  },
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * @param {string} query 用户输入的自然语言
 * @returns {{id:string, params:object, matched:string}|null}
 */
export function parseIntent(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return null;
  let best = null;
  for (const rule of RULES) {
    const m = q.match(rule.re);
    if (!m) continue;
    // 命中文本越长越可信；同长度保留先出现的规则（规则表已按具体度排序）
    if (!best || m[0].length > best.matched.length) {
      best = { id: rule.id, matched: m[0], params: rule.params ? rule.params(q) || {} : {} };
    }
  }
  return best;
}

/** 把意图拼成可直接打开的 URL（参数会被工具页的 restoreInputs 回填） */
export function intentUrl(intent) {
  if (!intent) return null;
  const url = new URL('/tools/' + intent.id + '/', 'https://x/');
  for (const [k, v] of Object.entries(intent.params || {})) url.searchParams.set(k, String(v));
  // 有参数就顺带跑一次（文件类工具会自动忽略 run，等用户选文件）
  if (Object.keys(intent.params || {}).length) url.searchParams.set('run', '1');
  return url.pathname + url.search;
}

/* ---------------- 流程推荐（v3.31）：从「猜一个工具」到「建议一条流程」 ---------------- */

let CTX_PROMISE = null;

/**
 * 流程定义 + 端口声明，都按需取：不打字不下载，首屏一个字节都不为它付。
 * 取不到就返回空表——助手退回单工具模式，不报错、不挡路。
 */
export function loadContext() {
  if (!CTX_PROMISE) {
    const get = (u) =>
      fetch(u)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    CTX_PROMISE = Promise.all([get('/workflows/workflows.json'), get('/tools/io.json')]).then(([wf, io]) => ({
      flows: wf && Array.isArray(wf.flows) ? wf.flows : [],
      io: io && typeof io === 'object' ? io : {},
    }));
  }
  return CTX_PROMISE;
}

/**
 * 流程名跟这句话有多像——命中 2 个词才算相关。
 *
 * 为什么不是「命中 1 个词」：
 *   「把图片压到 200KB」和流程「图片发布包」只共享「图片」一个泛词，
 *   按 1 个词算就会把一个只想压图的人推去走三步流程（还顺手改了他的边长）。
 *   说中两个词（「照片」+「PDF」）才是在说同一件事。
 * 为什么不用整词匹配：
 *   「照片转 PDF」与流程名「照片成 PDF」没有公共整词，但共享「照片」与「pdf」，
 *   所以要拿 2 字滑窗 + 英文/数字词，再看命中个数：
 *   照片成 PDF → {照片, 片成, pdf}，命中 2 → 相关；
 *   编码串还原 JSON → 命中 json 一个 → 不相关（用户只是要格式化，不是要还原编码串）。
 */
function related(name, query) {
  const q = String(query || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  const words = new Set();
  for (const seg of String(name || '').match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    for (let i = 0; i + 2 <= seg.length; i++) words.add(seg.slice(i, i + 2));
  }
  for (const w of String(name || '').toLowerCase().match(/[a-z]{2,}|\d+/g) || []) words.add(w);
  let hits = 0;
  for (const w of words) if (q.includes(w)) hits++;
  return hits >= 2;
}

/**
 * 一句话 → 一条可执行建议。返回 { kind, url, tag, name, desc, go }，没有命中则 null。
 *
 * 为什么不是「只要有流程就推流程」：
 *   命中工具在流程第 2 步及之后，说明这条路有前置步骤，而用户那一句话几乎总是漏了前置——
 *   「照片转 PDF」漏了先限边长，转出来还是手机原图尺寸，文件大得发不出去。
 *   命中工具是流程首步时，用户直接开工具就够用，把整条流程塞过去等于平白多三步。
 *   所以只有「非首步」才主推流程。
 *
 * 为什么不做「没流程就现场拼一条」：
 *   拼链要求下游唯一。图片类工具 11 个、其中 8 个吃 image，从 image 出发根本没有唯一解，
 *   硬拼就是猜；猜错的表现是把 A 的产物喂给 B，B 不一定报错，只输出一个看着正常的错东西。
 *   真正需要拼链时，人写一条放进 workflows.json 更可靠，而且能被构建期闸门验。
 *   端口仍然要用：下面用它挡掉「端口对不上」的流程（万一 workflows.json 被手工改过没重建）。
 */
export function recommend(query, opts = {}) {
  const { flows = [], io = {}, nameOf, t = (zh) => zh } = opts;
  const hit = parseIntent(query);
  if (!hit) return null;
  const name = nameOf ? nameOf(hit.id) : hit.id;
  if (!name) return null; // 工具不存在或是外链（没有 run.js，进不去）

  /** 相邻两步端口是否都成立。io 缺项时放行——宁可不推荐，也不要因为数据没同步就挡住工具。 */
  const chainOk = (steps) => {
    for (let i = 1; i < steps.length; i++) {
      const a = io[steps[i - 1].tool];
      const b = io[steps[i].tool];
      if (a && b && !canFeed(a.out, b.in)) return false;
    }
    return true;
  };

  let best = null;
  for (const f of flows) {
    const steps = Array.isArray(f.steps) ? f.steps : [];
    const idx = steps.findIndex((s) => s && s.tool === hit.id);
    if (idx < 0 || !chainOk(steps)) continue;
    if (!related(f.name, query)) continue; // 名字对不上就只是「同一个工具」，不是同一件事
    // 命中多条时取步数最少的：步数多不代表更合适，只是更容易被放弃
    if (!best || steps.length < best.steps.length) best = { flow: f, idx, steps };
  }

  const params = Object.entries(hit.params || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');

  if (best && best.idx > 0) {
    return {
      kind: 'flow',
      url: '/workflows/?flow=' + encodeURIComponent(best.flow.id),
      tag: t('🔗 建议走这条流程', 'intentFlow'),
      name: best.flow.name,
      desc: `${best.steps.length} 步${best.flow.cost ? ' · ' + best.flow.cost : ''}`,
      go: t('打开流程 →', 'intentFlowGo'),
    };
  }

  return {
    kind: 'tool',
    url: intentUrl(hit),
    tag: t('💡 也许你要', 'intentMaybe'),
    name,
    desc: params,
    go: t('打开并预填 →', 'intentGo'),
  };
}
