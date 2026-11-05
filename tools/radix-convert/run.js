// 工具：进制转换（2/8/10/16/36，纯浏览器执行）
//
// 这里只用 BigInt，不用 Number。原因很具体：Number 只能精确表示到 2^53−1，
// 超过就静默丢精度——十六进制的 `0xFFFFFFFFFFFFFFFF` 转出来会是
// 18446744073709552000 而不是 18446744073709551615，差 385，且不报错。
// 对账、算哈希、看区块高度时，这种「看着对其实错」比报错危险得多。
//
// 非法行只标出来、不中断：批量粘贴时一行写错就把整批结果清空，是很糟的体验。
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export const manifest = {
  usage:
    '把一串数字从一种进制转到另一种，每行一个，批量处理。用的是 BigInt，超过 2^53 的大数也不丢精度；写错的行会单独标出原因，不影响其他行。',
  tips: [
    '大数用 BigInt 精确计算：0xFFFFFFFFFFFFFFFF 能完整转成 18446744073709551615，不会变成 1.8e19',
    '16 进制可带 0x 前缀；负数写 -ff 或 -255 都认',
    '写错的行会保留在结果里并标出原因，不会中断整批；空行自动跳过',
    '36 进制用 0–9 与 a–z；输出统一大写，粘回代码时注意大小写敏感性',
  ],
  scenarios: [
    { scene: '看区块链交易的十六进制数值', how: '粘贴 0x... 选 16 → 10', result: '得到精确的十进制值，不会因为精度丢位' },
    { scene: '把一批 ID 转成 36 进制缩短', how: '每行一个十进制数，选 10 → 36', result: '批量拿到短 ID，长度一致' },
    { scene: '核对权限位掩码', how: '选 2 → 16', result: '二进制与十六进制对照，便于检查哪一位被置上' },
  ],
  inputs: [
    { name: 'numbers', label: '数字（每行一个）', type: 'textarea', placeholder: '255\n0xff\n1000000000000000000' },
    {
      name: 'from',
      label: '原进制',
      type: 'select',
      options: [
        { value: '2', label: '2 进制' },
        { value: '8', label: '8 进制' },
        { value: '10', label: '10 进制' },
        { value: '16', label: '16 进制' },
        { value: '36', label: '36 进制' },
      ],
    },
    {
      name: 'to',
      label: '目标进制',
      type: 'select',
      options: [
        { value: '2', label: '2 进制' },
        { value: '8', label: '8 进制' },
        { value: '10', label: '10 进制' },
        { value: '16', label: '16 进制' },
        { value: '36', label: '36 进制' },
      ],
    },
  ],
  runLabel: '转换',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function parseInBase(raw, base) {
  let s = raw.trim().replace(/[\s_]/g, '');
  let neg = false;
  if (s.startsWith('-') || s.startsWith('+')) {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  if (base === 16 && /^0x/i.test(s)) s = s.slice(2);
  if (base === 2 && /^0b/i.test(s)) s = s.slice(2);
  if (base === 8 && /^0o/i.test(s)) s = s.slice(2);
  if (!s) throw new Error('没有数字');
  let n = 0n;
  const B = BigInt(base);
  for (const ch of s.toLowerCase()) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) throw new Error(`「${ch}」不是 ${base} 进制的数字`);
    n = n * B + BigInt(d);
  }
  return neg ? -n : n;
}

export async function run({ numbers, from, to }) {
  const src = String(numbers || '');
  if (!src.trim()) throw new Error('请先输入要转换的数字（每行一个）');
  const fromBase = Number(from) || 10;
  const toBase = Number(to) || 16;
  if (![2, 8, 10, 16, 36].includes(fromBase) || ![2, 8, 10, 16, 36].includes(toBase)) {
    throw new Error('进制只支持 2 / 8 / 10 / 16 / 36');
  }

  const lines = src.split('\n');
  const rows = [];
  const errors = [];
  let index = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    index++;
    try {
      const n = parseInBase(line, fromBase);
      const out = n.toString(toBase).toUpperCase();
      rows.push({ i: index, input: line.trim(), out, dec: n.toString(10), big: n > 9007199254740991n || n < -9007199254740991n });
    } catch (e) {
      errors.push({ i: index, input: line.trim(), reason: e.message });
      rows.push({ i: index, input: line.trim(), out: null, reason: e.message });
    }
  }

  if (!rows.length) throw new Error('没有可转换的内容（都是空行）');
  if (rows.every((r) => r.out === null)) throw new Error(`全都转换失败：${errors[0].reason}`);

  const okCount = rows.filter((r) => r.out !== null).length;
  const bigCount = rows.filter((r) => r.big).length;
  const showDec = toBase !== 10;

  const html = `<div class="msg-ok">✅ 转换 ${okCount} 行${errors.length ? ` · ${errors.length} 行有问题` : ''}${bigCount ? ` · 其中 ${bigCount} 个超过 2^53，已用 BigInt 精确计算` : ''}</div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
      <tr style="border-bottom:2px solid var(--border);color:var(--muted);font-size:12.5px">
        <th style="padding:6px 4px;text-align:left">#</th>
        <th style="padding:6px 4px;text-align:left">输入（${fromBase} 进制）</th>
        <th style="padding:6px 4px;text-align:left">结果（${toBase} 进制）</th>
        ${showDec ? '<th style="padding:6px 4px;text-align:left">十进制</th>' : ''}
      </tr>
      ${rows
        .map((r) =>
          r.out === null
            ? `<tr style="border-bottom:1px solid var(--border);color:var(--danger,#c33)"><td style="padding:6px 4px">${r.i}</td><td style="padding:6px 4px;font-family:var(--mono);word-break:break-all">${esc(r.input)}</td><td style="padding:6px 4px" colspan="${showDec ? 2 : 1}">⚠️ ${esc(r.reason)}</td></tr>`
            : `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted)">${r.i}</td><td style="padding:6px 4px;font-family:var(--mono);word-break:break-all">${esc(r.input)}</td><td style="padding:6px 4px;font-family:var(--mono);word-break:break-all">${esc(r.out)}</td>${showDec ? `<td style="padding:6px 4px;font-family:var(--mono);word-break:break-all;color:var(--muted)">${esc(r.dec)}</td>` : ''}</tr>`
        )
        .join('')}
    </table>
    <p style="margin-top:10px;color:var(--muted);font-size:13px">全程 BigInt 精确计算，不经过浮点数；结果统一大写（2–9 与 A–Z）。</p>`;

  const text = rows
    .filter((r) => r.out !== null)
    .map((r) => r.out)
    .join('\n');
  return { html, text };
}
