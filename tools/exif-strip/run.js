// 工具：照片元数据（EXIF）查看与无损剥离
// 实现方式：直接按 JPEG 段结构读字节，不重编码、不解码像素——剥离后画质一像素都不变。
// 只裁掉携带个人信息的段（APP1 的 Exif / XMP、APP13 的 IPTC、COM 注释），
// 保留 APP0(JFIF)、APP2(ICC 色彩配置)、APP14(Adobe) —— 删掉它们会让照片偏色。
// 全程在浏览器内完成，文件不上传。

export const manifest = {
  usage:
    '选一张或多张手机拍摄的 JPG：先看里面藏了哪些信息（机型、拍摄时间、GPS 定位、后期软件），需要外发时点「剥离并下载」，元数据会被整段删掉，像素与画质完全不变。',
  inputs: [
    {
      name: 'files',
      label: '选择照片（JPG，可多选）',
      type: 'file',
      accept: 'image/jpeg,.jpg,.jpeg',
      multiple: true,
    },
    {
      name: 'mode',
      label: '处理方式',
      type: 'select',
      default: 'inspect',
      options: [
        { value: 'inspect', label: '只看元数据（不改动文件）' },
        { value: 'strip', label: '剥离元数据并下载（无损）' },
      ],
    },
  ],
  runLabel: '开始处理',
  tips: [
    '手机照片默认写入 GPS 坐标：外发原图等于把拍摄地点一起发出去',
    '剥离是「删除整段」，不解码重编码，所以画质与原图逐像素一致',
    'ICC 色彩配置会保留，苹果设备拍的 P3 色域照片剥离后不会偏色',
    '微信/微博中转过的图片通常已被平台清掉元数据，不必再处理',
  ],
  scenarios: [
    { scene: '把家里拍的照片发到二手平台', how: '选图 → 剥离并下载', result: 'GPS、机型、拍摄时间一并消失，画面不变' },
    { scene: '收到一张图想知道在哪拍的', how: '选图 → 只看元数据', result: '直接显示经纬度与拍摄设备，无需上传' },
    { scene: '批量交付照片给客户', how: '多选整个文件夹 → 剥离并下载', result: '一次处理全部，逐个下载干净的原图' },
  ],
};

/* ---------------- 二进制读取小工具 ---------------- */

const ascii = (dv, offset, len) => {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(offset + i));
  return s;
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// 只保留真正带个人信息的标签，避免把一整张表塞进页面
const TAG_LABEL = {
  0x010f: '相机品牌', // Make
  0x0110: '相机型号', // Model
  0x0112: '方向', // Orientation
  0x0131: '写入软件', // Software
  0x0132: '文件修改时间', // DateTime
  0x8769: 'EXIF 子目录',
  0x8825: 'GPS 子目录',
  0x9003: '拍摄时间', // DateTimeOriginal
  0x9004: '数字化时间', // DateTimeDigitized
  0x829a: '曝光时间', // ExposureTime
  0x829d: '光圈', // FNumber
  0x8827: 'ISO',
  0x920a: '焦距', // FocalLength
  0x9209: '闪光灯', // Flash
  0xa434: '镜头', // LensModel
  0xa002: '像素宽',
  0xa003: '像素高',
};

const GPS_TAG = {
  1: 'latRef',
  2: 'lat',
  3: 'lonRef',
  4: 'lon',
  5: 'altRef',
  6: 'alt',
  7: 'timeStamp',
  29: 'dateStamp',
};

