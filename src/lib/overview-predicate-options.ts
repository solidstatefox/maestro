/** One dropdown entry per RDF predicate, even when it occurs in both Properties and Roles. */
export function uniqueOverviewPredicateOptions<T extends { readonly uri: string }>(
  options: readonly T[],
): T[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const uri = option.uri.trim();
    if (!uri || seen.has(uri)) return false;
    seen.add(uri);
    return true;
  });
}
