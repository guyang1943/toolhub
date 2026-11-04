// ToolHub 本地工具：磁盘整数分区规划
// 纯前端、零网络、数据不出本机。规范见 docs/TOOL-CONTRACT.md

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

export const manifest = {
  inputs: [
    {
      name: 'diskGb',
      label: '磁盘总容量（GB）',
      type: 'number',
      min: 1,
      max: 100000,
      default: 1024,
    },
    {
      name: 'plan',
      label: '分区方案（每行：名称 大小GB，整数）',
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
  usage: '输入磁盘总容量（GB）与每行「名称 大小GB」的分区清单，一键规划整数 GB 分区并可视化布局。',
  tips: [
    '标称容量≠实际可用：1TB 硬盘在系统里通常只有约 931GB，规划时按实际值填写并留余量。',
    '整数 GB 分区便于对齐与记忆；系统盘建议单独留出 100–200GB。',
    '未分配空间可后续扩展，不必一次分满整块磁盘。',
  ],
  scenarios: [
    { scene: '给新装机的 1TB 固态规划系统盘与数据盘', how: '总容量填 931，按行列出 C/D/E 的整数 GB', result: '得到贴合实际的整数分区布局与未分配空间' },
    { scene: '重装系统前确认分区不超容量', how: '填入磁盘容量与拟建分区', result: '超容量时直接提示超出多少 GB' },
    { scene: '把剩余空间均摊到前几个分区', how: '「未分配空间处理」选「均摊」', result: '每个分区各加 1GB 直到分完，布局更整齐' },
  ],
  example: { diskGb: 931, plan: '系统C 120\n软件D 200\n数据E 400', remainder: 'leave' },
};

function parsePlan(text) {
  const parts = [];
  let idx = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)\s+(\d+)\s*$/);
    if (!m) {
      throw new Error('每行格式应为「名称 大小GB」，且大小必须是正整数，例如：系统C 120');
    }
    const name = m[1].trim() || ('分区' + (idx + 1));
    const size = parseInt(m[2], 10);
    if (size <= 0) throw new Error('分区大小必须是大于 0 的整数 GB：' + line);
    parts.push({ name, size });
    idx++;
  }
  if (parts.length === 0) throw new Error('请至少填写一个分区，例如：系统C 120');
  return parts;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export async function run({ diskGb, plan, remainder }) {
  const D = Number(diskGb);
  if (!Number.isFinite(D) || D <= 0) throw new Error('磁盘总容量必须是大于 0 的数字（GB）');

  const parts = parsePlan(plan);
  const requested = parts.reduce((s, p) => s + p.size, 0);
  const alloc = parts.map((p) => p.size);

  let unallocated = D - requested;
  let overMsg = '';
  if (unallocated < 0) {
    overMsg = '分区总大小超出磁盘容量 ' + (-unallocated) + ' GB，请缩减分区或调小总容量。';
  } else if (remainder === 'last' && unallocated > 0) {
    alloc[alloc.length - 1] += unallocated;
    unallocated = 0;
  } else if (remainder === 'spread' && unallocated > 0) {
    let i = 0;
    while (unallocated > 0) {
      alloc[i % alloc.length] += 1;
      unallocated -= 1;
      i++;
    }
    unallocated = 0;
  }

  const total = alloc.reduce((s, v) => s + v, 0);
  const scale = Math.max(total, D) || 1;

  const segHtml = parts.map((p, i) => {
    const w = (alloc[i] / scale) * 100;
    const c = PALETTE[i % PALETTE.length];
    return (
      '<div style="flex:0 0 auto;width:' + w.toFixed(3) + '%;min-width:2px;height:100%;' +
      'background:' + c + ';color:#fff;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;font-size:12px;line-height:1.25;' +
      'overflow:hidden;text-align:center;box-sizing:border-box;">' +
      '<span style="font-weight:600;padding:0 2px;">' + escapeHtml(p.name) + '</span>' +
      '<span>' + alloc[i] + 'GB</span></div>'
    );
  }).join('');
  const unaHtml = unallocated > 0
    ? '<div style="flex:1 1 auto;height:100%;background:#3a3f4b;color:#aab;display:flex;' +
      'align-items:center;justify-content:center;font-size:12px;">未分配 ' + unallocated + 'GB</div>'
    : '';

  const rows = parts.map((p, i) => {
    const pct = ((alloc[i] / D) * 100).toFixed(1);
    return '<tr><td>' + escapeHtml(p.name) + '</td><td>' + alloc[i] + ' GB</td><td>' + pct + '%</td></tr>';
  }).join('');

  const warnHtml = overMsg
    ? '<div class="msg-warn">⚠️ ' + escapeHtml(overMsg) + '</div>'
    : (unallocated > 0
        ? '<div class="msg-ok">✅ 规划可行，剩余未分配 ' + unallocated + ' GB（约占总容量 ' + ((unallocated / D) * 100).toFixed(1) + '%）。</div>'
        : '<div class="msg-ok">✅ 分区恰好填满整块磁盘，无未分配空间。</div>');

  const html =
    '<div style="font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8eaed;">' +
      warnHtml +
      '<div style="display:flex;height:56px;border-radius:8px;overflow:hidden;background:#222;margin:12px 0 4px;">' +
        segHtml + unaHtml +
      '</div>' +
      '<div style="color:#9aa0a6;font-size:12px;margin-bottom:12px;">条形按容量比例绘制；颜色仅用于区分分区。</div>' +
      '<table class="cmp-table"><thead><tr><th>分区</th><th>大小</th><th>占总量</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div style="margin-top:12px;color:#c9ccd1;">' +
        '总容量：<b>' + D + ' GB</b>　已分配：<b>' + total + ' GB</b>　未分配：<b>' + unallocated + ' GB</b>　分区数：<b>' + parts.length + '</b>' +
      '</div>' +
      '<div style="margin-top:10px;color:#9aa0a6;font-size:12px;">提示：厂商标称容量（如 1TB）通常大于系统识别值（约 931GB），规划请以系统识别容量为准。</div>' +
    '</div>';

  const text =
    '磁盘分区方案（整数 GB）\n' +
    '总容量：' + D + ' GB\n' +
    '已分配：' + total + ' GB　未分配：' + unallocated + ' GB\n' +
    '分区数：' + parts.length + '\n' +
    parts.map((p, i) => (i + 1) + '. ' + p.name + ' ' + alloc[i] + 'GB (' + ((alloc[i] / D) * 100).toFixed(1) + '%)').join('\n');

  const fileText =
    '磁盘整数分区方案\n' +
    '总容量: ' + D + ' GB\n' +
    '已分配: ' + total + ' GB\n' +
    '未分配: ' + unallocated + ' GB\n' +
    '分区数: ' + parts.length + '\n' +
    '--------------------------------\n' +
    parts.map((p, i) => (i + 1) + '. ' + p.name + '  ' + alloc[i] + ' GB').join('\n') + '\n';
  const blob = new Blob([fileText], { type: 'text/plain;charset=utf-8' });

  return {
    html,
    text,
    files: [{ name: 'disk-partition-plan.txt', blob, kind: 'file' }],
  };
}
