/**
 * 上游 API 契约检查。
 *
 * 上游是免费公共 API，结构随时可能变。与其等每周同步任务默默拉回一堆空数据，
 * 不如每次跑之前先把契约验一遍——字段没了、分页行为变了、限额改了，立刻报错。
 *
 * 用法：npm run check
 */
import './lib/env.mjs';

const API = process.env.UPSTREAM_API ?? 'https://prompts.chat/api/prompts';
const UA = 'prompts-chat-zh/0.1 (contract check)';

const problems = [];
const notes = [];

function check(ok, label, detail = '') {
  const line = `${ok ? '  ✓' : '  ✗'} ${label}${detail ? `  ${detail}` : ''}`;
  process.stdout.write(`${line}\n`);
  if (!ok) problems.push(label);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  process.stdout.write(`契约检查：${API}\n\n`);

  process.stdout.write('分页与响应形状\n');
  const first = await get(`${API}?page=1`);
  check(Array.isArray(first.prompts), 'prompts 是数组');
  check(typeof first.total === 'number', 'total 是数字', `= ${first.total}`);
  check(typeof first.totalPages === 'number', 'totalPages 是数字', `= ${first.totalPages}`);
  check(typeof first.perPage === 'number', 'perPage 是数字', `= ${first.perPage}`);
  check(first.prompts.length > 0, '第一页非空');

  process.stdout.write('\nperPage 上限（站点按 100 翻页，上限变了会漏数据）\n');
  const big = await get(`${API}?perPage=500&page=1`);
  check(
    big.prompts.length <= 100,
    'perPage 被夹到不超过 100',
    `请求 500 实得 ${big.prompts.length}`,
  );
  const at100 = await get(`${API}?perPage=100&page=1`);
  check(at100.prompts.length === 100, 'perPage=100 能取满一页', `实得 ${at100.prompts.length}`);
  if (big.prompts.length !== at100.prompts.length) {
    notes.push(`perPage 上限可能已变化：500 → ${big.prompts.length}，100 → ${at100.prompts.length}`);
  }

  process.stdout.write('\n翻页不重不漏\n');
  const p1 = await get(`${API}?perPage=100&page=1`);
  const p2 = await get(`${API}?perPage=100&page=2`);
  const ids1 = new Set(p1.prompts.map((p) => p.id));
  const overlap = p2.prompts.filter((p) => ids1.has(p.id)).length;
  check(overlap === 0, '第 1、2 页无重复', `重复 ${overlap} 条`);

  // totalPages 是按「本次请求生效的 perPage」算的，不是固定按 100。
  // 不带 perPage 时上游默认 24，此时 totalPages 是 ceil(total/24)；
  // 同步脚本固定带 perPage=100，拿到的才是 ceil(total/100)。两者都要对。
  check(
    first.totalPages === Math.ceil(first.total / first.perPage),
    'totalPages 与 total÷perPage 自洽',
    `total=${first.total} ÷ perPage=${first.perPage} → ${Math.ceil(first.total / first.perPage)}，实际 ${first.totalPages}`,
  );
  check(
    at100.totalPages === Math.ceil(at100.total / 100),
    'perPage=100 时 totalPages 正确（同步脚本据此翻页）',
    `应为 ${Math.ceil(at100.total / 100)}，实际 ${at100.totalPages}`,
  );

  process.stdout.write('\n条目字段完整性（同步脚本依赖这些字段）\n');
  const required = ['id', 'slug', 'title', 'content', 'type'];
  for (const f of required) {
    const missing = first.prompts.filter((p) => p[f] === undefined || p[f] === null).length;
    check(missing === 0, `每条都有 ${f}`, missing ? `缺 ${missing} 条` : '');
  }
  const noContent = first.prompts.filter((p) => !String(p.content ?? '').trim()).length;
  check(noContent === 0, '每条 content 非空', noContent ? `空 ${noContent} 条` : '');

  process.stdout.write('\n排序参数\n');
  const oldest = await get(`${API}?perPage=5&sort=oldest&page=1`);
  check(Array.isArray(oldest.prompts), 'sort=oldest 可用');
  const dates = oldest.prompts.map((p) => p.createdAt).filter(Boolean);
  if (dates.length > 1) {
    const sorted = [...dates].sort();
    check(
      JSON.stringify(dates) === JSON.stringify(sorted),
      'sort=oldest 确实按时间升序',
      `${dates[0]} → ${dates[dates.length - 1]}`,
    );
  }

  if (notes.length) {
    process.stdout.write(`\n提示\n${notes.map((n) => `  · ${n}`).join('\n')}\n`);
  }

  process.stdout.write('\n');
  if (problems.length) {
    process.stdout.write(`契约检查未通过，${problems.length} 项异常：\n`);
    for (const p of problems) process.stdout.write(`  - ${p}\n`);
    process.stdout.write('\n上游结构可能已变更，请先检查再跑同步。\n');
    process.exit(1);
  }
  process.stdout.write('契约检查通过。\n');
}

main().catch((e) => {
  console.error(`契约检查失败：${e.message}`);
  console.error('上游可能已下线或地址有变。');
  process.exit(1);
});
