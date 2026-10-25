// 工具清单语义校验：在 JSON Schema 之上补「Schema 表达不了」的规则
//
// Schema 管形状（字段、类型、长度），这里管语义：
//   · id 必须等于目录名、分类必须在分类表里
//   · 字段名唯一、默认值必须合法（select 的默认值要在选项里、range 的默认值要在区间内）
//   · 只有 select 能带 options、只有 file 能带 accept/multiple
//   · 接入契约：必须导出 run()、禁止任何网络请求、单工具体积上限
//
// 输出统一为 { file, line, path, message }，可直接被 CLI 打印成 file:line: 消息 的形式。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validate, deref } from '../../assets/lib/json-schema.js';
import { readManifest, parsePositions, lineOfPath } from './tool-manifest.mjs';

/** 单个工具允许的贡献体积（不含构建生成的 index.html） */
export const MAX_TOOL_BYTES = 200 * 1024;

/** 运行时禁止出现的网络 API：本地执行是本站的信任基础，工具私自联网即破坏承诺 */
const FORBIDDEN_NET = [
  { re: /\bfetch\s*\(/, name: 'fetch()' },
  { re: /\bXMLHttpRequest\b/, name: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, name: 'WebSocket' },
  { re: /\bEventSource\b/, name: 'EventSource' },
  { re: /sendBeacon\s*\(/, name: 'navigator.sendBeacon()' },
  { re: /import\s*\(\s*['"`]https?:/, name: "import('http…')" },
];

// 数字字段的默认值允许写成数字，也允许写「数字字符串」——DOM 的 input.value 本来就是字符串，
// 且部分工具的默认值由表达式算出来（如 String(new Date().getMonth() + 1)）。空串表示「不预填」。
const numericish = (v) => typeof v === 'number' || v === '' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const TYPE_DEFAULT_OK = {
  text: (v) => typeof v === 'string',
  textarea: (v) => typeof v === 'string',
  select: (v) => typeof v === 'string' || typeof v === 'number',
  range: numericish,
  number: numericish,
  file: () => false, // file 字段没有默认值
};

/**
 * 校验一个工具的 tool.json + run.js manifest + 接入契约
 * @param {string} id 目录名
 * @param {{root:string, schema:object, categories:string[]}} ctx
 */
export function lintTool(id, ctx) {
  const { root, schema, categories } = ctx;
  const errors = [];
  const dir = join(root, 'tools', id);

  // ---- 1. tool.json ----
  const metaPath = join(dir, 'tool.json');
  let meta = null;
  if (!existsSync(metaPath)) {
    errors.push({ file: `tools/${id}/tool.json`, line: 1, path: '(root)', message: '缺少 tool.json（工具身份与收录信息）' });
  } else {
    const raw = readFileSync(metaPath, 'utf8');
    let text = raw;
    let pos = new Map();
    try {
      meta = JSON.parse(raw);
      pos = parsePositions(raw, 1);
    } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const line = m ? raw.slice(0, Number(m[1])).split('\n').length : 1;
      errors.push({ file: `tools/${id}/tool.json`, line, path: '(root)', message: `JSON 语法错误：${e.message}` });
    }
    if (meta) {
      const def = deref({ $ref: '#/$defs/toolMeta' }, schema);
      for (const err of validate(meta, def, schema, '')) {
        errors.push({
          file: `tools/${id}/tool.json`,
          line: lineOfPath(pos, err.path, 1),
          path: err.path || '(root)',
          message: err.message,
        });
      }
      if (meta.id && meta.id !== id) {
        errors.push({
          file: `tools/${id}/tool.json`,
          line: lineOfPath(pos, 'id', 1),
          path: 'id',
          message: `id 必须与目录名一致（目录是 ${id}，写的是 ${meta.id}）`,
        });
      }
      if (meta.category && categories.length && !categories.includes(meta.category)) {
        errors.push({
          file: `tools/${id}/tool.json`,
          line: lineOfPath(pos, 'category', 1),
          path: 'category',
          message: `分类「${meta.category}」不在 tools/registry.json 的 categories 里（可用：${categories.join(' / ')}）`,
        });
      }
      if (meta.runtime === 'link') {
        errors.push({
          file: `tools/${id}/tool.json`,
          line: lineOfPath(pos, 'runtime', 1),
          path: 'runtime',
          message: '本地工具目录不能声明 runtime: link（外链工具请加到 tools/directory.json）',
        });
      }
    }
  }

  // ---- 2. run.js：manifest ----
  const mf = readManifest(id, root);
  if (!mf.ok) {
    errors.push({ file: `tools/${id}/run.js`, line: mf.line || 1, path: 'manifest', message: mf.error });
  } else {
    const def = deref({ $ref: '#/$defs/manifest' }, schema);
    for (const err of validate(mf.manifest, def, schema, '')) {
      errors.push({
        file: `tools/${id}/run.js`,
        line: lineOfPath(mf.positions, err.path, mf.line),
        path: err.path || '(root)',
        message: err.message,
      });
    }
    errors.push(...lintManifestSemantics(id, mf));
  }

  // ---- 3. 代码契约 ----
  const runPath = join(dir, 'run.js');
  if (existsSync(runPath)) {
    const src = readFileSync(runPath, 'utf8');
    if (!/export\s+async\s+function\s+run\s*\(/.test(src)) {
      errors.push({ file: `tools/${id}/run.js`, line: 1, path: 'run', message: '必须 `export async function run(values)`' });
    }
    const lines = src.split('\n');
    lines.forEach((code, i) => {
      for (const f of FORBIDDEN_NET) {
        if (f.re.test(code) && !/^\s*(\/\/|\*)/.test(code)) {
          errors.push({
            file: `tools/${id}/run.js`,
            line: i + 1,
            path: 'contract',
            message: `禁止网络请求：出现 ${f.name}。本地工具必须完全离线执行（同一行若是注释请忽略这条）`,
          });
        }
      }
    });
    const bytes = toolSize(id, root);
    if (bytes > MAX_TOOL_BYTES) {
      errors.push({
        file: `tools/${id}/`,
        line: 1,
        path: 'contract',
        message: `工具体积 ${Math.round(bytes / 1024)}KB 超过上限 ${MAX_TOOL_BYTES / 1024}KB（不含构建生成的 index.html）`,
      });
    }
  }

  return errors;
}

/** 工具贡献体积：目录内除 index.html（构建产物）以外的文件总和 */
export function toolSize(id, root) {
  const dir = join(root, 'tools', id);
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (name === 'index.html') continue;
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? walkSize(p) : st.size;
  }
  return total;
}
function walkSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? walkSize(p) : st.size;
  }
  return total;
}

/** manifest 的语义规则（Schema 只能管形状，管不了「这个默认值配这个字段合不合法」） */
function lintManifestSemantics(id, mf) {
  const errors = [];
  const file = `tools/${id}/run.js`;
  const at = (path, fallbackPath) => ({
    file,
    line: lineOfPath(mf.positions, path, lineOfPath(mf.positions, fallbackPath || '', mf.line)),
    path,
  });
  const { manifest } = mf;
  const inputs = Array.isArray(manifest.inputs) ? manifest.inputs : [];

  // 字段名唯一
  const seen = new Map();
  inputs.forEach((inp, i) => {
    if (!inp || typeof inp !== 'object') return;
    if (seen.has(inp.name)) {
      errors.push({ ...at(`inputs[${i}].name`), message: `字段名「${inp.name}」与 inputs[${seen.get(inp.name)}] 重复` });
    } else seen.set(inp.name, i);
  });

  inputs.forEach((inp, i) => {
    if (!inp || typeof inp !== 'object') return;
    const p = `inputs[${i}]`;

    // 只有 select 能带 options
    if (inp.options && inp.type !== 'select') {
      errors.push({ ...at(`${p}.options`), message: '只有 type: select 的字段可以有 options' });
    }
    // 只有 file 能带 accept / multiple
    if (inp.accept && inp.type !== 'file') errors.push({ ...at(`${p}.accept`), message: 'accept 只对 type: file 有效' });
    if (inp.multiple && inp.type !== 'file') errors.push({ ...at(`${p}.multiple`), message: 'multiple 只对 type: file 有效' });
    // min / max 只对 range、number
    if ((inp.min != null || inp.max != null) && !['range', 'number'].includes(inp.type)) {
      errors.push({ ...at(`${p}.min`), message: 'min / max 只对 type: range 或 number 有效' });
    }

    // select 必须有选项，且值唯一
    if (inp.type === 'select') {
      if (!Array.isArray(inp.options) || !inp.options.length) {
        errors.push({ ...at(`${p}.options`), message: 'select 必须提供 options' });
      } else {
        const vals = inp.options.map((o) => o && o.value);
        const dup = vals.filter((v, k) => vals.indexOf(v) !== k);
        if (dup.length) errors.push({ ...at(`${p}.options`), message: `options 的 value 重复：${[...new Set(dup)].join(', ')}` });
        if (inp.default !== undefined && !vals.includes(inp.default)) {
          errors.push({
            ...at(`${p}.default`),
            message: `默认值 ${JSON.stringify(inp.default)} 不在 options 里（可用：${vals.map((v) => JSON.stringify(v)).join(', ')}）`,
          });
        }
      }
    }

    // range 必须有 min/max，且默认值落在区间内
    if (inp.type === 'range') {
      if (typeof inp.min !== 'number' || typeof inp.max !== 'number') {
        errors.push({ ...at(`${p}.min`), message: 'range 必须同时给出 min 与 max' });
      } else {
        if (inp.min >= inp.max) errors.push({ ...at(`${p}.min`), message: `min(${inp.min}) 必须小于 max(${inp.max})` });
        if (inp.default !== undefined && inp.default !== '') {
          const d = Number(inp.default);
          if (!Number.isFinite(d) || d < inp.min || d > inp.max) {
            errors.push({ ...at(`${p}.default`), message: `默认值必须是不小于 ${inp.min}、不大于 ${inp.max} 的数字` });
          }
        }
      }
    }
    if (inp.type === 'number' && typeof inp.min === 'number' && typeof inp.max === 'number' && inp.min >= inp.max) {
      errors.push({ ...at(`${p}.min`), message: `min(${inp.min}) 必须小于 max(${inp.max})` });
    }

    // file 必须给 accept（否则用户选到无法处理的文件，错误只能等到运行时才出现）
    if (inp.type === 'file' && !inp.accept) {
      errors.push({ ...at(`${p}.accept`), message: 'file 字段必须写 accept（例：image/*,.pdf）' });
    }

    // 默认值类型要和字段类型对得上；file 不能有默认值
    if (inp.default !== undefined) {
      const okFn = TYPE_DEFAULT_OK[inp.type];
      if (okFn && !okFn(inp.default)) {
        const expect = inp.type === 'file' ? 'file 字段不能有默认值' : inp.type === 'select' ? '默认值必须是 options 里的某个 value' : `默认值必须是 ${inp.type === 'number' || inp.type === 'range' ? '数字（或数字字符串）' : '字符串'}`;
        errors.push({ ...at(`${p}.default`), message: `${expect}（实际是 ${typeof inp.default}：${JSON.stringify(inp.default)}）` });
      }
    }
  });

  // example 的键必须是已声明的字段
  if (manifest.example && typeof manifest.example === 'object') {
    const names = new Set(inputs.map((x) => x && x.name));
    for (const k of Object.keys(manifest.example)) {
      if (!names.has(k)) {
        errors.push({ ...at(`example.${k}`, 'example'), message: `example 里的「${k}」不是已声明的字段` });
      }
    }
  }

  // scenarios 至少 1 条（工具页的「使用场景」板块靠它）
  if (manifest.scenarios && manifest.scenarios.length === 0) {
    errors.push({ ...at('scenarios'), message: 'scenarios 写了就要至少 1 条，否则删掉该字段' });
  }
  return errors;
}

/** 扫全站工具目录，返回 { errors, ids } */
export function lintAll(root, schema, categories) {
  const ids = readdirSync(join(root, 'tools'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, 'tools', d.name, 'run.js')))
    .map((d) => d.name)
    .sort();
  const errors = [];
  for (const id of ids) errors.push(...lintTool(id, { root, schema, categories }));
  return { errors, ids };
}
