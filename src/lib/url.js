/**
 * 带 base 路径的链接。
 *
 * 站点部署在 https://<user>.github.io/<repo>/ 这样的子路径下，
 * 页面里写死 "/prompts/" 会指到域名根而不是仓库根，所以内部链接一律过这个函数。
 */
const BASE = String(import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');

export function url(path = '/') {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('mailto:')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${p}` || '/';
}

export { BASE };
