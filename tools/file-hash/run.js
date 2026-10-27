// 工具：文件哈希校验（纯本地流式计算，无第三方依赖）
// MD5 / SHA-1 / SHA-256 / SHA-512 全部手写增量实现：
//   · WebCrypto 没有 MD5；
//   · crypto.subtle.digest 必须一次吃下整块数据，1GB 的镜像会把标签页撑爆。
// 这里按 4MB 分片读取、逐片喂给增量哈希器，内存占用与文件大小无关。

export const manifest = {
  usage:
    '把下载到的安装包、镜像或压缩包拖进来，算出 MD5 / SHA-1 / SHA-256 / SHA-512，粘贴发布方给的校验值即可判断文件是否被篡改或没下完整。文件全程在本机读取，不会上传。',
  tips: [
    '官网校验值常带空格、冒号或大写，本工具比对时会自动忽略这些差异',
    'SHA-256 最通用；MD5 保留是为了对齐还在用 md5 的老发布页',
    '不一致不一定是被篡改：断点续传没下完、代理缓存截断同样会导致不一致',
  ],
  scenarios: [
    { scene: '下载了系统镜像，想确认没下坏', how: '选中 iso → SHA-256 → 粘贴官网公布的校验值', result: '显示「一致」即可放心刻盘安装' },
    { scene: '收到的压缩包想确认传输途中没被改动', how: '算 MD5，和对方发来的值比对', result: '逐位对齐，不一致时直接指出第几位开始不同' },
    { scene: '两个文件看着一样，想确认是不是同一份', how: '分别算 SHA-256 再比', result: '哈希相同即内容完全一致，比看修改时间可靠' },
  ],
  inputs: [
    // accept 不写 '*'：拖放路由按它决定「这个文件能不能推给本工具」，
    // 通配符会让首页把任何文件都推给哈希工具，变成噪音。这里只列「发布方会公布校验值」的
    // 安装包 / 镜像 / 可执行文件 / 压缩包；其它类型在文件对话框里切到「所有文件」照样能选，
    // 拖进工具页也不受限制。
    // v3.7 补压缩包：开源项目的发布包绝大多数是 .zip / .tar.gz，那才是校验值最常见的对象。
    {
      name: 'file',
      label: '选择文件（也可以直接拖进来）',
      type: 'file',
      accept:
        '.exe,.msi,.dmg,.pkg,.deb,.rpm,.apk,.appimage,.iso,.img,.bin,.jar,.whl,.pdf,.zip,.tar,.gz,.tgz,.7z,.xz,.bz2,.zst',
    },
    {
      name: 'algo',
      label: '算法',
      type: 'select',
      default: 'SHA-256',
      options: [
        { value: 'SHA-256', label: 'SHA-256（64 位十六进制，推荐）' },
        { value: 'MD5', label: 'MD5（32 位，仅兼容老校验页）' },
        { value: 'SHA-1', label: 'SHA-1（40 位，已不安全）' },
        { value: 'SHA-512', label: 'SHA-512（128 位）' },
      ],
    },
    {
      name: 'expect',
      label: '发布方校验值（可留空）',
      type: 'text',
      placeholder: '粘贴官方校验值，大小写与空格都不影响比对',
    },
  ],
  runLabel: '计算哈希',
};

/* ---------------- 常量 ----------------
   SHA-256 的 K、SHA-512 的 K 与 IV 都是「素数的立方根 / 平方根小数部分」。
   这里按定义现算，而不是手抄 160 个 64 位常量：常量表抄错一位，哈希会静默算错，
   而错误值看起来和正常值一模一样，极难定位。现算的代价只有启动时几毫秒。 */
const PRIMES = (() => {
  const out = [];
  for (let n = 2; out.length < 80; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) out.push(n);
  }
  return out;
})();

function iroot(n, k) {
  // 整数 k 次根（向下取整），Newton 迭代
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / k) + 1);
  const K = BigInt(k), K1 = K - 1n;
  for (;;) {
    const y = (K1 * x + n / x ** K1) / K;
    if (y >= x) return x;
    x = y;
  }
}

const fracRoot = (p, bits, root) => {
  // floor(frac(p^(1/root)) · 2^bits)
  const mask = (1n << BigInt(bits)) - 1n;
  return iroot(BigInt(p) << BigInt(bits * root), root) & mask;
};

