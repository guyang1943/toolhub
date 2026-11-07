#!/usr/bin/env node
// 工作流引擎的单元测试（v3.23）
//
// 为什么要有这一套，而不是只靠 check-workflows：
//   闸门验的是「现有这三条流程配得对不对」，它挡不住引擎自己写错——绑定解析多认了一种写法、
//   自动接把两个口接串了、参数合并把默认值吞了，这些在流程数据正确时全都不会暴露。
//   所以这里一半是正例（真流程真能凑齐每个输入），另一半是**反例**：
//   每种错误都断言「必须报错，且报在对的地方」。只测正例的测试，改坏了也常常是绿的。
//
// 用法：node scripts/workflow-test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readManifest } from './lib/tool-manifest.mjs';
import { parseRef, planStep, buildValues, validateArgs, acceptMismatch, inputKind, exampleDefaultPorts, REF_FORMS, runBanner } from '../assets/lib/workflow-core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const throws = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return e.message;
  }
};

const file = (name = 'a.jpg', type = 'image/jpeg') => new File([new Uint8Array([1, 2, 3])], name, { type });

console.log('\n🧩 工作流引擎测试\n');

/* ---------- 1. 引用语法 ---------- */
console.log('· 引用语法');
{
  check('in.file / in.files / in.text / files[0] / text 都认', REF_FORMS.every((r) => parseRef(r)));
  check('files[3] 取到第 4 个', parseRef('files[3]').index === 3);
  const bad = ['prev.files[0]', 'files[-1]', 'files[0].name', 'in.files[0]', 'eval(1)', '', null];
  check(
    '别的写法一律不认（包括带查询、负下标、旧写法）',
    bad.every((r) => parseRef(r) === null),
    bad.find((r) => parseRef(r))
  );
  check('不认识的是 null，不是抛错——「写错」与「没值」要分开处理', parseRef('nope') === null);
}

/* ---------- 2. 参数校验 ---------- */
console.log('· 参数校验');
{
  const mf = {
    inputs: [
      { name: 'files', type: 'file', accept: 'image/jpeg', multiple: true },
      { name: 'quality', type: 'range', min: 10, max: 95, default: 70 },
      { name: 'format', type: 'select', default: 'image/jpeg', options: [{ value: 'image/jpeg' }, { value: 'image/webp' }] },
      { name: 'note', type: 'text' },
    ],
  };
  check('合规参数零问题', validateArgs(mf, { tool: 'x', args: { quality: 78, format: 'image/webp' } }).length === 0);
  check(
    '枚举值写错要报，并列出可选值',
    /不在 .* 的选项里/.test(validateArgs(mf, { tool: 'x', args: { format: 'image/gif' } })[0] || '')
  );
  check('滑块超上限要报', /大于上限 95/.test(validateArgs(mf, { tool: 'x', args: { quality: 120 } })[0] || ''));
  check('滑块低于下限要报', /小于下限 10/.test(validateArgs(mf, { tool: 'x', args: { quality: 5 } })[0] || ''));
  check('未知键要报，并列出该工具真有的输入', /不是 x 的输入项/.test(validateArgs(mf, { tool: 'x', args: { qulity: 1 } })[0] || ''));
  check('给文件输入写死值要报', /请改用 bind/.test(validateArgs(mf, { tool: 'x', args: { files: 'a.jpg' } })[0] || ''));
  check('对象当参数要报', /只能是标量/.test(validateArgs(mf, { tool: 'x', args: { quality: { v: 1 } } })[0] || ''));
}

