// 工具：JWT 解码（纯浏览器执行，仅解码不校验签名）
export const manifest = {
  usage: '粘贴 JWT（三段用点分隔的字符串），立即解码出 Header 与 Payload 内容。注意：本工具只做 Base64 解码，不验证签名，不能用于鉴权判断。',
  tips: [
    '解码后可核对 exp（过期时间）与 iat（签发时间），排查 401 问题',
    '不要把生产环境的 token 粘贴到不信任的网站——本工具全程本地处理',
    '签名校验必须由服务端完成，前端解码结果只作调试参考',
  ],
  scenarios: [
    { scene: '接口一直返回 401，怀疑 token 过期', how: '粘贴 token → 查看 exp 提示', result: '直接显示"已过期 / 还有 N 天到期"' },
    { scene: '想知道 token 里带了哪些权限', how: '粘贴 token → 看 Payload 的 scope/roles', result: '权限清单一次性看清' },
    { scene: '对比测试环境和生产环境的 token 差异', how: '分别解码两次，比对 payload', result: '快速发现 iss / aud 是否配错' },
  ],
  inputs: [
    { name: 'token', label: 'JWT Token', type: 'textarea', placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xxxxx' },
  ],
  runLabel: '解码',
};

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function timeNote(ts) {
  if (typeof ts !== 'number') return '';
  const d = new Date(ts * 1000);
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  const rel = diff > 0 ? `已过去 ${Math.round(diff / 86400)} 天` : `${Math.round(-diff / 86400)} 天后到期`;
  const warn = diff > 0 ? ' ⚠️ 已过期' : '';
  return `（${d.toLocaleString('zh-CN')} · ${rel}${warn}）`;
}

export async function run({ token }) {
  const raw = String(token).trim().replace(/^Bearer\s+/i, '');
  const parts = raw.split('.');
  if (parts.length < 2) throw new Error('不是合法的 JWT（应为 3 段，用 . 分隔）');
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
  } catch {
    throw new Error('Header 解码失败，请检查 token 是否完整');
  }
  try {
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    throw new Error('Payload 解码失败，请检查 token 是否完整');
  }
  const notes = [];
  if (payload.exp !== undefined) notes.push(`exp:${timeNote(payload.exp)}`);
  if (payload.iat !== undefined) notes.push(`iat:${timeNote(payload.iat)}`);
  return {
    html: `
      <div class="msg-err" style="background:#fff7ed;color:#c2570a;padding:8px 12px;border-radius:8px;font-size:13px">
        ⚠️ 仅解码，未验证签名 —— 解码成功不代表 token 有效
      </div>
      <div style="margin-top:12px;font-size:13px;color:var(--muted)">Header（算法：${header.alg || '?'}）</div>
      <pre class="ok">${escapeHTML(JSON.stringify(header, null, 2))}</pre>
      <div style="margin-top:12px;font-size:13px;color:var(--muted)">Payload</div>
      <pre class="ok">${escapeHTML(JSON.stringify(payload, null, 2))}</pre>
      ${notes.length ? `<div style="margin-top:10px;font-size:12.5px;color:var(--muted)">${notes.join('　')}</div>` : ''}`,
    text: JSON.stringify({ header, payload }, null, 2),
  };
}

function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
