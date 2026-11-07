/**
 * 工具端口类型（io）：一个工具吃什么、产出什么。
 *
 * 为什么要有这个文件：
 *   工作流能不能接、助手该推荐哪条链，判断依据只能是「上一步产出什么、下一步吃什么」。
 *   在此之前这个依据是「目标工具只有一个 file 入参」（workflow-core 的自动接规则），
 *   那只能回答「有没有歧义」，回答不了「接得上吗」——把 PDF 喂给图片压缩，
 *   目标工具确实只有一个文件入参，但它接不住，而它不会报错，只会产出一张打不开的图。
 *
 * 为什么只有 6 类：
 *   端口分得越细，能接的越少。JSON / CSV / 纯文本拆成三类，是因为它们的下游真的不同
 *   （csv-json 只吃 CSV、json-format 只吃 JSON、其余文本工具只吃文本）；再往下拆
 *   （YAML / XML / SQL / Markdown）会变成一堆只有一两个工具认的类型，
 *   等于把「接不上」变成常态，端口也就没用了。
 *
 * 为什么不用 MIME：
 *   MIME 说的是文件怎么存，端口说的是数据是什么。json-format 的输入是个 textarea，
 *   MIME 给不出「这里面装的是 JSON」这个区别，而助手恰恰需要它。
 */

export const PORTS = ['image', 'pdf', 'text', 'json', 'csv', 'file'];

export const PORT_LABEL = {
  image: '图片',
  pdf: 'PDF',
  text: '文本',
  json: 'JSON',
  csv: '表格',
  file: '任意文件',
};

/** 工具自己声明的 io 是否合法。返回错误数组，空 = 通过。 */
export function validateIo(io, where = 'io') {
  const errs = [];
  if (!io || typeof io !== 'object' || Array.isArray(io)) return [`${where} 缺失或不是对象`];
  const keys = Object.keys(io).sort().join(',');
  if (keys !== 'in,out') errs.push(`${where} 只允许 in / out 两个键（实际：${keys || '空'}）`);
  for (const side of ['in', 'out']) {
    const list = io[side];
    if (!Array.isArray(list) || !list.length) {
      errs.push(`${where}.${side} 必须是非空数组`);
      continue;
    }
    for (const p of list) if (!PORTS.includes(p)) errs.push(`${where}.${side} 含未知端口 ${JSON.stringify(p)}`);
    if (new Set(list).size !== list.length) errs.push(`${where}.${side} 有重复端口`);
    // file 是兜底类型：既然声明了具体类型，就不该再写 file
    if (list.includes('file') && list.length > 1) {
      errs.push(`${where}.${side} 里 file 不能与具体类型并存（file 表示「任意，含未知」）`);
    }
  }
  return errs;
}

/**
 * 上一步的产出能不能喂给下一步。
 *
 * 规则一：类型有交集就接得上——双向工具（csv-json / json-yaml）本来就吃两种。
 * 规则二：text 是「未定型文本」，可以流向 text / json / csv 三种口。
 *   这条不是放宽，是被 b64-to-json 流程逼出来的事实：base64-url 解码出来的东西
 *   可能是 JSON、可能是一段普通文字，工具自己也不知道，要等运行期解析。
 *   如果按「text 只能进 text」判，那条流程会被构建期判死，可它每次跑都是对的。
 * 规则三：json / csv 是「已定型文本」，只能流向同类型或 text，不能互相串。
 *   反过来不成立——把 CSV 喂给 json-format 会解析失败，那就是真接错了。
 */
export function canFeed(outPorts, inPorts) {
  const outs = Array.isArray(outPorts) ? outPorts : [];
  const ins = Array.isArray(inPorts) ? inPorts : [];
  if (!outs.length || !ins.length) return false;
  if (outs.some((p) => ins.includes(p))) return true;
  // 未定型文本可以进任何文本类数据口
  return outs.includes('text') && ins.some((p) => p === 'text' || p === 'json' || p === 'csv');
}

/** 给界面用的一句话：图片 → PDF */
export function ioText(io, arrow = ' → ') {
  const label = (list) => (Array.isArray(list) ? list.map((p) => PORT_LABEL[p] || p).join(' / ') : '?');
  return `${label(io?.in)}${arrow}${label(io?.out)}`;
}
