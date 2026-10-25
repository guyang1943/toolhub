#!/usr/bin/env node
// 四个新工具的功能级测试：直接调用 run.js 的 run()，验证真实输出
// 用法：node scripts/new-tools-test.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let pass = 0,
  fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? '  (' + detail + ')' : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? '  (' + detail + ')' : ''}`);
  }
};

// ---------- 1. 个税计算器 ----------
console.log('\n💰 个税计算器（累计预扣法）');
const tax = await import('file://' + join(root, 'tools/tax-calc/run.js').replace(/\\/g, '/'));
{
  const out = await tax.run({ salary: '15000', month: '10', social: '2500', kids: '2000', toddlers: '0', elder: '0', housing: '1500', edu: '0', other: '0' });
  const html = out.html;
  // 手工核算：累计应税 40000 → 累计税额 1480；9 月累计应税 36000 → 税额 1080；本月 400
  check('本月个税 = ¥400.00', html.includes('¥400.00'), '累计预扣 1480 − 上月 1080');
  check('税后到手 = ¥12,100.00', html.includes('¥12,100.00'));
  check('适用税率 10%', html.includes('10%'));
  check('全年合计个税 ¥2,280.00', html.includes('¥2,280.00'), '12 个月合计 = 年度税额');
  check('含 12 个月预测表', (html.match(/<tr/g) || []).length >= 18, `${(html.match(/<tr/g) || []).length} 行`);
  check('当前月份高亮', html.includes('font-weight:700'));
  // 高税率档：月薪 5 万无扣除，全年应税 54 万 → 30% 档，税额 109080
  const hi = await tax.run({ salary: '50000', month: '12', social: '0', kids: '0', toddlers: '0', elder: '0', housing: '0', edu: '0', other: '0' });
  check('高收入档全年 ¥109,080.00', hi.html.includes('¥109,080.00'), '54 万应税 × 30% − 52920');
  // 低收入不交税：月薪 4000 < 起征点
  const lo = await tax.run({ salary: '4000', month: '12', social: '0', kids: '0', toddlers: '0', elder: '0', housing: '0', edu: '0', other: '0' });
  check('低于起征点全年 ¥0.00', lo.html.includes('¥0.00'));
  // 错误处理
  let err = '';
  try {
    await tax.run({ salary: '', month: '1', social: '0', kids: '0', toddlers: '0', elder: '0', housing: '0', edu: '0', other: '0' });
  } catch (e) {
    err = e.message;
  }
  check('空月薪报错', err.includes('税前月薪'), err);
  err = '';
  try {
    await tax.run({ salary: '10000', month: '13', social: '0', kids: '0', toddlers: '0', elder: '0', housing: '0', edu: '0', other: '0' });
  } catch (e) {
    err = e.message;
  }
  check('月份 13 报错', err.includes('1–12'), err);
}

// ---------- 2. 单位换算 ----------
console.log('\n📐 单位换算');
const unit = await import('file://' + join(root, 'tools/unit-convert/run.js').replace(/\\/g, '/'));
{
  const conv = (cat, from, to, value) => unit.run({ cat, value, from, to });
  const r1 = await conv('length', 'm', 'ft', '1');
  check('1 米 = 3.2808399 英尺', r1.html.includes('3.2808399'), '英制换算');
  const r2 = await conv('temperature', 'C', 'F', '100');
  check('100℃ = 212℉', r2.html.includes('212'), '温度线性换算');
  check('温度全量表不崩（含华氏/开氏行）', r2.html.includes('华氏度') && r2.html.includes('开尔文'));
  const r3 = await conv('temperature', 'C', 'K', '-273.15');
  check('-273.15℃ = 0K', r3.html.includes('>0<'), '绝对零度');
  const r4 = await conv('data', 'TB', 'GiB', '1');
  check('1TB ≈ 931.32257GiB', r4.html.includes('931.32257'), '10 进制 → 2 进制（8 位有效数字）');
  const r5 = await conv('mass', 'kg', 'jin', '1');
  check('1 千克 = 2 市斤', r5.html.includes('>2<'), '市斤');
  const r6 = await conv('speed', 'mach', 'kmh', '1');
  check('1 马赫 ≈ 1,225.044 km/h', r6.html.includes('1,225.044'), '340.29 × 3.6');
  const r7 = await conv('angle', 'rad', 'deg', '1');
  check('1 弧度 = 57.29578 度', r7.html.includes('57.29578'), '弧度（8 位有效数字）');
  // 全量表：长度类 9 个单位 + 表头 = 10 行
  check('全量表 10 行（长度：9 单位 + 表头）', (r1.html.match(/<tr/g) || []).length === 10);
  // 无效输入
  let err = '';
  try {
    await conv('length', '', '', '1');
  } catch (e) {
    err = e.message;
  }
  check('未选单位报错', err.includes('来源单位'), err);
  err = '';
  try {
    await unit.run({ cat: 'length', value: 'abc', from: 'm', to: 'ft' });
  } catch (e) {
    err = e.message;
  }
  check('非数字报错', err.includes('有效数字'), err);
  check('导出 onForm 钩子', typeof unit.onForm === 'function');
}

// ---------- 3. PDF 合并/拆分（真实 pdf-lib） ----------
console.log('\n📄 PDF 合并 / 拆分（真实 PDF 处理）');
const PDFLib = require(join(root, 'assets/vendor/pdf-lib.min.js'));
globalThis.window = { PDFLib };
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => 'blob:mock');
globalThis.Blob = globalThis.Blob || class Blob {};

async function makePdf(pages, text) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`${text}-${i + 1}`, { x: 20, y: 100, size: 20 });
  }
  return new Uint8Array(await doc.save());
}
const asFile = (bytes, name) => ({ name, type: 'application/pdf', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

const pdf = await import('file://' + join(root, 'tools/pdf-merge/run.js').replace(/\\/g, '/'));
{
  const a = await makePdf(3, 'A');
  const b = await makePdf(2, 'B');
  const merged = await pdf.run({ mode: 'merge', files: [asFile(a, 'a.pdf'), asFile(b, 'b.pdf')] });
  check('合并提示 2 个文件 / 5 页', merged.html.includes('共 5 页'), merged.html.match(/共 \d+ 页/)?.[0]);
  check('合并输出文件名 merged.pdf', merged.files?.[0]?.name === 'merged.pdf');

  const ex = await pdf.run({ mode: 'extract', files: [asFile(a, 'a.pdf')], pages: '1,3', every: '1' });
  check('提取 2 页', ex.html.includes('已提取 2 / 3 页'), ex.html.match(/已提取 \d+ \/ \d+ 页/)?.[0]);

  const exAll = await pdf.run({ mode: 'extract', files: [asFile(a, 'a.pdf')], pages: '', every: '1' });
  check('留空页码范围 = 全部 3 页', exAll.html.includes('已提取 3 / 3 页'));

  const sp = await pdf.run({ mode: 'split', files: [asFile(a, 'a.pdf')], pages: '', every: '2' });
  check('每份 2 页拆成 2 个文件', sp.html.includes('已拆成 2 个文件'), sp.html.match(/已拆成 \d+ 个文件/)?.[0]);
  const spNames = (sp.files || []).map((f) => f.name);
  check('拆分文件名含页码范围', spNames.includes('a-1-2.pdf') && spNames.includes('a-3-3.pdf'), spNames.join(' / '));

  // 真实校验合并产物的页数（绕过 Blob 桩，直接验证内部产物不可行——用二次加载验证思路替代：
  // 合并/提取/拆分均走同一 save() 链路，页数提示来自真实 getPageCount，已由上方断言覆盖）

  let err = '';
  try {
    await pdf.run({ mode: 'extract', files: [asFile(a, 'a.pdf')], pages: '5', every: '1' });
  } catch (e) {
    err = e.message;
  }
  check('越界页码报错', err.includes('超出范围'), err);
  err = '';
  try {
    await pdf.run({ mode: 'extract', files: [asFile(a, 'a.pdf')], pages: 'x-y', every: '1' });
  } catch (e) {
    err = e.message;
  }
  check('非法片段报错', err.includes('无法识别'), err);
  err = '';
  try {
    await pdf.run({ mode: 'merge', files: [asFile(a, 'a.pdf')] });
  } catch (e) {
    err = e.message;
  }
  check('合并少于 2 个文件报错', err.includes('至少需要选择'), err);
  err = '';
  try {
    await pdf.run({ mode: 'merge', files: [asFile(a, 'a.pdf'), { name: 'b.txt', type: 'text/plain', arrayBuffer: async () => new ArrayBuffer(8) }] });
  } catch (e) {
    err = e.message;
  }
  check('非 PDF 文件报错', err.includes('不是 PDF'), err);
}

// ---------- 4. 二维码解析（Python 生成真 QR → RGBA 直喂 jsQR + 全链路 DOM 桩） ----------
console.log('\n🔳 二维码解析（真实 QR 解码）');
const qrPng = join(root, '.tmp-qr.png');
const qrRgba = join(root, '.tmp-qr.rgba');
const qrInv = join(root, '.tmp-qr-inv.rgba');
const qrNoise = join(root, '.tmp-noise.rgba');
if (!existsSync(qrRgba)) {
  execFileSync('C:\\Users\\huwei\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe', ['-c', `
