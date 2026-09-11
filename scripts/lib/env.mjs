/**
 * 极简 .env 加载器，只依赖 Node 内置模块。
 * 必须在 import llm.mjs 之前 import 本模块——ESM 的 import 会被提升，
 * 而 llm.mjs 在模块顶层就读取 process.env。
 */
import { existsSync, readFileSync } from 'node:fs';

export function loadEnv(file = '.env') {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去掉成对的引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();
