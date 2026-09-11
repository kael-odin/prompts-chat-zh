/**
 * 把 data/upstream.json 里的英文提示词翻成简体中文，结果缓存到 data/zh.json。
 *
 * 设计要点：
 *   · 缓存以内容指纹为键 —— 同一条提示词出现多次只翻一次；上游改一个字只重翻那一条。
 *   · 代码块整块跳过，占位符换成 [[n]] 哨兵再还原，不指望模型"自觉"。
 *   · 译后逐条比对结构（围栏数/标题数/哨兵/花括号），不合格打回重译一次。
 *   · 每 25 条落盘一次，中断了也能接着跑。
 *
 * 用法：
 *   npm run translate -- --limit=50         只翻 50 条（先看质量）
 *   npm run translate -- --only=linux-terminal
 *   npm run translate -- --force            忽略缓存全量重翻
 *   npm run translate -- --stats            只报告缓存覆盖率，不翻译
 */
import './lib/env.mjs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { chat, assertKey, createLimiter, formatUsage, MODEL } from './lib/llm.mjs';
import { splitBlocks, protect, restore, chunkText } from './lib/segments.mjs';
import { verify } from './lib/verify.mjs';

const UPSTREAM = 'data/upstream.json';
const CACHE = 'data/zh.json';
const CHECKPOINT_EVERY = 25;

// ---------------------------------------------------------------- 提示词

const TITLE_SYS = `你是提示词标题本地化专家。把用户给出的英文标题译成简体中文。

要求：
- 只输出译文本身，不要引号、不要解释、不要标点结尾
- 简洁，像中文软件的列表标题；不要「关于」「一个」这类赘余词
- ChatGPT、Claude、Midjourney、GPT-4 这类产品名与模型名保持原文
- %%PH_0%% 这类标记是占位符，原样保留`;

const CONTENT_INTRO = `你是提示词本地化专家，把用户给出的提示词译成简体中文。

原文可能是英文，也可能是葡萄牙语、意大利语、越南语等其他语言——无论哪种，一律译成简体中文。`;

// 第 1 条是重点：早期版本漏了「逐行对应」，而分段逻辑又把换行吃掉了，
// 结果长文档的列表项和标题被揉进同一行，结构全塌。
const CONTENT_RULES = `铁律：
1. **逐行对应**：原文怎么换行，译文就怎么换行。绝不能把多行合并成一行——列表项、标题、空行都必须各自占一行，输出行数要和原文一致。
2. 完整保留 markdown 结构：标题层级、列表符号、粗体、表格、引用块，一个都不能少。
3. 代码块和行内代码原样保留，其中的标识符、命令、变量名一律不译。
4. JSON / YAML / XML 的键名保持英文，只译其中的人类语言字符串值。
5. 保留原文的大小写强调（MUST、NEVER 这类全大写照旧全大写）。
6. 保持指令强度："must" 译「必须」而不是「应该」，"never" 译「绝不」。
7. 术语：prompt 译「提示词」；模型名与产品名不译。
8. 不要添加任何前言、解释、后记，也不要复述原文。只输出译文。`;

// 系统提示里只要出现具体的哨兵样例，模型就会时不时把它当成正文抄进译文，
// 所以在没有占位符的文本上一律用不带占位符规则的版本。
const CONTENT_SYS_PLAIN = `${CONTENT_INTRO}

${CONTENT_RULES}`;

const CONTENT_SYS_GUARDED = `${CONTENT_INTRO}

${CONTENT_RULES}
9. %%PH_0%% 这类形如「两个百分号 + PH_ + 数字 + 两个百分号」的标记是占位符，必须原样保留——不翻译、不改写、不加空格、不合并、不改动其中的下划线和百分号。
10. 不要自己发明占位符标记。原文里没有的标记，译文里也不能出现。`;

