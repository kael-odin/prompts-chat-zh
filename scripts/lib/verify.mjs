/**
 * 译后结构校验。
 *
 * 光靠调提示词管不住模型——它偶尔会吞掉一个标题、把列表揉成一坨、或者漏掉一个占位符。
 * 与其祈祷，不如译完逐条比对结构，不合格的打回重译。
 * 这是整条流水线里最值钱的一道闸门。
 *
 * 比对的两个输入都是「已还原」的普通文本（占位符已回到原样），
 * 所以检查的是最终产物本身，而不是中间态，不会出现"清理干净了却仍被判不合格"的假阳性。
 */
import { countPlaceholders } from './segments.mjs';

/** 统计 markdown 围栏数量（``` 与 ~~~ 各自成对，取总数的一半即块数）。 */
function fenceCount(s) {
  return (String(s).match(/^\s*(```|~~~)/gm) || []).length;
}

/** 统计标题行数。 */
function headingCount(s) {
  return (String(s).match(/^\s*#{1,6}\s/gm) || []).length;
}

function newlineCount(s) {
  return (String(s).match(/\n/g) || []).length;
}

/**
 * 结构化行数：列表项、标题、表格行、引用块。
 *
 * 为什么不直接数换行：不少提示词是在窄编辑器里写出来的硬换行（每四十来个字符断一次），
 * 译成中文后自然重新折行，行数一定对不上——那是正常的排版差异，不是损坏。
 * 真正要防的是「结构化元素被揉进同一行」：列表项、标题、表格行一旦和别的内容挤在一起，
 * markdown 就渲染不出来了。数这个才抓得准。
 */
function structuralLines(s) {
  return (String(s).match(/^\s*(?:[-*+]|\d+[.)]|#{1,6}\s|\||>)/gm) || []).length;
}

/** 去掉代码块和行内代码后，看双花括号是否配对。 */
function bracesBalanced(s) {
  const t = String(s).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  return (t.match(/\{\{/g) || []).length === (t.match(/\}\}/g) || []).length;
}

/**
 * 比对原文与译文的结构。
 * @param {string} original 上游原文
 * @param {string} translation 已还原占位符的译文
 * @returns {{ok: boolean, issues: string[]}}
 */
export function verify(original, translation) {
  const issues = [];

  if (!translation || !translation.trim()) {
    return { ok: false, issues: ['译文为空'] };
  }

  const sf = fenceCount(original);
  const tf = fenceCount(translation);
  if (sf !== tf) issues.push(`代码围栏数不一致：原文 ${sf}，译文 ${tf}`);

  const sh = headingCount(original);
  const th = headingCount(translation);
  if (sh !== th) issues.push(`标题数不一致：原文 ${sh}，译文 ${th}`);

  // 结构化行被揉进同一行：列表项、标题、表格行一旦合并，markdown 就渲染不出来了。
  // 这是最隐蔽也最常见的一种损坏——纯文本看着没事，页面上却是一坨。
  const slSrc = structuralLines(original);
  const slDst = structuralLines(translation);
  if (slSrc >= 3 && slDst < slSrc) {
    issues.push(`结构化行数减少：原文 ${slSrc}，译文 ${slDst}`);
  }

  // 整体换行塌缩兜底：结构化行没问题，但整篇的行全被合并了（硬换行文档不算，那种情况
  // 结构化行数会一致，且译文换行数通常只略少）
  const nlSrc = newlineCount(original);
  const nlDst = newlineCount(translation);
  if (nlSrc >= 20 && nlDst < nlSrc * 0.5) {
    issues.push(`换行数大幅减少：原文 ${nlSrc}，译文 ${nlDst}`);
  }

  // 占位符逐个核对：原文有的，译文一个都不能少
  const srcCounts = countPlaceholders(original);
  if (srcCounts.size) {
    const dstCounts = countPlaceholders(translation);
    const missing = [];
    for (const [token, n] of srcCounts) {
      const got = dstCounts.get(token) ?? 0;
      if (got < n) missing.push(n - got === n ? token : `${token}（缺 ${n - got} 个）`);
    }
    if (missing.length) issues.push(`占位符丢失：${missing.join('、')}`);
  }

  // 只在原文配对、译文不配对时才算是译坏了。
  // 有些原文本身 {{ 和 }} 数就不等，译文照搬，那不是模型的问题。
  if (bracesBalanced(original) && !bracesBalanced(translation)) {
    issues.push('译文花括号不配对（原文是配对的）');
  }

  // 译文短得离谱通常意味着模型截断了
  if (original.length > 200 && translation.length < original.length * 0.2) {
    issues.push(`译文过短：原文 ${original.length} 字符，译文仅 ${translation.length}`);
  }

  return { ok: issues.length === 0, issues };
}
