// 工具：子网计算器（IPv4，纯浏览器执行）
//
// 只做 IPv4。IPv6 的位运算要 128 位整数，且「可用主机数」在 /64 下是个天文数字，
// 和 IPv4 的直觉完全不同——把两者塞进一个结果表只会让人误读。这里明确不做，文案里说清。
//
// 两个容易被忽略的边界，这里按 RFC 处理而不是按「主机数 = 2^n − 2」一刀切：
// · /31（RFC 3021）：点对点链路，两端都是可用地址，可用数 2
// · /32：单机地址，可用数 1
function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`「${ip}」不是 IPv4 地址：需要四段，用点分开（例：192.168.1.10）`);
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) throw new Error(`「${ip}」不是 IPv4 地址：每一段都必须是数字`);
    const v = Number(p);
    if (v > 255) throw new Error(`「${ip}」不是 IPv4 地址：${p} 超过 255`);
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function parseMask(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('请填子网掩码：可以写 24，也可以写 255.255.255.0');
  if (/^\d{1,2}$/.test(s)) {
    const p = Number(s);
    if (p < 0 || p > 32) throw new Error(`前缀长度 ${p} 不合法：IPv4 只在 0–32 之间`);
    return { prefix: p, maskInt: p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0, given: 'prefix' };
  }
  if (s.includes('.')) {
    const m = ipToInt(s);
    // 点分掩码必须是「从左连续的一串 1」：取反加一后应当是 2 的幂（0 掩码单独处理）
    const inv = (~m) >>> 0;
    const prefix = m === 0 ? 0 : 32 - Math.log2((inv + 1) >>> 0);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`掩码 ${s} 不合法：点分写法必须是连续的 1，例如 255.255.255.0、255.255.254.0`);
    }
    if ((((0xffffffff << (32 - prefix)) >>> 0) !== m) && prefix !== 0) {
      throw new Error(`掩码 ${s} 不合法：不是从左连续的 1（例如 255.0.255.0 这种写法不存在）`);
    }
    return { prefix, maskInt: m, given: 'dotted' };
  }
  throw new Error(`掩码 ${s} 看不懂：填 24 这样的前缀长度，或 255.255.255.0 这样的点分写法`);
}

function classify(n) {
  const inRange = (base, bits) => ((n >>> (32 - bits)) === (base >>> (32 - bits)));
  if (n === 0xffffffff) return '受限广播地址';
  if (inRange(0x00000000, 8)) return '「本网络」保留地址（0.0.0.0/8）';
  if (inRange(0x0a000000, 8)) return '私有地址（10.0.0.0/8）';
  if (inRange(0x64400000, 10)) return '运营商级 NAT 地址（100.64.0.0/10）';
  if (inRange(0x7f000000, 8)) return '回环地址（127.0.0.0/8）';
  if (inRange(0xa9fe0000, 16)) return '链路本地地址（169.254.0.0/16）';
  if (inRange(0xac100000, 12)) return '私有地址（172.16.0.0/12）';
  if (inRange(0xc0a80000, 16)) return '私有地址（192.168.0.0/16）';
  if (inRange(0xe0000000, 4)) return '组播地址（224.0.0.0/4）';
  if (inRange(0xf0000000, 4)) return '保留地址（240.0.0.0/4）';
  return '公网地址';
}

