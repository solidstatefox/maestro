/**
 * Normalize lexical values used by Maestro's supported FCT <value> constraints.
 *
 * FCT value constraints are interpreted as trimmed values throughout Maestro,
 * regardless of whether they are compiled from the live query tree or parsed
 * from XML. Keep this policy in one place so Results, counts, and the proxy
 * translator generate equivalent literal terms.
 */
export function normalizeFctValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
