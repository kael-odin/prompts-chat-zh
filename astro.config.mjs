// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 部署到 GitHub Pages 时默认走 https://<user>.github.io/<repo>/ 这个子路径。
// 换成自定义域名时，把 BASE_PATH 设为 '/'、SITE_URL 设为域名即可。
const base = process.env.BASE_PATH ?? '/prompts-chat-zh';
const site = process.env.SITE_URL ?? 'https://kael-odin.github.io';

export default defineConfig({
  site,
  base,
  integrations: [
    // 生成 sitemap-index.xml / sitemap-0.xml。
    // 分页页（/page/N/）不进 sitemap：它们是列表页的翻页，属于薄内容，
    // 真正值得收录的是每条提示词的详情页。
    sitemap({
      filter: (page) => !/\/page\/\d+\/?$/.test(page),
      changefreq: 'weekly',
      priority: 0.7,
      serialize(item) {
        // 提示词详情页权重最高，列表和分类页次之
        if (/\/prompts\/[^/]+\/?$/.test(item.url)) {
          return { ...item, priority: 0.9, changefreq: 'monthly' };
        }
        if (/\/prompts\/?$/.test(item.url)) {
          return { ...item, priority: 0.9, changefreq: 'daily' };
        }
        return item;
      },
    }),
  ],
  build: {
    // 输出目录形式的 URL（/prompts/foo/index.html），静态托管最稳
    format: 'directory',
  },
  devToolbar: { enabled: false },
});