/** 解析一个 IFD，返回 { tag: value } 与「下一个 IFD 偏移」 */
function readIfd(dv, tiffStart, ifdOffset, little) {
  const out = {};
  const base = tiffStart + ifdOffset;
  if (base + 2 > dv.byteLength) return out;
  const count = dv.getUint16(base, little);
  for (let i = 0; i < count; i++) {
    const e = base + 2 + i * 12;
    if (e + 12 > dv.byteLength) break;
    const tag = dv.getUint16(e, little);
    const type = dv.getUint16(e + 2, little);
    const n = dv.getUint32(e + 4, little);
    const size = (TYPE_SIZE[type] || 1) * n;
    const valOff = size <= 4 ? e + 8 : tiffStart + dv.getUint32(e + 8, little);
    if (valOff + size > dv.byteLength) continue;
    if (type === 2) {
      out[tag] = ascii(dv, valOff, n).replace(/\0+$/, '').trim();
    } else if (type === 3) {
      out[tag] = n === 1 ? dv.getUint16(valOff, little) : Array.from({ length: n }, (_, k) => dv.getUint16(valOff + k * 2, little));
    } else if (type === 4 || type === 9) {
      const get = type === 4 ? dv.getUint32.bind(dv) : dv.getInt32.bind(dv);
      out[tag] = n === 1 ? get(valOff, little) : Array.from({ length: n }, (_, k) => get(valOff + k * 4, little));
    } else if (type === 5 || type === 10) {
      const get = type === 5 ? dv.getUint32.bind(dv) : dv.getInt32.bind(dv);
      const arr = [];
      for (let k = 0; k < n; k++) {
        const num = get(valOff + k * 8, little);
        const den = get(valOff + k * 8 + 4, little);
        arr.push(den ? num / den : 0);
      }
      out[tag] = n === 1 ? arr[0] : arr;
    } else if (type === 1 || type === 7) {
      out[tag] = Array.from({ length: n }, (_, k) => dv.getUint8(valOff + k));
    }
  }
  return out;
}

/** 从一段 APP1 载荷里解析 EXIF：返回 { 摘要字段, gps, 原始标签数 } */
function parseExif(payload) {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  // payload 开头是 "Exif\0\0"，之后是 TIFF 头
  if (payload.byteLength < 14 || ascii(dv, 0, 4) !== 'Exif') return null;
  const tiffStart = 6;
  const mark = ascii(dv, tiffStart, 2);
  const little = mark === 'II';
  if (!little && mark !== 'MM') return null;
  if (dv.getUint16(tiffStart + 2, little) !== 42) return null;
  const ifd0Offset = dv.getUint32(tiffStart + 4, little);
  const ifd0 = readIfd(dv, tiffStart, ifd0Offset, little);

  let exif = {};
  if (typeof ifd0[0x8769] === 'number') exif = readIfd(dv, tiffStart, ifd0[0x8769], little);
  let gpsRaw = {};
  if (typeof ifd0[0x8825] === 'number') gpsRaw = readIfd(dv, tiffStart, ifd0[0x8825], little);

  const merged = { ...ifd0, ...exif };
  const fields = [];
  for (const [tagStr, label] of Object.entries(TAG_LABEL)) {
    const tag = Number(tagStr);
    const v = merged[tag];
    if (v === undefined || v === '' || Array.isArray(v)) continue;
    if (tag === 0x8769 || tag === 0x8825) continue;
    let text = String(v);
    if (tag === 0x829d) text = 'f/' + Number(v).toFixed(1);
    else if (tag === 0x829a) text = v >= 1 ? `${Number(v).toFixed(1)} 秒` : `1/${Math.round(1 / v)} 秒`;
    else if (tag === 0x920a) text = Number(v).toFixed(0) + ' mm';
    else if (tag === 0x8827) text = 'ISO ' + v;
    else if (tag === 0x9209) text = v & 1 ? '触发' : '未触发';
    else if (tag === 0x0112) text = `方向 ${v}`;
    fields.push({ label, value: text });
  }

  // GPS：三个有理数（度、分、秒）拼成十进制度
  const dms = (arr, ref) => {
    if (!Array.isArray(arr) || arr.length < 3) return null;
    const deg = arr[0] + arr[1] / 60 + arr[2] / 3600;
    const sign = ref === 'S' || ref === 'W' ? -1 : 1;
    return sign * deg;
  };
  const lat = dms(gpsRaw[2], gpsRaw[1]);
  const lon = dms(gpsRaw[4], gpsRaw[3]);
  const alt = Array.isArray(gpsRaw[6]) ? gpsRaw[6][0] : typeof gpsRaw[6] === 'number' ? gpsRaw[6] : null;
  const gps = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon, alt } : null;

  return { fields, gps, tagCount: Object.keys(merged).length };
}

