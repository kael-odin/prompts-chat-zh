/**
 * 分段与占位符保护。
 *
 * 提示词不是普通散文：里面混着代码块、占位符和各种"咒语"式的字面量。
 * 直接整段丢给模型翻译，代码会被改写、占位符会被译掉，译出来的提示词就废了。
 *
 * 这里做三件事：
 *   1. splitBlocks  —— 把 markdown 切成「要翻译的文本段」和「原样保留的代码段」
 *   2. protect       —— 把无歧义的占位符换成 %%PH_n%% 哨兵，译完再还原
 *   3. chunkText     —— 把过长的文本段切成模型能吃下的块
 */

/** 无歧义、必须原样保留的占位符写法。有歧义的（如单个 {}）不在此列，交给提示词约束 + 译后校验。 */
const PLACEHOLDER_PATTERNS = [
  /\{\{[^{}\n]{0,80}\}\}/g, // {{variable}}
  /\$\{[^{}\n]{0,80}\}/g, // ${variable}
  /%(\d+\$)?[sdif]/g, // %s %1$s %d
  /\[[A-Z][A-Z0-9 _-]{2,}\]/g, // [INSERT TOPIC]
];

/** 列出文本中出现的所有占位符（去重排序），用于审查与译后比对。 */
export function findPlaceholders(text) {
  const found = new Set();
  for (const re of PLACEHOLDER_PATTERNS) {
    for (const m of String(text ?? '').matchAll(re)) found.add(m[0]);
  }
  return [...found].sort();
}

/** 统计每种占位符出现的次数，用于核对译文有没有漏掉。 */
export function countPlaceholders(text) {
  const counts = new Map();
  const s = String(text ?? '');
  for (const re of PLACEHOLDER_PATTERNS) {
    for (const m of s.matchAll(re)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }
  return counts;
}

/**
 * 按 markdown 围栏切分内容。围栏内的内容永远不送去翻译。
 *
 * 返回的块按顺序用 '\n' 拼起来可以无损还原原文，这个性质依赖下面 chunkText 也按行切分。
 *
 * @returns {{type: 'text'|'code', value: string}[]}
 */
export function splitBlocks(md) {
  const lines = String(md ?? '').split('\n');
  const blocks = [];
  let buf = [];
  let inFence = false;
  let fenceMark = '';

  const flushText = () => {
    if (buf.length) {
      blocks.push({ type: 'text', value: buf.join('\n') });
      buf = [];
    }
  };

  for (const line of lines) {
    const m = /^\s*(```|~~~)/.exec(line);

    if (!inFence && m) {
      flushText();
      inFence = true;
      fenceMark = m[1];
      buf.push(line);
      continue;
    }

    if (inFence) {
      buf.push(line);
      if (m && m[1] === fenceMark) {
        blocks.push({ type: 'code', value: buf.join('\n') });
        buf = [];
        inFence = false;
      }
      continue;
    }

    buf.push(line);
  }

  // 围栏没闭合：整块当代码保留，宁可少翻也不要破坏
  if (inFence) {
    blocks.push({ type: 'code', value: buf.join('\n') });
    buf = [];
  }
  flushText();

  return blocks;
}

/**
 * 把占位符替换成 %%PH_n%% 哨兵，避免模型误译。
 *
 * 哨兵格式为什么是 %%PH_n%% 而不是 [[n]]：后者会被模型模仿。
 * 实测原文里出现单中括号时，模型会"顺手"补成双中括号，凭空造出占位符污染译文。
 * 带字母的 %%PH_n%% 没有这个类比空间。
 *
 * @returns {{text: string, tokens: string[]}}
 */
export function protect(text) {
  const tokens = [];
  let out = text;

  for (const re of PLACEHOLDER_PATTERNS) {
    out = out.replace(re, (match) => {
      const idx = tokens.length;
      tokens.push(match);
      return `%%PH_${idx}%%`;
    });
  }

  return { text: out, tokens };
}

/**
 * 把哨兵还原成原始占位符。
 * 对不上号的哨兵一律删除：索引是照原文编号的，译文里冒出个越界索引只可能是模型幻觉，
 * 留着就会在页面上显示成 %%PH_9%% 这种垃圾。
 */
export function restore(text, tokens) {
  return String(text ?? '').replace(/%%PH_(\d+)%%/g, (whole, n) => {
    const i = Number(n);
    return i >= 0 && i < tokens.length ? tokens[i] : '';
  });
}

/**
 * 按「行」把文本切成不超过 maxChars 的块。
 *
 * 必须是按行切——早期版本按句号切、再用空格拼回去，结果把换行全吃掉了：
 * 整篇没有空行的文档（全用单换行分列表项）会被当成一个"段落"，
 * 送进模型的就成了一整行，译回来的标题和列表项全挤成一坨。
 * 实测 1518 条里有 33 条栽在这上面。
 *
 * 各块之间用 '\n' 拼接即可无损还原，因为每一刀都落在行边界上。
 */
export function chunkText(text, maxChars = 3000) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return [s];

  const lines = s.split('\n');
  const chunks = [];
  let cur = [];
  let curLen = 0;

  const flush = () => {
    if (cur.length) {
      chunks.push(cur.join('\n'));
      cur = [];
      curLen = 0;
    }
  };

  for (const line of lines) {
    // 单行本身超长：只能硬切，这里没有换行可言，切了不影响结构
    if (line.length > maxChars) {
      flush();
      for (let i = 0; i < line.length; i += maxChars) chunks.push(line.slice(i, i + maxChars));
      continue;
    }

    const next = curLen + line.length + (cur.length ? 1 : 0);
    if (cur.length && next > maxChars) {
      flush();
    } else if (cur.length && curLen > maxChars * 0.6 && line.trim() === '') {
      // 已经够长了又遇上空行，就在段落边界收一刀，译文衔接更自然
      flush();
    }

    cur.push(line);
    curLen += line.length + (cur.length > 1 ? 1 : 0);
  }

  flush();
  return chunks;
}