const K256 = new Uint32Array(64);
for (let i = 0; i < 64; i++) K256[i] = Number(fracRoot(PRIMES[i], 32, 3));

// SHA-512 的字是 64 位：拆成 hi/lo 两个 32 位半字（比 BigInt 快一个数量级）
const K512 = new Uint32Array(160);
for (let i = 0; i < 80; i++) {
  const v = fracRoot(PRIMES[i], 64, 3);
  K512[i * 2] = Number(v >> 32n);
  K512[i * 2 + 1] = Number(v & 0xffffffffn);
}
const IV512 = new Uint32Array(16);
for (let i = 0; i < 8; i++) {
  const v = fracRoot(PRIMES[i], 64, 2);
  IV512[i * 2] = Number(v >> 32n);
  IV512[i * 2 + 1] = Number(v & 0xffffffffn);
}

const MD5_T = new Int32Array(64);
for (let i = 0; i < 64; i++) MD5_T[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/* ---------------- 压缩函数 ---------------- */
function md5Block(bytes, off, st) {
  const M = new Int32Array(16);
  for (let i = 0; i < 16; i++) {
    const p = off + i * 4;
    M[i] = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
  }
  let a = st[0], b = st[1], c = st[2], d = st[3];
  for (let i = 0; i < 64; i++) {
    let f, g;
    if (i < 16) { f = (b & c) | (~b & d); g = i; }
    else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
    else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
    else { f = c ^ (b | ~d); g = (7 * i) & 15; }
    const sum = (a + f + MD5_T[i] + M[g]) | 0;
    const s = MD5_S[i];
    a = d; d = c; c = b;
    b = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
  }
  st[0] = (st[0] + a) | 0;
  st[1] = (st[1] + b) | 0;
  st[2] = (st[2] + c) | 0;
  st[3] = (st[3] + d) | 0;
}

function sha1Block(bytes, off, st) {
  const W = new Int32Array(80);
  for (let i = 0; i < 16; i++) {
    const p = off + i * 4;
    W[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
  }
  for (let i = 16; i < 80; i++) {
    const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
    W[i] = (x << 1) | (x >>> 31);
  }
  let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4];
  for (let i = 0; i < 80; i++) {
    let f, k;
    if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
    else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
    else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
    else { f = b ^ c ^ d; k = 0xca62c1d6; }
    const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
    e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
  }
  st[0] = (st[0] + a) | 0;
  st[1] = (st[1] + b) | 0;
  st[2] = (st[2] + c) | 0;
  st[3] = (st[3] + d) | 0;
  st[4] = (st[4] + e) | 0;
}

function sha256Block(bytes, off, st) {
  const W = new Int32Array(64);
  for (let i = 0; i < 16; i++) {
    const p = off + i * 4;
    W[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
  }
  for (let i = 16; i < 64; i++) {
    const a15 = W[i - 15], a2 = W[i - 2];
    const s0 = ((a15 >>> 7) | (a15 << 25)) ^ ((a15 >>> 18) | (a15 << 14)) ^ (a15 >>> 3);
    const s1 = ((a2 >>> 17) | (a2 << 15)) ^ ((a2 >>> 19) | (a2 << 13)) ^ (a2 >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K256[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g; g = f; f = e;
    e = (d + t1) | 0;
    d = c; c = b; b = a;
    a = (t1 + t2) | 0;
  }
  st[0] = (st[0] + a) | 0;
  st[1] = (st[1] + b) | 0;
  st[2] = (st[2] + c) | 0;
  st[3] = (st[3] + d) | 0;
  st[4] = (st[4] + e) | 0;
  st[5] = (st[5] + f) | 0;
  st[6] = (st[6] + g) | 0;
  st[7] = (st[7] + h) | 0;
}

// SHA-512：每个 64 位字用 hi/lo 两个 32 位半字表示，st 为 16 个 Uint32 交错存放
function sha512Block(bytes, off, st) {
  const W = new Uint32Array(160);
  for (let i = 0; i < 16; i++) {
    const p = off + i * 8;
    W[i * 2] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    W[i * 2 + 1] = (bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7];
  }
  for (let i = 16; i < 80; i++) {
    const a = (i - 15) * 2, b = (i - 2) * 2;
    const xh = W[a], xl = W[a + 1], yh = W[b], yl = W[b + 1];
    // σ0 = rotr1 ^ rotr8 ^ shr7
    const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
    const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
    // σ1 = rotr19 ^ rotr61 ^ shr6（rotr61 = 转 32 再转 29，两个半字互换后错位）
    const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
    const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
    const lo = (W[(i - 16) * 2 + 1] >>> 0) + (s0l >>> 0) + (W[(i - 7) * 2 + 1] >>> 0) + (s1l >>> 0);
    const hi =
      (W[(i - 16) * 2] >>> 0) + (s0h >>> 0) + (W[(i - 7) * 2] >>> 0) + (s1h >>> 0) + Math.floor(lo / 4294967296);
    W[i * 2] = hi;
    W[i * 2 + 1] = lo >>> 0;
  }
  let ah = st[0], al = st[1], bh = st[2], bl = st[3], ch = st[4], cl = st[5], dh = st[6], dl = st[7];
  let eh = st[8], el = st[9], fh = st[10], fl = st[11], gh = st[12], gl = st[13], hh = st[14], hl = st[15];
  for (let i = 0; i < 80; i++) {
    // Σ1(e) = rotr14 ^ rotr18 ^ rotr41
    const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
    const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
    const chh = (eh & fh) ^ (~eh & gh);
    const chl = (el & fl) ^ (~el & gl);
    let t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i * 2 + 1] >>> 0) + (W[i * 2 + 1] >>> 0);
    const t1h = (hh >>> 0) + (S1h >>> 0) + (chh >>> 0) + (K512[i * 2] >>> 0) + (W[i * 2] >>> 0) + Math.floor(t1l / 4294967296);
    t1l = t1l >>> 0;
    // Σ0(a) = rotr28 ^ rotr34 ^ rotr39
    const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
    const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
    const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
    const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
    let t2l = (S0l >>> 0) + (majl >>> 0);
    const t2h = (S0h >>> 0) + (majh >>> 0) + Math.floor(t2l / 4294967296);
    t2l = t2l >>> 0;
    // h←g, g←f, f←e, e←d+T1, d←c, c←b, b←a, a←T1+T2
    hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
    let nl = (dl >>> 0) + (t1l >>> 0);
    eh = ((dh >>> 0) + (t1h >>> 0) + Math.floor(nl / 4294967296)) | 0;
    el = nl >>> 0;
    dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
    nl = (t1l >>> 0) + (t2l >>> 0);
    ah = ((t1h >>> 0) + (t2h >>> 0) + Math.floor(nl / 4294967296)) | 0;
    al = nl >>> 0;
  }
  const add = (p, hi, lo) => {
    const l = (st[p + 1] >>> 0) + (lo >>> 0);
    st[p] = (st[p] >>> 0) + (hi >>> 0) + Math.floor(l / 4294967296);
    st[p + 1] = l >>> 0;
  };
  add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl);
  add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
}

/* ---------------- 增量哈希器：任意长度数据分片喂入 ---------------- */
const ALGOS = {
  MD5: {
    block: 64,
    lenBytes: 8,
    little: true,
    words: 4,
    out: 'le32',
    create: () => new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]),
    compress: md5Block,
  },
  'SHA-1': {
    block: 64,
    lenBytes: 8,
    little: false,
    words: 5,
    out: 'be32',
    create: () => new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]),
    compress: sha1Block,
  },
  'SHA-256': {
    block: 64,
    lenBytes: 8,
    little: false,
    words: 8,
    out: 'be32',
    create: () =>
      new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]),
    compress: sha256Block,
  },
  'SHA-512': {
    block: 128,
    lenBytes: 16,
    little: false,
    words: 8,
    out: 'be64',
    create: () => Uint32Array.from(IV512),
    compress: sha512Block,
  },
};

