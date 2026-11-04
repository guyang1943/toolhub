// ToolHub 本地工具：磁盘整数分区规划
// 纯前端、零网络、数据不出本机。规范见 docs/TOOL-CONTRACT.md

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];
const MB = 1024;

export const manifest = {
  inputs: [
    {
      name: 'diskGb',
      label: '磁盘总容量（GB，可填小数）',
      type: 'number',
      min: 1,
      max: 100000,
      default: 1024,
    },
    {
      name: 'plan',
      label: '分区方案（每行：名称 大小，单位 G/M/T 可省，可小数）',
      type: 'textarea',
      placeholder: '系统C 120\n软件D 200\n数据E 400',
      default: '系统C 120\n软件D 200\n数据E 400',
    },
    {
      name: 'remainder',
      label: '未分配空间处理',
      type: 'select',
      default: 'leave',
      options: [
        { value: 'leave', label: '保留未分配' },
        { value: 'last', label: '并入最后一个分区' },
        { value: 'spread', label: '均摊到前面的分区' },
      ],
    },
  ],
  runLabel: '规划分区',
  usage: '输入磁盘总容量与每行「名称 大小」的分区清单（支持 G/M/T 单位与小数，精确到 MB），工具按 MB 精确计算，并把结果向上取整为整数 GB 显示，便于对齐与记忆。',
  tips: [
    '标称容量≠实际可用：1TB 硬盘在系统里通常只有约 931GB，规划时按实际值填写并留余量。',
    '填写支持小数与单位：120、120G、122880M、0.2T 都行，内部统一换算成 MB 精确计算。',
    '显示的整数 GB 是向上取整的（120.5G→121GB），旁附精确 MB；多分区时整数合计可能略超容量，会给出提示。',
    '未分配空间可后续扩展，不必一次分满整块磁盘。',
  ],
  scenarios: [
    { scene: '给新装机的 1TB 固态规划系统盘与数据盘', how: '总容量填 931，按行列出 C/D/E，大小可带 M 精度', result: '得到贴合实际的整数 GB 分区布局与未分配空间' },
    { scene: '用精确到 MB 的方案（如 122880M=120G）规划', how: '分区大小直接写 MB', result: '内部零误差计算，显示仍归整为整数 GB' },
    { scene: '确认分区不超容量', how: '填入磁盘容量与拟建分区', result: '超容量时直接提示超出多少 MB' },
  ],
  example: { diskGb: 931, plan: '系统C 120\n软件D 200\n数据E 400', remainder: 'leave' },
};

function fmt(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 把「数字[单位]」解析为整数 MB；单位缺省为 G。小数被四舍五入到 MB 精度。
function parseSize(token) {
  const m = String(token).trim().match(/^(\d+(?:\.\d+)?)\s*([gmt])?$/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  if (!isFinite(v) || v <= 0) return 0;
  const unit = (m[2] || 'g').toLowerCase();
  if (unit === 'm') return Math.round(v);
  if (unit === 't') return Math.round(v * MB * MB);
  return Math.round(v * MB); // g
}

function parsePlan(text) {
  const parts = [];
  let idx = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*([gmt])?$/i);
    if (!m) {
      throw new Error('每行格式应为「名称 大小[GB|M|T]」，大小可为小数，例如：系统C 120 或 系统C 122880M');
    }
    const name = m[1].trim() || ('分区' + (idx + 1));
    const mb = parseSize(m[2] + (m[3] || 'g'));
    if (mb <= 0) throw new Error('分区大小必须大于 0，例如：系统C 120 或 系统C 122880M');
    parts.push({ name, mb });
    idx++;
  }
  if (parts.length === 0) throw new Error('请至少填写一个分区，例如：系统C 120');
  return parts;
}

