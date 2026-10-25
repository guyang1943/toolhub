#!/usr/bin/env node
// 新工具脚手架：一条命令生成可直接运行的工具目录
//
// 用法：
//   node scripts/new-tool.mjs my-tool --name "我的工具" --cat 文本
//   node scripts/new-tool.mjs my-tool --name "我的工具" --force   # 覆盖已存在目录
//
// 生成 tools/<id>/tool.json 与 tools/<id>/run.js（含最小可跑实现），
// 并在 tools/registry.json 的 order 里登记，随后自动跑一次清单校验。
// 剩下的长尾内容（articles.json / i18n*.json）会打印提醒——verify 会因为缺它们而失败，
// 这是有意的：工具能跑 ≠ 可以上线。
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const force = argv.includes('--force');

if (!id) {
  console.error(`用法：node scripts/new-tool.mjs <id> [--name 名称] [--cat 分类] [--force]

  id     小写字母/数字/连字符，2-32 位，会成为 /tools/<id>/ 路径
  --name 工具显示名（默认用 id）
  --cat  分类：文本 图片 文档 数据 开发 设计 音视频 效率 网络（默认 文本）`);
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) {
  console.error(`❌ id「${id}」不符合规范：小写字母开头，只含小写字母/数字/连字符，2-32 位`);
  process.exit(1);
}

const name = flag('name', id);
const category = flag('cat', '文本');
const dir = join(root, 'tools', id);
if (existsSync(dir) && !force) {
  console.error(`❌ tools/${id}/ 已存在。要重建请加 --force（会覆盖 tool.json 与 run.js）`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const meta = {
  id,
  name,
  desc: '一句话说清它解决什么问题（6-60 字，会出现在卡片与搜索结果）',
  category,
  source: '社区贡献 · 纯浏览器实现',
  license: 'MIT',
  runtime: 'browser',
  tags: [],
  since: 'v2.8',
  // 想署名就加 "author": "你的 GitHub 用户名"，页面会显示「社区贡献：xxx」
};
writeFileSync(join(dir, 'tool.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

writeFileSync(
  join(dir, 'run.js'),
  `// ${name}
// 约定：manifest 必须是对象字面量（构建期会静态解析它生成表单）；
// run() 返回 { html, text?, files? }；不得发起任何网络请求。

export const manifest = {
  usage: '用一句话说明这个工具怎么用，以及它和同类工具的区别。',
  inputs: [
    {
      name: 'text',
      label: '输入内容',
      type: 'textarea',
      placeholder: '把要处理的内容粘到这里…',
    },
  ],
  runLabel: '处理',
  tips: ['一条真正能帮上忙的提示，而不是复述功能'],
  scenarios: [{ scene: '什么情况下会用到它', how: '用户怎么操作', result: '得到什么结果' }],
};

export async function run({ text }) {
  if (!text) throw new Error('请先粘贴内容');

  // 这里是你的实现。结果区可以直接用站内的样式类：
  //   .msg-ok（成功提示） / .msg-warn（提醒） / .cmp-table（表格）
  const lines = text.split('\\n');

  return {
    html: \`<div class="msg-ok">✅ 共 \${lines.length} 行，\${text.length} 个字符</div>\`,
    text: String(lines.length),
    files: [],
  };
}
`,
  'utf8'
);

// 登记排序（没有登记的工具会被追加到列表末尾，但仍建议显式写进去）
const regPath = join(root, 'tools', 'registry.json');
const reg = JSON.parse(readFileSync(regPath, 'utf8'));
if (!reg.order.includes(id)) {
  reg.order.push(id);
  writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

// 派生注册表
spawnSync(process.execPath, [join(root, 'scripts', 'sync-tools.mjs')], { cwd: root, stdio: 'inherit' });
// 立刻校验一次
const lint = spawnSync(process.execPath, [join(root, 'scripts', 'lint-tools.mjs'), id], { cwd: root, stdio: 'inherit' });

console.log(`
✅ 已生成 tools/${id}/
   ├─ tool.json   身份与收录信息（desc / tags / license 记得改）
   └─ run.js      manifest + run() 骨架

下一步：
  1. 实现 run()：返回 { html, text?, files? }
  2. 补长尾内容（缺了 verify 会失败）：
       articles.json       → "${id}": { intro, steps[], faq[], pitfalls[] }
       i18n.json           → en.tools["${id}"]: { name, desc }
       i18n-detail.json    → en["${id}"]: { usage, tips[], scenarios[], labels{} }
  3. node scripts/gen-search-aliases.mjs     # 生成拼音/英文搜索别名
  4. node scripts/build-pages.mjs            # 生成 /tools/${id}/ 静态页
  5. node scripts/verify.mjs                 # 全量校验，全绿再提 PR

${lint.status === 0 ? '校验：清单已通过 ✅' : '校验：上面还有问题，改完再跑 node scripts/lint-tools.mjs ' + id}
`);
process.exit(lint.status === 0 ? 0 : 1);