export const manifest = {
  usage:
    '输入一个 IPv4 地址与掩码（写 24 或 255.255.255.0 都认），算出网络地址、广播地址、可用地址范围、可用主机数与反掩码，并把掩码在两种写法之间互转。仅支持 IPv4。',
  tips: [
    '掩码两种写法都认：24 与 255.255.255.0 等价，结果里会同时给出',
    '/31 与 /32 按 RFC 处理：点对点链路两端都可用（2 个），单机地址是 1 个，不是 0',
    '只算 IPv4；IPv6 的位宽与「可用主机数」概念不同，硬塞进一张表只会误读',
    '结果里的「地址类型」按保留段判断，私有地址不等于不能上公网，还要看路由与 NAT',
  ],
  scenarios: [
    { scene: '配一台新机器的静态 IP', how: '填 192.168.1.10 / 24', result: '拿到可用范围与广播地址，避免把网关配成广播' },
    { scene: '看运维给的网段还剩多少地址', how: '填网络地址与掩码', result: '可用主机数直接给出，不用算 2^8−2' },
    { scene: '点对点链路该用 /30 还是 /31', how: '分别算一次看可用数', result: '/31 省下一半地址，结果里写明了依据' },
  ],
  inputs: [
    { name: 'ip', label: 'IPv4 地址', type: 'text', placeholder: '192.168.1.10' },
    { name: 'mask', label: '子网掩码', type: 'text', placeholder: '24 或 255.255.255.0' },
  ],
  runLabel: '计算',
};

export async function run({ ip, mask }) {
  const addr = String(ip || '').trim();
  if (!addr) throw new Error('请填 IPv4 地址（例：192.168.1.10）');
  const ipInt = ipToInt(addr);
  const { prefix, maskInt } = parseMask(mask);

  const network = (ipInt & maskInt) >>> 0;
  const wildcard = (~maskInt) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const total = Math.pow(2, 32 - prefix);

  let usable;
  let first;
  let last;
  if (prefix === 32) {
    usable = 1;
    first = network;
    last = network;
  } else if (prefix === 31) {
    usable = 2;
    first = network;
    last = broadcast;
  } else {
    usable = total - 2;
    first = (network + 1) >>> 0;
    last = (broadcast - 1) >>> 0;
  }

  const rows = [
    ['网络地址', `${intToIp(network)}/${prefix}`],
    ['广播地址', prefix >= 31 ? '（无，/31 与 /32 没有广播地址）' : intToIp(broadcast)],
    ['可用地址范围', usable ? `${intToIp(first)} – ${intToIp(last)}` : '（无可用地址）'],
    ['可用主机数', String(usable)],
    ['该网段地址总数', `${total}（含网络地址与广播地址）`],
    ['点分掩码', intToIp(maskInt)],
    ['前缀长度', `/${prefix}`],
    ['反掩码（wildcard）', intToIp(wildcard)],
    ['地址类型', classify(ipInt)],
    ['输入地址是否网络地址', ipInt === network ? '是（主机位全 0，不能分配给机器）' : '否'],
  ];
  if (prefix < 31) rows.push(['输入地址是否广播地址', ipInt === broadcast ? '是（主机位全 1，不能分配给机器）' : '否']);

  const notes = [];
  if (prefix === 31) notes.push('/31 按 RFC 3021 处理：点对点链路上两端都是可用地址，因此可用数是 2 而不是 0。');
  if (prefix === 32) notes.push('/32 是单机地址（常用于回环或主机路由），可用数为 1。');
  if (prefix === 0) notes.push('/0 匹配整个 IPv4 空间，可用地址数按 2^32 − 2 计。');

  return {
    html: `<div class="msg-ok">✅ ${intToIp(network)}/${prefix} · 可用 ${usable} 个地址</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted);width:38%">${k}</td><td style="padding:6px 4px;font-family:var(--mono);word-break:break-all">${v}</td></tr>`
          )
          .join('')}
      </table>
      ${notes.length ? `<p style="margin-top:10px;color:var(--muted);font-size:13px">${notes.join(' ')}</p>` : ''}
      <p style="margin-top:10px;color:var(--muted);font-size:13px">仅计算 IPv4。私有地址判断只是按保留段取值，能不能上网还取决于路由与 NAT。</p>`,
    text: [
      `网络地址：${intToIp(network)}/${prefix}`,
      `广播地址：${prefix >= 31 ? '无' : intToIp(broadcast)}`,
      `可用范围：${usable ? `${intToIp(first)} – ${intToIp(last)}` : '无'}`,
      `可用主机数：${usable}`,
      `掩码：${intToIp(maskInt)}（/${prefix}）`,
      `反掩码：${intToIp(wildcard)}`,
      `地址类型：${classify(ipInt)}`,
    ].join('\n'),
  };
}