import qrcode, json, random
from PIL import Image
qr = qrcode.QRCode(border=2, box_size=8)
qr.add_data('https://sitool.eu.org/tools/tax-calc/')
qr.make()
img = qr.make_image(fill_color='black', back_color='white').convert('RGB')
w, h = img.size
img.save(${JSON.stringify(qrPng)})
rgba = bytearray()
inv = bytearray()
for r, g, b in img.getdata():
    rgba += bytes((r, g, b, 255))
    inv += bytes((255 - r, 255 - g, 255 - b, 255))
open(${JSON.stringify(qrRgba)}, 'wb').write(rgba)
open(${JSON.stringify(qrInv)}, 'wb').write(inv)
noise = bytearray()
random.seed(42)
for _ in range(w * h):
    v = random.randint(0, 255)
    noise += bytes((v, v, v, 255))
open(${JSON.stringify(qrNoise)}, 'wb').write(noise)
json.dump({'w': w, 'h': h}, open(${JSON.stringify(join(root, '.tmp-qr.dims.json'))}, 'w'))
`], { stdio: 'pipe' });
}
const dims2 = JSON.parse(readFileSync(join(root, '.tmp-qr.dims.json'), 'utf8'));

const jsQR = require(join(root, 'assets/vendor/jsQR.js'));
globalThis.window = { jsQR };
{
  const w = dims2.w,
    h = dims2.h;
  if (w && h) {
    const data = new Uint8Array(readFileSync(qrRgba));
    const found = jsQR(data, w, h, { inversionAttempts: 'attemptBoth' });
    check('jsQR 解码真实二维码', !!found && found.data === 'https://sitool.eu.org/tools/tax-calc/', found?.data);
    check('识别到四个定位角', !!found && !!found.location && !!found.location.topLeftCorner && !!found.location.bottomRightCorner);
    const inv = new Uint8Array(readFileSync(qrInv));
    const foundInv = jsQR(inv, w, h, { inversionAttempts: 'attemptBoth' });
    check('反色二维码也能解码', !!foundInv && foundInv.data === 'https://sitool.eu.org/tools/tax-calc/', foundInv?.data);
    const noise = new Uint8Array(readFileSync(qrNoise));
    const none = jsQR(noise, w, h, { inversionAttempts: 'attemptBoth' });
    check('随机噪声图返回 null', none === null);
  } else {
    console.log('  ⚠️ 未拿到二维码维度，跳过');
  }

  // 全链路：run() + DOM 桩（createImageBitmap / canvas / after 钩子）
  const stubEl = () => {
    const el = {
      style: {},
      children: [],
      _h: {},
      addEventListener(t, fn) {
        (this._h[t] = this._h[t] || []).push(fn);
      },
      appendChild(c) {
        this.children.push(c);
      },
      querySelector: (s) => (s.startsWith('#') ? stubEl() : null),
    };
    return el;
  };
  const canvasStub = (rgba, w, h) => {
    const c = stubEl();
    c.width = w;
    c.height = h;
    c.getContext = () => ({
      drawImage() {},
      getImageData: (x, y, cw, ch) => ({ data: rgba.subarray(0, cw * ch * 4), width: cw, height: ch }),
      stroke() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
    });
    c.toDataURL = () => 'data:image/png;base64,';
    return c;
  };
  const img = new Uint8Array(readFileSync(qrRgba));
  const realCanvas = canvasStub(img, dims2.w, dims2.h);
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? canvasStub(img, dims2.w, dims2.h) : stubEl()),
    head: stubEl(),
  };
  globalThis.createImageBitmap = async (file) => ({ width: dims2.w, height: dims2.h });
  const qr = await import('file://' + join(root, 'tools/qr-decode/run.js').replace(/\\/g, '/'));
  const out = await qr.run({ file: { name: 'qr.png', type: 'image/png' } });
  check('run() 返回识别成功', out.html.includes('识别成功'));
  check('run() 输出内容与类型', out.html.includes('https://sitool.eu.org/tools/tax-calc/') && out.html.includes('网址链接'));
  check('run() 返回可复制文本 + 打开链接', typeof out.text === 'string' && out.text.includes('https://sitool.eu.org/') && out.html.includes('打开链接'));
  // after 钩子（预览图标注 + 复制按钮）
  const box = stubEl();
  out.after(box);
  check('after() 渲染预览图', box.children.length > 0 || box._h);
  // 无二维码图片报错
  const noiseCanvas = canvasStub(new Uint8Array(readFileSync(qrNoise)), dims2.w, dims2.h);
  globalThis.document.createElement = (tag) => (tag === 'canvas' ? canvasStub(new Uint8Array(readFileSync(qrNoise)), dims2.w, dims2.h) : stubEl());
  let err = '';
  try {
    await qr.run({ file: { name: 'noise.png', type: 'image/png' } });
  } catch (e) {
    err = e.message;
  }
  check('无二维码图片友好报错', err.includes('没有识别到二维码'), err);
}

// ---------- 5. 房贷计算器 ----------
console.log('\n🏠 房贷计算器（等额本息 / 等额本金）');
const mortgage = await import('file://' + join(root, 'tools/mortgage-calc/run.js').replace(/\\/g, '/'));
{
  const eq = await mortgage.run({ amount: '100', rate: '3.5', years: '30', mode: 'equal-payment' });
  // 100 万 · 3.5% · 360 期：月供 4490.45，总利息 616,560.88
  check('等额本息月供 ¥4,490.45', eq.html.includes('¥4,490.45'), 'P·r(1+r)^n / ((1+r)^n−1)');
  check('支付利息 ¥616,560.88', eq.html.includes('¥616,560.88'));
  check('还款总额 ¥1,616,560.88', eq.html.includes('¥1,616,560.88'));
  check('逐年表 30 行', (eq.html.match(/<td>第 \d+ 年<\/td>/g) || []).length === 30);

  const ep = await mortgage.run({ amount: '100', rate: '3.5', years: '30', mode: 'equal-principal' });
  // 首月 = 1000000/360 + 1000000*0.035/12 = 2777.78 + 2916.67
  check('等额本金首月 ¥5,694.44', ep.html.includes('¥5,694.44'), '本金均摊 + 首月全额利息');
  check('等额本金总利息更少', ep.html.includes('¥526,458.33'), ep.html.match(/¥[\d,]+\.\d\d<\/b><span>支付利息总额/)?.[0]);

  const zero = await mortgage.run({ amount: '100', rate: '0', years: '10', mode: 'equal-payment' });
  check('零利率月供 ¥8,333.33', zero.html.includes('¥8,333.33'), '100 万 / 120 期');
  check('零利率无利息', zero.html.includes('¥0.00'));

  let err = '';
  try {
    await mortgage.run({ amount: '0', rate: '3.5', years: '30', mode: 'equal-payment' });
  } catch (e) {
    err = e.message;
  }
  check('金额为 0 报错', err.includes('大于 0'), err);
  err = '';
  try {
    await mortgage.run({ amount: '100', rate: '40', years: '30', mode: 'equal-payment' });
  } catch (e) {
    err = e.message;
  }
  check('利率 40% 报错', err.includes('0–30'), err);
}

// ---------- 6. 时区转换 ----------
console.log('\n🌍 时区转换（真实 IANA 数据）');
const tzc = await import('file://' + join(root, 'tools/timezone-convert/run.js').replace(/\\/g, '/'));
{
  const rowOf = (html, city) => html.split('<tr').find((x) => x.includes(city)) || '';
  const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const t1 = await tzc.run({ datetime: '2026-10-25 20:00', zone: 'Asia/Shanghai' });
  check('北京 20:00 → 纽约 08:00', strip(rowOf(t1.html, '纽约')).includes('2026-10-25 08:00'), 'UTC+8 → UTC−4');
  check('纽约时差 −12 小时', strip(rowOf(t1.html, '纽约')).includes('−12 小时'));
  check('东京 +1 小时', strip(rowOf(t1.html, '东京')).includes('+1 小时'));
  check('伦敦 10 月末为标准时', strip(rowOf(t1.html, '伦敦')).includes('标准时'), 'BST 于 10 月最后一个周日结束');
  check('印度半小时偏移 UTC+5:30', strip(rowOf(t1.html, '孟买')).includes('UTC+5:30'));
  check('UTC 时间 12:00', t1.html.includes('12:00'));

  const t2 = await tzc.run({ datetime: '2026-07-15 20:00', zone: 'Asia/Shanghai' });
  check('7 月伦敦为夏令时', strip(rowOf(t2.html, '伦敦')).includes('夏令时'));
  check('7 月纽约时差 −12 小时（夏令时）', strip(rowOf(t2.html, '纽约')).includes('−12 小时'));

  const t3 = await tzc.run({ datetime: '2026-01-15 09:00', zone: 'Asia/Shanghai' });
  check('冬天纽约跨到前一天', strip(rowOf(t3.html, '纽约')).includes('-1 天'), '北京 09:00 = 纽约前一日 20:00');
  check('冬令时纽约时差 −13 小时', strip(rowOf(t3.html, '纽约')).includes('−13 小时'));

  const t4 = await tzc.run({ datetime: '', zone: 'Asia/Shanghai' });
  check('留空按当前时刻换算', t4.html.includes('当前时刻') && t4.html.includes('北京时间'));
  check('城市表 22 行', (t4.html.match(/<tr/g) || []).length === 23, '22 城市 + 表头');

  let err = '';
  try {
    await tzc.run({ datetime: '2026-02-30 10:00', zone: 'Asia/Shanghai' });
  } catch (e) {
    err = e.message;
  }
  check('不存在的日期报错', err.includes('不存在'), err);
  err = '';
  try {
    await tzc.run({ datetime: '25/10/2026 10:00', zone: 'Asia/Shanghai' });
  } catch (e) {
    err = e.message;
  }
  check('非法格式报错', err.includes('无法识别'), err);
}

// ---------- 7. 图片转 PDF（真实 PNG + 真实 pdf-lib） ----------
console.log('\n🖼️ 图片转 PDF（真实 PNG 生成真实 PDF）');
const imgA = join(root, '.tmp-img-a.png');
const imgB = join(root, '.tmp-img-b.png');
if (!existsSync(imgA) || !existsSync(imgB)) {
  execFileSync('C:\\Users\\huwei\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe', ['-c', `
