import { beginMaestroQueryExecution, type MaestroQueryClockScope } from "./maestro-query-execution-clock";

export type MaestroQueryEventsSubscription = { close: () => void };
type QueuePositionListener = (index: number, server: string, lane?: "light" | "heavy", laneIndex?: number, laneNumber?: number, lanePosition?: number) => void;
type TelemetryEvent = { requestId?: string; queryId?: number; queueIndex?: number; server?: string;
  lane?: "light" | "heavy"; laneIndex?: number; laneNumber?: number; lanePosition?: number; elapsedMs?: number };
type Subscriber = {
  scope: MaestroQueryClockScope | null;
  componentScope: MaestroQueryClockScope | null;
  onQueuePosition?: QueuePositionListener;
  running: Map<number, Array<(elapsedMs?: number) => void>>;
  completedBeforeDispatch: Set<number>;
  signal?: AbortSignal | null;
  onAbort?: () => void;
  closed: boolean;
  finished: boolean;
  drainTimer?: ReturnType<typeof setTimeout>;
};
type SharedStream = {
  id: string;
  controller: AbortController;
  listeners: Map<string, Subscriber>;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (reason: unknown) => void;
  opened: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
  handshakeTimer?: ReturnType<typeof setTimeout>;
};

// One HTTP/1.1 SSE connection per browser tab, never one per FCT/SPARQL query.
// Query IDs still identify independent clocks, queue positions and cancellation.
const IDLE_CLOSE_MS = 3000;
const HANDSHAKE_MS = 1500;
let sharedStream: SharedStream | null = null;

function finishSubscriber(listener: Subscriber): void {
  for (const finish of listener.running.values()) for (const complete of finish) complete();
  listener.running.clear();
  listener.completedBeforeDispatch.clear();
}
function closeSubscriber(stream: SharedStream, requestId: string, listener: Subscriber): void {
  if (listener.closed) return;
  listener.closed = true;
  clearTimeout(listener.drainTimer);
  listener.signal?.removeEventListener("abort", listener.onAbort!);
  stream.listeners.delete(requestId);
  finishSubscriber(listener);
  // A brief idle grace period reuses the same stream across sequential facets
  // without keeping a connection open for the lifetime of an idle tab.
  if (stream.listeners.size === 0 && !stream.controller.signal.aborted) {
    stream.idleTimer = setTimeout(() => stream.controller.abort(), IDLE_CLOSE_MS);
  }
}
function dispatchTelemetry(stream: SharedStream, event: string, data: TelemetryEvent): void {
  if (event === "ready") {
    if (!stream.opened) {
      stream.opened = true;
      clearTimeout(stream.handshakeTimer);
      stream.resolveReady();
    }
    return;
  }
  // Current proxy frames always carry requestId. Tolerate legacy frames only
  // when exactly one query is subscribed; never guess across concurrent jobs.
  const requestId = typeof data.requestId === "string" ? data.requestId
    : stream.listeners.size === 1 ? stream.listeners.keys().next().value : undefined;
  if (!requestId) return;
  const listener = stream.listeners.get(requestId);
  if (!listener || listener.closed) return;
  if (event === "queue-position" && Number.isSafeInteger(data.queueIndex) && (data.queueIndex ?? -1) >= 0) {
    listener.onQueuePosition?.(data.queueIndex!, typeof data.server === "string" ? data.server : "",
      data.lane === "light" || data.lane === "heavy" ? data.lane : undefined,
      Number.isInteger(data.laneIndex) && (data.laneIndex ?? -1) >= 0 ? data.laneIndex : undefined,
      Number.isInteger(data.laneNumber) && (data.laneNumber ?? 0) > 0 ? data.laneNumber : undefined,
      Number.isInteger(data.lanePosition) && (data.lanePosition ?? 0) > 0 ? data.lanePosition : undefined);
  } else if (event === "dispatched" && Number.isInteger(data.queryId)) {
    if (!listener.completedBeforeDispatch.delete(data.queryId!)) {
      const { scope, componentScope } = listener;
      const clocks: Array<(elapsedMs?: number) => void> = [];
      if (scope) clocks.push(beginMaestroQueryExecution(scope));
      if (componentScope && componentScope !== scope) clocks.push(beginMaestroQueryExecution(componentScope));
      if (clocks.length) listener.running.set(data.queryId!, clocks);
    }
  } else if (event === "completed" && Number.isInteger(data.queryId)) {
    const finish = listener.running.get(data.queryId!);
    if (finish) {
      for (const complete of finish) complete(data.elapsedMs);
      listener.running.delete(data.queryId!);
    } else listener.completedBeforeDispatch.add(data.queryId!);
  } else if (event === "finished") {
    // The result POST and SSE have independent delivery order. Retain the
    // subscriber until its server-side completion marker arrives, then release
    // only that request, never the tab's shared connection.
    listener.finished = true;
    closeSubscriber(stream, requestId, listener);
  }
}
function openSharedStream(id: string): SharedStream {
  let resolveReady!: () => void;
  let rejectReady!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const stream: SharedStream = {
    id, controller: new AbortController(), listeners: new Map(),
    ready, resolveReady, rejectReady, opened: false,
  };
  sharedStream = stream;
  // A hard deadline must settle the handshake even if fetch ignores abort.
  // No query should wait indefinitely for optional telemetry.
  stream.handshakeTimer = setTimeout(() => {
    if (!stream.opened) stream.rejectReady(new Error("Telemetry handshake timed out"));
    stream.controller.abort();
    if (sharedStream === stream) sharedStream = null;
  }, HANDSHAKE_MS);
  void (async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch("/proxy/api/service", {
        method: "POST", cache: "no-store", signal: stream.controller.signal,
        credentials: "same-origin",
        headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
        body: JSON.stringify({ service: "maestroTransport", operationId: "subscribeQueryEvents", parameters: { id: stream.id } }),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body)
        throw new Error(`Telemetry subscription returned HTTP ${response.status}`);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replace(/\r\n/g, "\n");
        if (done) buffer = buffer.replace(/\r/g, "\n");
        if (buffer.length > 128_000) throw new Error("Telemetry frame exceeded limit");
        let boundary = -1;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event:[ \t]*(.+)$/m.exec(frame)?.[1]?.trim();
          const dataText = frame.split("\n").filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).replace(/^[ \t]/, "")).join("\n");
          if (!event || !dataText) continue;
          let payload: unknown;
          try { payload = JSON.parse(dataText); } catch { continue; }
          if (!payload || typeof payload !== "object") continue;
          dispatchTelemetry(stream, event, payload as TelemetryEvent);
        }
        if (done) return;
      }
    } catch (error) {
      if (!stream.opened) stream.rejectReady(error);
    } finally {
      clearTimeout(stream.handshakeTimer);
      clearTimeout(stream.idleTimer);
      if (!stream.opened) stream.rejectReady(new Error("Telemetry stream closed before ready"));
      for (const listener of stream.listeners.values()) finishSubscriber(listener);
      // A dead connection must never be reused by new queries.
      if (sharedStream === stream) sharedStream = null;
      try { reader?.releaseLock(); } catch { /* aborted stream */ }
      stream.controller.abort();
    }
  })();
  return stream;
}

