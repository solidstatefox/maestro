/** Server-side, request-correlated push channel for proxy queue and dispatch telemetry.
 * The /fct and /sparql HTTP bodies are never modified by this channel.
 * One channel is shared by a browser tab; request UUIDs multiplex its events.
 * Channels are ephemeral, memory-bounded and identified by unpredictable client UUIDs.
 */
import { withProxyQueryEventSink } from "./proxy-query-events";

export const MAESTRO_TELEMETRY_ID_HEADER = "x-maestro-telemetry-id";
export const MAESTRO_TELEMETRY_STREAM_HEADER = "x-maestro-telemetry-stream-id";
const MAX_CHANNELS = 256;
const CHANNEL_LIFETIME_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 20000;
type TelemetryChannel = { push: (event: string, payload: unknown) => void; finish: () => void };
const channels = new Map<string, TelemetryChannel>();
const validId = (id: string) => /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(id);

export function openProxyQueryTelemetry(request: Request, explicitId?: string): Response {
  const id = explicitId ?? (new URL(request.url).searchParams.get("id") ?? "");
  if (!validId(id)) return new Response("Invalid query telemetry id", { status: 400 });
  if (channels.has(id)) return new Response("Query telemetry already connected", { status: 409 });
  if (channels.size >= MAX_CHANNELS) return new Response("Too many query telemetry streams", { status: 429 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval>;
      let expiry: ReturnType<typeof setTimeout>;
      const onAbort = () => finish();
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(expiry);
        request.signal.removeEventListener("abort", onAbort);
        channels.delete(id);
        try { controller.close(); } catch { /* Stream already cancelled. */ }
      };
      const write = (message: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(message)); } catch { finish(); }
      };
      const push = (event: string, payload: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      channels.set(id, { push, finish });
      request.signal.addEventListener("abort", onAbort, { once: true });
      heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);
      expiry = setTimeout(finish, CHANNEL_LIFETIME_MS);
      // Sent only after the channel is registered, so the client can await a
      // real subscription handshake before dispatching its FCT/SPARQL POST.
      push("ready", {});
    },
    cancel() { channels.get(id)?.finish(); },
  });
  return new Response(stream, { status: 200, headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}

/** Publish only to the exact request's subscribed channel; no shared broadcast. */
export async function withProxyQueryTelemetry<T>(request: Request, execute: () => Promise<T>): Promise<T> {
  const requestId = request.headers.get(MAESTRO_TELEMETRY_ID_HEADER) ?? "";
  const explicitStreamId = request.headers.get(MAESTRO_TELEMETRY_STREAM_HEADER) ?? "";
  // Existing request-only clients still work during a rolling reload, but the
  // current browser always supplies a distinct, tab-shared stream ID.
  const streamId = explicitStreamId || requestId;
  if (!validId(requestId) || !validId(streamId)) return execute();
  const channel = channels.get(streamId);
  if (!channel) return execute();
  channel.push("queued", { requestId });
  try {
    return await withProxyQueryEventSink((event, data) =>
      channel.push(event, { ...data, requestId }), execute);
  } finally {
    channel.push("finished", { requestId });
    // Only legacy request-scoped streams finish with the query. Multiplexed
    // streams remain available for other queries until the tab goes idle.
    if (!explicitStreamId) channel.finish();
  }
}
