// 工具包生成器（提交页专用，按需动态加载）
//
// 目标：让"我有个想法"到"本地能跑的工具目录"只需填一个表单。
//   · 生成 tool.json（身份与收录信息）
//   · 生成 run.js（manifest + run 骨架，可直接在站内调试）
//   · 生成 README.md（接入约定摘要）
//   · 打包成 zip 下载（STORE 模式，无第三方库）
// 校验用的是和构建期完全相同的 assets/lib/json-schema.js + tools/schema.json，
// 所以"这里没报错"就等于"node scripts/lint-tools.mjs 不会报错"（字段层面）。

import { validate, deref } from './lib/json-schema.js';
import { zipBlob } from './lib/zip.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------------- 代码生成 ---------------- */

const toName = (label, i) => {
  const ascii = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (ascii.length) return ascii[0] + ascii.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return 'field' + (i + 1);
};

/** 表单字段 → manifest.inputs 的**对象表示**（校验与代码生成共用这一份，避免两处逻辑跑偏） */
function manifestInputs(fields) {
  return fields.map((f) => {
    const out = { name: f.name, label: f.label, type: f.type };
    if (f.type === 'select') {
      const opts = String(f.options || '')
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      out.options = opts.map((s) => ({ value: s, label: s }));
      out.default = opts[0] || '';
    } else if (f.type === 'file') {
      out.accept = f.accept || '*';
      out.multiple = true;
    } else if (f.type === 'number' || f.type === 'range') {
      out.default = Number(f.default) || 0;
      if (f.type === 'range') {
        out.min = 0;
        out.max = 100;
      }
    } else if (f.default) {
      out.default = f.default;
    }
    if (f.placeholder) out.placeholder = f.placeholder;
    return out;
  });
}

/** 把对象序列化成带缩进的 JS 字面量（生成 run.js 用，不依赖 eval） */
function jsValue(v) {
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(jsValue).join(', ') + ']';
  if (v && typeof v === 'object') {
    return '{ ' + Object.entries(v).map(([k, val]) => `${k}: ${jsValue(val)}`).join(', ') + ' }';
  }
  return 'undefined';
}

function runSource(m) {
  const inputs = manifestInputs(m.fields);
  const args = inputs.map((f) => f.name).join(', ');
  return `// ${m.name}
// 由 ToolHub 提交页生成；改完记得本地跑：node scripts/lint-tools.mjs ${m.id}
export const manifest = {
  inputs: [
${inputs.map((inp) => '    ' + jsValue(inp) + ',').join('\n')}
  ],
  runLabel: ${jsValue(m.runLabel || '运行')},
  usage: ${jsValue(m.desc || '')},
  tips: ['在这里写一条真正有用的提示，而不是复述功能'],
  scenarios: [{ scene: '什么情况下会用到它', how: '用户怎么操作', result: '得到什么结果' }],
};

export async function run({ ${args} }) {
  // 契约：返回 { html, text?, files? }
  //   html  必填，结果区展示的 HTML（可以用 .msg-ok / .msg-warn / .cmp-table）
  //   text  可选，会被「复制结果」按钮使用
  //   files 可选，[{ name, blob, kind }]，kind 填 'image' 会显示预览
  //
  // 必须完全离线：不要用 fetch / XMLHttpRequest / WebSocket，构建期会拦下来。
  if (!${inputs[0]?.name || 'input'}) throw new Error('请先填写输入');

  return {
    html: '<div class="msg-ok">✅ 处理完成</div>',
    text: '把纯文本结果放这里，便于复制',
    files: [],
  };
}
`;
}

function toolJsonSource(m) {
  const meta = {
    id: m.id,
    name: m.name,
    desc: m.desc,
    category: m.category,
    source: m.source || '社区贡献',
    license: m.license || 'MIT',
    runtime: 'browser',
    tags: m.tags.split(/[,，\s]+/).filter(Boolean).slice(0, 6),
    since: 'v2.8',
  };
  // 空字符串会被规范判为「不合法」（minLength 2），所以没填就不写这个键
  if (m.author && m.author.trim()) meta.author = m.author.trim();
  return JSON.stringify(meta, null, 2) + '\n';
}

