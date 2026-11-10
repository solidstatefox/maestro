import { beginMaestroQueryExecution, type MaestroQueryClockScope } from "./maestro-query-execution-clock";

/** Streaming response adapter: preserve the ordinary Response contract for callers. */
export async function unwrapMaestroQueryEvents(response: Response, scope: MaestroQueryClockScope | null, signal?: AbortSignal | null): Promise<Response> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) return response;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing Maestro query event stream");
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: Response | null = null;
  const running = new Map<number, (elapsedMs?: number) => void>();
  const pendingCompletion = new Set<number>();
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Query canceled", "AbortError");
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary).replace(/\r/g, "");
        buffer = buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const dataText = /^data: (.+)$/m.exec(frame)?.[1];
        if (!event || !dataText) continue;
        const data = JSON.parse(dataText) as { queryId?: number; elapsedMs?: number; status?: number; statusText?: string; headers?: [string,string][]; body?: string };
        if (event === "dispatched" && typeof data.queryId === "number" && scope) {
          if (pendingCompletion.delete(data.queryId)) continue;
          running.set(data.queryId, beginMaestroQueryExecution(scope));
        } else if (event === "completed" && typeof data.queryId === "number") {
          const finish = running.get(data.queryId);
          if (finish) { finish(data.elapsedMs); running.delete(data.queryId); }
          else pendingCompletion.add(data.queryId);
        } else if (event === "result") {
          if (typeof data.status !== "number" || typeof data.body !== "string") throw new Error("Malformed proxy result frame");
          finalResponse = new Response(data.body, { status: data.status, statusText: data.statusText,
            headers: new Headers(data.headers ?? []) });
        }
      }
      if (done) break;
    }
    if (!finalResponse) throw new Error("Proxy query stream ended without a result");
    return finalResponse;
  } finally {
    for (const finish of running.values()) finish();
    reader.releaseLock();
  }
}
