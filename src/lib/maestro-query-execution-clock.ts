/** Proxy-dispatch-driven execution clock. Browser and proxy queue waiting are excluded.
 * Start and completion are signaled over the query event stream. */
export type MaestroQueryClockScope = "alphabet" | "properties" | "roles" | "categories" | "categoryTree" | "graphs" | "results" | "groups" | "record" | "recordGraphs" | "recordAuthors" | "policies" | "personal" | "statuses" | "analysis" | "views";
type ClockState = { active: number; elapsedMs: number; activeSince: number; lastCompletedAt: number; lastStartedAt: number };
const clocks = new Map<MaestroQueryClockScope, ClockState>();
let clockGeneration = 0;

export function maestroQueryClockScope(headers?: Headers): MaestroQueryClockScope | null {
  if (!headers) return null;
  const label = `${headers.get("x-maestro-debug-source") ?? ""} ${headers.get("x-maestro-debug-component") ?? ""}`.toLowerCase();
  // Match query identity from proxy request headers, not component mount time.
  if (label.includes("results-search") || label.includes("resultstotalcount") || label.includes("results-total-count")) return "results";
  if (label.includes("group-values-fct") || label.includes("group-members-fct")) return "groups";
  if (label.includes("record-graph-discovery")) return "recordGraphs";
  if (label.includes("record-author-discovery")) return "recordAuthors";
  if (label.includes("record-policy") || label.includes("record-template") || label.includes("record-shacl") || label.includes("record-xslt")) return "policies";
  if (label.includes("record-") || label.includes("recorddescription")) return "record";
  if (label.includes("personal-widget-values") || label.includes("personal-role-widget-values")) return "personal";
  if (label.includes("status-facet") || label.includes("statuses-facet")) return "statuses";
  if (label.includes("analyze-values")) return "analysis";
  if (label.includes("view-discover") || label.includes("view-feature") || label.includes("view-policy")) return "views";
  if (label.includes("alphabet")) return "alphabet";
  if (label.includes("classes-hierarchy")) return "categoryTree";
  if (label.includes("facetloader:properties")) return "properties";
  if (label.includes("facetloader:roles")) return "roles";
  if (/facetloader:classes/.test(label)) return "categories";
  if (/facetloader:graphs/.test(label) || label.includes("graph-list")) return "graphs";
  return null;
}

export function beginMaestroQueryExecution(scope: MaestroQueryClockScope): (serverElapsedMs?: number) => void {
  const now = performance.now();
  const state = clocks.get(scope) ?? { active: 0, elapsedMs: 0, activeSince: 0, lastCompletedAt: 0, lastStartedAt: 0 };
  // Keep accumulated time across idle gaps and panel remounts.
  // Dispatch is reported by the proxy after it acquires the upstream slot.
  if (state.active === 0) state.activeSince = now;
  state.lastStartedAt = now;
  state.active++;
  clocks.set(scope, state);
  let ended = false;
  return (serverElapsedMs?: number) => {
    if (ended) return;
    ended = true;
    const end = performance.now();
    state.active = Math.max(0, state.active - 1);
    if (state.active === 0) {
      // The proxy supplies the authoritative monotonic execution duration.
      // Concurrent subqueries still use union time, not overlapping totals.
      state.elapsedMs += Math.max(0, serverElapsedMs ?? end - state.activeSince);
      state.lastCompletedAt = end;
    }
  };
}

export function getMaestroQueryExecutionMs(scope: MaestroQueryClockScope): number {
  const state = clocks.get(scope);
  if (!state) return 0;
  return state.elapsedMs + (state.active > 0 ? Math.max(0, performance.now() - state.activeSince) : 0);
}

/** One polling snapshot for the loading UI. lastStartedAt distinguishes queued work
 * from a request which dispatched (and may already have completed). */
export function getMaestroQueryExecutionSnapshot(scope: MaestroQueryClockScope): { elapsedMs: number; active: number; lastStartedAt: number; generation: number } {
  const state = clocks.get(scope);
  return {
    elapsedMs: getMaestroQueryExecutionMs(scope),
    active: state?.active ?? 0,
    lastStartedAt: state?.lastStartedAt ?? 0,
    generation: clockGeneration,
  };
}

/** Reset all execution totals before a new live-query pipeline. Old in-flight
 * completion callbacks retain their old state objects, not these new clocks. */
export function resetMaestroQueryExecutionClocks(): void {
  clocks.clear();
  clockGeneration++;
}
