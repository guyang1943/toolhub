// 工作流的纯逻辑：端口绑定、参数合并、参数校验（v3.23）
//
// 为什么单独一个文件，而不是直接写在引擎里：
//   一份逻辑有三个地方要用——浏览器里的引擎（assets/workflow.js）、构建期闸门
//   （scripts/check-workflows.mjs）、闸门自己的测试（scripts/workflow-test.mjs）。
//   如果构建期用一套规则、运行时用另一套，那么「构建期通过」就不再等于「点运行不会崩」，
//   而工作流这类编排系统的腐烂方式恰恰是参数漂移：工具改了表单，流程没跟着改。
//   所以绑定规则只能有一份实现，这里就是那一份。Node 与浏览器都能直接 import。
//
// 刻意不做的事：
//   · 不用 eval / new Function 求值。绑定表达式只有四种写法，多一种就多一个注入面，
//     而且「用户能写的表达式」和「用户能做的危险操作」之间只差一个字符。
//   · 不在流程里写死「某工具输出什么类型」。上一步到底给了文件还是文本，由它实际返回什么决定；
//     静态检查能验的是「这个工具的输入项存在、参数合法、每个输入都有确定的值」。

/* ---------------- 引用语法 ---------------- */
//
//   in.file   用户选的单个文件        in.files  用户选的全部文件
//   in.text   用户输入的文本
//   files[N]  上一步产出的第 N 个文件（从 0 起）
//   text      上一步产出的文本
//
// 就这五种。少即是好：每一种都有一个明确的、可静态校验的语义。

/** 解析一个引用串，非法返回 null（不抛，调用方要分开处理「写错」与「没值」） */
export function parseRef(ref) {
  if (typeof ref !== 'string') return null;
  const s = ref.trim();
  if (s === 'in.file') return { stage: 0, kind: 'file', index: 0 };
  if (s === 'in.files') return { stage: 0, kind: 'file', index: -1 };
  if (s === 'in.text') return { stage: 0, kind: 'text', index: -1 };
  if (s === 'text') return { stage: 1, kind: 'text', index: -1 };
  const m = /^files\[(\d+)\]$/.exec(s);
  if (m) return { stage: 1, kind: 'file', index: Number(m[1]) };
  return null;
}

/** 所有合法的引用写法，构建期报错时原样列给作者看 */
export const REF_FORMS = ['in.file', 'in.files', 'in.text', 'files[0]', 'text'];

/**
 * 一个输入项是「文件口」还是「文本口」。
 * 返回 null 表示它不是数据入口（下拉、滑块、多行以外的单行以外……），只能靠 args 或默认值。
 */
export function inputKind(input) {
  if (!input) return null;
  if (input.type === 'file') return 'file';
  if (input.type === 'textarea' || input.type === 'text') return 'text';
  return null;
}

/* ---------------- 参数校验 ---------------- */

/**
 * 按 manifest 校验 step.args。返回问题列表（空数组 = 通过）。
 * 这一份同时被构建期闸门调用，所以文案要能直接指认到字段。
 */
export function validateArgs(manifest, step) {
  const errs = [];
  const inputs = Array.isArray(manifest?.inputs) ? manifest.inputs : [];
  const tool = step?.tool || '(未命名)';
  for (const [key, val] of Object.entries(step?.args || {})) {
    const input = inputs.find((i) => i.name === key);
    if (!input) {
      errs.push(`args.${key} 不是 ${tool} 的输入项（它有：${inputs.map((i) => i.name).join(' / ')}）`);
      continue;
    }
    if (input.type === 'file') {
      errs.push(`args.${key} 是文件输入，不能在这里写死值，请改用 bind`);
      continue;
    }
    if (typeof val === 'object' && val !== null) {
      errs.push(`args.${key} 只能是标量，不能是对象或数组`);
      continue;
    }
    if (input.type === 'select') {
      const allowed = (input.options || []).map((o) => String(o.value));
      if (!allowed.includes(String(val))) {
        errs.push(`args.${key} = ${JSON.stringify(val)} 不在 ${tool} 的选项里（可选：${allowed.join(' / ')}）`);
      }
      continue;
    }
    if (input.type === 'range' || input.type === 'number') {
      const n = Number(val);
      if (!Number.isFinite(n)) {
        errs.push(`args.${key} = ${JSON.stringify(val)} 不是数字`);
        continue;
      }
      if (input.min != null && n < input.min) errs.push(`args.${key} = ${n} 小于下限 ${input.min}`);
      if (input.max != null && n > input.max) errs.push(`args.${key} = ${n} 大于上限 ${input.max}`);
    }
  }
  return errs;
}

/* ---------------- 端口绑定 ---------------- */

/** 这个阶段「上一段」产出的默认引用：首步取用户输入，其余取上一步 */
const defaultRef = (index, kind) => (index === 0 ? (kind === 'file' ? 'in.file' : 'in.text') : kind === 'file' ? 'files[0]' : 'text');

/**
 * 规划一步：每个输入的值从哪来。**构建期与运行时走的是同一个函数**。
 * 返回 { values:[{name, from, ref?}], errors:[] }，from 为 arg / bind / default / auto。
 *
 * 规则（三条，都不做猜测）：
 *   1. args 与 bind 不能同时给同一个输入赋值——两处都写，谁赢都是错的，直接报。
 *   2. 同一类数据口（文件口 / 文本口）在一个工具里只能有一个，才允许自动接。
 *      有两个而没显式 bind，就报错：猜错的代价是把 A 的产物喂给 B，而 B 通常不报错，
 *      只会输出一个看起来很正常的错东西。
 *   3. 每个输入都必须有确定的值（args / bind / 默认值 / 自动接）。流程不能在中途停下来问人。
 */
