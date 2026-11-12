/** Stable UI label for property facets. Unlike dynamically discovered QNames,
 * the URI-local name does not change when namespace metadata arrives later. */
export function facetPropertyLabel(uri: string): string {
  const cut = Math.max(uri.lastIndexOf("#"), uri.lastIndexOf("/"));
  const local = cut < 0 ? uri : uri.slice(cut + 1);
  try { return decodeURIComponent(local) || uri; }
  catch { return local || uri; }
}
