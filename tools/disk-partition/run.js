// ToolHub 本地工具：硬盘整数分区计算器
// 纯前端、零网络、数据不出本机。规范见 docs/TOOL-CONTRACT.md
//
// 目标：在 Windows 磁盘管理 / DiskPart / 分区工具里，容量是按 MB 填的，
// 但文件系统会占用一点空间存结构信息，直接填 1024×G 往往只显示 99.9 GB。
// 本工具反推「想让系统严格显示整数 G GB，应该填多少 MB」。
//
// NTFS：按柱面对齐。1 柱面 = 512B × 255 磁头 × 63 扇区 = 8225280 B = 7.84423828125 MB
//       柱面数 = ceil(1024×G ÷ C)，应填 MB = ceil(柱面数 × C)
// FAT32：经典经验公式 应填 MB = 1024×G + 4×(G−1)（每 GB 多 4MB 存元数据，首 GB 不计）
// 上述公式经联想官方知识库与多个在线整数分区计算器交叉核对。

const CYL = (512 * 255 * 63) / (1024 * 1024); // 7.84423828125 MB / 柱面
const FAT32_GUI_MAX = 32; // Windows 图形界面格式化 FAT32 的常用上限（GB）
const COMMON = [10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1024, 1500, 2000];

function ntfsMb(G) {
  const cylinders = Math.ceil((1024 * G) / CYL);
  return Math.ceil(cylinders * CYL);
}
function fat32Mb(G) {
  return 1024 * G + 4 * (G - 1);
}
function fmt(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const manifest = {
  inputs: [
    {
      name: 'targetGb',
      label: '想显示的整数容量（GB）',
      type: 'number',
      min: 1,
      max: 32768,
      default: 100,
    },
    {
      name: 'fsType',
      label: '文件系统格式',
      type: 'select',
      default: 'both',
      options: [
        { value: 'both', label: '两种都要（NTFS + FAT32）' },
        { value: 'ntfs', label: '只要 NTFS' },
        { value: 'fat32', label: '只要 FAT32' },
      ],
    },
    {
      name: 'batch',
      label: '批量容量（可选，逗号或空格分隔，如 120, 500, 1000）',
      type: 'text',
      placeholder: '留空即可，例如：120, 500, 1000',
      default: '',
    },
  ],
  runLabel: '计算应填 MB',
  usage: '填一个想让系统严格显示的整数 GB 容量（可再填多个批量容量），选好文件系统，即可算出在磁盘管理／分区工具里应输入的精确 MB 数值，并附常用容量对照表。',
  tips: [
    '分区工具里的「简单卷大小」单位是 MB，把结果里的纯数字直接粘进去，不要带逗号和单位。',
    '直接填 1024×G（如 100G 填 102400）通常只显示 99.9 GB：文件系统要留空间存元数据，所以必须多填一点。',
    'NTFS 按柱面对齐（1 柱面约 7.844 MB）向上取整；FAT32 用 1024×G+4×(G−1)，两者公式不同，别混用。',
    'FAT32 在 Windows 磁盘管理里一般只能格式化到 32GB 以内，更大的分区请用 NTFS 或 exFAT。',
    'GPT/MBR、4K 对齐、不同分区软件可能带来几 MB 偏差；格式化后显示差 1–2 MB 属正常。',
    '厂商标称 1TB 按 1000 进制，系统按 1024 进制显示约 931GB；本工具算的是「显示整数 GB」，与标称容量是两回事。',
  ],
  scenarios: [
    { scene: '新装硬盘想分出一个刚好显示 100GB 的 C 盘', how: '目标填 100，格式选「两种都要」', result: 'NTFS 应填 102407 MB、FAT32 应填 102796 MB，直接粘进磁盘管理' },
    { scene: '一次要规划 C/D/E 好几个整数分区', how: '批量容量填 120, 500, 1000', result: '对照表一次列出每个容量的两种 MB 值并高亮' },
    { scene: '不打字，只想查常见容量的对照值', how: '保持默认直接点「计算应填 MB」', result: '下方对照表给出 10–2000GB 共 21 档的 NTFS/FAT32 应填值' },
  ],
  example: { targetGb: 100, fsType: 'both', batch: '' },
};

export async function run({ targetGb, fsType, batch }) {
  const G0 = Number(targetGb);
  if (!Number.isInteger(G0) || G0 < 1 || G0 > 32768) {
    throw new Error('目标容量请填 1–32768 之间的整数 GB，例如 100');
  }

  // 批量容量：宽容解析，逗号 / 空格 / 顿号 / 分号 / 换行都可分隔，忽略非法项
  const extra = [];
  for (const tok of String(batch || '').split(/[\s,，、;；]+/)) {
    if (!tok) continue;
    const n = Number(tok);
    if (Number.isInteger(n) && n >= 1 && n <= 32768) extra.push(n);
  }
  const chosen = [G0, ...extra].filter((v, i, a) => a.indexOf(v) === i).slice(0, 30);
  const chosenSet = new Set(chosen);

  const showNtfs = fsType !== 'fat32';
  const showFat32 = fsType !== 'ntfs';

  // 结果卡：只突出所选格式
  const card = (title, mb, color, note) =>
    '<div style="flex:1;min-width:210px;background:#1c2028;border:1px solid #303845;border-radius:10px;padding:16px 18px;">' +
      '<div style="color:#9aa0a6;font-size:12px;margin-bottom:6px;">' + title + '</div>' +
      '<div style="font-size:30px;font-weight:700;color:' + color + ';line-height:1.1;letter-spacing:.5px;">' + fmt(mb) + '<span style="font-size:14px;font-weight:500;color:#9aa0a6;margin-left:6px;">MB</span></div>' +
      '<div style="color:#c9ccd1;font-size:12px;margin-top:8px;">分区工具里填：<b style="color:#fff;font-size:13px;">' + mb + '</b>（纯数字，别带逗号）</div>' +
      '<div style="color:#7f8792;font-size:11px;margin-top:6px;">' + note + '</div>' +
    '</div>';

  const cards =
    (showNtfs ? card('NTFS 应填', ntfsMb(G0), '#7fb3ff', '柱面对齐向上取整，比 1024×' + G0 + ' 多 ' + (ntfsMb(G0) - 1024 * G0) + ' MB') : '') +
    (showFat32 ? card('FAT32 应填', fat32Mb(G0), '#8fd694', '1024×G+4×(G−1)，比 1024×' + G0 + ' 多 ' + (fat32Mb(G0) - 1024 * G0) + ' MB') : '');

  // 对照表：常用档位 + 用户容量，升序去重，用户行高亮
  const rowsGb = [...new Set([...COMMON, ...chosen])].sort((a, b) => a - b);
  const rows = rowsGb.map((G) => {
    const n = ntfsMb(G), f = fat32Mb(G), base = 1024 * G;
    const hit = chosenSet.has(G);
    const style = hit ? ' style="background:#26374a;color:#fff;font-weight:600;"' : '';
    const mark = hit ? ' <span style="color:#7fb3ff;font-size:11px;">← 你选的</span>' : '';
    return '<tr' + style + '><td>' + G + ' GB' + mark + '</td><td>' + fmt(base) + '</td>' +
      (showNtfs ? '<td>' + fmt(n) + '</td>' : '') +
      (showFat32 ? '<td>' + fmt(f) + '</td>' : '') +
      '<td>+' + (n - base) + ' / +' + (f - base) + '</td></tr>';
  }).join('');

  const fatWarn = showFat32 && chosen.some((G) => G > FAT32_GUI_MAX)
    ? '<div class="msg-warn">⚠️ 你选的容量里有超过 ' + FAT32_GUI_MAX + 'GB 的分区：Windows 磁盘管理图形界面通常只能把 FAT32 格式化到 32GB 以内，更大的分区建议用 NTFS 或 exFAT（exFAT 一般直接填 1024×G MB）。表中 FAT32 数值为公式理论值，供 DiskPart / 第三方分区工具参考。</div>'
    : '';

  const head = '<thead><tr><th>目标整数容量</th><th>直接填 1024×G<br><span style="font-weight:400;color:#9aa0a6;font-size:11px;">（会显示 99.x GB）</span></th>' +
    (showNtfs ? '<th>NTFS 应填 MB</th>' : '') +
    (showFat32 ? '<th>FAT32 应填 MB</th>' : '') +
    '<th>补偿量<br><span style="font-weight:400;color:#9aa0a6;font-size:11px;">NTFS / FAT32</span></th></tr></thead>';

  const html =
    '<div style="font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8eaed;">' +
      '<div class="msg-ok">✅ 想让系统严格显示 <b>' + G0 + ' GB</b>，就按下面的 MB 数填进磁盘管理的「简单卷大小」。（纯计算，不改动你的磁盘）</div>' +
      fatWarn +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:14px 0 6px;">' + cards + '</div>' +
      '<div style="color:#9aa0a6;font-size:12px;margin:10px 0 16px;">' +
        '原理：文件系统会占用少量空间存结构信息，直接按 1GB=1024MB 填会少显示约 0.1GB。' +
        'NTFS 按柱面（7.84423828125 MB）对齐向上取整；FAT32 用 1024×G+4×(G−1)。' +
      '</div>' +
      '<div style="font-weight:600;margin-bottom:8px;">常用容量对照表' + (chosen.length > 1 ? '（已高亮你填的 ' + chosen.length + ' 个容量）' : '（已高亮你填的容量）') + '</div>' +
      '<div style="overflow-x:auto;"><table class="cmp-table">' + head + '<tbody>' + rows + '</tbody></table></div>' +
      '<div style="margin-top:12px;color:#9aa0a6;font-size:12px;">' +
        '提示：分区工具里填的是 <b>纯数字 MB</b>，不要带逗号或单位；填完格式化后若显示差 1–2 MB，属于对齐与分区表差异，属正常。' +
      '</div>' +
    '</div>';

  const line = (G) => {
    const n = ntfsMb(G), f = fat32Mb(G);
    return String(G).padStart(5) + ' GB  |  直填 ' + String(1024 * G).padStart(8) + '  |  NTFS ' + String(n).padStart(8) + ' MB  |  FAT32 ' + String(f).padStart(8) + ' MB';
  };
  const text =
    '硬盘整数分区计算器（显示在系统里的整数 GB → 分区工具应填的 MB）\n' +
    '目标：' + G0 + ' GB' + (chosen.length > 1 ? '（批量：' + chosen.join('、') + ' GB）' : '') + '\n' +
    (showNtfs ? 'NTFS  ：填 ' + ntfsMb(G0) + ' MB\n' : '') +
    (showFat32 ? 'FAT32 ：填 ' + fat32Mb(G0) + ' MB\n' : '') +
    '直接填 ' + 1024 * G0 + ' MB 通常只显示约 99.9 GB。\n' +
    '公式：NTFS 按柱面 7.84423828125MB 对齐向上取整；FAT32 = 1024×G + 4×(G−1)\n' +
    '--------------------------------------------------------\n' +
    '常用容量对照（GB | 直填1024×G | NTFS | FAT32）\n' +
    rowsGb.map(line).join('\n');

  const fileText =
    '硬盘整数分区计算器 · 应填 MB 对照表\n' +
    '目标整数容量：' + G0 + ' GB' + (chosen.length > 1 ? '；批量：' + chosen.join('、') + ' GB' : '') + '\n' +
    '文件系统：' + (fsType === 'both' ? 'NTFS + FAT32' : fsType.toUpperCase()) + '\n' +
    '--------------------------------------------------------\n' +
    (showNtfs ? 'NTFS 应填：' + ntfsMb(G0) + ' MB\n' : '') +
    (showFat32 ? 'FAT32 应填：' + fat32Mb(G0) + ' MB\n' : '') +
    '直接按 1024×G 填（' + 1024 * G0 + ' MB）通常只显示约 99.9 GB。\n' +
    '公式：NTFS 按柱面 7.84423828125MB 对齐向上取整；FAT32 = 1024×G + 4×(G−1)\n' +
    '--------------------------------------------------------\n' +
    '容量 GB | 直填 1024×G | NTFS 应填 MB | FAT32 应填 MB\n' +
    rowsGb.map((G) => G + ' | ' + 1024 * G + ' | ' + ntfsMb(G) + ' | ' + fat32Mb(G)).join('\n') + '\n' +
    '--------------------------------------------------------\n' +
    '注意：分区工具里填纯数字 MB；GPT/MBR、4K 对齐、不同工具可能带来几 MB 偏差。\n' +
    'FAT32 在 Windows 磁盘管理图形界面一般只能格式化到 32GB 以内。\n';
  const blob = new Blob([fileText], { type: 'text/plain;charset=utf-8' });

  return {
    html,
    text,
    files: [{ name: 'disk-partition-mb.txt', blob, kind: 'file' }],
  };
}
