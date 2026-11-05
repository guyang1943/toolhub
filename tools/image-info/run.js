// 工具：图片信息（只读，不改图）
//
// EXIF 自己解：只读前 256 KB 的 JPEG 段，够拿到 IFD0 与 ExifIFD 的常用标量。
// 不引第三方库是因为要用的就只有 5 个字段，加上一个「有没有 GPS」的布尔值。
//
// 隐私口径写死在这里：GPS 只输出「有 / 无」，绝不展开经纬度。看图的人想知道这张图
// 会不会泄露位置，给他一串坐标等于把泄露点摆到眼前；想知道具体位置的人另有专门工具。
//
// 这个工具不上传、不写文件、不生成 blob，全部是读。

const TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readAscii(view, offset, count) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function readValue(view, entry, tiffStart, little) {
  const type = view.getUint16(entry + 2, little);
  const count = view.getUint32(entry + 4, little);
  const size = (TYPES[type] || 0) * count;
  if (!size) return null;
  let valueOffset = entry + 8;
  if (size > 4) {
    const rel = view.getUint32(entry + 8, little);
    valueOffset = tiffStart + rel;
  }
  if (valueOffset + size > view.byteLength) return null;
  if (type === 2) return readAscii(view, valueOffset, count);
  if (type === 3) return view.getUint16(valueOffset, little);
  if (type === 4) return view.getUint32(valueOffset, little);
  if (type === 5) {
    const num = view.getUint32(valueOffset, little);
    const den = view.getUint32(valueOffset + 4, little);
    return den ? num / den : 0;
  }
  if (type === 9) return view.getInt32(valueOffset, little);
  if (type === 10) {
    const num = view.getInt32(valueOffset, little);
    const den = view.getInt32(valueOffset + 4, little);
    return den ? num / den : 0;
  }
  return null;
}

function readIfd(view, tiffStart, dirOffset, little) {
  const out = {};
  const base = tiffStart + dirOffset;
  if (base + 2 > view.byteLength) return out;
  const n = view.getUint16(base, little);
  for (let i = 0; i < n; i++) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const v = readValue(view, entry, tiffStart, little);
    if (v !== null && v !== '') out[tag] = v;
  }
  return out;
}

function parseExif(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return { ok: false, reason: '不是 JPEG' };
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) break;
    const marker = view.getUint8(p + 1);
    const len = view.getUint16(p + 2);
    if (marker === 0xe1) {
      const seg = p + 4;
      if (readAscii(view, seg, 4) !== 'Exif') return { ok: false, reason: 'APP1 里没有 Exif 头' };
      const tiffStart = seg + 6;
      const order = String.fromCharCode(view.getUint8(tiffStart), view.getUint8(tiffStart + 1));
      if (order !== 'II' && order !== 'MM') return { ok: false, reason: 'EXIF 字节序标记异常' };
      const little = order === 'II';
      const ifd0Offset = view.getUint32(tiffStart + 4, little);
      const ifd0 = readIfd(view, tiffStart, ifd0Offset, little);
      const exifIfdOffset = ifd0[0x8769];
      const exifIfd = exifIfdOffset ? readIfd(view, tiffStart, exifIfdOffset, little) : {};
      const gpsOffset = ifd0[0x8825];
      return {
        ok: true,
        make: ifd0[0x010f],
        model: ifd0[0x0110],
        orientation: ifd0[0x0112],
        software: ifd0[0x0131],
        dateTime: ifd0[0x0132] || exifIfd[0x9003],
        exposure: exifIfd[0x829a],
        fnumber: exifIfd[0x829d],
        iso: exifIfd[0x8827],
        focal: exifIfd[0x920a],
        lens: exifIfd[0xa434],
        gps: !!gpsOffset,
      };
    }
    p += 2 + len;
  }
  return { ok: false, reason: '这段里没有 Exif 段' };
}

function sniffFormat(bytes, mime) {
  const b = new Uint8Array(bytes);
  const hex = (n) => Array.from(b.slice(0, n)).map((x) => x.toString(16).padStart(2, '0')).join('');
  if (hex(3) === 'ffd8ff') return 'JPEG';
  if (hex(8) === '89504e470d0a1a0a') return 'PNG';
  if (hex(4) === '47494638') return 'GIF';
  if (hex(4) === '52494646' && b.length > 11) {
    const tag = String.fromCharCode(...Array.from(b.slice(8, 12)));
    if (tag === 'WEBP') return 'WebP';
    if (tag === 'AVIF' || tag === 'avis') return 'AVIF';
  }
  if (hex(2) === '424d') return 'BMP';
  if (b.length > 11) {
    const brand = String.fromCharCode(...Array.from(b.slice(4, 8)));
    if (brand === 'ftyp') {
      const sub = String.fromCharCode(...Array.from(b.slice(8, 12)));
      if (['heic', 'heix', 'hevc', 'mif1'].includes(sub)) return 'HEIC';
      if (sub.startsWith('avi')) return 'AVIF';
    }
  }
  return (mime || '').replace('image/', '').toUpperCase() || '未知';
}

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

