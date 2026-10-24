// 工具：UUID / ULID 生成（crypto 随机源，纯浏览器执行）
export const manifest = {
  inputs: [
    {
      name: 'version',
      label: '类型',
      type: 'select',
      default: 'v4',
      options: [
        { value: 'v4', label: 'UUID v4（随机，最常用）' },
        { value: 'ulid', label: 'ULID（按时间有序，适合数据库主键）' },
        { value: 'nano', label: 'Nano ID（短 ID，21 位）' },
      ],
    },
    { name: 'count', label: '生成数量（1–20）', type: 'number', default: '5' },
  ],
  runLabel: '生成',
  tips: ['做数据库主键、幂等令牌：选 ULID，按时间有序利于索引', '对外暴露的短链接 ID：用 Nano ID（21 位更短）', '同一毫秒内连续生成 ULID 也保证不重复（本工具做了单调递增处理）'],
  scenarios: [
    { scene: '建表需要一个绝不重复的主键', how: '选 ULID → 生成批量', result: '既唯一又按时间递增，索引友好' },
    { scene: '做短链接/分享码', how: '选 Nano ID', result: '21 位短 ID，比 UUID 好记好传' },
    { scene: '测试接口要造一批假 ID', how: '数量 20 + UUID v4', result: '一次拿到 20 个随机 ID 直接粘进用例' },
  ],
};

export async function run({ version, count }) {
  const n = Math.min(20, Math.max(1, Number(count) || 5));
  const gen = { v4: uuidV4, ulid: ulid, nano: nanoId }[version];
  const list = Array.from({ length: n }, gen);
  return {
    html: `<div class="msg-ok">✅ 已生成 ${n} 个</div><pre class="ok">${list.join('\n')}</pre>
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

function uuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ULID：48 位时间戳 + 80 位随机，Crockford Base32
const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
function ulid() {
  let time = Date.now();
  if (time <= lastTime) time = lastTime + 1; // 保证单调递增
  lastTime = time;
  let id = '';
  for (let i = 9; i >= 0; i--) {
    id = C32[(time % 32) | 0] + id;
    time = Math.floor(time / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0, acc = 0, out = '';
  for (const byte of rand) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += C32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return id + out;
}

function nanoId() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';
  const b = crypto.getRandomValues(new Uint8Array(21));
  return [...b].map((x) => alphabet[x % 64]).join('');
}
