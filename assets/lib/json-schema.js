// 极简 JSON Schema 校验器（零依赖）
//
// 为什么自己写而不是拉 ajv：
//   1. 项目至今没有 node_modules，发布包只含静态文件，加依赖会改变部署形态；
//   2. 我们只需要一个很小的子集，能给出「字段路径 + 人话错误」就够；
//   3. 校验器要能在浏览器里跑（提交页的 manifest 生成器复用同一套规则，保证「本地能过 = 构建能过」）。
//
// 支持的子集：$ref(仅本地 #/...)、type(含数组)、enum、const、required、properties、
//   additionalProperties(false)、items、minItems/maxItems、uniqueItems、
//   minLength/maxLength、pattern、minimum/maximum、oneOf/anyOf/allOf/not、if/then(不用)。
// 不支持的 keyword 会被忽略（不要依赖它做安全校验）。

/** 单值类型判断（JSON 语义：integer 不算 number 之外的独立类型） */
function isType(v, t) {
  switch (t) {
    case 'object':
      return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array':
      return Array.isArray(v);
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    default:
      return true;
  }
}

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const fmt = (v) => {
  if (typeof v === 'string') return JSON.stringify(v.length > 30 ? v.slice(0, 30) + '…' : v);
  if (v && typeof v === 'object') return Array.isArray(v) ? `[${v.length} 项]` : '{…}';
  return String(v);
};

/** 解析本地 $ref（只支持 #/$defs/xxx 与 #/definitions/xxx） */
export function deref(schema, root) {
  let cur = schema;
  let guard = 0;
  while (cur && typeof cur === 'object' && typeof cur.$ref === 'string') {
    if (++guard > 20) throw new Error('$ref 出现循环引用');
    const ref = cur.$ref;
    if (!ref.startsWith('#/')) throw new Error(`只支持本地 $ref，收到 ${ref}`);
    cur = ref
      .slice(2)
      .split('/')
      .reduce((acc, k) => (acc == null ? acc : acc[k.replace(/~1/g, '/').replace(/~0/g, '~')]), root);
    if (cur === undefined) throw new Error(`$ref 指向不存在的节点：${ref}`);
  }
  return cur;
}

/**
 * 校验一个值
 * @returns {{path:string, message:string}[]} 空数组表示通过
 */
export function validate(value, schema, root = schema, path = '') {
  const errs = [];
  const s = deref(schema, root);
  if (!s || typeof s !== 'object') return errs;

  // type
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => isType(value, t))) {
      errs.push({ path, message: `类型应为 ${types.join(' | ')}，实际是 ${typeName(value)}` });
      return errs; // 类型都不对，后续关键字没有意义
    }
  }
  // enum / const
  if (s.enum && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(value))) {
    errs.push({ path, message: `取值必须是 ${s.enum.map(fmt).join(' / ')} 之一，实际是 ${fmt(value)}` });
  }
  if (s.const !== undefined && JSON.stringify(value) !== JSON.stringify(s.const)) {
    errs.push({ path, message: `取值必须是 ${fmt(s.const)}` });
  }

  if (typeof value === 'string') {
    if (s.minLength != null && value.length < s.minLength) errs.push({ path, message: `至少要 ${s.minLength} 个字符（当前 ${value.length}）` });
    if (s.maxLength != null && value.length > s.maxLength) errs.push({ path, message: `最多 ${s.maxLength} 个字符（当前 ${value.length}）` });
    if (s.pattern && !new RegExp(s.pattern).test(value)) errs.push({ path, message: `格式不符：需匹配 ${s.pattern}` });
  }

  if (typeof value === 'number') {
    if (s.minimum != null && value < s.minimum) errs.push({ path, message: `不能小于 ${s.minimum}` });
    if (s.maximum != null && value > s.maximum) errs.push({ path, message: `不能大于 ${s.maximum}` });
  }

  if (Array.isArray(value)) {
    if (s.minItems != null && value.length < s.minItems) errs.push({ path, message: `至少 ${s.minItems} 项（当前 ${value.length}）` });
    if (s.maxItems != null && value.length > s.maxItems) errs.push({ path, message: `最多 ${s.maxItems} 项（当前 ${value.length}）` });
    if (s.uniqueItems) {
      const seen = new Set();
      for (const x of value) {
        const k = JSON.stringify(x);
        if (seen.has(k)) errs.push({ path, message: `存在重复项 ${fmt(x)}` });
        seen.add(k);
      }
    }
    if (s.items) value.forEach((x, i) => errs.push(...validate(x, s.items, root, `${path}[${i}]`)));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of s.required || []) {
      if (value[key] === undefined) errs.push({ path: path ? `${path}.${key}` : key, message: '缺少必填字段' });
    }
    const props = s.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) {
        errs.push(...validate(v, props[k], root, path ? `${path}.${k}` : k));
      } else if (s.additionalProperties === false) {
        errs.push({
          path: path ? `${path}.${k}` : k,
          message: `未知字段，规范里没有这个键（可用字段：${Object.keys(props).join(' / ') || '无'}）`,
        });
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        errs.push(...validate(v, s.additionalProperties, root, path ? `${path}.${k}` : k));
      }
    }
  }

  if (s.allOf) for (const sub of s.allOf) errs.push(...validate(value, sub, root, path));
  if (s.anyOf) {
    const ok = s.anyOf.some((sub) => validate(value, sub, root, path).length === 0);
    if (!ok) errs.push({ path, message: '不满足 anyOf 中的任何一种形态' });
  }
  if (s.oneOf) {
    const hits = s.oneOf.filter((sub) => validate(value, sub, root, path).length === 0).length;
    if (hits !== 1) errs.push({ path, message: `应恰好匹配 oneOf 中的 1 种形态，实际匹配 ${hits} 种` });
  }
  if (s.not && validate(value, s.not, root, path).length === 0) {
    errs.push({ path, message: '命中了 not 禁止的形态' });
  }

  return errs;
}

/** 便捷入口：值为 undefined 时按「缺失」处理，交给 required 报错 */
export function check(value, schema, root = schema, path = '') {
  if (value === undefined) return [{ path: path || '(root)', message: '缺少必填字段' }];
  return validate(value, schema, root, path);
}