export function createHasher(algo) {
  const cfg = ALGOS[algo];
  if (!cfg) throw new Error(`不支持的算法「${algo}」，可选：${Object.keys(ALGOS).join(' / ')}`);
  const st = cfg.create();
  const buf = new Uint8Array(cfg.block);
  let bufLen = 0, total = 0;

  return {
    update(bytes) {
      total += bytes.length;
      let i = 0;
      if (bufLen) {
        const need = cfg.block - bufLen;
        if (bytes.length < need) {
          buf.set(bytes, bufLen);
          bufLen += bytes.length;
          return;
        }
        buf.set(bytes.subarray(0, need), bufLen);
        cfg.compress(buf, 0, st);
        bufLen = 0;
        i = need;
      }
      for (; i + cfg.block <= bytes.length; i += cfg.block) cfg.compress(bytes, i, st);
      if (i < bytes.length) {
        buf.set(bytes.subarray(i), 0);
        bufLen = bytes.length - i;
      }
    },

    digest() {
      const padBlocks = bufLen + 1 + cfg.lenBytes <= cfg.block ? 1 : 2;
      const pad = new Uint8Array(padBlocks * cfg.block);
      pad.set(buf.subarray(0, bufLen), 0);
      pad[bufLen] = 0x80;
      const bits = total * 8;
      const hi = Math.floor(bits / 4294967296);
      const lo = bits >>> 0;
      const n = pad.length;
      if (cfg.little) {
        // MD5 的长度位是 64 位小端（低 32 位在前）。写成 32 位在 >512MB 时才暴露，
        // 空串与 "abc" 两个向量能验证补位形态，但只有大文件能验证这里的高低位顺序。
        pad[n - 8] = lo & 0xff; pad[n - 7] = (lo >>> 8) & 0xff;
        pad[n - 6] = (lo >>> 16) & 0xff; pad[n - 5] = (lo >>> 24) & 0xff;
        pad[n - 4] = hi & 0xff; pad[n - 3] = (hi >>> 8) & 0xff;
        pad[n - 2] = (hi >>> 16) & 0xff; pad[n - 1] = (hi >>> 24) & 0xff;
      } else {
        // 大端 64 位长度；SHA-512 的 128 位长度里高 64 位永远是 0（文件不可能到 2^61 字节）
        const at = n - 8;
        pad[at] = (hi >>> 24) & 0xff; pad[at + 1] = (hi >>> 16) & 0xff;
        pad[at + 2] = (hi >>> 8) & 0xff; pad[at + 3] = hi & 0xff;
        pad[at + 4] = (lo >>> 24) & 0xff; pad[at + 5] = (lo >>> 16) & 0xff;
        pad[at + 6] = (lo >>> 8) & 0xff; pad[at + 7] = lo & 0xff;
      }
      for (let p = 0; p < pad.length; p += cfg.block) cfg.compress(pad, p, st);

      const out = new Uint8Array(cfg.out === 'be64' ? cfg.words * 8 : cfg.words * 4);
      if (cfg.out === 'le32') {
        for (let w = 0; w < cfg.words; w++) {
          const v = st[w];
          out[w * 4] = v & 0xff;
          out[w * 4 + 1] = (v >>> 8) & 0xff;
          out[w * 4 + 2] = (v >>> 16) & 0xff;
          out[w * 4 + 3] = (v >>> 24) & 0xff;
        }
      } else if (cfg.out === 'be64') {
        for (let w = 0; w < cfg.words; w++) {
          const v = st[w * 2] >>> 0, u = st[w * 2 + 1] >>> 0;
          out[w * 8] = v >>> 24; out[w * 8 + 1] = (v >>> 16) & 0xff;
          out[w * 8 + 2] = (v >>> 8) & 0xff; out[w * 8 + 3] = v & 0xff;
          out[w * 8 + 4] = u >>> 24; out[w * 8 + 5] = (u >>> 16) & 0xff;
          out[w * 8 + 6] = (u >>> 8) & 0xff; out[w * 8 + 7] = u & 0xff;
        }
      } else {
        for (let w = 0; w < cfg.words; w++) {
          const v = st[w] >>> 0;
          out[w * 4] = v >>> 24; out[w * 4 + 1] = (v >>> 16) & 0xff;
          out[w * 4 + 2] = (v >>> 8) & 0xff; out[w * 4 + 3] = v & 0xff;
        }
      }
      return out;
    },
  };
}

