/** Keep pagination stable when a filter or a background refresh shrinks a list. */
export function paginationState(page, total, pageSize) {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;
  const count = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.max(1, Math.min(pages, Number.isSafeInteger(page) ? page : 1));
  return { page: current, pages, pageSize: size, total: count, start: (current - 1) * size, end: Math.min(current * size, count) };
}

/** A bounded, predictable set of numbered page links, even for a large collection. */
export function pageNumbers(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const values = [...new Set([1, pages, page - 1, page, page + 1, ...(page <= 3 ? [2, 3, 4] : []), ...(page >= pages - 2 ? [pages - 3, pages - 2, pages - 1] : [])])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return values.flatMap((value, index) => index && value - values[index - 1] > 1 ? ['ellipsis', value] : [value]);
}
