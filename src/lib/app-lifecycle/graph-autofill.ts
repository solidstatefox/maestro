/** Auto-fill is advisory: a failed graph lookup must never make a healthy
 * graph server unusable. A pending lookup may hold the first query briefly to
 * allow the chosen graph to become the authoritative FCT address. */
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
  // Only the current query's probe can release its execution barrier.
  if (facts.probeIdentity !== facts.queryIdentity) return false;
  // A timeout or unsupported graph lookup is not a failure of the live query.
  return facts.probeState === "no-graph" || facts.probeState === "error";
}