/** Register one request against the tab's shared OpenAPI SSE subscription.
 * The ready handshake precedes the native query POST, without allocating one
 * extra browser connection per query. Telemetry is optional on failure.
 */
export function subscribeMaestroQueryEvents(
  id: string,
  scope: MaestroQueryClockScope | null,
  signal?: AbortSignal | null,
  onQueuePosition?: QueuePositionListener,
  componentScope?: MaestroQueryClockScope | null,
): Promise<MaestroQueryEventsSubscription & { streamId: string }> {
  if (signal?.aborted) return Promise.reject(new DOMException("Query canceled", "AbortError"));
  const stream = sharedStream && !sharedStream.controller.signal.aborted ? sharedStream : openSharedStream(id);
  clearTimeout(stream.idleTimer);
  const listener: Subscriber = { scope, componentScope: componentScope ?? null, onQueuePosition,
    running: new Map(), completedBeforeDispatch: new Set(), signal, closed: false, finished: false };
  stream.listeners.set(id, listener);
  return new Promise((resolve, reject) => {
    let settled = false;
    const close = () => {
      if (listener.closed) return;
      if (signal?.aborted || !stream.opened || listener.finished) {
        closeSubscriber(stream, id, listener);
      } else if (!listener.drainTimer) {
        // Result delivery can beat the independent SSE completion frame.
        // Keep clocks alive briefly, but never leak a missing completion.
        listener.drainTimer = setTimeout(() => closeSubscriber(stream, id, listener), 500);
      }
    };
    const onAbort = () => {
      if (!settled) { settled = true; reject(new DOMException("Query canceled", "AbortError")); }
      closeSubscriber(stream, id, listener);
    };
    listener.onAbort = onAbort;
    signal?.addEventListener("abort", onAbort, { once: true });
    // The signal may abort between the initial check and registration.
    if (signal?.aborted) { onAbort(); return; }
    stream.ready.then(() => {
      if (!settled) { settled = true; resolve({ close, streamId: stream.id }); }
    }, error => {
      if (!settled) { settled = true; reject(error); }
      close();
    });
  });
}
