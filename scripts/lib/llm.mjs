/**
 * OpenAI 兼容端点的极简客户端：重试、超时、并发闸门、用量累计。
 * 只依赖 Node 内置 fetch，不引第三方包。
 */

const BASE = (process.env.TRANSLATE_BASE_URL ?? 'https://xc.lifesecretary.com:8000/v1').replace(
  /\/+$/,
  '',
);
const KEY = process.env.TRANSLATE_API_KEY ?? '';
export const MODEL = process.env.TRANSLATE_MODEL ?? 'deepseek-v4-flash';

/** 累计用量，跑完打印，方便估算成本。 */
export const usage = { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

export function assertKey() {
  if (!KEY) {
    console.error('缺少 TRANSLATE_API_KEY。复制 .env.example 为 .env 并填入 key。');
    process.exit(1);
  }
}

async function postOnce(body, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 推理模型的思考过程，有的网关会以 <think>…</think> 内联在 content 里一起返回
 * （有的则放 reasoning_content 字段，不经过这里）。混进译文会直接污染结果，统一剥掉；
 * 非推理模型没有这个标签，原样透传。
 */
function stripThinking(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // 只有开标签没有闭标签说明输出被思考占满后截断了，剩下的全是思考残渣
    .replace(/^[^<]*<think>[\s\S]*$/i, '');
}

/**
 * 发一次对话请求，失败按指数退避重试。
 * @returns {Promise<string>} 助手回复正文
 */
export async function chat(messages, opts = {}) {
  const { temperature = 0.1, maxTokens = 8192, retries = 4, timeoutMs = 180_000 } = opts;
  const body = { model: MODEL, messages, temperature, max_tokens: maxTokens };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await postOnce(body, timeoutMs);
      const u = data.usage ?? {};
      usage.calls += 1;
      usage.promptTokens += u.prompt_tokens ?? 0;
      usage.completionTokens += u.completion_tokens ?? 0;
      usage.reasoningTokens += u.completion_tokens_details?.reasoning_tokens ?? 0;
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('响应里没有 content');
      const cleaned = stripThinking(content);
      if (!cleaned.trim() && content.trim()) {
        throw new Error('整段输出都是思考内容，没有译文');
      }
      return cleaned;
    } catch (e) {
      lastErr = e;
      // 4xx（除 429）是请求本身有问题，重试没意义
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable || attempt === retries) break;
      const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      process.stderr.write(
        `  ! ${e.message.slice(0, 80)} — ${Math.round(wait)}ms 后重试 (${attempt + 1}/${retries})\n`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * 并发闸门。上游中转站的限流未知，并发别开大，6 左右比较稳。
 */
export function createLimiter(concurrency) {
  let active = 0;
  const queue = [];

  const next = () => {
    active -= 1;
    if (queue.length) {
      active += 1;
      queue.shift()();
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      const run = () => {
        fn().then(
          (v) => {
            next();
            resolve(v);
          },
          (e) => {
            next();
            reject(e);
          },
        );
      };
      if (active < concurrency) {
        active += 1;
        run();
      } else {
        queue.push(run);
      }
    });
}

export function formatUsage() {
  const total = usage.promptTokens + usage.completionTokens;
  return (
    `调用 ${usage.calls} 次 | 输入 ${usage.promptTokens.toLocaleString()} tok | ` +
    `输出 ${usage.completionTokens.toLocaleString()} tok` +
    (usage.reasoningTokens ? `（含推理 ${usage.reasoningTokens.toLocaleString()}）` : '') +
    ` | 合计 ${total.toLocaleString()} tok`
  );
}