const README = (id) => `# 工具包：${id}

由 ToolHub 提交页生成。三步放进仓库即可本地跑起来：

1. 把整个目录复制到 \`toolhub/tools/${id}/\`
2. \`node scripts/lint-tools.mjs ${id}\` —— 清单合规检查（必过）
3. \`node scripts/build-pages.mjs\` 生成页面，然后本地起个静态服务器打开 \`/tools/${id}/\`

## 接入契约（摘要）

- \`tool.json\`：身份与收录信息，字段见 \`tools/schema.json\` 的 \`toolMeta\`
- \`run.js\`：必须 \`export const manifest\`（表单）与 \`export async function run(values)\`（执行）
- \`run()\` 返回 \`{ html, text?, files? }\`；\`files\` 为 \`[{ name, blob, kind }]\`
- **禁止任何网络请求**（fetch / XHR / WebSocket / sendBeacon），本地工具必须离线可跑
- 工具体积 ≤ 200KB；不要引入远程脚本
- 还需要补三份内容才算收录完整：\`articles.json\`（长尾正文）、\`i18n.json\`（英文名与简介）、
  \`i18n-detail.json\`（英文详情），缺了 \`node scripts/verify.mjs\` 会报错
`;

/* ---------------- 界面 ---------------- */

const CATS = ['文本', '图片', '文档', '数据', '开发', '设计', '音视频', '效率', '网络'];

let SCHEMA = null;
async function loadSchema() {
  if (SCHEMA) return SCHEMA;
  const res = await fetch('/tools/schema.json');
  SCHEMA = await res.json();
  return SCHEMA;
}