export const manifest = {
  usage:
    '选一张图片，读出尺寸、格式、体积、宽高比与 EXIF 里的常用字段（机型、镜头、拍摄时间、光圈快门 ISO、朝向）。只看不改：不生成新图、不写文件。GPS 只显示「有 / 无」，不展开坐标。',
  tips: [
    'GPS 只告诉你「这张图带位置信息」，不会把经纬度列出来——需要看坐标另有专门工具，看信息时不该顺带泄露',
    '微信、公众号导出的图基本没有 EXIF：平台为了省体积与隐私会把元数据剥掉，读到「无」是正常的',
    '尺寸是解码后的像素尺寸，不是文件里写的尺寸；手机照片的 EXIF 朝向可能让显示方向与像素方向差 90°',
    'HEIC / RAW 这类浏览器解不开的格式会直接给提示，不会假装读到了尺寸',
  ],
  scenarios: [
    { scene: '收到的图要不要压缩', how: '看尺寸与体积', result: '像素大但体积小说明已经压过，再压只会更糊' },
    { scene: '发图前担心泄露拍摄地', how: '看「位置信息」这一行', result: '显示「有」就说明带 GPS，发之前该先剥掉' },
    { scene: '查照片是哪台设备拍的', how: '看机型与镜头字段', result: '原相机照片能看到厂商与型号，截图与平台图通常为空' },
  ],
  inputs: [{ name: 'file', label: '选择图片（只读，不改图）', type: 'file', accept: 'image/*' }],
  runLabel: '查看信息',
};

export async function run({ file }) {
  if (!file) throw new Error('请先选择一张图片');
  if (file.type && !/^image\//.test(file.type)) {
    throw new Error(`「${file.name || '这个文件'}」不是图片（${file.type}），请选择 PNG / JPEG / WebP 等图片文件`);
  }

  let bmp = null;
  let decodeError = '';
  try {
    bmp = await createImageBitmap(file);
  } catch {
    decodeError = '浏览器解不开这个格式（常见于 HEIC、RAW），尺寸与缩略图都读不到';
  }

  const head = await file.slice(0, 262144).arrayBuffer();
  const format = sniffFormat(head, file.type);
  let exif = { ok: false, reason: '' };
  if (format === 'JPEG') {
    try {
      exif = parseExif(head);
    } catch {
      exif = { ok: false, reason: 'EXIF 段结构异常，跳过' };
    }
  } else {
    exif = { ok: false, reason: `${format} 没有 JPEG 那样的 EXIF 段` };
  }

  const rows = [];
  const dims = bmp ? { w: bmp.width, h: bmp.height } : null;
  rows.push(['文件名', file.name || '（未命名）']);
  rows.push(['格式', format]);
  rows.push(['体积', `${fmtSize(file.size)}（${file.size.toLocaleString('en-US')} 字节）`]);
  if (bmp) {
    const ratio = (bmp.width / bmp.height).toFixed(3);
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(bmp.width, bmp.height) || 1;
    rows.push(['像素尺寸', `${bmp.width} × ${bmp.height}`]);
    rows.push(['宽高比', `${ratio}（${bmp.width / g}:${bmp.height / g}）`]);
    rows.push(['总像素', `${((bmp.width * bmp.height) / 1e6).toFixed(2)} 百万像素`]);
    if (typeof bmp.close === 'function') bmp.close();
  } else {
    rows.push(['像素尺寸', decodeError]);
  }
  rows.push(['修改时间', file.lastModified ? new Date(file.lastModified).toLocaleString('zh-CN') : '未知']);

  if (exif.ok) {
    const e = [];
    if (exif.make || exif.model) e.push(['机型', [exif.make, exif.model].filter(Boolean).join(' ')]);
    if (exif.lens) e.push(['镜头', exif.lens]);
    if (exif.dateTime) e.push(['拍摄时间', String(exif.dateTime).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')]);
    if (exif.exposure) e.push(['快门', `${exif.exposure >= 1 ? exif.exposure : `1/${Math.round(1 / exif.exposure)}`} 秒`]);
    if (exif.fnumber) e.push(['光圈', `f/${exif.fnumber}`]);
    if (exif.iso) e.push(['ISO', String(exif.iso)]);
    if (exif.focal) e.push(['焦距', `${Math.round(exif.focal)} mm`]);
    if (exif.orientation) e.push(['朝向标记', `Orientation ${exif.orientation}`]);
    if (exif.software) e.push(['处理软件', String(exif.software)]);
    e.push(['位置信息（GPS）', exif.gps ? '有（本工具不展开坐标）' : '无']);
    rows.push(...e);
  } else {
    rows.push(['EXIF', `未读到（${exif.reason || '文件里没有'}）`]);
    rows.push(['位置信息（GPS）', '无或无法判断（没有可读的 EXIF）']);
  }

  const gpsWarn = exif.ok && exif.gps
    ? `<div class="msg-warn" style="margin-top:10px">⚠️ 这张图带 GPS 位置信息。发到公开平台前建议先剥掉元数据，否则等于把拍摄地点一起发出去。</div>`
    : '';

  return {
    html: `<div class="msg-ok">🔍 ${format}${dims ? ` · ${dims.w}×${dims.h}` : ''} · ${fmtSize(file.size)}</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted);width:34%">${k}</td><td style="padding:6px 4px;word-break:break-all">${v}</td></tr>`
          )
          .join('')}
      </table>
      ${gpsWarn}
      <p style="margin-top:10px;color:var(--muted);font-size:13px">只读：不生成新图、不写文件、不上传。EXIF 只解析前 256 KB 的常用标量字段，GPS 坐标一律不显示。</p>`,
    text: rows.map(([k, v]) => `${k}：${v}`).join('\n'),
  };
}