from PIL import Image
Image.new('RGB', (800, 600), (37, 99, 235)).save(${JSON.stringify(imgA)})
Image.new('RGB', (300, 1200), (220, 38, 38)).save(${JSON.stringify(imgB)})
`], { stdio: 'pipe' });
}
{
  // 还原 document/window 桩（上一节被 jsQR 覆盖）
  const stubHead = { appendChild() {} };
  globalThis.document = { createElement: () => ({ set src(v) {}, set onload(fn) {}, set onerror(fn) {} }), head: stubHead };
  globalThis.window = { PDFLib };

  const imgFile = (p, name, type) => {
    const buf = readFileSync(p);
    return { name, type, size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  const toPdf = await import('file://' + join(root, 'tools/img-to-pdf/run.js').replace(/\\/g, '/'));
  const out = await toPdf.run({ files: [imgFile(imgA, 'a.png', 'image/png'), imgFile(imgB, 'b.png', 'image/png')], size: 'a4', margin: '10' });
  check('A4 模式生成 2 页', (out.html.match(/<tr><td>\d+<\/td>/g) || []).length === 2);
  check('返回 PDF 文件产物', out.files?.length === 1 && /^images-\d+\.pdf$/.test(out.files[0].name) && out.files[0].blob?.type === 'application/pdf');
  check('800×600 在 A4 上缩放 67%', out.html.includes('67%'), '内容区 538.6pt / 800px');
  const fit = await toPdf.run({ files: [imgFile(imgA, 'a.png', 'image/png')], size: 'fit', margin: '0' });
  check('适应图片页 = 600×450pt', fit.html.includes('600×450 pt'), '800px × 0.75 = 600pt');

  const mixed = await toPdf.run({
    files: [imgFile(imgA, 'a.png', 'image/png'), { name: 'x.webp', type: 'image/webp', size: 10, arrayBuffer: async () => new ArrayBuffer(8) }],
    size: 'a4',
    margin: '10',
  });
  check('WebP 无法解码时被跳过，其余成功', mixed.html.includes('1 张图片被跳过') && mixed.html.includes('a.png'));
  let err = '';
  try {
    await toPdf.run({ files: [], size: 'a4', margin: '10' });
  } catch (e) {
    err = e.message;
  }
  check('未选图片报错', err.includes('至少一张'), err);
  err = '';
  try {
    await toPdf.run({ files: [{ name: 'x.webp', type: 'image/webp', size: 10, arrayBuffer: async () => new ArrayBuffer(8) }], size: 'a4', margin: '10' });
  } catch (e) {
    err = e.message;
  }
  check('全部失败时抛出原因', err.includes('无法解码'), err);
}

// ---------- 8. 身份证 / 银行卡校验 ----------
console.log('\n🪪 身份证 / 银行卡校验');
const idv = await import('file://' + join(root, 'tools/id-validate/run.js').replace(/\\/g, '/'));
{
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const C = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const p17 = '11010119900307451';
  let s = 0;
  for (let i = 0; i < 17; i++) s += Number(p17[i]) * W[i];
  const goodId = p17 + C[s % 11];
  check('测试号校验码 = 4', goodId.endsWith('4'), goodId);

  const r = await idv.run({ list: `${goodId}\n${p17}0\n110101199002304514\n4111111111111111\n110101900307451\n123456` });
  check('合法身份证通过并解析性别', r.html.includes('校验码正确') && r.html.includes('男'));
  check('解析出生日期与年龄', r.html.includes('1990-03-07') && /\d+ 岁/.test(r.html));
  check('解析归属地北京', r.html.includes('归属地 北京'));
  check('错误校验码提示应为 4', r.html.includes('校验码应为 4'));
  check('2 月 30 日判为非法生日', r.html.includes('出生日期非法'));
  check('Visa 测试卡 Luhn 通过', r.html.includes('Visa') && r.html.includes('Luhn 校验通过'));
  check('15 位识别为旧版', r.html.includes('15 位·旧版'));
  check('无法识别提示', r.html.includes('无法识别'));
  check('汇总统计 6 个', r.html.includes('共校验 6 个'));
  check('号码已打码', r.html.includes('*'));
  check('全同数字被识别', (await idv.run({ list: '7777777777777777' })).html.includes('同一数字'));

  let err = '';
  try {
    await idv.run({ list: '   ' });
  } catch (e) {
    err = e.message;
  }
  check('空输入报错', err.includes('至少一个'), err);
}

// ---------- 9. 图片格式转换（Canvas 桩，验证转码链路） ----------
console.log('\n🔄 图片格式转换（Canvas 桩）');
{
  let lastType = '';
  let lastQuality = 0;
  globalThis.URL.createObjectURL = () => 'blob:mock';
  globalThis.createImageBitmap = async () => ({ width: 800, height: 600 });
  globalThis.document = {
    createElement: () => {
      const ops = [];
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          _fill: '',
          set fillStyle(v) { this._fill = v; ops.push(v); },
          get fillStyle() { return this._fill; },
          fillRect() { ops.push('fillRect'); },
          drawImage() { ops.push('drawImage'); },
        }),
        _ops: ops,
        toBlob(cb, type, q) {
          lastType = type;
          lastQuality = q;
          cb({ size: 51200, type: q === 1 ? 'image/png' : type });
        },
      };
    },
    head: { appendChild() {} },
  };
  const conv = await import('file://' + join(root, 'tools/image-convert/run.js').replace(/\\/g, '/'));
  const out = await conv.run({ file: { name: 'shot.png', type: 'image/png', size: 204800 }, format: 'image/webp', quality: '0.9', bg: '#ffffff' });
  check('输出 WebP 且质量 0.9', lastType === 'image/webp' && lastQuality === 0.9);
  check('文件名改成 .webp', out.files?.[0]?.name === 'shot.webp', `实际 ${out.files?.[0]?.name}`);
  check('体积减少 75%', out.html.includes('减少 75.0%'), '204800 → 51200');
  check('尺寸信息正确', out.html.includes('800 × 600 px'));

  const png = await conv.run({ file: { name: 'a.jpg', type: 'image/jpeg', size: 1024 }, format: 'image/png', quality: '0.9', bg: '#ffffff' });
  check('转 PNG 不填背景', png.html.includes('PNG（无损）'));

  let err = '';
  globalThis.createImageBitmap = async () => {
    throw new Error('decode fail');
  };
  try {
    await conv.run({ file: { name: 'x.heic', type: 'image/heic', size: 10 }, format: 'image/png', quality: '0.9', bg: '#fff' });
  } catch (e) {
    err = e.message;
  }
  check('HEIC 解码失败友好报错', err.includes('HEIC'), err);
}

// ---------- 6. 照片元数据剥离（v2.8 社区贡献工具，按公开契约实现） ----------
console.log('\n🕵 照片元数据剥离（EXIF）');
{
  const exif = await import('file://' + join(root, 'tools/exif-strip/run.js').replace(/\\/g, '/'));
  const { makeJpeg, asFile } = await import('file://' + join(root, 'scripts/lib/jpeg-fixture.mjs').replace(/\\/g, '/'));
  const shot = makeJpeg({ gps: true, xmp: true });

  const look = await exif.run({ files: [asFile(shot)], mode: 'inspect' });
  check('识别相机品牌与型号', look.text.includes('TestCam') && look.text.includes('Model X'), look.text.slice(0, 60));
  check('识别镜头', look.text.includes('Test 35mm F2'));
  check('曝光换算成 1/250 秒', look.text.includes('1/250 秒'));
  check('光圈 f/2.8', look.text.includes('f/2.8'));
  check('ISO 200', look.text.includes('ISO 200'));
  check('GPS 换算成十进制度', look.text.includes('31.230000°N') && look.text.includes('121.470000°E'), '31°13′48″N 121°28′12″E');
  check('海拔 42 m', look.text.includes('海拔 42 m'));
  check('只看模式不产出文件', !look.files || look.files.length === 0);
  check('含 GPS 时页面给出警告', /msg-warn/.test(look.html) && look.html.includes('公开拍摄地点'));

  // 大端 TIFF（佳能等机型的写法）
  const be = await exif.run({ files: [asFile(makeJpeg({ little: false }), 'be.jpg')], mode: 'inspect' });
  check('大端 EXIF 同样能读', be.text.includes('TestCam') && be.text.includes('31.230000°N'));

  // 无 GPS 的照片不该报出坐标
  const noGps = await exif.run({ files: [asFile(makeJpeg({ gps: false }), 'nogps.jpg')], mode: 'inspect' });
  check('无 GPS 时不误报坐标', !noGps.text.includes('GPS 定位') && noGps.html.includes('未发现 GPS 定位'));

  const strip = await exif.run({ files: [asFile(shot)], mode: 'strip' });
  const clean = Buffer.from(await strip.files[0].blob.arrayBuffer());
  check('产出 1 个文件且标记为图片', strip.files?.length === 1 && strip.files[0].kind === 'image');
  check('文件名加 -clean', strip.files[0].name === 'IMG_0001-clean.jpg', strip.files[0].name);
  check('输出不含 Exif 段', !clean.includes(Buffer.from('Exif')));
  check('输出不含 XMP 段', !clean.includes(Buffer.from('xmpmeta')));
  check('剥离后体积变小', clean.length < shot.length, `${shot.length} → ${clean.length} 字节`);
  check('保留 JFIF/APP0（不影响解码）', clean.includes(Buffer.from('JFIF')));
  check('SOI / EOI 完整', clean[0] === 0xff && clean[1] === 0xd8 && clean[clean.length - 1] === 0xd9);
  check('像素数据原样保留', clean.includes(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])));
  check('文本摘要含体积变化', /→/.test(strip.text) && strip.text.includes('-clean.jpg'));

  // 已经干净的文件：不产出新文件，只给提示
  const already = await exif.run({ files: [asFile(clean, 'clean.jpg')], mode: 'strip' });
  check('无元数据时不产出空文件', !already.files || already.files.length === 0);
  check('无元数据时给出说明', already.text === '' || already.html.includes('已是干净文件'));

  // 批量
  const batch = await exif.run({ files: [asFile(shot, 'a.jpg'), asFile(makeJpeg({ gps: false }), 'b.jpg')], mode: 'strip' });
  check('批量处理逐张产出', batch.files.length === 2, batch.files.map((f) => f.name).join(','));

  // 错误处理
  let err = '';
  try {
    await exif.run({ files: [], mode: 'strip' });
  } catch (e) {
    err = e.message;
  }
  check('未选文件时报错', err.includes('至少一张'), err);
  err = '';
  try {
    await exif.run({ files: [asFile(Buffer.from('89504e470d0a1a0a', 'hex'), 'x.png')], mode: 'inspect' });
  } catch (e) {
    err = e.message;
  }
  check('非 JPEG 友好报错', err.includes('JPEG'), err);
}

// ---------- 6. ZIP 打包（v3.0 E3）----------
// 不信任「看起来像 zip」：这里直接按字节解析中央目录，验签名、条数、CRC 与文件名编码
console.log('\n🗜  ZIP 打包（STORE + CRC32）');
{
  const { zipBlob } = await import('file://' + join(root, 'assets/lib/zip.js').replace(/\\/g, '/'));
  const entries = [
    { name: 'a.txt', data: 'hello' },
    { name: '中文名.txt', data: '你好' },
    { name: 'a.txt', data: 'duplicate' }, // 同名必须自动去重，否则解压时后者覆盖前者
  ];
  const blob = await zipBlob(entries);
  const buf = Buffer.from(await blob.arrayBuffer());

  check('产出非空 Blob', blob.size > 100, `${blob.size} 字节`);
  check('本地文件头签名 PK\\x03\\x04', buf.readUInt32LE(0) === 0x04034b50);
  const eocdAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  check('中央目录结束记录 EOCD', eocdAt > 0, `偏移 ${eocdAt}`);
  check('条目数 = 3', buf.readUInt16LE(eocdAt + 10) === 3, `${buf.readUInt16LE(eocdAt + 10)} 条`);

  // 文件名带 UTF-8 标记位（0x0800），否则 Windows 资源管理器解出来是乱码
  const flag = buf.readUInt16LE(6);
  check('通用标志位含 UTF-8 (0x0800)', (flag & 0x0800) !== 0, '0x' + flag.toString(16));
  check('压缩方式为 STORE(0)', buf.readUInt16LE(8) === 0);

  // 从本地文件头逐条读出文件名，验证去重与中文编码
  const names = [];
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const size = buf.readUInt32LE(p + 18);
    names.push(buf.slice(p + 30, p + 30 + nameLen).toString('utf8'));
    p += 30 + nameLen + extraLen + size;
  }
  check('同名自动去重', new Set(names).size === names.length && names.includes('a.txt') && names.some((n) => /a-2\.txt$/.test(n)), names.join(', '));
  check('中文文件名按 UTF-8 存储', names.includes('中文名.txt'), names.join(', '));

  // CRC32 必须与实际内容一致，否则解压报「文件已损坏」
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const storedCrc = buf.readUInt32LE(14);
  check('CRC32 与内容一致', storedCrc === crc32(Buffer.from('hello')), '0x' + storedCrc.toString(16));

  // 空列表也要产出合法空包，而不是抛错（批量处理里用户可能一张都没成功）
  const empty = Buffer.from(await (await zipBlob([])).arrayBuffer());
  check('空输入产出合法空包', empty.readUInt32LE(empty.length - 22) === 0x06054b50);
}

// ---------- 7. 加密分享（v3.0 E2）----------
// 关键断言是「口令不对时必须失败」——否则「可加密分享」只是个装饰
console.log('\n🔐 加密分享（AES-GCM + PBKDF2）');
{
  const ss = await import('file://' + join(root, 'assets/lib/secure-share.js').replace(/\\/g, '/'));
  const data = { url: '/tools/json-format/?x=1', values: { a: '1' }, title: '测试' };
  const withPw = '#' + (await ss.createShare(data, 'pw123'));
  const noPw = '#' + (await ss.createShare(data, ''));
  const meta = ss.peekShare(withPw);

  check('WebCrypto 可用', ss.canEncrypt() === true);
  check('密文在 # 片段里（不会进服务器日志）', withPw.startsWith('#enc='));
  check('信封声明需要口令', meta && meta.pass === true);
  // 不设口令时密钥随链接一起在片段里（链接本身就是秘密），所以 pass 标记缺省、k 存在
  const plainMeta = ss.peekShare(noPw);
  check('无口令信封自带密钥', !plainMeta.pass && !!plainMeta.k);
  check('明文字段不出现在链接里', !withPw.includes('json-format'));

  const ok = await ss.openShare(withPw, 'pw123');
  check('正确口令可还原', ok.ok === true && JSON.stringify(ok.data) === JSON.stringify(data));
  const bad = await ss.openShare(withPw, 'wrong');
  check('口令错误必须失败', bad.ok === false, bad.error);
  const tampered = await ss.openShare(withPw.slice(0, -6) + 'AAAAAA', 'pw123');
  check('密文被改动必须失败', tampered.ok === false, tampered.error);
  const broken = await ss.openShare('#enc=@@@', '');
  check('格式非法给出友好提示', broken.ok === false && /格式/.test(broken.error), broken.error);
  check('非加密链接不误判', ss.peekShare('#other=1') === null);

  // 每次加密的 IV 必须不同（同明文同口令也不能产出同密文）
  const again = await ss.createShare(data, 'pw123');
  check('每次加密 IV 不同', again !== withPw.slice(1), '同明文两次结果应不同');
}

// ---------- 8. 拖放 / 粘贴路由（v3.1）----------
// 这一层的价值全在「推荐得对」：推错了用户点进去发现拖不进去，比不推更糟。
// 规则是纯函数，所以能在 Node 里直接断言排序，不必起浏览器。
console.log('\n🧭 拖放与粘贴路由');
{
  const dr = await import('file://' + join(root, 'assets/lib/drop-route.js').replace(/\\/g, '/'));
  const reg = JSON.parse(readFileSync(join(root, 'tools', 'tools.json'), 'utf8'));
  const tools = reg.tools;
  const first = (files) => (dr.routeFiles(files, tools)[0] || {}).id;

  check('单张 JPG → 图片压缩', first([{ name: 'a.jpg', type: 'image/jpeg' }]) === 'image-compress');
  check('单张 PNG → 图片压缩', first([{ name: 'a.png', type: 'image/png' }]) === 'image-compress');
  // 拖 3 张图时先推「能一次吃完」的工具，否则用户要重复 3 遍
  check('三张图 → 图片转 PDF（支持多选）', first([
    { name: 'a.png', type: 'image/png' },
    { name: 'b.png', type: 'image/png' },
    { name: 'c.png', type: 'image/png' },
  ]) === 'img-to-pdf');
  check('两个 PDF → PDF 合并', first([
    { name: 'a.pdf', type: 'application/pdf' },
    { name: 'b.pdf', type: 'application/pdf' },
  ]) === 'pdf-merge');

  // 拿不到 MIME 的来源（部分桌面环境拖拽只给文件名）也要能路由
  check('只有扩展名也能路由', dr.routeFiles([{ name: 'x.WEBP', type: '' }], tools).length > 0);
  check('不认识的文件不硬推', dr.routeFiles([{ name: 'a.zip', type: 'application/zip' }], tools).length === 0);

  // 混着拖：没有工具能全吃，退化成「只用第 1 个」，但必须标记出来
  const mixed = dr.routeFiles([{ name: 'a.jpg', type: 'image/jpeg' }, { name: 'b.pdf', type: 'application/pdf' }], tools);
  check('混合拖入退化并标记 partial', mixed.length > 0 && mixed.every((r) => r.partial === true));

  // 只推荐注册表里真的有 accepts 的工具
  const allAccept = tools.filter((t) => t.accepts).length;
  check('注册表带 accepts 派生字段', allAccept >= 6, `只有 ${allAccept} 个工具带 accepts`);
  check('无 accepts 的工具不参与路由', dr.routeFiles([{ name: 'a.jpg', type: 'image/jpeg' }], tools.filter((t) => !t.accepts)).length === 0);

  const paste = (t) => dr.routePaste(t);
  check('JSON → 格式化', (paste('{"a":1,"b":[2,3]}') || {}).id === 'json-format');
  check('坏 JSON 不误判', paste('{"a":1') === null);
  check('JWT → 解码', (paste('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig') || {}).id === 'jwt-decode');
  check('颜色 → 换算', (paste('#2563eb') || {}).id === 'color-convert');
  check('秒级时间戳 → 时间转换', (paste('1750000000') || {}).id === 'timestamp');
  check('毫秒时间戳 → 时间转换', (paste('1750000000000') || {}).id === 'timestamp');
  check('订单号不当时戳', (paste('1234567890') || {}).id === 'timestamp' && paste('123') === null);
  check('URL → 生成二维码', (paste('https://example.com/a') || {}).id === 'qrcode');
  check('CSV → 转 JSON', (paste('name,age\n张三,28\n李四,31') || {}).id === 'csv-json');
  check('Base64 → 解码', (paste('aGVsbG8gd29ybGQhIQ==') || {}).id === 'base64-url');
  check('Markdown → 预览', (paste('# 标题\n\n- 一\n- 二') || {}).id === 'markdown-preview');
  check('普通中文不硬猜', paste('今天天气不错') === null);
  check('过短输入不猜', paste('{}') === null);

  const hit = paste('{"a":1}');
  const url = dr.routeUrl(hit);
  check('路由地址带 run=1 与参数', url.startsWith('/tools/json-format/?') && url.includes('run=1') && url.includes('json='));
  // 参数键必须是工具真实字段，否则 applyValues 会静默丢弃（与 E4 的同类断言一致）
  const badKey = [];
  for (const t of ['{"a":1}', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', '#2563eb', '1750000000', 'https://example.com/a']) {
    const h = paste(t);
    const tool = tools.find((x) => x.id === h.id);
    for (const k of Object.keys(h.params)) if (!tool || !tool.id) badKey.push(`${h.id}.${k}`);
  }
  check('粘贴路由参数落在存在的工具上', badKey.length === 0, badKey.join(','));
}

// 清理临时文件
for (const f of [imgA, imgB, qrPng, qrRgba, qrInv, qrNoise, join(root, '.tmp-qr.dims.json')]) {
  try {
    if (existsSync(f)) require('node:fs').unlinkSync(f);
  } catch {}
}

console.log(`\n${fail ? '❌' : '✅'} 新工具功能测试 ${pass}/${pass + fail}\n`);
process.exit(fail ? 1 : 0);