export async function mountToolBuilder(box) {
  const el = document.createElement('div');
  el.className = 'builder';
  el.innerHTML = `
    <div class="builder-head">
      <h2>🛠 生成一个工具包</h2>
      <p>填完下面的表单，直接在浏览器里生成 <code>tool.json</code> + <code>run.js</code> 骨架并打包下载。不联网、不上传，生成的校验结果与构建期一致。</p>
    </div>
    <div class="builder-grid">
      <label>工具 id（小写字母/连字符，也是 URL）<input id="b-id" placeholder="csv-to-markdown" /></label>
      <label>名称（≤ 24 字）<input id="b-name" placeholder="CSV 转 Markdown 表格" /></label>
      <label class="span2">一句话介绍（6–60 字，会出现在卡片与搜索结果）<input id="b-desc" placeholder="把 CSV 粘进来，直接得到可粘贴到文档里的 Markdown 表格" /></label>
      <label>分类<select id="b-cat">${CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label>License<input id="b-license" value="MIT" /></label>
      <label class="span2">来源 / 署名<input id="b-source" placeholder="社区贡献 · 纯浏览器实现" /></label>
      <label class="span2">标签（逗号分隔，最多 6 个）<input id="b-tags" placeholder="csv,markdown,表格" /></label>
    </div>
    <div class="builder-fields">
      <div class="builder-fields-head">
        <b>表单字段</b>
        <button type="button" class="btn ghost" id="b-add">+ 添加字段</button>
      </div>
      <div id="b-fields"></div>
      <p class="builder-hint">字段最多 10 个。类型：文本 / 多行 / 数字 / 滑杆 / 下拉 / 文件。<code>name</code> 会自动从标签生成，可手改。</p>
    </div>
    <div class="row">
      <button type="button" class="btn" id="b-build">生成并下载 zip</button>
      <button type="button" class="btn ghost" id="b-check">只校验</button>
    </div>
    <div id="b-out" class="builder-out" aria-live="polite"></div>`;

  box.appendChild(el);

  const fields = [];
  const fieldsBox = el.querySelector('#b-fields');

  function renderFields() {
    fieldsBox.innerHTML = fields
      .map(
        (f, i) => `<div class="bfield" data-i="${i}">
        <input class="bf-label" data-i="${i}" data-k="label" value="${esc(f.label)}" placeholder="标签" />
        <input class="bf-name" data-i="${i}" data-k="name" value="${esc(f.name)}" placeholder="name" />
        <select class="bf-type" data-i="${i}" data-k="type">
          ${['text', 'textarea', 'number', 'range', 'select', 'file']
            .map((t) => `<option value="${t}" ${t === f.type ? 'selected' : ''}>${t}</option>`)
            .join('')}
        </select>
        <input class="bf-extra" data-i="${i}" data-k="extra" value="${esc(f.extra || '')}" placeholder="${
          f.type === 'select' ? '选项，逗号分隔' : f.type === 'file' ? 'accept，如 image/*' : '默认值'
        }" />
        <button type="button" class="bf-del" data-del="${i}" aria-label="删除这个字段">✕</button>
      </div>`
      )
      .join('');
    fieldsBox.querySelectorAll('input,select').forEach((inp) => {
      inp.oninput = inp.onchange = () => {
        const i = Number(inp.dataset.i);
        const k = inp.dataset.k;
        if (k === 'extra') {
          if (fields[i].type === 'select') fields[i].options = inp.value;
          else if (fields[i].type === 'file') fields[i].accept = inp.value;
          else fields[i].default = inp.value;
        } else if (k === 'label') {
          fields[i].label = inp.value;
          if (!fields[i].touched) {
            fields[i].name = toName(inp.value, i);
            const nameInput = fieldsBox.querySelector(`.bf-name[data-i="${i}"]`);
            if (nameInput) nameInput.value = fields[i].name;
          }
        } else {
          fields[i][k] = inp.value;
          if (k === 'name') fields[i].touched = true;
        }
      };
    });
    fieldsBox.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = () => {
        fields.splice(Number(btn.dataset.del), 1);
        renderFields();
      };
    });
  }

  function addField(label = '', type = 'text') {
    if (fields.length >= 10) return;
    fields.push({ label, name: toName(label, fields.length), type, options: '', accept: '', default: '' });
    renderFields();
  }
  addField('输入内容', 'textarea');
  el.querySelector('#b-add').onclick = () => addField('', 'text');

  const val = (id) => el.querySelector('#' + id).value.trim();

  function collect() {
    return {
      id: val('b-id'),
      name: val('b-name'),
      desc: val('b-desc'),
      category: el.querySelector('#b-cat').value,
      license: val('b-license') || 'MIT',
      source: val('b-source') || '社区贡献 · 纯浏览器实现',
      tags: val('b-tags'),
      author: '',
      runLabel: '运行',
      fields,
    };
  }

  /** 同一套 schema，两个文件分别校验 */
  async function checkAll(m) {
    const schema = await loadSchema();
    const errs = [];
    let metaJson;
    try {
      metaJson = JSON.parse(toolJsonSource(m));
    } catch (e) {
      return ['tool.json 生成失败：' + e.message];
    }
    const metaDef = deref({ $ref: '#/$defs/toolMeta' }, schema);
    for (const e of validate(metaJson, metaDef, schema, '')) errs.push(`tool.json ${e.path || '(root)'}：${e.message}`);

    // manifest 用同一份对象结构校验（不 eval 源码）
    const manifestObj = {
      inputs: manifestInputs(m.fields),
      runLabel: m.runLabel,
      usage: m.desc,
      tips: ['占位提示，写正式内容时替换'],
      scenarios: [],
    };
    const mfDef = deref({ $ref: '#/$defs/manifest' }, schema);
    for (const e of validate(manifestObj, mfDef, schema, '')) errs.push(`manifest ${e.path || '(root)'}：${e.message}`);

    // 语义补充：字段名唯一（schema 管不了）
    const names = m.fields.map((f) => f.name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) errs.push(`字段 name 重复：${[...new Set(dup)].join(', ')}`);
    if (m.fields.some((f) => !f.name)) errs.push('有字段还没生成 name，请填写标签或手动改名');
    return errs;
  }

  async function build(alsoDownload) {
    const out = el.querySelector('#b-out');
    const m = collect();
    const errs = await checkAll(m);
    if (errs.length) {
      out.innerHTML = `<div class="msg-warn">⚠ 还有 ${errs.length} 个问题需要先修：</div><ul class="builder-errs">${errs
        .map((e) => `<li>${esc(e)}</li>`)
        .join('')}</ul>`;
      return;
    }
    const files = [
      { name: `${m.id}/tool.json`, text: toolJsonSource(m) },
      { name: `${m.id}/run.js`, text: runSource(m) },
      { name: `${m.id}/README.md`, text: README(m.id) },
    ];
    out.innerHTML = `<div class="msg-ok">✅ 校验通过：tool.json 与 manifest 均符合 <code>tools/schema.json</code>。${
      alsoDownload ? '已开始下载 ' + esc(m.id) + '.zip' : ''
    }</div>
      <details><summary>查看生成的 run.js</summary><pre class="builder-pre">${esc(files[1].text)}</pre></details>
      <details><summary>查看生成的 tool.json</summary><pre class="builder-pre">${esc(files[0].text)}</pre></details>`;

    if (alsoDownload) {
      const blob = await zipBlob(files.map((f) => ({ name: f.name, data: f.text })));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${m.id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  el.querySelector('#b-build').onclick = () => build(true);
  el.querySelector('#b-check').onclick = () => build(false);
  return { fields, build, checkAll };
}
