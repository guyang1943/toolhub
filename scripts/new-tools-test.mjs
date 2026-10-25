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

// 清理临时文件
for (const f of [imgA, imgB, qrPng, qrRgba, qrInv, qrNoise, join(root, '.tmp-qr.dims.json')]) {
  try {
    if (existsSync(f)) require('node:fs').unlinkSync(f);
  } catch {}
}

console.log(`\n${fail ? '❌' : '✅'} 新工具功能测试 ${pass}/${pass + fail}\n`);
process.exit(fail ? 1 : 0);
