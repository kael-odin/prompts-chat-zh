// @ts-check
import { defineConfig } from 'astro/config';

// 部署到 GitHub Pages 时默认走 https://<user>.github.io/<repo>/ 这个子路径。
// 换成自定义域名时，把 BASE_PATH 设为 '/'、SITE_URL 设为域名即可。
const base = process.env.BASE_PATH ?? '/prompts-chat-zh';
const site = process.env.SITE_URL ?? 'https://kael-odin.github.io';

export default defineConfig({
  site,
  base,
  build: {
    // 输出目录形式的 URL（/prompts/foo/index.html），静态托管最稳
    format: 'directory',
  },
  devToolbar: { enabled: false },
});
