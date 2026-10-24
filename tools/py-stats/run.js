// 工具：数值统计（Python 标准库 statistics，浏览器内执行）
import { runPython } from '/assets/pyodide-runtime.js';

export const manifest = {
  usage: '粘贴一组数字（可用逗号、空格或换行分隔），自动计算总数、均值、中位数、标准差、分位数、最大值与最小值。使用 Python 标准库 statistics，无需额外依赖。',
  tips: ['首次使用需要下载 Python 运行时（约 13MB，有进度条），之后整个会话内都即时返回', '支持逗号/空格/换行/制表符混排，可直接从 Excel 或日志里复制粘贴', '分位数用线性插值法（与 Excel QUARTILE.INC 一致）'],
  scenarios: [
    { scene: '拿到一批数据想快速看分布', how: '粘贴数字 → 计算', result: '均值/中位数/四分位一次看全' },
    { scene: '判断数据是否有异常值', how: '看最大值最小值与标准差', result: '离群点很快暴露出来' },
    { scene: '不想用 Excel 就为了算个平均数', how: '粘贴 → 复制结果', result: '无需打开表格软件' },
  ],
  inputs: [
    {
      name: 'data',
      label: '数字列表',
      type: 'textarea',
      placeholder: '12, 15, 18, 22, 25',
      default: '12, 15, 18, 22, 25, 31, 42, 8, 19, 27',
    },
  ],
  runLabel: '计算统计量',
};

export async function run({ data }) {
  const nums = String(data)
    .split(/[,，\s;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (nums.length < 2) throw new Error('请至少输入 2 个数字');
  const bad = nums.filter((s) => isNaN(Number(s)));
  if (bad.length) throw new Error(`这些不是合法数字：${bad.slice(0, 5).join(', ')}`);

  const code = `
import statistics as st, json
data = [float(x) for x in ${JSON.stringify(nums)}]
n = len(data)
q = st.quantiles(data, n=4) if n >= 4 else [min(data), st.median(data), max(data)]
res = {
  "n": n,
  "sum": sum(data),
  "mean": st.mean(data),
  "median": st.median(data),
  "stdev": st.stdev(data) if n > 1 else 0.0,
  "min": min(data),
  "max": max(data),
  "range": max(data) - min(data),
  "q1": q[0], "q2": st.median(data), "q3": q[2],
}
print(json.dumps(res, ensure_ascii=False))
`;
  const { out, err } = await runPython(code);
  if (err) throw new Error(String(err).split('\n').slice(-3).join(' '));
  const r = JSON.parse(out.trim().split('\n').pop());
  const f = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
  const rows = [
    ['样本数 (n)', r.n],
    ['总和', f(r.sum)],
    ['平均值', f(r.mean)],
    ['中位数', f(r.median)],
    ['标准差（样本）', f(r.stdev)],
    ['最小值 / 最大值', `${f(r.min)} / ${f(r.max)}`],
    ['极差', f(r.range)],
    ['四分位数 Q1 / Q2 / Q3', `${f(r.q1)} / ${f(r.q2)} / ${f(r.q3)}`],
  ];
  return {
    html: `<div class="msg-ok">✅ 已用 Python statistics 计算 ${r.n} 个数字</div>
      <table style="width:100%;font-size:13.5px;border-collapse:collapse;margin-top:10px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 4px;color:var(--muted);width:45%">${k}</td><td style="padding:7px 4px;font-family:var(--mono)">${v}</td></tr>`
          )
          .join('')}
      </table>`,
  };
}
