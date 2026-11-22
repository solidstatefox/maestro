/** Server-side priority scheduler; slots are granted before emitting dispatch events.
 * Per-browser quotas are looked up using the server-issued client cookie.
 * Server-wide ceiling protects multi-client traffic in this Node process.
 */
import { currentProxyClient, getProxyClientPreferences } from "./maestro-proxy-client-preferences";
import { proxyQueuePositionNotifier } from "./proxy-query-events";
export type QueryPriority = "autocomplete" | "interactive" | "facet" | "count";
export type QueryWeight = "light" | "heavy";
type Task = { priority: QueryPriority; weight: QueryWeight; client: string; order: number;
  start: () => void; cancel: () => void;
  queuePosition?: (index: number, server: string, lane: QueryWeight, laneIndex: number, laneNumber: number, lanePosition: number) => void;
  lastQueuePosition: number; lastLaneIndex: number; lastLaneNumber: number; lastLanePosition: number;
};
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
const ranks: Record<QueryPriority, number> = { autocomplete: -1, interactive: 0, facet: 1, count: 2 };
/** Compute queue indexes from the SAME server-side heavy/light scheduler that
 * dispatches the tasks. Merge equal-priority lanes using its alternation
 * rule; do not number the two physical arrays independently. Endpoint queue
 * projections are subsequently merged into one unique pending ordinal. */
