/**
 * Coordinates browser-originated data requests across Maestro widgets.
 * The per-server foreground lane remains available while a background count runs.
 * Requests waiting in the queue can be aborted without reaching the graph server.
 * No retry is performed: cancellation and endpoint errors remain visible to callers.
 */
export type QueryPriority = "interactive" | "facet" | "count";

type Task = {
  priority: QueryPriority;
  order: number;
  start: () => void;
  cancel: () => void;
};

type ServerQueue = { active: number; background: number; pending: Task[] };
const queues = new Map<string, ServerQueue>();
let sequence = 0;
const TOTAL_LIMIT = 2;
const COUNT_LIMIT = 1;
const ranks: Record<QueryPriority, number> = { interactive: 0, facet: 1, count: 2 };

function drain(server: string, queue: ServerQueue) {
  queue.pending.sort((a, b) => ranks[a.priority] - ranks[b.priority] || a.order - b.order);
  while (queue.active < TOTAL_LIMIT) {
    const index = queue.pending.findIndex((task) => task.priority !== "count" || queue.background < COUNT_LIMIT);
    if (index < 0) break;
    const [task] = queue.pending.splice(index, 1);
    queue.active += 1;
    if (task.priority === "count") queue.background += 1;
    task.start();
  }
  if (!queue.active && !queue.pending.length) queues.delete(server);
}

export function classifyMaestroRequest(url: string, headers: Headers, body: string): QueryPriority | null {
  if (!/\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) return null;
  if ((body.includes('"selectEndpointUrl"') || body.includes('"selectEndpointId"') || body.includes('"health"')) || url.includes("health=1")) return null;
  const source = `${headers.get("x-maestro-debug-source") ?? ""} ${headers.get("x-maestro-debug-component") ?? ""}`.toLowerCase();
  if (/alphabet-letter-count|distinct-count|count-sparql|results-total-count|facet-value-count|query-count|subject-count|history-query-count|bookmark-history-query-count/.test(source) ||
      /"facetValueCount"\s*:/.test(body) || /"countOnly"\s*:\s*true/.test(body) || /<view\b[^>]*type=["']alphabet["']/.test(body)) return "count";
  if (/results|groupby|group-by|record|analyze|view-results/.test(source)) return "interactive";
  return "facet";
}

/** Resolve the authoritative server, never an old selected-server cookie. */
export function graphServerForRequest(body: string): string {
  try {
    const parsed = JSON.parse(body) as { queryXml?: string; facetValueCount?: { addr?: string } };
    if (typeof parsed.facetValueCount?.addr === "string") return graphServerFromAddr(parsed.facetValueCount.addr);
    if (typeof parsed.queryXml === "string") body = parsed.queryXml;
  } catch { /* FCT XML request */ }
  const addr = body.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
  return graphServerFromAddr(addr);
}
function graphServerFromAddr(addr: string): string {
  const at = addr.indexOf("@");
  return at >= 0 ? addr.slice(at + 1).trim() || "unspecified" : "unspecified";
}

export async function scheduleMaestroQuery<T>(
  server: string, priority: QueryPriority, signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw new DOMException("Maestro request canceled", "AbortError");
  const queue = queues.get(server) ?? { active: 0, background: 0, pending: [] };
  queues.set(server, queue);
  return new Promise<T>((resolve, reject) => {
    let running = false;
    let finished = false;
    const onAbort = () => {
      if (running || finished) return;
      finished = true;
      queue.pending.splice(queue.pending.indexOf(task), 1);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Maestro request canceled", "AbortError"));
      drain(server, queue);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      queue.active -= 1;
      if (priority === "count") queue.background -= 1;
      drain(server, queue);
    };
    const task: Task = {
      priority, order: sequence++, cancel: onAbort,
      start: () => {
        running = true;
        if (signal?.aborted) { finish(); reject(new DOMException("Maestro request canceled", "AbortError")); return; }
        void work().then(resolve, reject).finally(finish);
      },
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    queue.pending.push(task);
    drain(server, queue);
  });
}
