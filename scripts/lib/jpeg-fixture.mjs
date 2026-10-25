// 测试夹具：合成带 EXIF / GPS 的最小 JPEG（不依赖任何图片素材）
//
// 为什么不用真照片：真照片体积大又涉及隐私，而且 EXIF 变体（有/无 GPS、大小端）难以覆盖。
// 这里按 JPEG 段结构拼字节，像素数据是假的（本工具不解码像素，只看段），
// 但段结构、TIFF 目录、GPS 有理数都是真实格式，解析器必须按真实规则才能读出来。

/** 大端/小端都能写的最小 TIFF 构造器 */
function tiffWriter(little) {
  const u16 = (v) => {
    const b = Buffer.alloc(2);
    little ? b.writeUInt16LE(v) : b.writeUInt16BE(v);
    return b;
  };
  const u32 = (v) => {
    const b = Buffer.alloc(4);
    little ? b.writeUInt32LE(v) : b.writeUInt32BE(v);
    return b;
  };
  const rat = (num, den) => Buffer.concat([u32(num), u32(den)]);
  const ascii = (s) => Buffer.from(s + '\0', 'latin1');
  return { u16, u32, rat, ascii };
}

/**
 * 构造 TIFF 数据块（8 字节头 + IFD0 + Exif 子目录 + GPS 子目录 + 数据区）
 * @param {{little?:boolean, gps?:boolean, make?:string, model?:string}} opt
 */
function buildTiff({ little = true, gps = true, make = 'TestCam', model = 'Model X' } = {}) {
  const w = tiffWriter(little);
  const TYPE = { ascii: 2, short: 3, long: 4, rational: 5 };

  // 每个 IFD 先用「逻辑条目」描述，再统一分配偏移
  const ifd0 = [
    { tag: 0x010f, type: TYPE.ascii, val: w.ascii(make) },
    { tag: 0x0110, type: TYPE.ascii, val: w.ascii(model) },
    { tag: 0x0132, type: TYPE.ascii, val: w.ascii('2024:05:06 07:08:09') },
    { tag: 0x8769, type: TYPE.long, val: w.u32(0), isExifPtr: true },
  ];
  const exifIfd = [
    { tag: 0x9003, type: TYPE.ascii, val: w.ascii('2024:05:06 07:08:09') },
    { tag: 0x829d, type: TYPE.rational, val: w.rat(28, 10) }, // f/2.8
    { tag: 0x829a, type: TYPE.rational, val: w.rat(1, 250) }, // 1/250 s
    { tag: 0x8827, type: TYPE.short, val: w.u16(200) }, // ISO 200
    { tag: 0xa434, type: TYPE.ascii, val: w.ascii('Test 35mm F2') },
  ];
  const gpsIfd = gps
    ? [
        { tag: 0x0001, type: TYPE.ascii, val: w.ascii('N') },
        { tag: 0x0002, type: TYPE.rational, val: Buffer.concat([w.rat(31, 1), w.rat(13, 1), w.rat(48, 1)]) },
        { tag: 0x0003, type: TYPE.ascii, val: w.ascii('E') },
        { tag: 0x0004, type: TYPE.rational, val: Buffer.concat([w.rat(121, 1), w.rat(28, 1), w.rat(12, 1)]) },
        { tag: 0x0006, type: TYPE.rational, val: w.rat(42, 1) },
      ]
    : [];
  if (gps) ifd0.push({ tag: 0x8825, type: TYPE.long, val: w.u32(0), isGpsPtr: true });
  ifd0.sort((a, b) => a.tag - b.tag);

  const ifdSize = (entries) => 2 + entries.length * 12 + 4;
  const TYPE_SIZE = { 2: 1, 3: 2, 4: 4, 5: 8 };
  const entryCount = (e) => e.val.length / TYPE_SIZE[e.type];

  // 先算各 IFD 的起始偏移（头 8 字节 + 依次排列）
  const off0 = 8;
  const offExif = off0 + ifdSize(ifd0);
  const offGps = offExif + ifdSize(exifIfd);
  const dataStart = offGps + (gps ? ifdSize(gpsIfd) : 0);

  const dataChunks = [];
  let dataCursor = dataStart;
  /** 把条目值落到数据区（≤4 字节直接内联），返回该条目的 4 字节值域 */
  const place = (e) => {
    if (e.val.length <= 4) {
      const b = Buffer.alloc(4);
      e.val.copy(b);
      return b;
    }
    const ptr = w.u32(dataCursor);
    dataChunks.push(e.val);
    dataCursor += e.val.length;
    return ptr;
  };

  const writeIfd = (entries, selfOffset, nextOffset) => {
    const parts = [w.u16(entries.length)];
    for (const e of entries) {
      let ptr;
      if (e.isExifPtr) ptr = w.u32(offExif);
      else if (e.isGpsPtr) ptr = w.u32(offGps);
      else ptr = place(e);
      parts.push(w.u16(e.tag), w.u16(e.type), w.u32(entryCount(e)), ptr);
    }
    parts.push(w.u32(nextOffset));
    return Buffer.concat(parts);
  };

  const head = Buffer.concat([little ? Buffer.from('II') : Buffer.from('MM'), w.u16(42), w.u32(off0)]);
  const body = Buffer.concat([
    writeIfd(ifd0, off0, 0),
    writeIfd(exifIfd, offExif, 0),
    ...(gps ? [writeIfd(gpsIfd, offGps, 0)] : []),
  ]);
  return Buffer.concat([head, body, ...dataChunks]);
}

/** 拼一个 JPEG：SOI + APP0(JFIF) + APP1(Exif) + [APP1(XMP)] + COM + DQT + SOF0 + SOS + 数据 + EOI */
export function makeJpeg({ little = true, gps = true, xmp = false, comment = 'shot by test camera' } = {}) {
  const segment = (marker, payload) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
  };
  const tiff = buildTiff({ little, gps });
  const app1 = segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
  const jfif = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
  const xmpSeg = xmp
    ? segment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from('<x:xmpmeta>test</x:xmpmeta>')]))
    : Buffer.alloc(0);
  const com = segment(0xfe, Buffer.from(comment, 'latin1'));
  const dqt = segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 8)]));
  const sof = segment(0xc0, Buffer.from([8, 0, 16, 0, 16, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]));
  const sos = segment(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]));
  const scan = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jfif,
    app1,
    xmpSeg,
    com,
    dqt,
    sof,
    sos,
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** 包成 run() 认得的「文件」对象 */
export function asFile(buf, name = 'IMG_0001.jpg') {
  return {
    name,
    size: buf.length,
    type: 'image/jpeg',
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}
