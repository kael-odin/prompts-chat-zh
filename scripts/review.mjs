/**
 * 生成中英对照的抽查报告，用来人工验收翻译质量。
 *
 * 除了并排展示原文与译文，还会做机器可判定的完整性检查：
 *   · 代码块是否逐字节一致
 *   · 占位符是否一个不少
 *   · markdown 围栏与标题数量是否守恒
 *
 * 用法：
 *   npm run review                    全部已翻译条目
 *   npm run review -- --limit=20      只看前 20 条
 *   npm run review -- --only=slug     只看指定条目
 *   npm run review -- --file=data/x.md
 */
import './lib/env.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { splitBlocks, findPlaceholders } from './lib/segments.mjs';
import { verify } from './lib/verify.mjs';

const args = { limit: 0, only: [], file: 'data/review.md', width: 1200, flagged: false };
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split('=');
  if (k === '--limit') args.limit = Number(v) || 0;
  else if (k === '--only') args.only.push(v);
  else if (k === '--file') args.file = v;
  else if (k === '--width') args.width = Number(v) || 1200;
  else if (k === '--flagged') args.flagged = true;
}

const cut = (s, n = args.width) =>
  s.length <= n ? s : `${s.slice(0, n)}\n…（此处省略 ${s.length - n} 字符）`;

const codes = (s) =>
  splitBlocks(s)
    .filter((b) => b.type === 'code')
    .map((b) => b.value);

const fences = (s) => (s.match(/^\s*(```|~~~)/gm) || []).length;
const headings = (s) => (s.match(/^\s*#{1,6}\s/gm) || []).length;

function checks(en, zh) {
  const rows = [];
  const cEn = codes(en);
  const cZh = codes(zh);
  const same =
    cEn.length === cZh.length && cEn.every((v, i) => v === cZh[i]);
  rows.push([
    '代码块逐字节一致',
    same,
    cEn.length === 0 ? '无代码块' : `${cEn.length} 块`,
  ]);

  const pEn = findPlaceholders(en);
  const pZh = findPlaceholders(zh);
  rows.push([
    '占位符全部保留',
    pEn.join('|') === pZh.join('|'),
    pEn.length === 0 ? '无占位符' : pEn.join(' '),
  ]);

  rows.push(['围栏数守恒', fences(en) === fences(zh), `${fences(en)} → ${fences(zh)}`]);
  rows.push(['标题数守恒', headings(en) === headings(zh), `${headings(en)} → ${headings(zh)}`]);

  const v = verify(en, zh);
  rows.push(['结构校验', v.ok, v.issues.join('；') || '通过']);
  return rows;
}

async function main() {
  const snap = JSON.parse(await readFile('data/upstream.json', 'utf8'));
  let cache;
  try {
    cache = JSON.parse(await readFile('data/zh.json', 'utf8'));
  } catch {
    process.stdout.write('还没有译文缓存，先跑 npm run translate。\n');
    return;
  }

  let items = snap.prompts.filter((p) => cache.entries[p.hash]);
  if (args.only.length) items = items.filter((p) => args.only.includes(p.slug));
  // --flagged：只看结构校验没过的条目
  if (args.flagged) items = items.filter((p) => cache.entries[p.hash].issues?.length);
  // 长文优先——最容易出问题的排前面
  items.sort((a, b) => b.content.length - a.content.length);
  if (args.limit) items = items.slice(0, args.limit);

  const lines = [
    '# 翻译抽查报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    `模型：${cache.model ?? '未知'}`,
    `条目：${items.length}`,
    '',
    '每条先列机器可判定的完整性检查，再并排给原文与译文（超长部分截断显示）。',
    '',
  ];

  let allOk = 0;

  for (const p of items) {
    const e = cache.entries[p.hash];
    const rows = checks(p.content, e.content);
    const ok = rows.every(([, pass]) => pass);
    if (ok) allOk += 1;

    lines.push('---', '', `## ${ok ? '✅' : '⚠️'} ${p.title}`, '');
    lines.push(`- slug：\`${p.slug}\``);
    lines.push(`- 类型：${p.type}｜原文 ${p.content.length} 字符 → 译文 ${e.content.length} 字符`);
    lines.push(`- 作者：${p.author ?? '—'}｜上游 id：\`${p.id}\``);
    if (e.issues?.length) lines.push(`- 翻译时告警：${e.issues.join('；')}`);
    lines.push('');
    lines.push('| 检查项 | 结果 | 说明 |');
    lines.push('| --- | --- | --- |');
    for (const [name, pass, note] of rows) {
      lines.push(`| ${name} | ${pass ? '✅' : '❌'} | ${note.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
    lines.push(`**标题原文**：${p.title}`);
    lines.push('');
    lines.push(`**标题译文**：${e.title}`);
    lines.push('');
    if (e.summary) {
      lines.push(`**摘要译文**：${e.summary}`);
      lines.push('');
    }
    lines.push('<details><summary>正文对照</summary>', '');
    lines.push('**原文**', '', '```text', cut(p.content), '```', '');
    lines.push('**译文**', '', '```text', cut(e.content), '```', '');
    lines.push('', '</details>', '');
  }

  lines.push('---', '', `## 汇总`, '', `机器检查全过的条目：${allOk}/${items.length}`, '');

  await writeFile(args.file, lines.join('\n'), 'utf8');
  process.stdout.write(
    `报告已写入 ${args.file}\n条目 ${items.length}，机器检查全过 ${allOk}/${items.length}\n`,
  );
}

main().catch((e) => {
  console.error('生成报告失败：', e);
  process.exit(1);
});
