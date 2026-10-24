// 工具：CSV 数据体检（pandas，浏览器内执行）
import { ensurePackage, runPython } from '/assets/pyodide-runtime.js';

export const manifest = {
  usage: '粘贴 CSV（首行为表头），自动做一次"数据体检"：行数列数、每列类型、缺失值、唯一值数量、数值列的统计摘要。使用 pandas 在浏览器内计算，数据不上传。首次使用需加载 pandas（约 20MB，等待时间较长）。',
  tips: [
    '首次运行要下载 pandas 运行时（约 20-40 秒），之后本次会话内变快',
    '中文乱码时确认 CSV 是 UTF-8 编码，可在 Excel 里"另存为 CSV UTF-8"',
    '数值列出现 object 类型，通常是混入了空格、货币符号或"无"等文字',
  ],
  scenarios: [
    { scene: '拿到合作方给的 CSV，先摸清数据情况', how: '粘贴 CSV → 体检', result: '行列数、缺失值、类型一次看清' },
    { scene: '怀疑数据里有大量空值', how: '看缺失值统计', result: '哪几列缺失严重立刻知道' },
    { scene: '要确认数值列能否直接计算', how: '看类型与统计摘要', result: '发现混入文字的脏列，避免算错' },
  ],
  inputs: [
    {
      name: 'csv',
      label: 'CSV 内容（首行为表头）',
      type: 'textarea',
      placeholder: 'name,age,city\n张三,28,南京\n李四,31,上海',
      default: 'name,age,city,score\n张三,28,南京,88\n李四,31,上海,92\n王五,,南京,79\n赵六,45,,85',
    },
  ],
  runLabel: '开始体检',
};

export async function run({ csv }) {
  if (!csv.trim()) throw new Error('请先粘贴 CSV 内容');
  const lines = csv.trim().split('\n');
  if (lines.length < 2) throw new Error('至少需要表头 + 1 行数据');

  await ensurePackage('pandas');
  const code = `
import io, json, pandas as pd
raw = ${JSON.stringify(csv)}
df = pd.read_csv(io.StringIO(raw))
info = {
  "rows": int(df.shape[0]),
  "cols": int(df.shape[1]),
  "columns": [],
}
for c in df.columns:
    s = df[c]
    info["columns"].append({
        "name": str(c),
        "dtype": str(s.dtype),
        "missing": int(s.isna().sum()),
        "unique": int(s.nunique(dropna=True)),
        "sample": str(s.dropna().iloc[0])[:40] if s.notna().any() else "",
    })
num = df.select_dtypes(include="number")
summary = []
if num.shape[1] > 0:
    d = num.describe().to_dict()
    for k, v in d.items():
        if k == "count":
            continue
        summary.append({"col": str(k), "mean": round(float(v["mean"]), 4), "min": round(float(v["min"]), 4),
                        "max": round(float(v["max"]), 4), "std": round(float(v["std"]), 4) if v["std"] == v["std"] else 0.0})
print(json.dumps({"info": info, "summary": summary}, ensure_ascii=False))
`;
  const { out, err } = await runPython(code);
  if (err) throw new Error(String(err).split('\n').slice(-3).join(' '));
  const r = JSON.parse(out.trim().split('\n').pop());
  const info = r.info;

  const colRows = info.columns
    .map(
      (c) => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 4px">${esc(c.name)}</td>
        <td style="padding:6px 4px;font-family:var(--mono);font-size:12px">${c.dtype}</td>
        <td style="padding:6px 4px;text-align:right;color:${c.missing ? '#c2570a' : 'var(--muted)'}">${c.missing}</td>
        <td style="padding:6px 4px;text-align:right">${c.unique}</td>
        <td style="padding:6px 4px;color:var(--muted);font-size:12px">${esc(c.sample)}</td>
      </tr>`
    )
    .join('');

  const sumRows = r.summary.length
    ? r.summary
        .map(
          (s) => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:6px 4px">${esc(s.col)}</td>
            <td style="padding:6px 4px;text-align:right;font-family:var(--mono)">${s.mean}</td>
            <td style="padding:6px 4px;text-align:right;font-family:var(--mono)">${s.min}</td>
            <td style="padding:6px 4px;text-align:right;font-family:var(--mono)">${s.max}</td>
            <td style="padding:6px 4px;text-align:right;font-family:var(--mono)">${s.std}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5" style="padding:8px;color:var(--muted)">没有数值列（全部被识别为文本）</td></tr>';

  const totalMissing = info.columns.reduce((a, c) => a + c.missing, 0);
  return {
    html: `
      <div class="msg-ok">✅ ${info.rows} 行 × ${info.cols} 列 · 缺失值合计 ${totalMissing} 个</div>
      <div style="margin-top:14px;font-size:13px;color:var(--muted)">列信息</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <tr style="border-bottom:2px solid var(--border);text-align:left">
          <th style="padding:6px 4px">列名</th><th style="padding:6px 4px">类型</th>
          <th style="padding:6px 4px;text-align:right">缺失</th><th style="padding:6px 4px;text-align:right">唯一值</th>
          <th style="padding:6px 4px">样例</th>
        </tr>${colRows}
      </table>
      <div style="margin-top:18px;font-size:13px;color:var(--muted)">数值列统计</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <tr style="border-bottom:2px solid var(--border);text-align:left">
          <th style="padding:6px 4px">列名</th><th style="padding:6px 4px;text-align:right">均值</th>
          <th style="padding:6px 4px;text-align:right">最小</th><th style="padding:6px 4px;text-align:right">最大</th>
          <th style="padding:6px 4px;text-align:right">标准差</th>
        </tr>${sumRows}
      </table>`,
  };
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
