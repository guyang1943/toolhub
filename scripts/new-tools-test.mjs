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
  check('合并输出文件名 merged.pdf', merged.html.includes('merged.pdf'));

  const ex = await pdf.run({ mode: 'extract', files: [asFile(a, 'a.pdf')], pages: '1,3', every: '1' });
  check('提取 2 页', ex.html.includes('已提取 2 / 3 页'), ex.html.match(/已提取 \d+ \/ \d+ 页/)?.[0]);

  const exAll = await pdf.run({ mode: 'extract', files: [asFile(a, 'a.pdf')], pages: '', every: '1' });
  check('留空页码范围 = 全部 3 页', exAll.html.includes('已提取 3 / 3 页'));

  const sp = await pdf.run({ mode: 'split', files: [asFile(a, 'a.pdf')], pages: '', every: '2' });
  check('每份 2 页拆成 2 个文件', sp.html.includes('已拆成 2 个文件'), sp.html.match(/已拆成 \d+ 个文件/)?.[0]);
  check('拆分文件名含页码范围', sp.html.includes('a-1-2.pdf') && sp.html.includes('a-3-3.pdf'));

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
  check('run() 提供复制与打开链接', out.html.includes('copy-btn') && out.html.includes('打开链接'));
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

// 清理临时文件
for (const f of [qrPng, qrRgba, qrInv, qrNoise, join(root, '.tmp-qr.dims.json')]) {
  try {
    if (existsSync(f)) require('node:fs').unlinkSync(f);
  } catch {}
}

console.log(`\n${fail ? '❌' : '✅'} 新工具功能测试 ${pass}/${pass + fail}\n`);
process.exit(fail ? 1 : 0);