/* ---------------- JPEG 段遍历 ---------------- */

const SEG_LABEL = {
  0xe0: 'APP0 JFIF',
  0xe1: 'APP1',
  0xe2: 'APP2 ICC 色彩',
  0xe3: 'APP3',
  0xe4: 'APP4',
  0xe5: 'APP5',
  0xe6: 'APP6',
  0xe7: 'APP7',
  0xe8: 'APP8',
  0xe9: 'APP9',
  0xea: 'APP10',
  0xeb: 'APP11',
  0xec: 'APP12',
  0xed: 'APP13 IPTC',
  0xee: 'APP14 Adobe',
  0xef: 'APP15',
  0xfe: 'COM 注释',
  0xdb: 'DQT 量化表',
  0xc4: 'DHT 霍夫曼表',
  0xc0: 'SOF0 帧头',
  0xc2: 'SOF2 帧头',
  0xdd: 'DRI',
  0xda: 'SOS 图像数据',
};

/** 走一遍 JPEG 段结构：返回段列表 + 是否有 Exif */
function walkJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('不是 JPEG 文件（缺少 FFD8 起始标记）');
  }
  const segments = [];
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      // 不是合法标记：从当前位置到末尾当作图像数据，避免越界
      segments.push({ marker: -1, start: i, end: bytes.length, label: '剩余数据' });
      break;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd9) {
      segments.push({ marker, start: i, end: i + 2, label: 'EOI 结束' });
      i += 2;
      break;
    }
    if (marker === 0xda) {
      // SOS 之后是熵编码数据，直接吃到文件末尾
      segments.push({ marker, start: i, end: bytes.length, label: 'SOS 图像数据' });
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start: i, end: i + 2, label: '独立标记' });
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    const end = Math.min(i + 2 + len, bytes.length);
    let label = SEG_LABEL[marker] || `段 0x${marker.toString(16)}`;
    // APP1 可能是 Exif 或 XMP，两者都带个人信息
    if (marker === 0xe1 && end - i > 10) {
      const head = String.fromCharCode(...bytes.subarray(i + 4, i + 10));
      if (head.startsWith('Exif')) label = 'APP1 Exif';
      else if (head.includes('http')) label = 'APP1 XMP';
    }
    segments.push({ marker, start: i, end, label });
    i = end;
  }
  return segments;
}

/** 判断某段是否属于「会泄露个人信息、且删掉不影响解码」的段 */
function isPrivate(seg, bytes) {
  if (seg.marker === 0xfe) return true; // COM 注释
  if (seg.marker === 0xe1) {
    const head = String.fromCharCode(...bytes.subarray(seg.start + 4, Math.min(seg.start + 10, seg.end)));
    return head.startsWith('Exif') || head.includes('http'); // Exif / XMP
  }
  if (seg.marker === 0xed) return true; // IPTC / Photoshop 资源块
  if (seg.marker === 0xeb) return true; // APP11 JUMBF / 厂商扩展
  if (seg.marker === 0xe5 || seg.marker === 0xe6) return false; // 部分厂商把预览图放这里，保留更稳
  return false;
}

function stripBytes(bytes) {
  const segs = walkJpeg(bytes);
  const removed = [];
  const kept = [];
  for (const s of segs) {
    if (s.marker === 0xd9) break;
    if (isPrivate(s, bytes)) removed.push(s);
    else kept.push(s);
  }
  if (!removed.length) return { out: bytes, removed, changed: false };
  const chunks = [bytes.subarray(0, 2)]; // SOI
  for (const s of kept) chunks.push(bytes.subarray(s.start, s.end));
  chunks.push(new Uint8Array([0xff, 0xd9])); // EOI
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return { out, removed, changed: true };
}

/* ---------------- 主流程 ---------------- */

