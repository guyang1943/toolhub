// 「本模块是不是被当 CLI 直接跑的」——唯一正确的判断方式
//
// 不能直接比字符串：
//   import.meta.url === pathToFileURL(process.argv[1]).href
//
// 本机工作区是目录联接（C:\Users\...\WorkBuddy\... → D:\WorkBuddyProjects\...）：
// ESM 解析出的 import.meta.url 是**真实路径**（D:\…），而 argv[1] 是**联接路径**（C:\…），
// 两者永不相等。后果不是报错而是**静默失联**——脚本一行不跑、退出码 0，
// 在 CI 上却是好的（CI 没有联接）。这种「本地绿、线上也绿，但本地根本没执行」最难查。
//
// 所以统一走 realpath：路径被解析到同一个真实文件才算「是主模块」。
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 判断当前模块是否作为 CLI 入口运行 */
export function isMainModule(metaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    // 文件被删/权限异常时保守返回 false：宁可当被 import，也不要误跑一遍写文件
    return false;
  }
}
