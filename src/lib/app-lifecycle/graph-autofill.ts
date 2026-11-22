/** Auto-fill is advisory: a failed graph lookup must never make a healthy
 * graph server unusable. A pending lookup must never hold the first query:
 * a discovered graph is applied through the regular query-identity transition. */
export type GraphAutoFillProbeState = "empty" | "running" | "no-graph" | "error";

export type GraphAutoFillReadiness = Readonly<{
  enabled: boolean;
  graphSelected: boolean;
  graphFieldEditing: boolean;
  queryIdentity: string;
  probeIdentity: string;
  probeState: GraphAutoFillProbeState;
}>;

export function graphAutoFillAllowsQuery(facts: GraphAutoFillReadiness): boolean {
  if (!facts.enabled || facts.graphSelected || facts.graphFieldEditing) return true;
  // Graph enumeration is optional enrichment. It may scope a *future* query,
  // but it must never gate an otherwise valid FCT query while a preflight is
  // queued, stalled, cancelled, or waiting for an unavailable graph server.
  // Query identity changes caused by a discovered graph already invalidate the
  // original request through the normal FCT navigation pipeline.
  return true;
}