function projectedQueueOrder(queue: ServerQueue): Task[] {
  const byPriority = (a: Task, b: Task) => ranks[a.priority] - ranks[b.priority] || a.order - b.order;
  const light = [...queue.pendingLight].sort(byPriority);
  const heavy = [...queue.pendingHeavy].sort(byPriority);
  let lane = queue.nextLane;
  const ordered: Task[] = [];
  while (light.length || heavy.length) {
    // Prefer the first currently dispatchable task, exactly as drain does.
    // Once all remaining tasks are quota-blocked, their relative future
    // readiness is unknowable; retain priority/FIFO, never pretend an
    // ineligible heavy job is running.
    const li = light.findIndex(task => canDispatch(queue, task));
    const hi = heavy.findIndex(task => canDispatch(queue, task));
    const l = li >= 0 ? li : light.length ? 0 : -1;
    const h = hi >= 0 ? hi : heavy.length ? 0 : -1;
    const choose: QueryWeight = l < 0 ? "heavy" : h < 0 ? "light"
      : li < 0 && hi >= 0 ? "heavy" : hi < 0 && li >= 0 ? "light"
      : ranks[light[l].priority] < ranks[heavy[h].priority] ? "light"
      : ranks[light[l].priority] > ranks[heavy[h].priority] ? "heavy" : lane;
    const item = choose === "light" ? light.splice(l, 1)[0] : heavy.splice(h, 1)[0];
    ordered.push(item);
    lane = choose === "light" ? "heavy" : "light";
  }
  return ordered;
}
function reportQueuePositions(): void {
  // Per-endpoint queues can dispatch concurrently. Produce one unique
  // proxy-wide waiting ordinal while preserving every endpoint's internal
  // heavy/light order; equal projected positions tie-break by enqueue order.
  // The ordinal describes current waiting work, not a guarantee about which
  // independently available endpoint will complete first.
  const all = [...queues.entries()].flatMap(([server, queue]) =>
    projectedQueueOrder(queue).map((task, localIndex) => ({ task, server, localIndex })));
  all.sort((a, b) => a.localIndex - b.localIndex || a.task.order - b.task.order);
  all.forEach(({ task, server }, i) => {
    const index = i + 1;
    const queue = queues.get(server)!;
    const lane = task.weight;
    const orderedLane = [...(lane === "light" ? queue.pendingLight : queue.pendingHeavy)]
      .sort((a,b) => ranks[a.priority] - ranks[b.priority] || a.order - b.order);
    const laneIndex = orderedLane.indexOf(task) + 1;
    // Sheet controls concurrent request quotas, not fixed worker identities.
    // Assign a deterministic *projected* numbered lane for each client's
    // waiting work, distributed round-robin across its configured quota.
    // This is a waiting-queue address, not a claim about a running socket.
    const clientLaneIndex = orderedLane.filter(item => item.client === task.client).indexOf(task) + 1;
    const preference = getProxyClientPreferences(task.client);
    const laneCount = Math.max(1, lane === "heavy" ? preference.heavyPerServer : preference.lightPerServer);
    const laneNumber = (clientLaneIndex - 1) % laneCount + 1;
    const lanePosition = Math.floor((clientLaneIndex - 1) / laneCount) + 1;
    if (index !== task.lastQueuePosition || task.lastLaneIndex !== laneIndex ||
        task.lastLaneNumber !== laneNumber || task.lastLanePosition !== lanePosition) {
      task.lastQueuePosition = index;
      task.lastLaneIndex = laneIndex;
      task.lastLaneNumber = laneNumber;
      task.lastLanePosition = lanePosition;
      task.queuePosition?.(index, server, lane, laneIndex, laneNumber, lanePosition);
    }
  });
}

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
    if (task.lastQueuePosition !== 0) {
      task.lastQueuePosition = 0;
      task.queuePosition?.(0, server, task.weight, 0, 0, 0);
    }
    reportQueuePositions();
    const usage = queue.clients.get(task.client) ?? { total: 0, heavy: 0 };
    usage.total++;
    if (lane === "heavy") usage.heavy++;
    queue.clients.set(task.client, usage);
    queue.active++;
    queue.nextLane = lane === "light" ? "heavy" : "light";
    task.start();
  }
  if (!queue.active && !queue.pendingLight.length && !queue.pendingHeavy.length) queues.delete(server);
  reportQueuePositions();
}
export function classifyMaestroRequest(url: string, headers: Headers, body: string): QueryPriority | null {
  if (!/\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) return null;
  if (body.includes('"requestClass":"autocomplete"')) return "autocomplete";
  if (body.includes('"selectEndpointUrl"') || body.includes('"selectEndpointId"') || body.includes('"health"') || url.includes("health=1")) return null;
  const source = `${headers.get("x-maestro-debug-source") ?? ""} ${headers.get("x-maestro-debug-component") ?? ""}`.toLowerCase();
  if (/alphabet-letter-count|distinct-count|count-sparql|results-total-count|facet-value-count|query-count|subject-count|history-query-count|bookmark-history-query-count/.test(source) ||
      /"facetValueCount"\s*:/.test(body) || /"countOnly"\s*:\s*true/.test(body) || /<view\b[^>]*type=["'](?:alphabet|count-distinct)["']/.test(body)) return "count";
  if (/results|groupby|group-by|record|analyze|view-results/.test(source)) return "interactive";
  return "facet";
}
/** Conservative query-cost heuristic: counts, aggregation, sorting, and regex are heavy. */
export function weightMaestroQuery(query: string, priority: QueryPriority): QueryWeight {
  // Bounded autocomplete lookups are always light, including SELECT DISTINCT.
  // A saturated heavy lane must not block the highest-priority request.
  if (priority === "autocomplete") return "light";
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
      reportQueuePositions();
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
    const task: Task = { priority, weight, client, order: sequence++, cancel: onAbort,
      queuePosition: proxyQueuePositionNotifier(), lastQueuePosition: -1, lastLaneIndex: -1, lastLaneNumber: -1, lastLanePosition: -1, start: () => {
      running = true;
      if (signal?.aborted) { finish(); reject(new DOMException("Maestro request canceled", "AbortError")); return; }
      void work().then(resolve, reject).finally(finish);
    } };
    signal?.addEventListener("abort", onAbort, { once: true });
    (weight === "heavy" ? queue.pendingHeavy : queue.pendingLight).push(task);
    reportQueuePositions();
    drain(server, queue);
  });
}

/** Reconsider pending work immediately when a client changes its quota. */
export function rescheduleMaestroQueries(): void {
  for (const [server, queue] of queues) drain(server, queue);
}