export const hashBytes = (algo, bytes) => {
  const h = createHasher(algo);
  h.update(bytes);
  return h.digest();
};
export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/* ---------------- 文件读取：分片，整块不进内存 ---------------- */
const CHUNK = 4 * 1024 * 1024;

async function readSlice(file, start, end) {
  const blob = typeof file.slice === 'function' ? file.slice(start, end) : file;
  if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  // 老浏览器没有 Blob.arrayBuffer
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('读取失败，文件可能已被移动或没有读取权限'));
    fr.readAsArrayBuffer(blob);
  });
}

const sizeOf = (file) => (typeof file.size === 'number' ? file.size : 0);
const fmtSize = (n) =>
  n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

// 进度条复用工具页已有的加载样式（不往 assets 里加 CSS）
function progressSink(total) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return () => {};
  const box = document.getElementById('tool-result');
  if (!box || total < CHUNK) return () => {};
  let fill = null, txt = null;
  return (done) => {
    if (!fill) {
      box.innerHTML =
        '<div class="py-load"><div class="py-load-bar"><div class="py-load-fill" id="hash-fill"></div></div>' +
        '<div class="py-load-txt" id="hash-txt"></div></div>';
      fill = document.getElementById('hash-fill');
      txt = document.getElementById('hash-txt');
      if (!fill || !txt) return;
    }
    const pct = Math.min(100, Math.round((done / total) * 100));
    fill.style.width = pct + '%';
    txt.textContent = `正在读取并计算 ${fmtSize(done)} / ${fmtSize(total)}（${pct}%）`;
  };
}

