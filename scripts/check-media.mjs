/**
 * 图片链路健康检查。
 *
 * 图片全部走 weserv.nl 代理 + 各家源站，任何一环出问题，页面上的图都会退化成链接。
 * 这个脚本定期探一遍，把两类性质完全不同的故障分开报：
 *
 *   · 代理故障  —— weserv 网络不通或返回 5xx。**所有图都会废**，必须立刻处理。
 *   · 源站失效  —— weserv 正常但返回 4xx，说明那张图本身被删了。
 *                  这是正常损耗（用户删了图、生成服务的临时链接过期），不该报警，
 *                  否则很快就没人看告警了。
 *
 * 用法：
 *   node scripts/check-media.mjs             正常检查
 *   node scripts/check-media.mjs --json      输出 JSON（给工作流用）
 *   node scripts/check-media.mjs --sample=12 加大取样量
 */
import { readFile } from 'node:fs/promises';

const args = { json: false, sample: 8, timeout: 25000 };
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split('=');
  if (k === '--json') args.json = true;
  else if (k === '--sample') args.sample = Number(v) || 8;
  else if (k === '--timeout') args.timeout = Number(v) || 25000;
}

const PROXY = 'https://images.weserv.nl/';

/** 阈值：超过这个比例才认为是大面积故障，而不是零星损耗。 */
const PROXY_FAIL_RATIO = 0.5;
const ORIGIN_FAIL_RATIO = 0.3;

async function probe(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeout);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'prompts-chat-zh media-health-check' },
      signal: ac.signal,
    });
    // 不下载正文，读完头就掐断；我们只关心状态码和类型
    const type = res.headers.get('content-type') ?? '';
    const len = Number(res.headers.get('content-length') ?? 0);
    await res.body?.cancel();
    return { status: res.status, type, len, ok: res.ok };
  } catch (e) {
    return { status: 0, type: '', len: 0, ok: false, error: e.name || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function proxyUrl(origin, width = 400) {
  const params = new URLSearchParams({
    url: origin,
    w: String(width),
    output: 'webp',
    q: '75',
    fit: 'inside',
    we: '1',
  });
  return `${PROXY}?${params}`;
}

/** 按域名分层取样：某个源站整体挂掉，也应该是它自己那组全红，而不是被别的正常项稀释掉。 */
function sampleByHost(prompts, limit) {
  const byHost = new Map();
  for (const p of prompts) {
    if (!p.mediaUrl || p.type !== 'IMAGE') continue;
    let host;
    try {
      host = new URL(p.mediaUrl).host;
    } catch {
      continue;
    }
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(p);
  }

  const hosts = [...byHost.keys()].sort((a, b) => byHost.get(b).length - byHost.get(a).length);
  const picked = [];
  // 轮流从各域名取，保证每个源站都被覆盖到
  for (let round = 0; picked.length < limit; round++) {
    let added = false;
    for (const h of hosts) {
      const list = byHost.get(h);
      if (round >= list.length) continue;
      picked.push(list[round]);
      added = true;
      if (picked.length >= limit) break;
    }
    if (!added) break;
  }
  return { picked, hostCount: hosts.length, totalWithMedia: [...byHost.values()].reduce((n, l) => n + l.length, 0) };
}

async function main() {
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile('data/upstream.json', 'utf8'));
  } catch {
    console.error('读不到 data/upstream.json。先跑一次 `npm run sync` 拿到样本。');
    process.exit(2);
  }

  const { picked, hostCount, totalWithMedia } = sampleByHost(snapshot.prompts, args.sample);

  if (!picked.length) {
    console.error('样本里没有带图的提示词，跳过检查。');
    process.exit(0);
  }

  const results = [];
  for (const p of picked) {
    const host = new URL(p.mediaUrl).host;
    const viaProxy = await probe(proxyUrl(p.mediaUrl));
    results.push({ slug: p.slug, host, ...viaProxy });
  }

  // 分类
  const proxyDown = results.filter((r) => r.status === 0 || r.status >= 500);
  const originGone = results.filter((r) => r.status >= 400 && r.status < 500);
  const healthy = results.filter((r) => r.ok && r.type.startsWith('image/'));

  const ratio = (n) => n / results.length;
  const proxyBroken = ratio(proxyDown.length) > PROXY_FAIL_RATIO;
  const originRotting = ratio(originGone.length) > ORIGIN_FAIL_RATIO;

  const summary = {
    checked: results.length,
    healthy: healthy.length,
    proxyDown: proxyDown.length,
    originGone: originGone.length,
    hosts: hostCount,
    totalWithMedia,
    severity: proxyBroken ? 'critical' : originRotting ? 'warning' : 'ok',
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ summary, results }, null, 2)}\n`);
  } else {
    process.stdout.write(`图片链路检查 —— 取样 ${summary.checked} 张，覆盖 ${hostCount} 个源站`);
    process.stdout.write(`（全站带图条目 ${totalWithMedia}）\n\n`);
    for (const r of results) {
      const mark = r.ok ? '✓' : r.status === 0 || r.status >= 500 ? '✗ 代理' : '· 源站';
      process.stdout.write(
        `  ${mark.padEnd(7)} ${String(r.status).padStart(3)}  ${r.host.padEnd(48)} ${r.slug}\n`,
      );
    }
    process.stdout.write(
      `\n通过 ${healthy.length} / 代理故障 ${proxyDown.length} / 源站失效 ${originGone.length}\n`,
    );
    if (proxyBroken) {
      process.stdout.write('\n严重：代理大面积不可用，页面上的图基本都会退化成链接。\n');
    } else if (originRotting) {
      process.stdout.write('\n提示：源站失效比例偏高，属正常损耗，留意一下即可。\n');
    } else {
      process.stdout.write('\n链路正常。\n');
    }
  }

  // 只有代理整体挂掉才算失败退出，源站零星失效不触发告警
  process.exit(proxyBroken ? 1 : 0);
}

main().catch((e) => {
  console.error('检查失败：', e);
  process.exit(2);
});