/* ---------- 3. 端口规划 ---------- */
console.log('· 端口规划');
{
  const oneFile = { inputs: [{ name: 'file', type: 'file', accept: 'image/*' }] };
  const p0 = planStep(oneFile, { tool: 't' }, 0);
  check('首步的唯一文件口自动接用户输入', p0.values[0].ref === 'in.file');
  const p1 = planStep(oneFile, { tool: 't' }, 1);
  check('续接步的唯一文件口自动接上一步第 1 个文件', p1.values[0].ref === 'files[0]');

  const twoText = { inputs: [{ name: 'a', type: 'textarea' }, { name: 'b', type: 'text' }] };
  const amb = planStep(twoText, { tool: 't' }, 1);
  check(
    '同类口有两个又没写 bind → 必须报错，不许猜',
    amb.errors.length === 2 && amb.errors.every((e) => /自动接会接错/.test(e)),
    amb.errors.join('；')
  );
  const half = planStep(twoText, { tool: 't', bind: { b: 'text' } }, 1);
  check('只 bind 一个口时，另一个口不会静默放过', half.errors.length >= 1, half.errors.join('；'));
  const full = planStep(twoText, { tool: 't', bind: { a: 'in.text', b: 'text' } }, 1);
  check('两个口都写清 bind → 通过', full.errors.length === 0, full.errors.join('；'));

  const noDefault = { inputs: [{ name: 'mode', type: 'select' }] };
  check('下拉没有默认值、也没给 args → 报「不能留空」', /不能留空/.test(planStep(noDefault, { tool: 't' }, 0).errors[0] || ''));

  const both = { inputs: [{ name: 'file', type: 'file', accept: 'image/*' }] };
  check('同一输入既给 args 又给 bind → 报错', planStep(both, { tool: 't', args: { file: 'x' }, bind: { file: 'in.file' } }, 0).errors.some((e) => /只能留一处/.test(e)));
  check('bind 引用写法非法 → 报错并列出可用写法', planStep(both, { tool: 't', bind: { file: 'prev.files' } }, 1).errors.some((e) => /不是合法引用/.test(e)));
  check('bind 指向不存在的输入 → 报错', planStep(both, { tool: 't', bind: { nope: 'text' } }, 1).errors.some((e) => /不是 t 的输入项/.test(e)));
  check('inputKind 只把 file / textarea / text 当数据口', inputKind({ type: 'select' }) === null && inputKind({ type: 'file' }) === 'file');
}

/* ---------- 4. 运行时取值 ---------- */
console.log('· 运行时取值');
{
  const mf = {
    inputs: [
      { name: 'files', type: 'file', accept: 'image/*', multiple: true },
      { name: 'q', type: 'range', min: 1, max: 100, default: 70 },
    ],
  };
  const step = { tool: 't', args: { q: 78 } };
  const v0 = buildValues(mf, step, 0, { files: [file('x.png', 'image/png')] });
  check('首步把用户文件包成数组（multiple 输入）', Array.isArray(v0.files) && v0.files[0].name === 'x.png');
  check('args 覆盖默认值', v0.q === 78);

  const prev = { files: [{ name: 'b.jpg', blob: new Blob([new Uint8Array([9])], { type: 'image/jpeg' }), kind: 'image' }], text: '' };
  const v1 = buildValues(mf, { tool: 't' }, 1, { prev });
  check('上一步的 {name,blob} 会被补成 File（工具里能拿到 name 与 type）', v1.files[0] instanceof File && v1.files[0].name === 'b.jpg');

  const textFlow = { inputs: [{ name: 'text', type: 'textarea' }] };
  check('文本口取上一步的文本', buildValues(textFlow, { tool: 't' }, 1, { prev: { files: [], text: '{"a":1}' } }).text === '{"a":1}');
  check('上一步没有文本 → 明确报错，而不是传空串', /没有文本产出/.test(throws(() => buildValues(textFlow, { tool: 't' }, 1, { prev: { files: [], text: '' } }))));
  check('上一步文件不够 → 报「只产出 N 个」', /只产出 0 个/.test(throws(() => buildValues(mf, { tool: 't' }, 1, { prev: { files: [], text: '' } }))));
  check('规划有问题时取值也抛——构建期与运行时不会各行其是', throws(() => buildValues({ inputs: [{ name: 'a', type: 'textarea' }, { name: 'b', type: 'text' }] }, { tool: 't' }, 1, {})) !== '');
}

/* ---------- 5. 入口类型兼容 ---------- */
console.log('· 入口类型兼容');
{
  check('image/png 与只收 JPG 的工具不兼容', acceptMismatch('image/png', 'image/jpeg,.jpg,.jpeg').length === 1);
  check('image/jpeg 与 .jpg/.jpeg 兼容', acceptMismatch('image/jpeg,.jpg,.jpeg', 'image/jpeg,.jpg,.jpeg').length === 0);
  check('通配入口对通配工具兼容', acceptMismatch('image/*', 'image/*').length === 0);
  check('image/* 工具收得下 image/png', acceptMismatch('image/png', 'image/*').length === 0);
  check('任一侧没写 accept 就不判（不假装知道）', acceptMismatch('', 'image/jpeg').length === 0);
}