const idle = () => new Promise((r) => setTimeout(r, 0));

/* ---------------- 校验值比对 ---------------- */
const clean = (s) => String(s || '').replace(/[\s:：\-]/g, '').toLowerCase();

function compare(expect, hex) {
  const want = clean(expect);
  if (!want) return null;
  if (!/^[0-9a-f]+$/.test(want)) {
    return { ok: false, text: '填写的校验值里有非十六进制字符，可能是把文件名或链接一起粘进来了' };
  }
  if (want.length !== hex.length) {
    return {
      ok: false,
      text: `位数不对：当前算法输出 ${hex.length} 位，你填的是 ${want.length} 位（确认一下算法是否选错）`,
    };
  }
  let diff = -1;
  for (let i = 0; i < hex.length; i++) if (hex[i] !== want[i]) { diff = i; break; }
  if (diff < 0) return { ok: true, text: '一致' };
  const win = (s) => s.slice(Math.max(0, diff - 6), diff) + '[' + s[diff] + ']' + s.slice(diff + 1, diff + 7);
  return { ok: false, diff, text: `从第 ${diff + 1} 位开始不一致（共 ${hex.length} 位）`, mine: win(hex), theirs: win(want) };
}

export async function run({ file, algo, expect }) {
  if (!file) throw new Error('请先选择一个文件（也可以把文件直接拖到这一页）');
  if (!algo) throw new Error('请选择要使用的哈希算法');
  if (!ALGOS[algo]) throw new Error(`不支持的算法「${algo}」，可选：${Object.keys(ALGOS).join(' / ')}`);

  const total = sizeOf(file);
  const hasher = createHasher(algo);
  const tick = progressSink(total);
  const started = Date.now();
  let done = 0;

  if (total === 0) {
    // 空文件也有确定哈希（MD5 d41d8cd98f00b204e9800998ecf8427e），不能因为「没读到数据」就报错
    hasher.update(new Uint8Array(0));
  } else {
    while (done < total) {
      const end = Math.min(done + CHUNK, total);
      let part;
      try {
        part = await readSlice(file, done, end);
      } catch (e) {
        throw new Error(`读取「${file.name || '文件'}」到 ${fmtSize(done)} 处失败：${e.message}`);
      }
      hasher.update(new Uint8Array(part));
      done = end;
      tick(done);
      await idle(); // 让出主线程，进度条才动得起来
    }
  }

  const hex = toHex(hasher.digest());
  const ms = Date.now() - started;
  const cmp = compare(expect, hex);
  const name = file.name || '未命名文件';

  let verdict = '';
  if (cmp) {
    verdict = cmp.ok
      ? '<div class="msg-ok">✅ 与填写的校验值一致，文件内容完整、未被改动</div>'
      : `<div class="msg-warn">⚠️ 与填写的校验值不一致：${cmp.text}${
          cmp.diff === undefined
            ? ''
            : `<br>实际 <code>${cmp.mine}</code><br>填写 <code>${cmp.theirs}</code>`
        }</div>`;
  }

  return {
    html: `<div class="msg-ok">✅ ${algo} 计算完成 · ${name}（${fmtSize(total)}）</div>
      <pre class="ok">${hex}</pre>
      ${verdict}
      <p>${hex.length} 位十六进制 · 耗时 ${ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'} · 全程本机计算，文件未上传</p>`,
    text: hex,
  };
}
