// 工具：身份证 / 银行卡号校验（GB 11643 校验码 + 银联卡 Luhn，纯本地）
const PROVINCE = {
  11: '北京', 12: '天津', 13: '河北', 14: '山西', 15: '内蒙古',
  21: '辽宁', 22: '吉林', 23: '黑龙江',
  31: '上海', 32: '江苏', 33: '浙江', 34: '安徽', 35: '福建', 36: '江西', 37: '山东',
  41: '河南', 42: '湖北', 43: '湖南', 44: '广东', 45: '广西', 46: '海南',
  50: '重庆', 51: '四川', 52: '贵州', 53: '云南', 54: '西藏',
  61: '陕西', 62: '甘肃', 63: '青海', 64: '宁夏', 65: '新疆',
  71: '中国台湾', 81: '中国香港', 82: '中国澳门', 91: '国外',
};

const ID_W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_C = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

function idCheckChar(id17) {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (id17.charCodeAt(i) - 48) * ID_W[i];
  return ID_C[sum % 11];
}

function luhnOk(s) {
  let sum = 0;
  let dbl = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function cardOrg(d) {
  if (/^62/.test(d)) return '银联 UnionPay';
  if (/^4/.test(d)) return 'Visa';
  if (/^5[1-5]/.test(d)) return 'Mastercard';
  if (/^\d{4}/.test(d)) {
    const head = Number(d.slice(0, 4));
    if (head >= 2221 && head <= 2720) return 'Mastercard';
  }
  if (/^3[47]/.test(d)) return 'American Express';
  if (/^35/.test(d)) return 'JCB';
  if (/^(6011|64[4-9]|65)/.test(d)) return 'Discover';
  if (/^9/.test(d)) return '部分国内借记卡';
  return '未识别卡组织';
}

// 从 8 位生日串解析年龄/是否合法
function parseBirth(s) {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  if (y < 1900 || dt.getTime() > Date.now()) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d)) age--;
  return { y, m, d, age };
}

const pad2 = (n) => String(n).padStart(2, '0');

