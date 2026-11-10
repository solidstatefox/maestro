import { scheduleMaestroQuery, type QueryPriority, type QueryWeight } from "./graph-server-query-scheduler";
export function withGraphServerSlot<T>(endpoint: string, priority: QueryPriority, signal: AbortSignal | undefined, run: () => Promise<T>, weight?: QueryWeight): Promise<T> {
  return scheduleMaestroQuery(endpoint, priority, signal, run, weight);
}
