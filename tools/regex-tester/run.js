// 工具：正则测试器（JS 实时匹配，纯浏览器执行）
export const manifest = {
  usage: '输入正则表达式和待测试文本，实时高亮所有匹配项，并列出每个匹配的分组内容。支持 g/i/m/s 修饰符切换。',
  tips: ['写正则时先从小片段试起，逐步加量比一次写完整更容易定位问题', 'g 修饰符影响 lastIndex 与替换行为，测试和实际代码要保持一致', '贪婪匹配（.*）常常吃掉太多内容，用 .*? 改成非贪婪更可控'],
  scenarios: [
    { scene: '要提取日志里的 IP 地址', how: '输入 \\b\\d{1,3}(\\.\\d{1,3}){3}\\b → 粘贴日志', result: '所有 IP 高亮，并列出匹配数' },
    { scene: '验证手机号/邮箱格式规则', how: '粘贴规则 → 用几组正常与异常数据测试', result: '一眼看出规则是否过严或过松' },
    { scene: '替换前想确认会影响多少处', how: '看匹配数量与高亮范围', result: '避免误伤不该替换的内容' },
  ],
  inputs: [
    { name: 'pattern', label: '正则表达式（不含斜杠）', type: 'text', placeholder: '\\b\\w+@\\w+\\.\\w+\\b', default: '\\b\\d{1,3}(\\.\\d{1,3}){3}\\b' },
    { name: 'flags', label: '修饰符', type: 'select', default: 'g', options: [
      { value: 'g', label: 'g（全局）' }, { value: 'gi', label: 'gi（全局+忽略大小写）' },
      { value: 'gm', label: 'gm（全局+多行）' }, { value: 'gims', label: 'gims（全部开启）' },
    ] },
    { name: 'text', label: '测试文本', type: 'textarea', placeholder: '粘贴要匹配的文本…', default: '用户 192.168.1.10 于 10:24 登录\n异常来源 8.8.8.8，尝试次数 3\n内网 127.0.0.1 正常' },
  ],
  runLabel: '测试匹配',
};

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export async function run({ pattern, flags, text }) {
  if (!pattern.trim()) throw new Error('请输入正则表达式');
  let re;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    return { html: `<div class="msg-err">❌ 正则语法错误：${esc(e.message)}</div>` };
  }
  const matches = [...text.matchAll(new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'))];
  if (!matches.length) {
    return { html: `<div class="msg-err">没有匹配项（正则本身合法）</div>
      <pre class="ok">${esc(text)}</pre>` };
  }
  // 高亮
  let html = '', last = 0;
  for (const m of matches) {
    const i = m.index;
    html += esc(text.slice(last, i)) + `<mark style="background:#fde68a;color:#111;border-radius:3px">${esc(m[0])}</mark>`;
    last = i + m[0].length;
  }
  html += esc(text.slice(last));

  const rows = matches
    .slice(0, 20)
    .map((m, idx) => `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 6px;color:var(--muted)">${idx + 1}</td>
      <td style="padding:5px 6px;font-family:var(--mono)">${esc(m[0])}</td>
      <td style="padding:5px 6px;font-family:var(--mono);font-size:12px;color:var(--muted)">${m.slice(1).map((g) => (g === undefined ? '—' : esc(g))).join(' | ') || '—'}</td>
      <td style="padding:5px 6px;color:var(--muted);font-size:12px">位置 ${m.index}</td>
    </tr>`)
    .join('');

  return {
    html: `<div class="msg-ok">✅ 匹配 ${matches.length} 处${matches.length > 20 ? '（下表只显示前 20 条）' : ''}</div>
      <pre class="ok">${html}</pre>
      <div style="margin-top:12px;font-size:13px;color:var(--muted)">匹配明细</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <tr style="border-bottom:2px solid var(--border);text-align:left">
          <th style="padding:5px 6px">#</th><th style="padding:5px 6px">匹配内容</th>
          <th style="padding:5px 6px">分组</th><th style="padding:5px 6px">位置</th>
        </tr>${rows}
      </table>`,
    text: matches.map((m, i) => `${i + 1}. ${m[0]}（位置 ${m.index}）`).join('\n') || '无匹配',
  };
}
