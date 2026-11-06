// 工具：JSON ⇄ YAML（浏览器执行，按需加载 vendor js-yaml 4.1.0 / MIT）
//
// 三条容易踩的坑，全部转成中文说明而不是把 js-yaml 的英文异常丢给用户：
//   1. 多文档（--- 分隔）：load() 只认第一个文档，这里先数一遍，>1 直接说明怎么拆
//   2. 锚点 / 别名（&a / *a）：YAML 会展开引用，JSON 没有对应结构，转完会出现重复数据
//   3. !! 自定义类型：DEFAULT_SCHEMA 不认识，说明「请去掉标签或改成普通标量」
//
// v4 起 safeLoad 被移除，所以 load/dump 都显式传 schema: DEFAULT_SCHEMA，
// 不依赖默认行为在不同版本间漂移。vendor 文件只在点「转换」时注入，不进首屏。
//
// 数据边界：文本只在本机内存里解析，不发请求、不上传、不写本地存储。

const VENDOR = '/assets/vendor/js-yaml.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = resolve;
    sc.onerror = () => reject(new Error('转换库没加载成功（' + src + '）。断网时请确认已下载离线包，然后刷新重试'));
    document.head.appendChild(sc);
  });
}

async function loadYaml() {
  if (typeof window !== 'undefined' && window.jsyaml) return window.jsyaml;
  if (typeof document === 'undefined') {
    throw new Error('当前环境没有 document，无法按需加载 YAML 转换库；请在浏览器里运行这个工具');
  }
  await loadScript(VENDOR);
  if (!window.jsyaml) throw new Error('转换库加载后没找到入口，请刷新重试');
  return window.jsyaml;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON.parse 的异常统一换成「第几行第几列 + 那一行原文」 */
function explainJson(err, src) {
  const msg = String((err && err.message) || err);
  const lc = /line (\d+) column (\d+)/i.exec(msg);
  const at = /position (\d+)/i.exec(msg);
  let lineNo = 0;
  let colNo = 0;
  if (lc) {
    lineNo = Number(lc[1]);
    colNo = Number(lc[2]);
  } else if (at) {
    const pos = Number(at[1]);
    const before = src.slice(0, pos);
    lineNo = before.split('\n').length;
    colNo = pos - before.lastIndexOf('\n');
  }
  if (!lineNo) return msg;
  const line = src.split('\n')[lineNo - 1] || '';
  return '第 ' + lineNo + ' 行第 ' + colNo + ' 列附近：' + msg.replace(/^JSON\.parse: /, '') + '\n出错行：' + line;
}

/** js-yaml 的 YAMLException 带 mark（行列 + 片段），转成一句人话 */
function explainYaml(err, src) {
  const msg = String((err && err.message) || err);
  if (/unknown tag|could not determine a constructor|unacceptable kind of an object to dump/i.test(msg)) {
    const tag = /(?:!!|tag:)[^\s]+/.exec(msg);
    return (
      'YAML 里有自定义类型标签' + (tag ? '「' + tag[0] + '」' : '') +
      '，DEFAULT_SCHEMA 不认识它。请去掉 !! 标签，或把值写成普通的字符串 / 数字 / 布尔（需要引号就加引号）。'
    );
  }
  const mark = err && err.mark;
  if (mark && typeof mark.line === 'number') {
    const line = src.split('\n')[mark.line] || '';
    return '第 ' + (mark.line + 1) + ' 行第 ' + (mark.column + 1) + ' 列附近：' + (err.reason || msg.split('\n')[0]) + '\n出错行：' + line;
  }
  return msg.split('\n')[0];
}

function countDocuments(jsyaml, text) {
  try {
    const docs = jsyaml.loadAll(text, undefined, { schema: jsyaml.DEFAULT_SCHEMA });
    return docs.length;
  } catch (e) {
    // loadAll 也会抛出语法错；交给下面的 load() 统一给一次人话报错
    return 1;
  }
}

export const manifest = {
  usage:
    '把 JSON 转成 YAML，或把 YAML 转成 JSON；方向可选自动判断。转换库用 js-yaml 4.1.0（MIT），显式指定 DEFAULT_SCHEMA，遇到锚点、多文档、!! 自定义类型会给出中文说明而不是英文异常。',
  tips: [
    '多文档（用 --- 分隔）一次只处理一个：检测到多个会提示你先拆开，不会静默丢掉后面的文档',
    '锚点 &a / 别名 *a 会被展开成真实数据，转成 JSON 后同一份内容可能出现两次——结果区会提醒',
    '!!str 这类自定义标签 DEFAULT_SCHEMA 不认识，会明确告诉你去掉标签或改成普通标量',
    'JSON 里对象的键顺序会保留；YAML 的注释在转换中丢失，这是格式本身的差异，不是工具漏了',
    'YAML 转成 JSON 时，日期写法（2026-01-01）会变成字符串，不会变成 Date 对象',
    '转换库只在点「转换」时才加载（约 39 KB / gzip 13 KB），不占首屏；文本不出本机',
  ],
  scenarios: [
    { scene: '给 Kubernetes / CI 配置换格式', how: '贴 JSON 配置，方向选「JSON → YAML」', result: '得到缩进整齐的 YAML，可直接存成 .yaml' },
    { scene: '读别人给的 YAML 配置', how: '贴 YAML，方向选「YAML → JSON」', result: '得到格式化 JSON，方便比对或丢进代码里' },
    { scene: 'YAML 报错看不懂', how: '贴原文点转换', result: '指出第几行第几列、附上出错那一行，不再只给一句英文' },
  ],
  inputs: [
    { name: 'text', label: 'JSON 或 YAML 原文', type: 'textarea', placeholder: '{"name": "demo", "items": [1, 2]}\n\n或\n\nname: demo\nitems:\n  - 1\n  - 2' },
    {
      name: 'direction', label: '转换方向', type: 'select', default: 'auto',
      options: [
        { value: 'auto', label: '自动判断' },
        { value: 'j2y', label: 'JSON → YAML' },
        { value: 'y2j', label: 'YAML → JSON' },
      ],
    },
    { name: 'indent', label: '缩进空格数', type: 'select', default: '2', options: [
      { value: '2', label: '2 空格' }, { value: '4', label: '4 空格' }, { value: '6', label: '6 空格' },
    ] },
  ],
  example: { text: '{"name":"demo","items":[1,2],"enabled":true}', direction: 'auto', indent: '2' },
  runLabel: '转换',
};

export async function run({ text, direction, indent }) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) throw new Error('请粘贴 JSON 或 YAML 原文；只贴内容本身，不要带 ``` 围栏');
  if (/^\s*```/.test(raw)) throw new Error('输入里带着 ``` 围栏：去掉围栏，只留 JSON / YAML 本身');
  if (raw.length > 200000) throw new Error('输入超过 200 KB，超出本工具的处理范围');

  const n = Math.min(8, Math.max(2, Math.floor(Number(indent) || 2)));
  const dir = ['auto', 'j2y', 'y2j'].includes(direction) ? direction : 'auto';
  const looksJson = /^\s*[\[{]/.test(raw) || /^\s*(?:true|false|null|"|\d)/.test(raw);
  const mode = dir === 'auto' ? (looksJson ? 'j2y' : 'y2j') : dir;

  const jsyaml = await loadYaml();
  let output;
  const notices = [];

  if (mode === 'j2y') {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      throw new Error('输入不是合法 JSON —— ' + explainJson(e, raw));
    }
    output = jsyaml.dump(obj, {
      schema: jsyaml.DEFAULT_SCHEMA,
      indent: n,
      noRefs: true, // 不生成 &ref_0 锚点：JSON 里重复的引用在 YAML 里直接展开，读起来更直白
      lineWidth: -1,
      sortKeys: false,
      noCompatMode: true,
    });
    notices.push('JSON 的对象键顺序已保留；YAML 不支持注释往返，原文本里的注释（若有）不会出现在结果里。');
  } else {
    const docCount = countDocuments(jsyaml, raw);
    if (docCount > 1) {
      throw new Error(
        '检测到 ' + docCount + ' 个 YAML 文档（用 --- 分隔）。本工具一次只转一个文档，' +
        '请把每段分别贴进来转换；多文档是 YAML 的特性，JSON 没有等价写法。'
      );
    }
    if (/(^|[\s[{,])&[\w-]+/m.test(raw) || /(^|[\s[{,:])\*[\w-]+/m.test(raw)) {
      notices.push('输入里有锚点 & / 别名 *：YAML 会把引用展开成真实数据，转成 JSON 后同一份内容可能出现两次。');
    }
    let obj;
    try {
      obj = jsyaml.load(raw, { schema: jsyaml.DEFAULT_SCHEMA, json: false });
    } catch (e) {
      throw new Error('YAML 解析失败 —— ' + explainYaml(e, raw));
    }
    if (obj === undefined) throw new Error('这段 YAML 是空的（或只有注释），没有可转换的内容');
    try {
      output = JSON.stringify(obj, null, n);
    } catch (e) {
      throw new Error('YAML 里出现了 JSON 表达不了的值（例如循环引用或函数）：' + String(e.message || e));
    }
    notices.push('YAML 的日期写法会按字符串处理，不会变成 Date 对象；数字与布尔保持原类型。');
  }

  const noticeHtml = notices.length
    ? '<p style="margin-top:10px;color:var(--muted);font-size:13px">ℹ️ ' + notices.map(esc).join(' ').replace(/。 /g, '。<br>ℹ️ ') + '</p>'
    : '';

  return {
    html:
      '<div class="msg-ok">✅ ' + (mode === 'j2y' ? 'JSON → YAML' : 'YAML → JSON') + ' 转换完成（' + output.length + ' 字符）</div>' +
      noticeHtml +
      '<pre style="white-space:pre-wrap;word-break:break-all;padding:12px;margin-top:8px;background:var(--bg-alt,#f6f7f9);border:1px solid var(--border);border-radius:6px;font-family:var(--mono);font-size:13px;line-height:1.6">' +
      esc(output) + '</pre>',
    text: notices.map((x) => 'ℹ️ ' + x).join('\n') + (notices.length ? '\n' : '') + output,
  };
}
