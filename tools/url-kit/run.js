// 工具：URL 解析构造（纯浏览器执行）
//
// 两个设计点：
// 1. 只有一次点击，没有实时双向绑定。所以「改参数」不是拖一个表格改，而是给一个参数框：
//    解析出来的每个参数按 `键=值` 一行列出，改它、删它、加一行，就得到新地址。
//    这比在结果区里做可编辑表格诚实——单次执行的工具不该假装自己是编辑器。
// 2. 没写协议的地址（example.com/a?b=1）默认按 https 补全，但结果里会明说补了，
//    不让人以为原地址就是 https。
export const manifest = {
  usage:
    '把一条 URL 拆成协议、主机、端口、路径、参数、片段逐项列出；参数区按「键=值」一行一个，改完行再点一次就得到重新拼装的新地址（删一行即删参数，加一行即增参数）。',
  tips: [
    '没写协议（如 example.com/a）会按 https 补全，结果里会标明补过',
    '参数值里的中文会自动编解码：解析时显示可读的原文，拼装时按标准百分号编码',
    '同名参数（?tag=1&tag=2）会保留成两行，改哪行就换哪个值',
    '片段（# 后面那段）与路径中的百分号编码原样保留，不会被二次编码',
  ],
  scenarios: [
    { scene: '调试接口返回的地址带一堆参数', how: '粘贴地址 → 看参数表', result: '一眼看清每个参数的真实值，不用肉眼找 &' },
    { scene: '要把分享链接里的 utm 参数全删掉', how: '在参数区删掉那几行再生成', result: '拿到干净的链接，不残留跟踪参数' },
    { scene: '要给链接加一个带中文的参数', how: '参数区加一行 `q=中文` → 生成', result: '拼出来的地址编码正确，粘进浏览器能直接打开' },
  ],
  inputs: [
    { name: 'url', label: 'URL', type: 'textarea', placeholder: 'https://example.com/path?a=1&b=2#hash' },
    { name: 'params', label: '参数（可改，一行一个「键=值」）', type: 'textarea', placeholder: '留空 = 沿用原地址里的参数；写内容 = 用这里的参数替换' },
  ],
  runLabel: '解析并重建',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export async function run({ url, params }) {
  const raw = String(url || '').trim();
  if (!raw) throw new Error('请先粘贴一条 URL');
  if (/\s/.test(raw)) throw new Error('URL 中间有空白字符：复制时可能混进了换行，请删掉再试');

  let hadScheme = true;
  let fixed = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    hadScheme = false;
    fixed = 'https://' + raw.replace(/^\/+/, '');
  }

  let u;
  try {
    u = new URL(fixed);
  } catch {
    throw new Error('这条地址解析不了：检查主机名是否合法（例：example.com/a?b=1）');
  }
  if (!/^https?:$/.test(u.protocol) && !/^(ftp|file):$/.test(u.protocol)) {
    throw new Error(`协议 ${u.protocol} 不是常见的网页协议，本工具只按 http/https/ftp/file 解析`);
  }

  // 参数区有内容就整体替换，留空则沿用原参数
  const override = String(params || '').trim();
  const lines = override ? override.split('\n').map((l) => l.trim()).filter(Boolean) : null;
  const pairs = [];
  if (lines) {
    for (const line of lines) {
      const i = line.indexOf('=');
      if (i <= 0) throw new Error(`参数行「${line}」看不懂：要写成 键=值（键不能为空）`);
      pairs.push([line.slice(0, i).trim(), line.slice(i + 1)]);
    }
  } else {
    for (const [k, v] of u.searchParams) pairs.push([k, v]);
  }

  const qs = new URLSearchParams();
  for (const [k, v] of pairs) qs.append(k, v);
  const rebuilt = new URL(u.href);
  rebuilt.search = qs.toString();
  const out = rebuilt.href;

  const parts = [
    ['协议', u.protocol.replace(':', '')],
    ['主机', u.hostname],
    ['端口', u.port || '（默认端口，未显式写出）'],
    ['路径', u.pathname || '/'],
    ['查询字符串', u.search ? u.search.slice(1) : '（无）'],
    ['片段 hash', u.hash ? u.hash.slice(1) : '（无）'],
  ];
  if (u.username) parts.push(['用户名', u.username]);

  const dupKeys = new Set();
  const seen = new Set();
  for (const [k] of pairs) {
    if (seen.has(k)) dupKeys.add(k);
    seen.add(k);
  }

  const paramRows = pairs.length
    ? pairs
        .map(
          ([k, v], i) =>
            `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted);font-family:var(--mono);font-size:12.5px">${i + 1}</td><td style="padding:6px 4px;font-family:var(--mono)">${esc(k)}</td><td style="padding:6px 4px;font-family:var(--mono);word-break:break-all">${esc(v) || '<span style="color:var(--muted)">（空值）</span>'}</td><td style="padding:6px 4px;font-size:12px;color:var(--muted)">${dupKeys.has(k) ? '同名参数' : ''}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" style="padding:8px 4px;color:var(--muted)">这条地址没有查询参数</td></tr>';

  const edited = lines ? `参数区共 ${pairs.length} 个（已用它替换原参数）` : `沿用原地址里的 ${pairs.length} 个参数`;

  return {
    html: `<div class="msg-ok">✅ 解析完成${hadScheme ? '' : ' —— 原地址没写协议，已按 https 补全'}</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
        ${parts
          .map(
            ([k, v]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted);width:26%">${k}</td><td style="padding:6px 4px;font-family:var(--mono);word-break:break-all">${esc(v)}</td></tr>`
          )
          .join('')}
      </table>
      <p style="margin:14px 0 6px;color:var(--muted);font-size:13px">查询参数（${edited}）：</p>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:12.5px"><th style="padding:6px 4px;text-align:left">#</th><th style="padding:6px 4px;text-align:left">键</th><th style="padding:6px 4px;text-align:left">值（已解码）</th><th style="padding:6px 4px;text-align:left">备注</th></tr>
        ${paramRows}
      </table>
      <p style="margin:14px 0 6px;color:var(--muted);font-size:13px">重新拼装的地址：</p>
      <textarea readonly rows="3" style="width:100%;font-family:var(--mono);font-size:12.5px;line-height:1.6">${esc(out)}</textarea>
      <p style="margin-top:10px;color:var(--muted);font-size:13px">hash 与路径里的百分号编码原样保留；参数按标准重新编码。</p>`,
    text: out,
  };
}