export function planStep(manifest, step, index) {
  const inputs = Array.isArray(manifest?.inputs) ? manifest.inputs : [];
  const args = step?.args || {};
  const bind = step?.bind || {};
  const values = [];
  const errors = [];

  for (const key of Object.keys(bind)) {
    if (!inputs.some((i) => i.name === key)) {
      errors.push(`bind.${key} 不是 ${step.tool} 的输入项`);
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      errors.push(`${key} 同时写在 args 与 bind 里，只能留一处`);
    }
    if (!parseRef(bind[key])) {
      errors.push(`bind.${key} = ${JSON.stringify(bind[key])} 不是合法引用（可用：${REF_FORMS.join(' / ')}）`);
    }
  }

  for (const input of inputs) {
    if (Object.prototype.hasOwnProperty.call(args, input.name)) {
      values.push({ name: input.name, from: 'arg' });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(bind, input.name)) {
      values.push({ name: input.name, from: 'bind', ref: bind[input.name] });
      continue;
    }
    if (input.default !== undefined && input.default !== null) {
      values.push({ name: input.name, from: 'default' });
      continue;
    }
    const kind = inputKind(input);
    if (!kind) {
      errors.push(`输入 ${input.name} 没有默认值，也没在 args 里给值——流程里不能留空`);
      continue;
    }
    const sameKind = inputs.filter((i) => inputKind(i) === kind);
    if (sameKind.length > 1) {
      errors.push(
        `${step.tool} 有 ${sameKind.length} 个${kind === 'file' ? '文件' : '文本'}输入（${sameKind
          .map((i) => i.name)
          .join(' / ')}），自动接会接错，请在流程里用 bind 写明`
      );
      continue;
    }
    values.push({ name: input.name, from: 'auto', ref: defaultRef(index, kind) });
  }

  return { values, errors };
}

/* ---------------- 运行时取值 ---------------- */

/** 上一步给的是 { name, blob, kind }，工具要的是 File——补一层，别让工具自己判断 */
function toFile(f) {
  if (!f) return null;
  if (typeof File !== 'undefined' && f instanceof File) return f;
  const blob = f.blob || f;
  const name = f.name || (blob && blob.name) || 'file';
  try {
    return new File([blob], name, { type: (blob && blob.type) || '' });
  } catch {
    return blob;
  }
}

/** 把一个引用解析成实际的值。取不到就抛——错误信息要能让用户看懂是哪一步缺东西 */
export function resolveRef(ref, input, ctx) {
  const r = parseRef(ref);
  if (!r) throw new Error(`引用写法不合法：${JSON.stringify(ref)}`);
  const multi = !!input?.multiple;

  if (r.stage === 0) {
    if (r.kind === 'text') return String(ctx?.text ?? '');
    const list = ctx?.files || (ctx?.file ? [ctx.file] : []);
    if (!list.length) throw new Error('还没有选择文件');
    const f = toFile(list[r.index === -1 ? 0 : r.index]);
    return multi ? [f] : f;
  }

  if (r.kind === 'text') {
    const t = ctx?.prev?.text;
    if (!t) throw new Error('上一步没有文本产出');
    return t;
  }
  const files = ctx?.prev?.files || [];
  const f = files[r.index];
  if (!f) throw new Error(`上一步没有第 ${r.index + 1} 个文件（它只产出 ${files.length} 个）`);
  const file = toFile(f);
  return multi ? [file] : file;
}

/**
 * 把一步的实参凑齐。构建期用它做「能不能凑齐」的静态预演，运行时用它拿真值。
 * @param {object} manifest 工具的 manifest（inputs 为准）
 * @param {object} step     流程里的一步
 * @param {number} index    步骤序号（0 起，决定首步还是续接）
 * @param {object} ctx      { file, files, text, prev:{files,text} }
 */
export function buildValues(manifest, step, index, ctx = {}) {
  const plan = planStep(manifest, step, index);
  if (plan.errors.length) throw new Error(plan.errors.join('；'));
  const inputs = Array.isArray(manifest?.inputs) ? manifest.inputs : [];
  const out = {};
  for (const v of plan.values) {
    const input = inputs.find((i) => i.name === v.name);
    if (v.from === 'arg') out[v.name] = step.args[v.name];
    else if (v.from === 'default') out[v.name] = input.default;
    else out[v.name] = resolveRef(v.ref, input, ctx);
  }
  return out;
}

/* ---------------- 类型兼容 ---------------- */

/**
 * 流程入口的文件类型，第一步吃不吃得下。
 * 这是「构建期能抓、运行时很难解释」的一类错：用户选完图，第一步报「请选择 JPG 照片」，
 * 看起来像工具坏了，实际是流程入口写宽了。
 * @returns {string[]} 吃不下的类型（空 = 通过）
 */
export function acceptMismatch(flowAccept, toolAccept) {
  const tokens = (s) =>
    String(s || '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  const flow = tokens(flowAccept);
  const tool = tokens(toolAccept);
  if (!flow.length || !tool.length) return [];
  const ok = (t) =>
    tool.some((x) => {
      if (x === t) return true;
      if (x.endsWith('/*')) return t.startsWith(x.slice(0, -1));
      if (x === '*/*') return true;
      // .jpg 这类扩展名：把 image/jpeg 与 .jpeg 视为同一族，靠「/」后那段对得上
      const a = x.startsWith('.') ? x.slice(1) : x.split('/').pop();
      const b = t.startsWith('.') ? t.slice(1) : t.split('/').pop();
      return a === b || (a === 'jpg' && b === 'jpeg') || (a === 'jpeg' && b === 'jpg');
    });
  return flow.filter((t) => !ok(t));
}
