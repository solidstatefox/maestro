/** One request-scoped notification sink; survives await and proxy scheduler queueing. */
import { AsyncLocalStorage } from "node:async_hooks";

type Sink = (event: "dispatched" | "completed" | "queue-position", data: {
  queryId: number; elapsedMs?: number; queueIndex?: number; server?: string; lane?: "light" | "heavy"; laneIndex?: number;
}) => void;
const storage = new AsyncLocalStorage<{ sink: Sink; sequence: number }>();

export function withProxyQueryEventSink<T>(sink: Sink, run: () => Promise<T>): Promise<T> {
  return storage.run({ sink, sequence: 0 }, run);
}

/** Called inside the proxy scheduler's granted slot, never when enqueuing. */
export async function traceVirtuosoDispatch<T>(work: () => Promise<T>): Promise<T> {
  const context = storage.getStore();
  if (!context) return work();
  const queryId = ++context.sequence;
  const started = performance.now();
  context.sink("dispatched", { queryId });
  try { return await work(); }
  finally { context.sink("completed", { queryId, elapsedMs: Math.max(0, performance.now() - started) }); }
}

/** Capture the existing SSE request sink at scheduler enqueue time. A queued
 * task may move between lanes as quotas change; send its current server-side
 * position on each real scheduler reorder. No new endpoint or polling. */
export function proxyQueuePositionNotifier(): ((index: number, server: string, lane: "light" | "heavy", laneIndex: number) => void) | undefined {
  const context = storage.getStore();
  if (!context) return undefined;
  return (index, server, lane, laneIndex) => context.sink("queue-position", { queryId: 0, queueIndex: index, server, lane, laneIndex });
}