// 返回 { type, ok, detail }
function checkOne(raw) {
  const s = String(raw).replace(/\s+/g, '').replace(/-/g, '');

  if (/^\d{17}[\dXx]$/.test(s)) {
    const id = s.toUpperCase();
    const birth = parseBirth(id.slice(6, 14));
    const prov = PROVINCE[Number(id.slice(0, 2))];
    const expect = idCheckChar(id.slice(0, 17));
    const ok = expect === id[17];
    const gender = Number(id[16]) % 2 === 1 ? '男' : '女';
    const birthday = birth ? `${birth.y}-${pad2(birth.m)}-${pad2(birth.d)}` : '出生日期非法';
    const parts = [
      prov ? `归属地 ${prov}` : '前两位地区码未识别',
      birthday,
      birth ? `${gender} · ${birth.age} 岁` : gender,
      ok ? '校验码正确' : `校验码应为 ${expect}，实际 ${id[17]}`,
    ];
    return { type: '身份证（18 位）', ok: ok && !!birth, detail: parts.join(' · ') };
  }

  if (/^\d{15}$/.test(s)) {
    const birth = parseBirth('19' + s.slice(6, 12));
    const prov = PROVINCE[Number(s.slice(0, 2))];
    const gender = Number(s[14]) % 2 === 1 ? '男' : '女';
    return {
      type: '身份证（15 位·旧版）',
      ok: !!birth,
      detail: [
        prov ? `归属地 ${prov}` : '前两位地区码未识别',
        birth ? `${birth.y}-${pad2(birth.m)}-${pad2(birth.d)}` : '出生日期非法',
        birth ? `${gender} · ${birth.age} 岁` : gender,
        '旧版无校验码，建议确认是否已升位到 18 位',
      ].join(' · '),
    };
  }

  if (/^\d{12,19}$/.test(s)) {
    const ok = luhnOk(s);
    const allSame = /^(\d)\1+$/.test(s);
    return {
      type: '银行卡号',
      ok: ok && !allSame,
      detail: [
        cardOrg(s),
        `${s.length} 位`,
        ok ? 'Luhn 校验通过' : 'Luhn 校验不通过（可能输错一位）',
        allSame ? '全部为同一数字，明显不是真实卡号' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  return { type: '无法识别', ok: false, detail: '既不是 18/15 位身份证，也不是 12–19 位纯数字卡号' };
}

export const manifest = {
  usage:
    '批量校验身份证号与银行卡号的格式：身份证按 GB 11643 的加权校验码判断真伪，并解析归属地、出生日期、性别和年龄；银行卡按 Luhn 算法校验并识别卡组织。每行输入一个号码，适合核对表格数据、检查表单提交前的脏数据。全部在本地计算，号码不会上传。',
  tips: [
    '校验码通过只代表「格式合法」，不代表号码真实存在——真实姓名仍需通过实名接口核验',
    '银行卡 16–19 位都能校验；输错一位数字有约 90% 概率被 Luhn 拦下',
    '身份证第 17 位奇数为男、偶数为女，本工具已自动解析',
    '批量粘贴时，空格和短横线会自动忽略',
  ],
  scenarios: [
    { scene: '收集表里有一批身份证号要核对', how: '每行一个粘贴进来 → 校验', result: '一眼看出哪些校验码错、哪些生日不存在' },
    { scene: '用户填的银行卡号总是提交失败', how: '粘贴卡号 → 看 Luhn 结果', result: '确认是输错数字还是位数不对' },
    { scene: '表单开发要写前端校验', how: '用本工具核对测试用例的预期结果', result: '拿到校验码与卡组织的判定依据' },
  ],
  inputs: [
    {
      name: 'list',
      label: '身份证号 / 银行卡号（每行一个，最多 200 行）',
      type: 'textarea',
      placeholder: '110101199003074514\n6222020200011111111',
    },
  ],
  runLabel: '校验',
};

export async function run({ list }) {
  const lines = String(list || '')
    .split(/[\n\r,，;；]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('请先粘贴至少一个号码（每行一个）');
  if (lines.length > 200) throw new Error(`一次最多校验 200 个号码，当前 ${lines.length} 个，请分批`);

  const results = lines.map((x) => ({ input: x, ...checkOne(x) }));
  const okCount = results.filter((r) => r.ok).length;
  const idCount = results.filter((r) => r.type.startsWith('身份证')).length;
  const cardCount = results.filter((r) => r.type === '银行卡号').length;
  const unknown = results.length - idCount - cardCount;

  const mask = (s) => (s.length <= 8 ? s : s.slice(0, 4) + '*'.repeat(Math.max(4, s.length - 8)) + s.slice(-4));

  const rows = results
    .map(
      (r) => `<tr>
        <td style="font-family:ui-monospace,monospace">${mask(r.input)}</td>
        <td>${r.type}</td>
        <td>${r.ok ? '✅ 通过' : '❌ 未通过'}</td>
        <td style="font-size:13px">${r.detail}</td>
      </tr>`
    )
    .join('');

  return {
    html: `
      <div class="msg-ok">✅ 共校验 ${results.length} 个：通过 ${okCount} 个，未通过 ${results.length - okCount} 个（身份证 ${idCount} · 银行卡 ${cardCount}${unknown ? ' · 无法识别 ' + unknown : ''}）</div>
      <div style="overflow-x:auto;margin-top:12px">
        <table class="tbl">
          <thead><tr><th>号码（已打码）</th><th>类型</th><th>结果</th><th>解析详情</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="panel tips" style="margin-top:14px">🔒 <b>隐私与边界</b>
        <ul>
          <li>号码只在本页内存中计算，不上传、不记录；表格展示时已做打码处理</li>
          <li>校验码 / Luhn 只能证明「格式与数位自检正确」，无法证明号码真实存在或未注销</li>
          <li>归属地按前两位省级代码解析，精确到区县需要完整行政区划库，本工具不提供</li>
        </ul>
      </div>`,
  };
}
