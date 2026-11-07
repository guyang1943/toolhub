// 目录工具的「启动副本」：把只有构建期 / 校验器才读的字段切掉。
//
// 为什么要有这个文件（v3.32）：目录条目里 `evidence`（这条边界凭什么成立）
// 和 `linkStatus`（探活结果）全是给构建期用的——它们被 scripts/build-pages.mjs
// 写进静态详情页、被 scripts/lib/evidence.mjs 统计、被 check-links 写回，
// 而浏览器侧一行都不读（assets/ 下搜不到 evidence）。
// 但它们一直跟着 tools/directory.json 躺在首屏的六个启动 JSON 里，
// 每次打开首页都要为「谁在什么时候核过这条」付 1 KB。
//
// 做法与 v3.24 拆资源正文、v3.30 拆别名一致：源文件不动，另出一份给浏览器看。
// 这里刻意不删源文件里的字段——证据数据的读写方散在 check-links / sync-evidence /
// build-pages / tool-meta 五处，动源结构等于同时改五个写入口，为了省 1 KB 不值当。
// 生成的是**下游副本**：源改了、忘了重建，verify 的「目录证据不在首屏」会直接红。
export const BOOT_DROP = ['evidence', 'linkStatus'];

/** 由 tools/directory.json 派生浏览器用的精简副本（保持条目顺序与其余字段原样）。 */
export function slimDirectory(dir) {
  return {
    version: dir.version,
    note: '本文件由 tools/directory.json 派生（去掉 ' + BOOT_DROP.join(' / ') + '），改数据请改源文件。',
    tools: dir.tools.map((t) => {
      const o = { ...t };
      for (const k of BOOT_DROP) delete o[k];
      return o;
    }),
  };
}

/** 判断一份目录数据里还剩不剩构建期字段（verify 与构建共用）。 */
export function buildOnlyFieldsLeft(dir) {
  const left = [];
  for (const t of dir.tools) for (const k of BOOT_DROP) if (k in t) left.push(`${t.id}.${k}`);
  return left;
}
