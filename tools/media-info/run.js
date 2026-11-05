// 工具：音视频信息（纯浏览器执行）
//
// 元数据全部来自浏览器自己的解码器：给 video / audio 元素一个 object URL，
// 等 loadedmetadata 就能拿到时长与分辨率。不上传、不解析容器格式——
// 自己解 MP4 的 moov 与 WebM 的 EBML 只为拿六个数字，不值得。
//
// 代价是「浏览器解不开的格式就读不出信息」：MKV、AVI、部分 MOV 在 Chrome 里
// 既不报错也不加载，只在 error 事件里给一句 MEDIA_ERR。所以这里必须设超时，
// 否则用户会盯着一个永远转圈的界面。读到错就给人话，不要抛原始的 DOMException。

const TIMEOUT_MS = 8000;

function loadMeta(file) {
  return new Promise((resolve, reject) => {
    const isAudio = /^audio\//.test(file.type);
    const el = document.createElement(isAudio ? 'audio' : 'video');
    el.preload = 'metadata';
    el.muted = true;
    const url = URL.createObjectURL(file);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      el.removeAttribute('src');
      try {
        el.load();
      } catch {}
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('等了 8 秒还没读出时长：这个格式浏览器可能不支持（常见于 MKV / AVI / 部分 MOV），或者文件已损坏'));
    }, TIMEOUT_MS);

    el.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      if (done) return;
      const info = {
        duration: el.duration,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
        kind: isAudio ? '音频' : '视频',
      };
      cleanup();
      resolve(info);
    });
    el.addEventListener('error', () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('浏览器读不出这个文件：格式或编码不受支持（MKV / AVI / 部分 MOV 常见），也可能是文件损坏。可以先转成 MP4 / MP3 再看'));
    });
    el.src = url;
  });
}

const fmtDur = (s) => {
  if (!Number.isFinite(s)) return '未知';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}（${total} 秒）` : `${m}:${p(sec)}（${total} 秒）`;
};

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

export const manifest = {
  usage:
    '选一个视频或音频文件，本地读出时长、分辨率（视频）、体积与平均码率。用浏览器自带的解码器读元数据，文件不上传、不转码，因此也读不出编码格式这种要解析容器的字段。',
  tips: [
    '码率是「体积 ÷ 时长」算出来的平均码率，不是编码时的目标码率：可变码率（VBR）的峰值会比这个高不少',
    '发视频前看两个数就够了：时长是否超平台限制、体积是否超上传限制',
    'MKV / AVI / 部分 MOV 浏览器解不开，会直接给你一句人话而不是一直转圈',
    '分辨率是显示尺寸，竖屏视频的宽高可能被 EXIF 式的旋转标记换过，看到 1080×1920 不用奇怪',
  ],
  scenarios: [
    { scene: '发朋友圈前看视频会不会超限', how: '选文件看时长与体积', result: '超了就先用压缩工具，别等上传失败' },
    { scene: '录了段音频要转文字', how: '看时长估算转写成本', result: '按时长算钱的服务，先知道多少分钟再决定' },
    { scene: '下载的视频放不出来', how: '直接丢进来试读', result: '读不出元数据基本就是编码不受支持，换播放器或转码' },
  ],
  inputs: [{ name: 'file', label: '选择视频或音频', type: 'file', accept: 'video/*,audio/*' }],
  runLabel: '读取信息',
};

export async function run({ file }) {
  if (!file) throw new Error('请先选择一个视频或音频文件');
  const isMedia = /^(video|audio)\//.test(file.type || '');
  if (!isMedia) {
    throw new Error(`「${file.name || '这个文件'}」看起来不是音视频（${file.type || '无类型'}）：请选 MP4 / WebM / MP3 / WAV 这类文件`);
  }

  const info = await loadMeta(file);
  const size = file.size;
  const rows = [['文件名', file.name || '（未命名）'], ['类型', info.kind]];
  if (info.kind === '视频') {
    rows.push(['分辨率', info.width && info.height ? `${info.width} × ${info.height}` : '读不到（可能只有音轨）']);
    if (info.width && info.height) {
      const r = info.width / info.height;
      const known = [[16, 9], [9, 16], [4, 3], [3, 4], [1, 1], [21, 9]];
      const hit = known.find(([a, b]) => Math.abs(r - a / b) < 0.02);
      rows.push(['宽高比', hit ? `${hit[0]}:${hit[1]}` : r.toFixed(3)]);
    }
  }
  rows.push(['时长', fmtDur(info.duration)]);
  rows.push(['体积', `${fmtSize(size)}（${size.toLocaleString('en-US')} 字节）`]);
  if (Number.isFinite(info.duration) && info.duration > 0) {
    const kbps = (size * 8) / info.duration / 1000;
    rows.push(['平均码率', `${kbps.toFixed(0)} kbps（体积 ÷ 时长，不是编码目标码率）`]);
  } else {
    rows.push(['平均码率', '算不出（没读到时长）']);
  }

  const warn =
    Number.isFinite(info.duration) && info.duration > 600
      ? `<div class="msg-warn" style="margin-top:10px">⚠️ 时长超过 10 分钟：不少平台对单条视频有时长上限，上传前先确认。</div>`
      : '';

  return {
    html: `<div class="msg-ok">🎬 ${info.kind} · ${fmtDur(info.duration).split('（')[0]}${info.width ? ` · ${info.width}×${info.height}` : ''} · ${fmtSize(size)}</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 4px;color:var(--muted);width:32%">${k}</td><td style="padding:6px 4px;word-break:break-all">${v}</td></tr>`
          )
          .join('')}
      </table>
      ${warn}
      <p style="margin-top:10px;color:var(--muted);font-size:13px">文件不上传、不转码。信息来自浏览器的元数据解析，所以「编码格式（H.264 / AAC 之类）」这类要解容器的字段读不到——浏览器没把这件事暴露给页面。</p>`,
    text: rows.map(([k, v]) => `${k}：${v}`).join('\n'),
  };
}
