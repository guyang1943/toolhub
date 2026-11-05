// 工具：条形码生成器（Canvas，纯浏览器执行）
//
// 编码用 JsBarcode（MIT，v3.12.3，随工具一起放在 tools/barcode-gen/jsbarcode.min.js）。
// 自己写 Code128 的 107 条编码表也能写，但那条表的每一位都影响扫码枪能不能认——
// 这东西不该靠手抄。库只在真正生成时按需加载（同源静态文件，不是第三方请求）。
//
// EAN-13 的校验位自己算，先算再交给库：库对 12 位会补校验位，对 13 位校验位错会直接抛错，
// 那个错误信息对用户没意义。这里提前算好并说清楚「你填的校验位应该是几」，可修可改。

const EAN13 = /^\d{12,13}$/;

function eanCheckDigit(d12) {
  // 从第 1 位起，奇数位权重 1、偶数位权重 3，求和后取「凑到 10 的补数」
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

let libPromise = null;
function loadLib() {
  if (typeof window !== 'undefined' && window.JsBarcode) return Promise.resolve(window.JsBarcode);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境不能画条码：需要在浏览器里运行'));
      return;
    }
    const s = document.createElement('script');
    s.src = '/tools/barcode-gen/jsbarcode.min.js';
    s.async = true;
    s.onload = () => (window.JsBarcode ? resolve(window.JsBarcode) : reject(new Error('条码库加载后没找到入口，请刷新重试')));
    s.onerror = () => reject(new Error('条码库没加载出来（/tools/barcode-gen/jsbarcode.min.js），请刷新页面重试'));
    document.head.appendChild(s);
  });
  return libPromise;
}

export const manifest = {
  usage:
    '生成 Code128 或 EAN-13 条形码并下载 PNG。EAN-13 填 12 位会自动补第 13 位校验位，填 13 位会核对校验位是否算错。Code128 支持字母数字与常见符号，适合内部编号、物料编码。',
  tips: [
    'EAN-13 是商品码，必须是 12 或 13 位数字：前 3 位是国家/地区码，690–699 是中国大陆',
    '填 12 位时工具自动补校验位；填 13 位时如果校验位不对，会直接告诉你正确的最后一位是几',
    'Code128 支持大小写字母、数字与常见符号，但不支持中文——中文要用二维码，不是条码',
    '下载的是 PNG，导出宽度按内容长度自动算；打印时保持至少 2 倍缩放，别把细条糊掉',
  ],
  scenarios: [
    { scene: '给物料做内部编号条码', how: '格式选 Code128、填编号', result: '得到能扫的 PNG，不用装条码软件' },
    { scene: '做商品标签', how: '格式选 EAN-13、填 12 位', result: '自动补校验位，扫出来就是填的那串' },
    { scene: '拿到 13 位码但扫不出来', how: '直接填进来', result: '校验位算错会当场告诉你正确值，不用猜' },
  ],
  inputs: [
    { name: 'text', label: '条码内容', type: 'text', placeholder: '690123456789' },
    {
      name: 'format',
      label: '格式',
      type: 'select',
      options: [
        { value: 'CODE128', label: 'Code128（字母数字符号）' },
        { value: 'EAN13', label: 'EAN-13（12 或 13 位数字）' },
      ],
    },
  ],
  runLabel: '生成条码',
};

export async function run({ text, format }) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('请填条码内容：空内容画不出条码');
  const fmt = format === 'EAN13' ? 'EAN13' : 'CODE128';

  let value = raw;
  let checkNote = '';

  if (fmt === 'EAN13') {
    const digits = raw.replace(/[\s-]/g, '');
    if (!digits) throw new Error('EAN-13 只能是数字');
    if (!/^\d+$/.test(digits)) throw new Error(`EAN-13 只能是数字，「${raw}」里有非数字字符`);
    if (digits.length !== 12 && digits.length !== 13) {
      throw new Error(`EAN-13 要 12 位（自动补校验位）或 13 位（含校验位），你填了 ${digits.length} 位`);
    }
    const body = digits.slice(0, 12);
    const expect = eanCheckDigit(body);
    if (digits.length === 12) {
      value = body + expect;
      checkNote = `已自动补校验位：${body} → ${value}（第 13 位 ${expect}）`;
    } else {
      const given = Number(digits[12]);
      if (given !== expect) {
        throw new Error(
          `校验位对不上：前 12 位 ${body} 的校验位应该是 ${expect}，你填的是 ${given}。改成 ${body}${expect} 再试`
        );
      }
      value = digits;
      checkNote = `校验位 ${expect} 核对通过`;
    }
  } else {
    if (raw.length > 80) throw new Error(`内容 ${raw.length} 个字符太长了：Code128 超过 80 位会宽到扫不出来，建议分批或改用二维码`);
    if (!/^[\x20-\x7e]+$/.test(raw)) {
      throw new Error('Code128 只支持英文字母、数字与常见符号，中文与全角字符请改用二维码');
    }
  }

  const JsBarcode = await loadLib();
  const canvas = document.createElement('canvas');
  try {
    // 宽度按字符数放大：定宽会把长内容压成一片糊，扫码枪读不出来
    const barWidth = fmt === 'EAN13' ? 2 : value.length > 24 ? 2 : 3;
    JsBarcode(canvas, value, {
      format: fmt,
      width: barWidth,
      height: 100,
      displayValue: true,
      fontSize: 16,
      margin: 10,
      background: '#ffffff',
      lineColor: '#000000',
    });
  } catch (e) {
    throw new Error(`这个内容按 ${fmt} 编不出来：${(e && e.message) || '参数不合法'}`);
  }

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('导出 PNG 失败，这个浏览器的 Canvas 可能被禁用');
  const fmtTxt = fmt === 'EAN13' ? 'EAN-13' : 'Code128';

  return {
    html: `<div class="msg-ok">📊 已生成 ${fmtTxt}：<code>${value}</code></div>
      ${checkNote ? `<p style="margin-top:6px;color:var(--muted);font-size:13px">${checkNote}</p>` : ''}
      <p style="margin-top:8px;color:var(--muted);font-size:13px">导出 ${canvas.width}×${canvas.height} PNG。打印时至少放大 2 倍，细条糊了就扫不出来；条码两侧留白（margin）不要裁掉，那是扫码枪的识别区。</p>`,
    text: `${fmtTxt}：${value}${checkNote ? `（${checkNote}）` : ''}`,
    files: [{ name: `barcode-${fmt.toLowerCase()}-${value}.png`, blob }],
  };
}
