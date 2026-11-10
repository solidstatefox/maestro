/** Opt-in POST event stream. Final result retains original HTTP status and headers
 * inside the terminal result frame; the stream envelope is never cacheable.
 */
import { withProxyQueryEventSink } from "./proxy-query-events";
export const MAESTRO_EVENT_HEADER = "x-maestro-query-events";

export function streamProxyQuery(request: Request, execute: () => Promise<Response>): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: string, data: unknown) => {
        if (closed || request.signal.aborted) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; }
      };
      const abort = () => { if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } } };
      request.signal.addEventListener("abort", abort, { once: true });
      push("queued", {});
      void withProxyQueryEventSink((event, data) => push(event, data), execute)
        .then(async response => {
          const body = await response.text();
          push("result", { status: response.status, statusText: response.statusText, headers: [...response.headers.entries()], body });
        })
        .catch(error => {
          push("result", { status: 502, statusText: "Bad Gateway", headers: [["content-type", "application/json"]],
            body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) });
        })
        .finally(() => { request.signal.removeEventListener("abort", abort); if (!closed) { closed = true; controller.close(); } });
    },
  });
  return new Response(stream, { status: 200, headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
