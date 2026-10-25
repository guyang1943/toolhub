/**
 * 加密分享（v3.0 E2）：把工具输入加密后放进 URL 的 # 片段
 *
 * 为什么放 # 而不是 ?query：
 *   浏览器的 URL 片段（# 之后）**不会**随请求发送给服务器，也不进 CDN/访问日志。
 *   所以分享的 JSON、JWT、私钥片段在传输和日志里都不存在明文——这是这个功能唯一的价值，
 *   也是它比「把参数拼在 query 里」更值得做的原因。
 *
 * 两种模式：
 *   1. 无口令：随机生成密钥并放进链接本身。谁拿到链接谁都能解开（等于链接即钥匙），
 *      但内容仍然不经过服务器。
 *   2. 有口令：PBKDF2-SHA256（12 万次迭代）从口令派生密钥，钥匙不在链接里。
 *      链接和口令分开发（比如链接走微信、口令走电话），日志拿到链接也没用。
 *
 * 注意：WebCrypto 只在安全上下文（https / localhost）可用；否则提示「请用 https 打开」。
 */

const SUBTLE = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
const ITER = 120000;
export const ENC_PREFIX = '#enc=';

const b64u = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (str) => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function keyFromPassphrase(pass, salt) {
  const base = await SUBTLE.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return SUBTLE.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** 当前环境是否支持加密分享 */
export function canEncrypt() {
  return !!SUBTLE && typeof TextEncoder !== 'undefined';
}

/**
 * @param {any} data 任意可 JSON 序列化的数据
 * @param {string} [passphrase] 留空则密钥随链接一起走
 * @returns {Promise<string>} 形如 `enc=xxx` 的片段（不含 #）
 */
export async function createShare(data, passphrase) {
  if (!canEncrypt()) throw new Error('当前环境不支持加密（需要 https 或 localhost）');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const withPass = !!passphrase;
  const salt = withPass ? crypto.getRandomValues(new Uint8Array(16)) : null;
  const key = withPass ? await keyFromPassphrase(passphrase, salt) : await SUBTLE.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const ct = await SUBTLE.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  const envelope = { v: 1, iv: b64u(iv), ct: b64u(ct) };
  if (withPass) {
    envelope.pass = true;
    envelope.salt = b64u(salt);
  } else {
    // 无口令模式：把导出的原始密钥放进链接
    envelope.k = b64u(await SUBTLE.exportKey('raw', key));
  }
  return 'enc=' + b64u(new TextEncoder().encode(JSON.stringify(envelope)));
}

/** 读取 URL 片段里的信封（不解密），用于判断是否需要口令 */
export function peekShare(hash = location.hash) {
  if (!hash || !hash.startsWith(ENC_PREFIX)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(unb64u(hash.slice(ENC_PREFIX.length))));
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ok:true,data:any}|{needPass:true}|{ok:false,error:string}>}
 */
export async function openShare(hash, passphrase) {
  const env = peekShare(hash);
  if (!env || env.v !== 1 || !env.iv || !env.ct) return { ok: false, error: '链接格式不正确' };
  if (!canEncrypt()) return { ok: false, error: '当前页面不是安全上下文，无法解密（请用 https 打开）' };
  if (env.pass && !passphrase) return { needPass: true };
  try {
    const key = env.pass
      ? await keyFromPassphrase(passphrase, unb64u(env.salt))
      : await SUBTLE.importKey('raw', unb64u(env.k), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await SUBTLE.decrypt({ name: 'AES-GCM', iv: unb64u(env.iv) }, key, unb64u(env.ct));
    return { ok: true, data: JSON.parse(new TextDecoder().decode(plain)) };
  } catch {
    return { ok: false, error: env.pass ? '口令不正确，或链接内容被改动过' : '链接已损坏（可能复制时被截断）' };
  }
}
