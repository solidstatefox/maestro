/** Shared across Next.js API route modules in the same Node.js process.
 * Counts are low-priority and use at most one of two active slots per graph
 * server, leaving room for interactive browsing requests.
 */
import { scheduleMaestroQuery, type QueryPriority } from "./graph-server-query-scheduler";

export function withGraphServerSlot<T>(
  endpoint: string,
  priority: QueryPriority,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  return scheduleMaestroQuery(endpoint, priority, signal, run);
}
