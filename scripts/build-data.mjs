/**
 * 把上游快照与译文缓存合并成站点用的 data/site.json。
 *
 * 数据链：sync（英文快照） + translate（译文缓存） → build-data（合并） → Astro 构建
 * 某条还没翻完也不会挡住建站：translated 为 false，页面会回落到英文原文并标注。
 *
 * 用法：npm run data
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const UPSTREAM = 'data/upstream.json';
const CACHE = 'data/zh.json';
const OUT = 'data/site.json';

/** SKILL 类提示词开头是 YAML frontmatter，正文渲染时去掉，摘要单独展示。 */
function stripFrontmatter(s) {
  return String(s ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

async function main() {
  const snap = JSON.parse(await readFile(UPSTREAM, 'utf8'));

  let cache = { entries: {} };
  try {
    cache = JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {
    process.stdout.write('提示：还没有 data/zh.json，本次全部按未翻译处理。\n');
  }

  const prompts = snap.prompts.map((p) => {
    const e = cache.entries[p.hash];
    return {
      id: p.id,
      slug: p.slug,
      type: p.type,
      // 未翻译时中文标题回落英文，页面上会标出来
      title: e?.title || p.title,
      titleEn: p.title,
      summary: e?.summary || p.description || '',
      content: e ? stripFrontmatter(e.content) : '',
      contentEn: stripFrontmatter(p.content),
      translated: Boolean(e),
      issues: e?.issues ?? [],
      author: p.author,
      category: p.category,
      tags: p.tags,
      // 示例图只存链接、链回上游，不镜像——图片版权与 CC0 的文字不是一回事
      mediaUrl: p.mediaUrl,
      sourceUrl: `https://prompts.chat/prompts/${p.id}_${p.slug}`,
      updatedAt: p.updatedAt,
      voteCount: p.voteCount,
    };
  });

  // 分类、标签、类型聚合
  const catMap = new Map();
  const tagMap = new Map();
  const typeMap = new Map();
  for (const p of prompts) {
    typeMap.set(p.type, (typeMap.get(p.type) ?? 0) + 1);
    if (p.category?.slug) {
      const c = catMap.get(p.category.slug) ?? { slug: p.category.slug, name: p.category.name, count: 0 };
      c.count += 1;
      catMap.set(p.category.slug, c);
    }
    for (const t of p.tags ?? []) tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
  }

  const categories = [...catMap.values()].sort((a, b) => b.count - a.count);
  const tags = [...tagMap.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count);

  const translated = prompts.filter((p) => p.translated).length;
  const flagged = prompts.filter((p) => p.issues.length).length;

  const site = {
    generatedAt: new Date().toISOString(),
    upstreamSyncedAt: snap.syncedAt,
    source: 'https://prompts.chat',
    license: 'CC0 1.0',
    total: prompts.length,
    translated,
    flagged,
    categories,
    tags,
    types: [...typeMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    prompts,
  };

  await mkdir('data', { recursive: true });
  await writeFile(OUT, JSON.stringify(site), 'utf8');

  const mb = (Buffer.byteLength(JSON.stringify(site)) / 1024 / 1024).toFixed(1);
  process.stdout.write(
    `已写入 ${OUT}（${mb} MB）\n` +
      `  提示词 ${prompts.length}，已翻译 ${translated}（${((translated / prompts.length) * 100).toFixed(1)}%）\n` +
      `  结构告警 ${flagged}\n` +
      `  分类 ${categories.length}，标签 ${tags.length}\n`,
  );
}

main().catch((e) => {
  console.error('合并数据失败：', e);
  process.exit(1);
});
