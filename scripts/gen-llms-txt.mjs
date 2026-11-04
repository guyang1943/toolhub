#!/usr/bin/env node
// 生成根目录 llms.txt（v3.24 分发层）：让 AI 助手 / 搜索抓取能直接读到「有什么、干什么、
// 数据边界在哪」，不用解析整站 HTML。
//
// 为什么单独一个文件而不塞进 build-pages：
//   1. 构建链末尾还要再调一次（tools/tools.json 是 sync-tools 派生的，必须等派生完成）；
//   2. 有人只想刷新这一份时，`npm run gen:llms` 应当能单独跑，不必重建 150 个页面。
//
// 数据源只读三份：
//   tools/tools.json          本地工具（38 条）
//   tools/directory.json      目录外链（62 条，跳对方官网，适用对方隐私政策）
//   workflows/workflows.json  工作流（6 条）
// 一句话用途取工具已有的 desc（manifest 必填）——不新增任何文案工作量。缺 desc 由
// lintAll / verify 的「工具必填字段」先拦住，这里不重复造一套校验。
//
// 格式按 llmstxt.org：H1 + 一句 blockquote + 分节 H2 + `- [名](URL): 一句话`。
// 域名一律由调用方传 BASE，不在这里 hardcode——本地构建、预览域、正式域是三个值。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMainModule } from './lib/is-main.mjs';
import { PRIVACY_LABEL } from './lib/tool-meta.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 压成一行，去掉换行与多余空白——llms.txt 每条必须是一行，否则解析器会把后半句当成新条目 */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** 链接文字里不能有方括号，否则 Markdown 会把 `]` 当成链接结束 */
const linkText = (s) => oneLine(s).replace(/[[\]]/g, '');

/**
 * 纯渲染：给同样的数据就得到同样的文本（构建可重复）。
 * @param {{base:string, tools:Array, dirTools:Array, flows:Array}} data
 */
export function renderLlmsTxt({ base, tools = [], dirTools = [], flows = [] }) {
  const baseUrl = String(base || '').replace(/\/$/, '');
  const out = [];

  out.push('# ToolHub');
  out.push(
    '> 开源在线工具目录：能在浏览器里跑的都在本机处理，文件 0 字节上传服务器；第三方工具只做跳转，适用对方隐私政策。'
  );
  out.push('');

  out.push(`## 本地工具（${tools.length} 个，在本机运行，0 字节上传）`);
  for (const t of tools) {
    out.push(`- [${linkText(t.name || t.id)}](${baseUrl}/tools/${t.id}/): ${oneLine(t.usage || t.desc || '')}`);
  }
  out.push('');

  out.push(`## 第三方目录（${dirTools.length} 个，跳转对方官网，适用对方隐私政策）`);
  for (const t of dirTools) {
    const boundary = PRIVACY_LABEL[t.privacy] || t.privacy || '未核实';
    out.push(
      `- [${linkText(t.name || t.id)}](${baseUrl}/tools/${t.id}/): ${oneLine(t.desc || '')}（数据边界：${boundary}）`
    );
  }
  out.push('');

  out.push('## 工作流');
  for (const f of flows) {
    out.push(`- [${linkText(f.name || f.id)}](${baseUrl}/workflows/?flow=${encodeURIComponent(f.id)}): ${oneLine(f.goal || '')}`);
  }
  out.push('');

  return out.join('\n');
}

/**
 * 读数据、渲染、写根目录 llms.txt。
 * build-pages 会把已经读好的 tools / dirTools 传进来，避免二次解析；单独跑时自动读盘。
 */
export function genLlmsTxt({ root: r = root, base, tools, dirTools, flows } = {}) {
  const localTools = tools ?? JSON.parse(readFileSync(join(r, 'tools', 'tools.json'), 'utf8')).tools;
  const directory = dirTools ?? JSON.parse(readFileSync(join(r, 'tools', 'directory.json'), 'utf8')).tools;
  const flowList = flows ?? (JSON.parse(readFileSync(join(r, 'workflows', 'workflows.json'), 'utf8')).flows || []);

  const txt = renderLlmsTxt({ base, tools: localTools, dirTools: directory, flows: flowList });
  writeFileSync(join(r, 'llms.txt'), txt, 'utf8');
  return { txt, counts: { local: localTools.length, directory: directory.length, flows: flowList.length } };
}

if (isMainModule(import.meta.url)) {
  // 单独跑时的域名：优先命令行参数，其次环境变量；都没有才退回正式域。
  // 正式域只是 CLI 的兜底，不与构建链共用——构建链永远显式传 BASE。
  const base = process.argv[2] || process.env.BASE_URL || 'https://toolhub.bot.cd';
  const { counts } = genLlmsTxt({ base });
  console.log(
    `✅ llms.txt：本地 ${counts.local} 条 / 目录 ${counts.directory} 条 / 工作流 ${counts.flows} 条（BASE=${base}）`
  );
}
