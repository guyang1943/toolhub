#!/usr/bin/env node
// 把链接巡检的探活结果回写到目录证据（v3.24）
//
// 起因：62 条外链的 evidence.link.at 全是同一天（2026-11-03）。那次是一次性批量写入，
// 不是探活了 62 次。之后每周的 links.yml 一直在探活，但探活成功从不回写——于是「证据」
// 永远停在同一个日期，过期闸门一到就集体变红。闸门退化成噪音，等于没有闸门。
//
// 这个脚本只做一件事：读 health-report.json 的成功名单，把对应条目的 evidence.link 的
// at / method / by 三个字段刷新。**其他字段一个都不动**——尤其不碰 evidence.boundary：
// 探活 200 只能证明站点活着，证明不了它不上传你的文件。边界仍由人核（method: manual）。
//
// 用法：
//   node scripts/sync-evidence.mjs                         # 读根目录 health-report.json，写回
//   node scripts/sync-evidence.mjs --report r.json         # 指定报告
//   node scripts/sync-evidence.mjs --dry-run               # 只报告会更新多少条，不落盘
//
// CI 里由 .github/workflows/links.yml 在探活成功后调用，随后自动开 PR。不直接推 main：
// 证据是状态变更，走 PR 才有人工复核的入口。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMainModule } from './lib/is-main.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const REPORT = opt('report', 'health-report.json');
const DRY = argv.includes('--dry-run');

/** 探活日期取报告生成日（YYYY-MM-DD）。CI 的 cron 是北京时间 09:17 = UTC 01:17，
 *  同一天，所以用 UTC 日期不会和本地日期错开。 */
const probeDate = (generatedAt) => {
  const d = String(generatedAt || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/**
 * 纯函数：把探活结果合并进 directory 数据，返回改动摘要。不写盘，方便单测。
 * @param {object} directory tools/directory.json 的解析结果
 * @param {object} report    health-report.json 的解析结果
 * @returns {{data:object, updated:string[], skipped:{id:string,why:string}[], at:string}}
 */
export function mergeEvidence(directory, report) {
  const at = probeDate(report?.generatedAt);
  if (!at) throw new Error('health-report.json 缺 generatedAt 或格式不是 YYYY-MM-DD');
  const okTools = (Array.isArray(report.ok) ? report.ok : []).filter((r) => r.kind === '工具');
  const byId = new Map(okTools.map((r) => [r.id, r]));

  const updated = [];
  const skipped = [];
  for (const t of directory.tools || []) {
    const hit = byId.get(t.id);
    if (!hit) {
      skipped.push({ id: t.id, why: '本次探活未成功（死链或反爬）' });
      continue;
    }
    // URL 变了说明报告是基于旧数据生成的，不能拿旧探活结果证明新 URL
    if (hit.url && hit.url !== t.url) {
      skipped.push({ id: t.id, why: '报告里的 URL 与当前数据不一致' });
      continue;
    }
    const ev = t.evidence && typeof t.evidence === 'object' ? t.evidence : (t.evidence = {});
    // 展开原对象再覆盖，保留 at/by/method 的原有键序，diff 只看值
    ev.link = { ...(ev.link || {}), at, by: 'ci-schedule', method: 'probe-ci' };
    updated.push(t.id);
  }
  return { data: directory, updated, skipped, at };
}

function main() {
  const reportPath = join(root, REPORT);
  if (!existsSync(reportPath)) {
    console.error(`❌ 找不到探活报告：${REPORT}（先跑 node scripts/health-check.mjs --json ${REPORT}）`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const dirPath = join(root, 'tools', 'directory.json');
  const directory = JSON.parse(readFileSync(dirPath, 'utf8'));

  const { data, updated, skipped, at } = mergeEvidence(directory, report);

  if (DRY) {
    console.log(`🔎 dry-run：将把 ${updated.length} 条 evidence.link.at 刷成 ${at}，跳过 ${skipped.length} 条`);
    return { updated, skipped, at, written: false };
  }

  // 保持仓库的 LF 与 2 空格缩进；末尾补一个换行，避免每次 diff 都像改了最后一行
  writeFileSync(dirPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✅ evidence 刷新：${updated.length} 条 → ${at}（probe-ci / ci-schedule），跳过 ${skipped.length} 条`);
  if (skipped.length) {
    // 只列前几条，避免日志刷屏；完整名单在 health-report.json 里
    for (const s of skipped.slice(0, 8)) console.log(`   · 跳过 ${s.id}：${s.why}`);
    if (skipped.length > 8) console.log(`   · …另有 ${skipped.length - 8} 条`);
  }
  return { updated, skipped, at, written: true };
}

if (isMainModule(import.meta.url)) main();
