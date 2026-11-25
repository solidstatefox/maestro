import { getMaestroQueryExecutionSnapshot, type MaestroQueryClockScope } from "./maestro-query-execution-clock";

/** Queue residence is not Virtuoso execution time. The generous independent
 * stall ceiling is a transport safeguard, never an Anytime result. */
export const PERSONAL_FACET_STALL_MS = 300_000;
export const PERSONAL_FACET_RESPONSE_GRACE_MS = 30_000;
export function personalFacetDeadlineReason(elapsedMs: number, wallMs: number, timeoutMs: number): string | null {
  if (elapsedMs >= timeoutMs + PERSONAL_FACET_RESPONSE_GRACE_MS)
    return "Personal facet transport deadline exceeded after upstream execution budget and response grace; no Anytime response received.";
  if (wallMs >= PERSONAL_FACET_STALL_MS + timeoutMs)
    return "Personal facet stalled in the transport/queue; no Anytime response received.";
  return null;
}
export function watchPersonalFacetDeadline(scope: MaestroQueryClockScope, timeoutMs: number, onTimeout: (reason: string) => void): () => void {
  const started = performance.now();
  const timer = setInterval(() => {
    const clock = getMaestroQueryExecutionSnapshot(scope);
    const reason = personalFacetDeadlineReason(clock.elapsedMs, performance.now() - started, timeoutMs);
    if (reason) { clearInterval(timer); onTimeout(reason); }
  }, 500);
  return () => clearInterval(timer);
}