// 向上取整到整数 GB（显示用）：120.5G → 121GB
function gDisplay(mb) {
  return Math.ceil(mb / MB);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export async function run({ diskGb, plan, remainder }) {
  const diskMb = Math.round(Number(diskGb) * MB);
  if (!Number.isFinite(diskMb) || diskMb <= 0) {
    throw new Error('磁盘总容量必须是大于 0 的数字（GB），例如 1024 或 931.5');
  }

  const parts = parsePlan(plan);
  const requested = parts.reduce((s, p) => s + p.mb, 0);
  const alloc = parts.map((p) => p.mb);

  let unallocated = diskMb - requested;
  let overMsg = '';
  if (unallocated < 0) {
    overMsg = '分区总大小超出磁盘容量 ' + fmt(-unallocated) + ' MB（约 ' + gDisplay(-unallocated) + ' GB），请缩减分区或调小总容量。';
  } else if (remainder === 'last' && unallocated > 0) {
    alloc[alloc.length - 1] += unallocated;
    unallocated = 0;
  } else if (remainder === 'spread' && unallocated > 0) {
    let i = 0;
    while (unallocated > 0) {
      const add = Math.min(MB, unallocated);
      alloc[i % alloc.length] += add;
      unallocated -= add;
      i++;
    }
    unallocated = 0;
  }

  const total = alloc.reduce((s, v) => s + v, 0);
  const scale = Math.max(total, diskMb) || 1;

  const segHtml = parts.map((p, i) => {
    const w = (alloc[i] / scale) * 100;
    const c = PALETTE[i % PALETTE.length];
    return (
      '<div style="flex:0 0 auto;width:' + w.toFixed(3) + '%;min-width:2px;height:100%;' +
      'background:' + c + ';color:#fff;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;font-size:12px;line-height:1.25;' +
      'overflow:hidden;text-align:center;box-sizing:border-box;">' +
      '<span style="font-weight:600;padding:0 2px;">' + escapeHtml(p.name) + '</span>' +
      '<span>' + gDisplay(alloc[i]) + 'GB</span></div>'
    );
  }).join('');
  const unaHtml = unallocated > 0
    ? '<div style="flex:1 1 auto;height:100%;background:#3a3f4b;color:#aab;display:flex;' +
      'align-items:center;justify-content:center;font-size:12px;">未分配 ' + gDisplay(unallocated) + 'GB（' + fmt(unallocated) + ' MB）</div>'
    : '';

  const rows = parts.map((p, i) => {
    const pct = ((alloc[i] / diskMb) * 100).toFixed(1);
    return '<tr><td>' + escapeHtml(p.name) + '</td><td>' + gDisplay(alloc[i]) + ' GB</td><td>' + fmt(alloc[i]) + ' MB</td><td>' + pct + '%</td></tr>';
  }).join('');

  const displayTotalG = alloc.reduce((s, v) => s + gDisplay(v), 0);
  const diskDisplayG = gDisplay(diskMb);

  let warnHtml;
  if (overMsg) {
    warnHtml = '<div class="msg-warn">⚠️ ' + escapeHtml(overMsg) + '</div>';
  } else if (displayTotalG > diskDisplayG) {
    warnHtml = '<div class="msg-warn">⚠️ 各分区向上取整为整数 GB 后，显示合计 ' + displayTotalG + ' GB，已超过磁盘整数 ' + diskDisplayG + ' GB。实际按精确 MB 分配未超容量；如需严格不超，请缩减分区或改用「保留未分配」。</div>';
  } else if (unallocated > 0) {
    warnHtml = '<div class="msg-ok">✅ 规划可行，剩余未分配 ' + gDisplay(unallocated) + ' GB（精确 ' + fmt(unallocated) + ' MB，约占总容量 ' + ((unallocated / diskMb) * 100).toFixed(1) + '%）。</div>';
  } else {
    warnHtml = '<div class="msg-ok">✅ 分区恰好填满整块磁盘，无未分配空间。</div>';
  }

  const html =
    '<div style="font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8eaed;">' +
      warnHtml +
      '<div style="display:flex;height:56px;border-radius:8px;overflow:hidden;background:#222;margin:12px 0 4px;">' +
        segHtml + unaHtml +
      '</div>' +
      '<div style="color:#9aa0a6;font-size:12px;margin-bottom:12px;">条形按精确 MB 比例绘制；整数 GB 为向上取整显示值。</div>' +
      '<table class="cmp-table"><thead><tr><th>分区</th><th>整数GB</th><th>精确MB</th><th>占总量</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div style="margin-top:12px;color:#c9ccd1;">' +
        '总容量：<b>' + diskDisplayG + ' GB</b>（精确 ' + fmt(diskMb) + ' MB）　已分配：<b>' + displayTotalG + ' GB</b>　未分配：<b>' + gDisplay(unallocated) + ' GB</b>　分区数：<b>' + parts.length + '</b>' +
      '</div>' +
      '<div style="margin-top:10px;color:#9aa0a6;font-size:12px;">提示：显示的整数 GB 为向上取整（120.5G→121GB），精确 MB 见上；厂商标称容量（如 1TB）通常大于系统识别值（约 931GB），规划请以系统识别容量为准。</div>' +
    '</div>';

  const text =
    '磁盘分区方案（整数 GB 显示 / 精确 MB 计算）\n' +
    '总容量：' + diskDisplayG + ' GB（精确 ' + fmt(diskMb) + ' MB）\n' +
    '已分配：' + displayTotalG + ' GB　未分配：' + gDisplay(unallocated) + ' GB\n' +
    '分区数：' + parts.length + '\n' +
    parts.map((p, i) => (i + 1) + '. ' + p.name + ' ' + gDisplay(alloc[i]) + 'GB（精确 ' + fmt(alloc[i]) + ' MB, ' + ((alloc[i] / diskMb) * 100).toFixed(1) + '%)').join('\n');

  const fileText =
    '磁盘整数分区方案\n' +
    '总容量: ' + diskDisplayG + ' GB (精确 ' + fmt(diskMb) + ' MB)\n' +
    '已分配: ' + displayTotalG + ' GB\n' +
    '未分配: ' + gDisplay(unallocated) + ' GB (精确 ' + fmt(unallocated) + ' MB)\n' +
    '分区数: ' + parts.length + '\n' +
    '--------------------------------\n' +
    parts.map((p, i) => (i + 1) + '. ' + p.name + '  ' + gDisplay(alloc[i]) + ' GB (精确 ' + fmt(alloc[i]) + ' MB)').join('\n') + '\n';
  const blob = new Blob([fileText], { type: 'text/plain;charset=utf-8' });

  return {
    html,
    text,
    files: [{ name: 'disk-partition-plan.txt', blob, kind: 'file' }],
  };
}
