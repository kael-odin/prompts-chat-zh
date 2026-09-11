/**
 * 图片来源处理。
 *
 * 本站**不镜像图片**，只做「引用」：经 weserv.nl 中转、压成 WebP 再展示。
 * 图片始终由原站提供，我们一个字节都不落盘，源站压力由代理的 CDN 缓存承担。
 *
 * 为什么不直连原图：实测单张 288 KB – 1.3 MB，列表页几十张图直接上兆；
 * 压到 400px 的 WebP 只剩约 17 KB，差 17 倍。
 *
 * 顺带说清一件事：这些图并不在上游自己的服务器上——一部分在上游的对象存储，
 * 另一部分直接是 wiro.ai / fal.media 这些生成服务的 CDN 地址。
 * 用户生成后把链接粘过来的，上游只是存了 URL。
 */

const PROXY = 'https://images.weserv.nl/';

/** weserv 只处理图片。视频和音频不能走它，各自用原生标签轻量加载。 */
export function isProxyable(type) {
  return type === 'IMAGE';
}

/**
 * 拼一个代理缩略图地址。
 * @param {string} url 原始图片地址
 * @param {number} width 目标宽度（详情页 1200，列表 400）
 */
export function proxied(url, width) {
  if (!url) return null;
  const params = new URLSearchParams({
    url,
    w: String(width),
    output: 'webp',
    q: '75',
    fit: 'inside',
    we: '1', // 不放大：原图比目标宽度还小就保持原样
  });
  return `${PROXY}?${params.toString()}`;
}

/** 页面展示用的人话标签 */
export const MEDIA_LABELS = {
  IMAGE: '示例图',
  VIDEO: '示例视频',
  AUDIO: '示例音频',
};
