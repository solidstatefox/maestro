/** Server-side priority scheduler; slots are granted before emitting dispatch events.
 * Per-browser quotas are looked up using the server-issued client cookie.
 * Server-wide ceiling protects multi-client traffic in this Node process.
 */
import { currentProxyClient, getProxyClientPreferences } from "./maestro-proxy-client-preferences";
export type QueryPriority = "interactive" | "facet" | "count";
export type QueryWeight = "light" | "heavy";
type Task = { priority: QueryPriority; weight: QueryWeight; client: string; order: number; start: () => void; cancel: () => void };
type ClientUsage = { total: number; heavy: number };
type ServerQueue = {
  active: number;
  pendingLight: Task[];
  pendingHeavy: Task[];
  clients: Map<string, ClientUsage>;
  // Alternate lanes for equal-priority jobs so neither lane monopolizes free slots.
  nextLane: QueryWeight;
};
const queues = new Map<string, ServerQueue>();
let sequence = 0;
const SERVER_SAFETY_CEILING = 24;
const ranks: Record<QueryPriority, number> = { interactive: 0, facet: 1, count: 2 };
function canDispatch(queue: ServerQueue, task: Task): boolean {
  const preference = getProxyClientPreferences(task.client);
  const usage = queue.clients.get(task.client) ?? { total: 0, heavy: 0 };
  return usage.total < preference.lightPerServer &&
    (task.weight === "light" || usage.heavy < preference.heavyPerServer);
}

/** Two independent FIFO/priority queues, with a shared total server ceiling.
 * A saturated heavy quota cannot hold up eligible light work (and vice versa).
 * Among eligible jobs, preserve interactive priority, then alternate lanes at
 * equal priority to avoid one class monopolizing all newly available slots.
 */
function drain(server: string, queue: ServerQueue): void {
  const byPriority = (a: Task, b: Task) => ranks[a.priority] - ranks[b.priority] || a.order - b.order;
  queue.pendingLight.sort(byPriority);
  queue.pendingHeavy.sort(byPriority);
  while (queue.active < SERVER_SAFETY_CEILING) {
    const lightIndex = queue.pendingLight.findIndex(task => canDispatch(queue, task));
    const heavyIndex = queue.pendingHeavy.findIndex(task => canDispatch(queue, task));
    if (lightIndex < 0 && heavyIndex < 0) break;
    let lane: QueryWeight;
    if (lightIndex < 0) lane = "heavy";
    else if (heavyIndex < 0) lane = "light";
    else {
      const light = queue.pendingLight[lightIndex];
      const heavy = queue.pendingHeavy[heavyIndex];
      const priorityDiff = ranks[light.priority] - ranks[heavy.priority];
      lane = priorityDiff < 0 ? "light" : priorityDiff > 0 ? "heavy" : queue.nextLane;
    }
    const list = lane === "light" ? queue.pendingLight : queue.pendingHeavy;
    const index = lane === "light" ? lightIndex : heavyIndex;
    const [task] = list.splice(index, 1);
    const usage = queue.clients.get(task.client) ?? { total: 0, heavy: 0 };
    usage.total++;
    if (lane === "heavy") usage.heavy++;
    queue.clients.set(task.client, usage);
    queue.active++;
    queue.nextLane = lane === "light" ? "heavy" : "light";
    task.start();
  }
  if (!queue.active && !queue.pendingLight.length && !queue.pendingHeavy.length) queues.delete(server);
}
export function classifyMaestroRequest(url: string, headers: Headers, body: string): QueryPriority | null {
  if (!/\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) return null;
  if (body.includes('"selectEndpointUrl"') || body.includes('"selectEndpointId"') || body.includes('"health"') || url.includes("health=1")) return null;
  const source = `${headers.get("x-maestro-debug-source") ?? ""} ${headers.get("x-maestro-debug-component") ?? ""}`.toLowerCase();
  if (/alphabet-letter-count|distinct-count|count-sparql|results-total-count|facet-value-count|query-count|subject-count|history-query-count|bookmark-history-query-count/.test(source) ||
      /"facetValueCount"\s*:/.test(body) || /"countOnly"\s*:\s*true/.test(body) || /<view\b[^>]*type=["']alphabet["']/.test(body)) return "count";
  if (/results|groupby|group-by|record|analyze|view-results/.test(source)) return "interactive";
  return "facet";
}
/** Conservative query-cost heuristic: counts, aggregation, sorting, and regex are heavy. */
export function weightMaestroQuery(query: string, priority: QueryPriority): QueryWeight {
  return priority === "count" || /\b(?:GROUP\s+BY|ORDER\s+BY|COUNT\s*\(|REGEX\s*\(|SAMPLE\s*\(|DISTINCT\b|SERVICE\b)/i.test(query)
    ? "heavy" : "light";
}
export function graphServerForRequest(body: string): string {
  try { const parsed = JSON.parse(body) as { queryXml?: string; facetValueCount?: { addr?: string } };
    if (typeof parsed.facetValueCount?.addr === "string") return graphServerFromAddr(parsed.facetValueCount.addr);
    if (typeof parsed.queryXml === "string") body = parsed.queryXml;
  } catch { /* XML request */ }
  return graphServerFromAddr(body.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "");
}
function graphServerFromAddr(addr: string): string {
  const at = addr.indexOf("@");
  return at >= 0 ? addr.slice(at + 1).trim() || "unspecified" : "unspecified";
}
export async function scheduleMaestroQuery<T>(server: string, priority: QueryPriority, signal: AbortSignal | undefined, work: () => Promise<T>, weight: QueryWeight = priority === "count" ? "heavy" : "light"): Promise<T> {
  if (signal?.aborted) throw new DOMException("Maestro request canceled", "AbortError");
  const client = currentProxyClient();
  const queue: ServerQueue = queues.get(server) ?? { active: 0, pendingLight: [], pendingHeavy: [], clients: new Map<string, ClientUsage>(), nextLane: "light" };
  queues.set(server, queue);
  return new Promise<T>((resolve, reject) => {
    let running = false, finished = false;
    const onAbort = () => {
      if (running || finished) return;
      finished = true;
      const pending = weight === "heavy" ? queue.pendingHeavy : queue.pendingLight;
      const index = pending.indexOf(task);
      if (index >= 0) pending.splice(index, 1);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Maestro request canceled", "AbortError"));
      drain(server, queue);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      queue.active--;
      const usage = queue.clients.get(client);
      if (usage) { usage.total--; if (weight === "heavy") usage.heavy--; if (!usage.total) queue.clients.delete(client); }
      drain(server, queue);
    };
    const task: Task = { priority, weight, client, order: sequence++, cancel: onAbort, start: () => {
      running = true;
      if (signal?.aborted) { finish(); reject(new DOMException("Maestro request canceled", "AbortError")); return; }
      void work().then(resolve, reject).finally(finish);
    } };
    signal?.addEventListener("abort", onAbort, { once: true });
    (weight === "heavy" ? queue.pendingHeavy : queue.pendingLight).push(task);
    drain(server, queue);
  });
}

/** Reconsider pending work immediately when a client changes its quota. */
export function rescheduleMaestroQueries(): void {
  for (const [server, queue] of queues) drain(server, queue);
}
