/** Stable breadcrumb preview state updates: unchanged summaries/pending IDs should
 * never publish new React state objects. No query or proxy logic lives here. */
import type { FctUiResultSummary } from "./fct-query-api";

export function sameBreadcrumbSummary(a: FctUiResultSummary | undefined, b: FctUiResultSummary | undefined): boolean {
  return a === b || Boolean(a && b && a.label === b.label && a.count === b.count &&
    a.uri === b.uri && a.termType === b.termType && a.zeroClasses === b.zeroClasses);
}

/** Replace a complete breadcrumb scope without re-rendering if it is identical. */
export function reconcileBreadcrumbSummaries(
  current: Record<string, FctUiResultSummary>, next: Record<string, FctUiResultSummary>,
): Record<string, FctUiResultSummary> {
  const ids = Object.keys(next);
  if (ids.length === Object.keys(current).length && ids.every(id => sameBreadcrumbSummary(current[id], next[id]))) return current;
  return next;
}

/** Merge a partial/cache/step result without publishing identical values. */
export function mergeBreadcrumbSummaries(
  current: Record<string, FctUiResultSummary>, patch: Record<string, FctUiResultSummary>,
): Record<string, FctUiResultSummary> {
  if (Object.keys(patch).every(id => sameBreadcrumbSummary(current[id], patch[id]))) return current;
  return { ...current, ...patch };
}

export function reconcileBreadcrumbPendingIds(current: Set<string>, next: Set<string>): Set<string> {
  return current.size === next.size && [...next].every(id => current.has(id)) ? current : next;
}
