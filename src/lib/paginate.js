/**
 * 列表分页的公共逻辑，供 /prompts/ 和 /types/ 复用。
 *
 * 约定：第 1 页是目录本身（/prompts/），第 2 页起在 /page/N/ 下。
 * 这样第 1 页 URL 最干净，也不会和 /prompts/<slug>/ 打架。
 */

export function sortPrompts(list) {
  return [...list].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function chunk(list, perPage) {
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  return {
    totalPages,
    pageOf: (n) => list.slice((n - 1) * perPage, n * perPage),
  };
}

/** 生成第 2 页起的 getStaticPaths 返回值。 */
export function restPages(list, perPage, buildProps) {
  const { totalPages, pageOf } = chunk(list, perPage);
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => {
    const page = i + 2;
    return {
      params: { page: String(page) },
      props: { ...buildProps(pageOf(page)), page, totalPages },
    };
  });
}
