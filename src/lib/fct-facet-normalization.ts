import { toLabel } from "./uri-labels";

/** Distinct predicate/graph descriptors, retaining original server order.
 * Each COUNT is already an aggregate of one predicate; never sum repeated
 * rows introduced by labels or joins. Hierarchical class rows preserve one
 * edge per (class, parent) because multiple inheritance is meaningful. */
export function normalizeFctFacetItems<T extends {
  uri: string; label: string; count: number; parent?: string;
}>(items: readonly T[], retainParents = false): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = retainParents ? JSON.stringify([item.uri, item.parent ?? ""]) : item.uri;
    const previous = unique.get(key);
    if (!previous) { unique.set(key, item); continue; }
    const label = previous.label === toLabel(previous.uri) && item.label !== toLabel(item.uri)
      ? item.label : previous.label;
    unique.set(key, { ...previous, label,
      count: Number.isFinite(previous.count) && previous.count >= 0
        ? previous.count : Number.isFinite(item.count) && item.count >= 0 ? item.count : -1 });
  }
  return [...unique.values()];
}
