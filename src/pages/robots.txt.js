/**
 * robots.txt 由构建期生成，因为要把站点自己的绝对地址写进 Sitemap 行，
 * 而这个地址取决于部署时的 SITE_URL / BASE_PATH。
 *
 * 注意：GitHub Pages 的项目页是挂在 https://<user>.github.io/<repo>/ 下面的，
 * 而爬虫只认域名根目录的 robots.txt（https://<user>.github.io/robots.txt），
 * 那个文件不归本仓库管。所以这份文件在项目页模式下不会被真正读取——
 * 保留它是为了两种情况：将来换自定义域名，或者把它挪到根用户页仓库里去。
 */
import { url } from '../lib/url.js';

export function GET({ site }) {
  // site 里不含 base，要自己接上，否则 Sitemap 行会指到域名根
  const sitemapUrl = `${url('/sitemap-index.xml')}`;
  const absolute = new URL(sitemapUrl, site ?? 'https://kael-odin.github.io').href;

  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    '# 本站是非官方中文镜像，内容来自 prompts.chat（CC0 1.0 公共领域）',
    `# 上游原站：https://prompts.chat`,
    '',
    `Sitemap: ${absolute}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
