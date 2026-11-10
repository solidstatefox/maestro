/** Query/widget completeness registry, independent of any visual indicator. */
export type IncompleteResultState = { incomplete: boolean; source: string; requestId: string; message: string; observedAt: number };
const statuses = new Map<string, IncompleteResultState>();
const observers = new Set<() => void>();
export function getMaestroIncompleteResults(source: string): IncompleteResultState | undefined { return statuses.get(source); }
export function getAllMaestroIncompleteResults(): ReadonlyMap<string, IncompleteResultState> { return statuses; }
export function subscribeMaestroIncompleteResults(observer: () => void): () => void {
  observers.add(observer); return () => { observers.delete(observer); };
}
export function setMaestroIncompleteResults(source: string, state: Omit<IncompleteResultState, "source" | "observedAt">): void {
  if (!source) return;
  statuses.set(source, { ...state, source, observedAt: Date.now() });
  for (const observer of observers) observer();
}

/** Incomplete states belong to the previous live-query pipeline. */
export function resetMaestroIncompleteResults(): void {
  statuses.clear();
  for (const observer of observers) observer();
}
