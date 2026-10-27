/**
 * 解析一个「装了 qrcode + Pillow」的 Python 解释器（v3.9）
 *
 * 为什么要有这个文件：`new-tools-test.mjs` 和 `browser-test.mjs` 里曾经各写死了
 * 一条本机 Windows 绝对路径（`C:\Users\<user>\.workbuddy\binaries\...`）。
 * 本地永远绿，推上 GitHub Actions 的 ubuntu runner 立刻 ENOENT。
 *
 * 那种失败最浪费人：报错长得像「被测代码坏了」，实际只是环境不同。
 * 而且这个仓库的 CI 配置在 .github/workflows/ 里躺了很久，因为一直是本地仓库、
 * 没有远端，从来没真跑过——第一次推送就吃了这一记。
 *
 * 判据不能只「能启动」：必须 `import qrcode, PIL` 也成功。
 * 否则会选中一个能跑但缺包的 python，把问题从 ENOENT 变成 ImportError，等于没修。
 */
import { execFileSync } from 'node:child_process';

// 本机已知路径作为最后的兜底：这台开发机上没有全局 python3/python，
// 只有 WorkBuddy 自带的那一份。删掉它会让本地测试直接跳过，所以留着。
const KNOWN_LOCAL = 'C:\\Users\\huwei\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';

export function resolvePython() {
  const cands = [process.env.TOOLHUB_PYTHON, 'python3', 'python', KNOWN_LOCAL].filter(Boolean);
  for (const cmd of cands) {
    try {
      execFileSync(cmd, ['-c', 'import qrcode, PIL'], { stdio: 'ignore' });
      return cmd;
    } catch {
      /* 不行就试下一个候选 */
    }
  }
  return null;
}

export const PYTHON = resolvePython();

export const PYTHON_HINT =
  '需要 Python 3 + qrcode + Pillow 才能跑这组「与参考实现对拍」的测试。' +
  '安装：python -m pip install "qrcode[pil]"；' +
  '或把环境变量 TOOLHUB_PYTHON 指向解释器路径。';
