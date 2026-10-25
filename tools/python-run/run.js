// 工具：Python 运行器（Pyodide WASM，代码在用户浏览器本地执行，不上传）
import { runPython } from '/assets/pyodide-runtime.js';

export const manifest = {
  usage: '在下方粘贴 Python 代码并点击运行。首次运行需从本站下载 Pyodide 运行时（约 13MB，有进度条，需等待十几秒），之后同一次会话内瞬时启动。print() 输出会显示在结果区。内置标准库 + numpy/micro 常用包可按需加载。',
  tips: ['首次运行需下载约 13MB 的 WASM 运行时（有进度条，之后本次会话内瞬时启动，断网也能用）', '沙箱内无网络、无文件系统——这是安全边界也是限制', '需要 numpy 等库时：await micropip.install("numpy") 后 import numpy'],
  scenarios: [
    { scene: '临时验证一段 Python 逻辑对不对', how: '粘贴代码 → 运行', result: '无需装 Python 环境，直接看输出' },
    { scene: '电脑不是自己的，不想装环境', how: '打开网页 → 粘贴代码', result: '浏览器内执行，不污染本机' },
    { scene: '教学演示 Python 基础语法', how: '边讲边改代码 → 运行', result: '即时看到 print 结果，适合课堂' },
  ],
  inputs: [
    {
      name: 'code',
      label: 'Python 代码',
      type: 'textarea',
      placeholder: 'print("hello from Pyodide!")',
      default: '# 本地执行的 Python，无网络、无文件系统访问\nimport sys\nprint("Python", sys.version.split()[0])\nprint("sum:", sum(range(101)))',
    },
  ],
  runLabel: '▶ 运行',
};

export async function run({ code }) {
  if (!code.trim()) throw new Error('请先输入 Python 代码');
  const { out, err } = await runPython(code);
  let html = '';
  if (out) html += `<pre class="ok">${escapeHTML(out)}</pre>`;
  if (err) html += `<pre class="err">${escapeHTML(String(err))}</pre>`;
  if (!out && !err) html = '<div class="msg-ok">✅ 执行完成（无输出）</div>';
  return { html, text: out || (err ? String(err) : '') };
}

function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
