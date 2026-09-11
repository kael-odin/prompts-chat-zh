/**
 * 站点数据入口。
 *
 * data/site.json 由 scripts/build-data.mjs 生成，体量在 10MB 量级，
 * 所以这里做一次性读入并缓存，避免每个页面都重新解析一遍。
 */
import { readFileSync, existsSync } from 'node:fs';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const DATA = new URL('../../data/site.json', import.meta.url);

let cached = null;

export function getSite() {
  if (!cached) {
    if (!existsSync(DATA)) {
      throw new Error('缺少 data/site.json。先执行：npm run sync && npm run translate && npm run data');
    }
    cached = JSON.parse(readFileSync(DATA, 'utf8'));
  }
  return cached;
}

export function getPrompts() {
  return getSite().prompts;
}

export function getPrompt(slug) {
  return getSite().prompts.find((p) => p.slug === slug);
}

/**
 * 上游内容来自公开投稿，任何人可提交任意文本——包括 <script>。
 * 站点会把它当 HTML 渲染，所以必须过一遍白名单过滤，不能直接 set:html 原文。
 */
const SANITIZE_OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote',
    'ul', 'ol', 'li',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small',
    'pre', 'code', 'kbd', 'samp',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'a', 'img',
    'details', 'summary',
    'div', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    code: ['class'],
    pre: ['class'],
    th: ['align', 'colspan', 'rowspan'],
    td: ['align', 'colspan', 'rowspan'],
    div: ['class'],
    span: ['class'],
    details: ['open'],
  },
  allowedClasses: {
    code: ['language-*', 'lang-*', 'hljs'],
    pre: ['language-*', 'lang-*', 'hljs'],
    div: ['*'],
    span: ['*'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // 站外链接在新标签打开，由 Base 布局里的脚本统一加 rel
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? '';
      if (/^https?:\/\//.test(href) && !href.includes('prompts.chat')) {
        return { tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } };
      }
      return { tagName, attribs };
    },
  },
};

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md) {
  return sanitizeHtml(marked.parse(String(md ?? '')), SANITIZE_OPTIONS);
}

/** 列表页和搜索索引用的纯文本，去掉 markdown 记号。 */
export function plainText(md, max = 220) {
  const s = String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\d.\s]+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 类型标签的中文名 */
export const TYPE_LABELS = {
  TEXT: '文本',
  IMAGE: '图像',
  VIDEO: '视频',
  AUDIO: '音频',
  SKILL: '技能',
  TASTE: '品味',
  STRUCTURED: '结构化',
};

export function typeLabel(t) {
  return TYPE_LABELS[t] ?? t;
}