const SUMMARY_SYS = `用一句简体中文概括下面这条提示词的用途。

要求：不超过 40 字；不要以「这条提示词」开头；结尾不加句号；只输出这句话本身。`;

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const out = {
    concurrency: 6,
    maxChars: 3000,
    limit: 0,
    only: [],
    force: false,
    dryRun: false,
    stats: false,
    prune: false,
    recheck: false,
    minChars: 0,
  };
  for (const a of argv) {
    const [k, v] = a.split('=');
    if (k === '--concurrency') out.concurrency = Math.max(1, Number(v) || 6);
    else if (k === '--max-chars') out.maxChars = Math.max(500, Number(v) || 3000);
    else if (k === '--limit') out.limit = Number(v) || 0;
    else if (k === '--only') out.only.push(v);
    else if (k === '--min-chars') out.minChars = Number(v) || 0;
    else if (k === '--force') out.force = true;
    else if (k === '--dry-run') out.dryRun = true;
    else if (k === '--stats') out.stats = true;
    else if (k === '--prune') out.prune = true;
    else if (k === '--recheck') out.recheck = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------- 缓存

async function loadCache() {
  try {
    const c = JSON.parse(await readFile(CACHE, 'utf8'));
    if (!c.entries) c.entries = {};
    return c;
  } catch {
    return { version: 1, model: MODEL, entries: {} };
  }
}

async function saveCache(cache) {
  // 键排序，让每周的增量 diff 只落在新增的那几行上。
  //
  // 注意：只排序「序列化的结果」，绝不重新赋值 cache.entries。
  // 赋值会换掉对象引用，而并发中的任务早在 await 之前就抓住了旧引用，
  // 于是写进一个已被丢弃的对象里——译文就这么丢了。
  const sorted = {};
  for (const k of Object.keys(cache.entries).sort()) sorted[k] = cache.entries[k];

  const payload = { version: cache.version ?? 1, model: cache.model, entries: sorted };
  await mkdir('data', { recursive: true });
  // 先写临时文件再原子改名：进程在写到一半时被杀，也不会留下半个 JSON 把缓存毁掉
  const tmp = `${CACHE}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await rename(tmp, CACHE);
}

// ---------------------------------------------------------------- 翻译

/**
 * 翻译正文。代码块原样透传，文本块先保护占位符、再按行切块送翻，最后还原。
 *
 * 占位符保护以「文本块」为单位做，哨兵索引不会跨块串味；
 * 系统提示也按块选——没有占位符的块不提占位符，免得模型把提示里的样例抄进译文。
 *
 * @returns {Promise<string>} 已还原占位符的译文
 */
async function translateDocument(content) {
  const blocks = splitBlocks(content);
  const outBlocks = [];

  for (const b of blocks) {
    if (b.type === 'code') {
      outBlocks.push(b.value); // 代码不进模型
      continue;
    }

    // 模型会把首尾空行吃掉，而空行在 markdown 里是有语义的——它决定段落和列表是否断开。
    // 所以送翻之前先把首尾空行剪下来，拼回去时原样贴回。
    const lead = /^\n*/.exec(b.value)[0];
    const trail = /\n*$/.exec(b.value)[0];
    const core = b.value.slice(lead.length, b.value.length - trail.length);

    if (!core.trim()) {
      outBlocks.push(b.value);
      continue;
    }

    const { text: guarded, tokens } = protect(core);
    const system = tokens.length ? CONTENT_SYS_GUARDED : CONTENT_SYS_PLAIN;

    const parts = [];
    for (const chunk of chunkText(guarded, args.maxChars)) {
      if (!chunk.trim()) continue;
      const translated = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: chunk },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
      parts.push(translated.trim());
    }

    // chunkText 按行切分，各块用 '\n' 拼回去才是原样；用 '\n\n' 会凭空多出空行
    outBlocks.push(lead + restore(parts.join('\n'), tokens) + trail);
  }

  // 块同样按 '\n' 拼接，与 splitBlocks 的分法互为逆运算
  return outBlocks.join('\n');
}

/** 翻译正文，校验不通过就打回重译一次。 */
async function translateContent(content) {
  let translated = await translateDocument(content);
  let check = verify(content, translated);
  if (check.ok) return { text: translated, issues: [] };

  const firstIssues = check.issues;
  translated = await translateDocument(content);
  check = verify(content, translated);
  if (check.ok) return { text: translated, issues: [] };

  // 两次都不过：保留译文但打上标记，让站点和人都能看见
  return {
    text: translated,
    issues: [...new Set([...firstIssues, ...check.issues])],
  };
}

async function translateTitle(title) {
  const { text: guarded, tokens } = protect(title);
  const out = await chat(
    [
      { role: 'system', content: TITLE_SYS },
      { role: 'user', content: guarded },
    ],
    { temperature: 0.1, maxTokens: 256 },
  );
  return restore(out.trim(), tokens);
}

async function makeSummary(prompt, zhContent) {
  // 上游有摘要就翻摘要，没有就从译文里现生成一句
  if (prompt.description) {
    const out = await chat(
      [
        { role: 'system', content: SUMMARY_SYS },
        { role: 'user', content: prompt.description.slice(0, 2000) },
      ],
      { temperature: 0.2, maxTokens: 200 },
    );
    return out.trim();
  }
  const out = await chat(
    [
      { role: 'system', content: SUMMARY_SYS },
      { role: 'user', content: zhContent.slice(0, 2000) },
    ],
    { temperature: 0.2, maxTokens: 200 },
  );
  return out.trim();
}

async function translateOne(prompt) {
  const [title, content] = await Promise.all([
    translateTitle(prompt.title),
    translateContent(prompt.content),
  ]);

  let summary = '';
  try {
    summary = await makeSummary(prompt, content.text);
  } catch (e) {
    process.stderr.write(`  ! 摘要失败 ${prompt.slug}: ${e.message.slice(0, 80)}\n`);
  }

  const entry = {
    title,
    content: content.text,
    summary,
    at: new Date().toISOString(),
  };
  if (content.issues.length) entry.issues = content.issues;
  return entry;
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const snapshot = JSON.parse(await readFile(UPSTREAM, 'utf8'));
  const cache = await loadCache();

  const all = snapshot.prompts;
  const cached = all.filter((p) => cache.entries[p.hash]).length;

  // 校验规则改了之后，用它重新判定整个缓存，不必重翻——译文本身没变，变的只是判据
  if (args.recheck) {
    let cleared = 0;
    let added = 0;
    for (const p of all) {
      const e = cache.entries[p.hash];
      if (!e) continue;
      const check = verify(p.content, e.content);
      const had = Boolean(e.issues?.length);
      if (check.ok) {
        if (had) {
          delete e.issues;
          cleared += 1;
        }
      } else {
        e.issues = check.issues;
        if (!had) added += 1;
      }
    }
    await saveCache(cache);
    const still = all.filter((p) => cache.entries[p.hash]?.issues?.length).length;
    process.stdout.write(
      `重新校验完成：新判不合格 ${added} 条，解除 ${cleared} 条，当前不合格 ${still} 条\n`,
    );
    for (const p of all) {
      const e = cache.entries[p.hash];
      if (!e?.issues?.length) continue;
      process.stdout.write(`  ${p.slug}\n`);
      for (const i of e.issues) process.stdout.write(`      - ${i}\n`);
    }
    return;
  }

  // 缓存以内容指纹为键，上游改了内容旧指纹就成了孤儿，不清理会越积越多
  if (args.prune) {
    const live = new Set(all.map((p) => p.hash));
    const dead = Object.keys(cache.entries).filter((h) => !live.has(h));
    for (const h of dead) delete cache.entries[h];
    await saveCache(cache);
    process.stdout.write(
      `已清理 ${dead.length} 条失效缓存（内容已变更或条目已下架）\n` +
        `剩余 ${Object.keys(cache.entries).length} 条\n`,
    );
    return;
  }

  if (args.stats) {
    const pct = ((cached / all.length) * 100).toFixed(1);
    const flagged = Object.values(cache.entries).filter((e) => e.issues).length;
    process.stdout.write(
      `缓存覆盖：${cached}/${all.length}（${pct}%）\n` +
        `待翻译：${all.length - cached}\n` +
        `结构告警：${flagged}\n` +
        `模型：${cache.model ?? MODEL}\n`,
    );
    return;
  }

  let work = all.filter((p) => args.force || !cache.entries[p.hash]);
  if (args.only.length) work = work.filter((p) => args.only.includes(p.slug));
  // 配合 --force 用：只重翻超过某个体量的条目（分段逻辑出问题时，受害的就是这些长文）
  if (args.minChars) work = work.filter((p) => p.content.length >= args.minChars);
  if (args.limit) work = work.slice(0, args.limit);

  process.stdout.write(
    `共 ${all.length} 条，已缓存 ${cached} 条，本次待翻 ${work.length} 条\n` +
      `模型 ${MODEL}，并发 ${args.concurrency}，单块上限 ${args.maxChars} 字符\n\n`,
  );

  if (args.dryRun) {
    for (const p of work.slice(0, 20)) {
      process.stdout.write(`  ${p.hash}  ${p.type.padEnd(10)}  ${String(p.content.length).padStart(7)}  ${p.title}\n`);
    }
    if (work.length > 20) process.stdout.write(`  ...还有 ${work.length - 20} 条\n`);
    return;
  }

  if (!work.length) {
    process.stdout.write('没有需要翻译的内容。\n');
    return;
  }

  assertKey();
  const limit = createLimiter(args.concurrency);
  const started = Date.now();
  let done = 0;
  let failed = 0;
  let flagged = 0;

  // 落盘串行化：并发任务会各自触发检查点，两次 writeFile 撞在一起会写坏文件
  let saving = Promise.resolve();
  const save = () => {
    cache.model = MODEL;
    cache.version = cache.version ?? 1;
    saving = saving.then(
      () => saveCache(cache),
      () => saveCache(cache),
    );
    return saving;
  };

  process.on('SIGINT', async () => {
    process.stdout.write('\n收到中断，正在落盘……\n');
    await save();
    process.stdout.write(`已保存 ${done} 条。\n`);
    process.exit(130);
  });

  await Promise.all(
    work.map((prompt) =>
      limit(async () => {
        try {
          // 先接到局部变量再写入，避免在 await 之后重新解析 cache.entries
          const entry = await translateOne(prompt);
          cache.entries[prompt.hash] = entry;
          if (entry.issues) flagged += 1;
        } catch (e) {
          failed += 1;
          process.stderr.write(`  ✗ ${prompt.slug}: ${e.message.slice(0, 120)}\n`);
        } finally {
          done += 1;
          if (done % CHECKPOINT_EVERY === 0 || done === work.length) {
            await save();
          }
          const elapsed = (Date.now() - started) / 1000;
          const rate = done / elapsed;
          const eta = rate > 0 ? Math.round((work.length - done) / rate) : 0;
          process.stdout.write(
            `\r  ${done}/${work.length}  失败 ${failed}  告警 ${flagged}  ` +
              `${rate.toFixed(1)} 条/秒  剩约 ${Math.floor(eta / 60)}分${eta % 60}秒   `,
          );
        }
      }),
    ),
  );

  await save();
  process.stdout.write('\n\n翻译完成\n');
  process.stdout.write(`  ${formatUsage()}\n`);
  process.stdout.write(`  本次 ${done} 条，失败 ${failed}，结构告警 ${flagged}\n`);
  if (failed) process.stdout.write('  失败条目会在下次运行时自动重试（缓存里没有它们的记录）\n');
  if (flagged) process.stdout.write('  告警条目已存下译文并标记 issues，可单独复查\n');
}

main().catch((e) => {
  console.error('\n翻译失败：', e);
  process.exit(1);
});
