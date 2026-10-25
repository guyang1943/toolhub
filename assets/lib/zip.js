/**
 * 极简 ZIP 打包（STORE 模式，不压缩、不引第三方库）—— v3.0 E3
 *
 * 用途：
 *   1. 结果区多个文件「打包下载」，避免浏览器一次弹 N 个下载
 *   2. 批量处理页把结果打成一个包
 *   3. 提交页生成器把工具骨架打包
 *
 * 为什么 STORE 而不是 deflate：图片/PDF 本身已压缩，再压几乎没收益；
 * 而 STORE 不需要引入 pako 之类的库，几十行就能写完，也不用担心浏览器兼容。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

async function toBytes(d) {
  if (typeof d === 'string') return enc.encode(d);
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (d && typeof d.arrayBuffer === 'function') return new Uint8Array(await d.arrayBuffer());
  return enc.encode(String(d));
}

/**
 * @param {Array<{name: string, data: string|Uint8Array|ArrayBuffer|Blob}>} entries
 * @param {Date} [mtime] 固定时间戳可让同一个包内容变化时 hash 才变
 * @returns {Promise<Blob>}
 */
export async function zipBlob(entries, mtime = new Date()) {
  const dosTime = ((mtime.getHours() & 0x1f) << 11) | ((mtime.getMinutes() & 0x3f) << 5) | ((mtime.getSeconds() / 2) & 0x1f);
  const dosDate = (((mtime.getFullYear() - 1980) & 0x7f) << 9) | (((mtime.getMonth() + 1) & 0xf) << 5) | (mtime.getDate() & 0x1f);

  const chunks = [];
  const central = [];
  let offset = 0;
  const used = new Set();

  for (const e of entries) {
    // 同名文件自动加序号，避免解压时互相覆盖
    let name = e.name || 'file';
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let i = 2;
      while (used.has(`${base}-${i}${ext}`)) i++;
      name = `${base}-${i}${ext}`;
    }
    used.add(name);

    const nameBytes = enc.encode(name);
    const data = await toBytes(e.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // 本地文件头
    lv.setUint16(4, 20, true); // 版本 2.0
    lv.setUint16(6, 0x0800, true); // 文件名 UTF-8
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); // 中央目录项
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // 本地头偏移
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // 目录结束
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