/* ---------- 6. 数据口不许掉进示例默认值 ---------- */
console.log('· 示例默认值');
{
  const withExample = {
    inputs: [
      { name: 'text', type: 'textarea', default: '工具自带的示例段落' },
      { name: 'mode', type: 'select', default: 'auto', options: [{ value: 'auto' }, { value: 'x' }] },
    ],
  };
  const planBare = planStep(withExample, { tool: 'x' }, 1);
  check(
    '数据口落到默认值能被认出来',
    exampleDefaultPorts(withExample, planBare).join(',') === 'text',
    JSON.stringify(exampleDefaultPorts(withExample, planBare))
  );
  check('下拉的默认值不算（它不是数据口）', !exampleDefaultPorts(withExample, planBare).includes('mode'));

  const planBound = planStep(withExample, { tool: 'x', bind: { text: 'text' } }, 1);
  check('显式 bind 后不再报', exampleDefaultPorts(withExample, planBound).length === 0);
  check('bind 之后取值来源是 bind', planBound.values.find((v) => v.name === 'text').from === 'bind');

  const planArg = planStep(withExample, { tool: 'x', args: { text: '写死的值' } }, 1);
  check('args 写死也不算默认值', exampleDefaultPorts(withExample, planArg).length === 0);

  // 回归：真流程里一个都不许有——v3.24 的 dedupe-count 曾在这里犯错
  const flows = JSON.parse(readFileSync(join(root, 'workflows', 'workflows.json'), 'utf8')).flows;
  for (const f of flows) {
    for (const [i, step] of f.steps.entries()) {
      const mf = readManifest(step.tool, root);
      if (!mf.ok) continue;
      const bad = exampleDefaultPorts(mf.manifest, planStep(mf.manifest, step, i));
      check(`${f.id} 第 ${i + 1} 步没有数据口跑示例数据`, bad.length === 0, bad.join('、'));
    }
  }
}

/* ---------- 7. 真流程能凑齐每个输入 ---------- */
{
  const flows = JSON.parse(readFileSync(join(root, 'workflows', 'workflows.json'), 'utf8')).flows;
  console.log(`· 真流程（${flows.length} 条）`);
  const textFixture = Buffer.from(JSON.stringify({ name: '张三', city: '南京' })).toString('base64');

  for (const f of flows) {
    for (const [i, step] of f.steps.entries()) {
      const mf = readManifest(step.tool, root);
      check(`${f.id} 第 ${i + 1} 步能读出 ${step.tool} 的 manifest`, mf.ok, mf.error);
      if (!mf.ok) continue;

      const plan = planStep(mf.manifest, step, i);
      check(`${f.id} 第 ${i + 1} 步规划无问题`, plan.errors.length === 0, plan.errors.join('；'));
      check(`${f.id} 第 ${i + 1} 步参数合法`, validateArgs(mf.manifest, step).length === 0, validateArgs(mf.manifest, step).join('；'));

      // 用一份假的上一步产物把每个输入都真取一遍：只要有一个取不到就会抛
      const prev = {
        files: [file('prev.jpg')],
        text: i === 0 ? '' : textFixture,
      };
      const ctx = { files: [file('in.jpg')], text: textFixture, prev };
      const values = buildValues(mf.manifest, step, i, ctx);
      const missing = (mf.manifest.inputs || []).map((x) => x.name).filter((n) => values[n] === undefined);
      check(`${f.id} 第 ${i + 1} 步每个输入都取到了值`, missing.length === 0, `缺 ${missing.join('、')}`);
    }
  }
}

/* ---------- 8. v3.24 三条新流程的接线意图 ---------- */
// 这几条写的是「为什么这么接」，不是「跑得通吗」——后者上面已经覆盖。
// 一旦有人觉得 bind 冗余把它删掉，这几条会立刻红，而不是等到产物变成示例数据。
{
  const flows = JSON.parse(readFileSync(join(root, 'workflows', 'workflows.json'), 'utf8')).flows;
  const flow = (id) => flows.find((f) => f.id === id);
  const source = (id, i, name) => {
    const f = flow(id);
    const mf = readManifest(f.steps[i].tool, root);
    const plan = planStep(mf.manifest, f.steps[i], i);
    return plan.values.find((v) => v.name === name) || {};
  };

  const csv1 = source('csv-pick-to-json', 0, 'input');
  check('提列第 1 步把 input 钉在用户输入上', csv1.from === 'bind' && csv1.ref === 'in.text', JSON.stringify(csv1));
  const csv2 = source('csv-pick-to-json', 1, 'input');
  check('提列第 2 步吃上一步的 CSV 文本', csv2.from === 'bind' && csv2.ref === 'text', JSON.stringify(csv2));

  const ded2 = source('dedupe-count', 1, 'text');
  check('去重第 2 步吃上一步的名单，不落示例', ded2.from === 'bind' && ded2.ref === 'text', JSON.stringify(ded2));

  const qr2file = source('qr-embed', 1, 'file');
  const qr2uri = source('qr-embed', 1, 'dataUri');
  check('嵌码第 2 步的 file 接上一步的 PNG', qr2file.from === 'bind' && qr2file.ref === 'files[0]', JSON.stringify(qr2file));
  check('嵌码第 2 步的 dataUri 是空串占位（不自动接二维码原文）', qr2uri.from === 'arg', JSON.stringify(qr2uri));
  check(
    '空串真的是空串，不是被写成了别的',
    flow('qr-embed').steps[1].args.dataUri === '',
    JSON.stringify(flow('qr-embed').steps[1].args.dataUri)
  );
}