const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function run({ files, mode }) {
  const list = (Array.isArray(files) ? files : files ? [files] : []).filter(Boolean);
  if (!list.length) throw new Error('请先选择至少一张 JPG 照片');

  const doStrip = mode === 'strip';
  const rows = [];
  const outputs = [];
  const textLines = [];

  for (const file of list) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const segs = walkJpeg(buf);
    const exifSeg = segs.find((s) => s.label === 'APP1 Exif');
    let exif = null;
    if (exifSeg) {
      // 去掉 2 字节长度 + 4 字节 "Exif" 标识后的 TIFF 数据
      const payload = buf.subarray(exifSeg.start + 4, exifSeg.end);
      exif = parseExif(payload);
    }
    const privateSegs = segs.filter((s) => isPrivate(s, buf));
    const privateBytes = privateSegs.reduce((n, s) => n + (s.end - s.start), 0);

    let note = '';
    if (doStrip) {
      if (!privateSegs.length) {
        note = '没有可剥离的元数据（已是干净文件）';
      } else {
        const { out, removed } = stripBytes(buf);
        const name = file.name.replace(/\.(jpe?g)$/i, '') + '-clean.jpg';
        outputs.push({ name, blob: new Blob([out], { type: 'image/jpeg' }), kind: 'image' });
        note = `已删除 ${removed.length} 段（${removed.map((s) => s.label).join('、')}），省 ${fmtSize(privateBytes)}`;
        textLines.push(`${name} · ${fmtSize(file.size)} → ${fmtSize(out.length)} · 移除 ${removed.length} 段`);
      }
    } else {
      note = privateSegs.length ? `含 ${privateSegs.length} 段可剥离元数据（${fmtSize(privateBytes)}）` : '未发现个人信息段';
    }

    const meta = [];
    if (exif) {
      for (const f of exif.fields) meta.push(`${f.label}：${f.value}`);
      if (exif.gps) {
        const { lat, lon, alt } = exif.gps;
        meta.push(
          `GPS 定位：${Math.abs(lat).toFixed(6)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(6)}°${lon >= 0 ? 'E' : 'W'}${
            alt != null ? ` · 海拔 ${Math.round(alt)} m` : ''
          }`
        );
      }
    }
    rows.push({ name: file.name, size: file.size, exif, meta, note, privateCount: privateSegs.length, privateBytes });
    if (!doStrip) textLines.push(`${file.name} · ${meta.length ? meta.join('；') : '无 EXIF 信息'}`);
  }

  const gpsCount = rows.filter((r) => r.exif && r.exif.gps).length;
  const header = doStrip
    ? `<div class="msg-ok">✅ 处理完成：${outputs.length} 个文件已剥离元数据${gpsCount ? `，其中 ${gpsCount} 张原图含 GPS 定位` : ''}</div>`
    : `<div class="msg-ok">🔍 已读取 ${rows.length} 张照片${gpsCount ? `，<b>${gpsCount} 张含 GPS 定位</b>` : '，未发现 GPS 定位'}</div>`;

  const table = `<table class="cmp-table" style="width:100%;margin-top:12px">
    <tr><th>文件</th><th>体积</th><th>元数据</th><th>${doStrip ? '处理结果' : '风险'}</th></tr>
    ${rows
      .map(
        (r) => `<tr>
        <td style="word-break:break-all">${esc(r.name)}</td>
        <td style="white-space:nowrap">${fmtSize(r.size)}</td>
        <td>${r.meta.length ? r.meta.map(esc).join('<br>') : '<span style="opacity:.6">无 EXIF</span>'}</td>
        <td>${esc(r.note)}</td>
      </tr>`
      )
      .join('')}
  </table>`;

  const warning =
    !doStrip && gpsCount
      ? `<p class="msg-warn" style="margin-top:10px">⚠ 含 GPS 的照片直接外发，等于公开拍摄地点。点上方「处理方式」改为「剥离元数据并下载」，画质不受影响。</p>`
      : '';

  return {
    html: header + table + warning,
    text: textLines.join('\n'),
    files: outputs,
  };
}
