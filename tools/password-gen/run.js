// 工具：强密码生成（crypto 随机源，纯浏览器执行）
export const manifest = {
  inputs: [
    { name: 'length', label: '密码长度（8–64）', type: 'number', default: '16' },
    {
      name: 'charset',
      label: '字符集',
      type: 'select',
      default: 'full',
      options: [
        { value: 'full', label: '字母+数字+符号（最强）' },
        { value: 'alnum', label: '字母+数字' },
        { value: 'alpha', label: '纯字母' },
        { value: 'num', label: '纯数字（PIN 码）' },
      ],
    },
    { name: 'count', label: '生成数量（1–10）', type: 'number', default: '5' },
  ],
  runLabel: '生成',
  tips: ['重要账号用 16 位以上 + 全字符集，配合同类工具各站独立', 'PIN 码场景建议纯数字 6-8 位即可', '基于浏览器 crypto 安全随机源，生成过程不联网、不上传'],
  scenarios: [
    { scene: '注册新服务想用强密码', how: '长度 20 + 全字符集 → 生成 → 复制', result: '密码强度"极强"，且从未离开本机' },
    { scene: '要一次给团队开 5 个账号', how: '数量填 5 → 生成', result: '批量产出互不相同的随机密码' },
    { scene: '设置手机 PIN 码', how: '选纯数字 + 6 位', result: '得到随机 PIN，不用生日等弱组合' },
  ],
};

export async function run({ length, charset, count }) {
  const len = Math.min(64, Math.max(8, Number(length) || 16));
  const n = Math.min(10, Math.max(1, Number(count) || 5));
  const sets = {
    full: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.<?',
    alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    num: '0123456789',
  };
  const chars = sets[charset] || sets.full;
  const rand = new Uint32Array(len * n);
  crypto.getRandomValues(rand);
  const list = [];
  for (let i = 0; i < n; i++) {
    let pw = '';
    for (let j = 0; j < len; j++) pw += chars[rand[i * len + j] % chars.length];
    list.push(pw);
  }
  const strength = len >= 16 && charset === 'full' ? '极强' : len >= 12 ? '强' : '中等';
  return {
    html: `<div class="msg-ok">✅ 已生成 ${n} 个密码（强度：${strength}，基于 crypto 安全随机源，不会离开本机）</div>
      <pre class="ok">${list.map(escapeHTML).join('\n')}</pre>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="copy-btn">复制全部</button></div>`,
    after(box) {
      box.querySelector('#copy-btn').onclick = async (e) => {
        await navigator.clipboard.writeText(list.join('\n'));
        e.target.textContent = '已复制 ✓';
        setTimeout(() => (e.target.textContent = '复制全部'), 1500);
      };
    },
  };
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