/* ---------- 结果条文案（v3.24.1） ---------- */
console.log('· 结果条文案');
{
  const full = runBanner('图片发布包', 3, 4200);
  check('整条跑完：写清总步数与用时', /3 步跑完/.test(full) && /4\.2 秒/.test(full), full);
  check('整条跑完：不提「从第 N 步」', !/从第/.test(full), full);

  const resumed = runBanner('图片发布包', 3, 1200, 2);
  check('续跑：不写「3 步跑完」（那会让人以为整条重跑）', !/3 步跑完/.test(resumed), resumed);
  check('续跑：说清从第 3 步起、前 2 步沿用', /从第 3 步跑到最后/.test(resumed) && /前 2 步沿用/.test(resumed), resumed);

  // 边界：从第 0 步「续跑」等于整条跑，但调用方只在失败后传 >=1，这里只保证不炸、不写负号
  const fromZero = runBanner('X', 1, 0, 0);
  check('续跑的 resumedFrom=0 不当作续跑', /1 步跑完/.test(fromZero), fromZero);
}

/* ---------- 助手：一句话 → 一条流程（v3.31） ---------- */
console.log('\n🧭 助手流程推荐');
{
  const { recommend } = await import('../assets/lib/intent.js');
  const flows = JSON.parse(readFileSync(join(root, 'workflows/workflows.json'), 'utf8')).flows;
  const io = JSON.parse(readFileSync(join(root, 'tools/io.json'), 'utf8'));
  const toolList = JSON.parse(readFileSync(join(root, 'tools/tools.json'), 'utf8')).tools;
  const byId = new Map(toolList.map((t) => [t.id, t]));
  const nameOf = (id) => {
    const t = byId.get(id);
    return t && t.runtime !== 'link' ? t.name : null;
  };
  const rec = (q, extra) => recommend(q, { flows, io, nameOf, t: (zh) => zh, ...extra });

  const r1 = rec('把照片转成 pdf');
  check('命中流程后半段 → 推整条流程', r1 && r1.kind === 'flow' && r1.name === '照片成 PDF', r1 ? r1.name : 'null');
  check('流程链接带 ?flow=', r1 && r1.url === '/workflows/?flow=photo-to-pdf', r1 ? r1.url : 'null');

  // 反例：json-format 是「编码串还原 JSON」的第 2 步，但用户只想格式化一段 JSON
  const r2 = rec('json 格式化');
  check('流程名不相关 → 仍推工具', r2 && r2.kind === 'tool' && r2.name === 'JSON 格式化', r2 ? r2.kind + '/' + r2.name : 'null');

  const r3 = rec('生成二维码');
  check('命中流程首步 → 推工具（不多给步骤）', r3 && r3.kind === 'tool', r3 ? r3.kind : 'null');

  const r4 = rec('今天天气怎么样');
  check('无命中 → null', r4 === null);

  const r5 = rec('把照片转成 pdf', { nameOf: () => null });
  check('外链/不存在工具 → 不推荐', r5 === null);

  // 对照组：同一个流程名、同一句话，唯一变量是前一步工具能不能把产物交给后一步。
  // 端口接不上就不推、接得上才推——这证明 io 真的参与了判断，不是摆设。
  const mk = (id, steps) => [{ id, name: '照片成 PDF', cost: '约 1 秒', steps }];
  const r6 = rec('把照片转成 pdf', { flows: mk('bad', [{ tool: 'base64-url' }, { tool: 'img-to-pdf' }]) });
  check('端口接不上 → 不推流程', r6 && r6.kind === 'tool', r6 ? r6.kind : 'null');

  const r7 = rec('把照片转成 pdf', { flows: mk('good', [{ tool: 'image-resize' }, { tool: 'img-to-pdf' }]) });
  check('端口接得上 → 推流程（对照组）', r7 && r7.kind === 'flow' && r7.name === '照片成 PDF', r7 ? r7.kind + '/' + r7.name : 'null');
}

/* ---------- 输出 ---------- */
console.log(`\n${fails.length ? '❌ 失败 ' + fails.length + ' 项' : '✅ 全部通过'}（${pass + fails.length} 项）\n`);
if (fails.length) {
  for (const f of fails) console.log(`   · ${f}`);
  console.log('');
  process.exit(1);
}
