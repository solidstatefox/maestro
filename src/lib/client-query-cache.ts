import { inheritQueryQueueObservation, observeAdmittedQuery } from "./query-queue-observation";
import { actorQueryAllowed, getActorQueryAuthority, type QueryActorOwner } from "./app-lifecycle/actor-query-authority";
import { observeProxyFetch, stopProxyQueryGeneration, resumeProxyQueryGeneration } from "@/lib/proxy-transport-observation";
import { requireSparqlAttribution } from "@/lib/sparql-request-attribution";
import { maestroOffstageError, type MaestroQueryScope, type MaestroQueryViewCoordinator } from "@/lib/app-lifecycle/query-view-ownership";
import { maestroLanguageHeader } from "./maestro-language";
import { readMaestroConcurrency } from "./maestro-concurrency";
import { maestroQueryClockScope } from "./maestro-query-execution-clock";
import { subscribeMaestroQueryEvents } from "./client-query-events";
import { setMaestroIncompleteResults } from "./maestro-incomplete-results";
import { resolveFctRequestTimeout, configuredTimeoutMs } from "./maestro-query-timeouts";
/**
 * Client-side query cache persisted to IndexedDB.
 * Duplicates proxy cache on the client to avoid eating network bandwidth,
 * while leaving proxy-side caching intact for fresh clients.
 */

const DB_NAME = "maestro-client-query-cache";
const DB_VERSION = 1;
const STORE_NAME = "fct-query-cache";

interface CachedResponseRecord {
  key: string;
  body: string;
  contentType: string;
  status: number;
  timestamp: number;
}

const memoryCache = new Map<string, CachedResponseRecord>();
// IndexedDB is the persistent cache. This Map is only a bounded hot-response tier.
const MEMORY_CACHE_MAX_ENTRIES = 256;
const CLIENT_CACHE_TTL_MS = 5 * 60_000;
const MEMORY_CACHE_MAX_BYTES = 16 * 1024 * 1024;
let memoryCacheBytes = 0;
function memoryRecordBytes(record: CachedResponseRecord): number {
  // JS strings can occupy up to two bytes per UTF-16 code unit.
  return 2 * (record.key.length + record.body.length + record.contentType.length) + 128;
}
function rememberMemoryResponse(key: string, record: CachedResponseRecord): void {
  const previous = memoryCache.get(key);
  if (previous) {
    memoryCacheBytes -= memoryRecordBytes(previous);
    memoryCache.delete(key);
  }
  const size = memoryRecordBytes(record);
  if (size > MEMORY_CACHE_MAX_BYTES) return;
  while (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES || memoryCacheBytes + size > MEMORY_CACHE_MAX_BYTES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    const removed = memoryCache.get(oldest);
    if (removed) memoryCacheBytes -= memoryRecordBytes(removed);
    memoryCache.delete(oldest);
  }
  memoryCache.set(key, record);
  memoryCacheBytes += size;
}
let dbPromise: Promise<IDBDatabase> | null = null;
// A blocked IndexedDB upgrade/open cannot prevent any FCT request from
// reaching the proxy. The cache is an optional accelerator, never a query gate.
const CLIENT_CACHE_OPEN_TIMEOUT_MS = 1200;
const CLIENT_CACHE_LOOKUP_TIMEOUT_MS = 400;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    let settled = false;
    let request: IDBOpenDBRequest;
    const deadline = setTimeout(() => finish(null, new Error("Query cache IndexedDB open timed out")), CLIENT_CACHE_OPEN_TIMEOUT_MS);
    const finish = (db: IDBDatabase | null, error?: Error) => {
      if (settled) {
        // A browser may complete an open after our deadline. Do not leak a
        // connection that could block another tab's database upgrade.
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(db!);
    };
    try {
      request = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      finish(null, error instanceof Error ? error : new Error("IndexedDB open failed"));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null, request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => finish(null, new Error("Query cache IndexedDB open blocked"));
  });
  dbPromise = attempt.catch((error: unknown) => {
    dbPromise = null; // an unavailable optional cache may be retried later
    throw error;
  });
  return dbPromise;
}

/** Bound cache preflight separately from the actual query execution deadline.
 * A slow/blocked IndexedDB read must fall through to the existing FCT proxy.
 * Late cache results are ignored and must never replace a newer query. */
function lookupCachedResponseWithDeadline(key: string, signal?: AbortSignal | null): Promise<Response | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const settle = (response: Response | null) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      resolve(response);
    };
    const onAbort = () => settle(null);
    const deadline = setTimeout(() => settle(null), CLIENT_CACHE_LOOKUP_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { settle(null); return; }
    void getClientCachedResponse(key).then(settle, () => settle(null));
  });
}

export function computeClientCacheKey(url: string, init?: RequestInit): string | null {
  const method = (init?.method ?? "GET").toUpperCase();
  if (new Headers(init?.headers).has("authorization")) return null;
  if (method === "GET") {
    // FCT endpoint lists depend on the user's Personal login and graph server
    // configuration. Never restore them from an old browser IndexedDB entry.
    // Health checks must also use fresh results.
    if (url.includes("/proxy/api/fct") || url.includes("health=1")) return null;
    return `GET::${url}`;
  }
  if (method === "POST") {
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    // Never put credentials or authenticated personal responses into the
    // generic public response cache. Personal snapshots have their own scope.
    if (headers.has("authorization") || /"personal(?:Read|Write)"\s*:\s*true/i.test(bodyStr) || /\/ods\/home\//i.test(bodyStr) || /"update"\s*:/i.test(bodyStr)) return null;
    // A reconstructed blank-node Record is a response-local candidate set.
    // Do not replay old response labels/parent evidence through the public cache.
    if (/"responseScope"\s*:\s*"request"/.test(bodyStr)) return null;
    // Endpoint selection mutation should not be cached
    if ((bodyStr.includes('"selectEndpointId"') || bodyStr.includes('"selectEndpointUrl"'))) return null;
    const language = new Headers(init?.headers).get("x-maestro-language") ?? "";
    // The FCT route now emits authoritative page labels for text and list
    // results. A new cache namespace avoids replaying pre-fix URI-only cards
    // from IndexedDB after logout/login (without clearing unrelated user data).
    // The counted LIST projection also changes FCT response semantics; do not
    // replay pre-fix grouped rows under the same XML cache key.
    const predicateTrace = url.includes("/proxy/api/fct") && /<(?:[\w.-]+:)?view\b[^>]*\btype\s*=\s*\\?["'](?:properties-rank|properties-cluster|clusters|properties-synset)\\?["']/i.test(bodyStr);
    const responseRevision = url.includes("/proxy/api/fct") ? "fct-labels-v4::anytime-v1::counted-population-v1::" + (predicateTrace ? "predicate-query-trace-v1::" : "") : "public-v4::anytime-v1::";
    return `POST::${responseRevision}${url}::lang=${language}::timeout=${headers.get("x-maestro-query-timeout-ms") ?? ""}::${bodyStr}`;
  }
  return null;
}

export async function getClientCachedResponse(key: string): Promise<Response | null> {
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.timestamp <= CLIENT_CACHE_TTL_MS) {
    memoryCache.delete(key);
    memoryCache.set(key, mem);
    return new Response(mem.body, {
      status: mem.status,
      headers: {
        "Content-Type": mem.contentType,
        "X-Maestro-Client-Cache": "HIT",
      },
    });
  }
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    const record = await new Promise<CachedResponseRecord | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as CachedResponseRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (record && Date.now() - record.timestamp <= CLIENT_CACHE_TTL_MS) {
      rememberMemoryResponse(key, record);
      return new Response(record.body, {
        status: record.status,
        headers: {
          "Content-Type": record.contentType,
          "X-Maestro-Client-Cache": "HIT",
        },
      });
    }
  } catch {
    // Cache read failure is non-fatal
  }
  return null;
}

export async function setClientCachedResponse(
  key: string,
  body: string,
  contentType: string,
  status: number
): Promise<void> {
  // Only successful HTTP responses may enter either browser cache tier.
  if (status < 200 || status >= 300) return;
  const record: CachedResponseRecord = {
    key,
    body,
    contentType,
    status,
    timestamp: Date.now(),
  };
  rememberMemoryResponse(key, record);
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function clearClientQueryCache(): Promise<void> {
  memoryCache.clear();
  memoryCacheBytes = 0;
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
  } catch {
    // Non-fatal
  }
}

/** In-flight Maestro query operations, shared by query listeners and the Refresh/Abort control. */
const pendingQueryControllers = new Set<AbortController>();
export type PendingMaestroQuery = { id: number; label: string; state: "preparing" | "queued" | "active";
  queueIndex: number; workspaceId: string; viewOwnerKey: string; actorOwner?: QueryActorOwner; serverQueueIndex?: number; queueServer?: string; serverQueueLane?: "light" | "heavy"; serverQueueLaneIndex?: number; serverQueueLaneNumber?: number; serverQueueLanePosition?: number; proxyDispatchConfirmed?: boolean };
const pendingQueryDetails = new Map<AbortController, PendingMaestroQuery>();
/** The scheduler is shared, but authority belongs to one XState supervisor
 * per mounted workspace. A query MUST name its view and ribbon explicitly.
 * Debug labels are diagnostics only: they confer no ability to execute. */
const queryWorkspaces = new Map<string, MaestroQueryViewCoordinator>();
export function registerMaestroQueryWorkspace(workspaceId: string, controller: MaestroQueryViewCoordinator): () => void {
  if (!workspaceId || queryWorkspaces.has(workspaceId)) throw new Error("Duplicate or missing Maestro query workspace");
  queryWorkspaces.set(workspaceId, controller);
  const unsubscribe = controller.subscribe(() => {
    // Stop only independently owned requests whose zone has just been left.
    // The actor's own signal still controls same-zone query/session changes.
    for (const [request, detail] of pendingQueryDetails) {
      if (detail.workspaceId === workspaceId && detail.actorOwner &&
        (controller.getSnapshot().context.cancelled || !actorQueryAllowed(detail.actorOwner, controller.getSelection()))) request.abort();
    }
    notifyPendingQueries();
  });
  notifyPendingQueries();
  return () => {
    unsubscribe();
    if (queryWorkspaces.get(workspaceId) === controller) {
      for (const [request, detail] of pendingQueryDetails) {
        if (detail.workspaceId === workspaceId && detail.actorOwner) request.abort();
      }
      queryWorkspaces.delete(workspaceId);
    }
    notifyPendingQueries();
  };
}
function queryWorkspace(headers?: HeadersInit): { workspaceId: string; controller: MaestroQueryViewCoordinator } | null {
  const id = new Headers(headers).get("x-maestro-workspace-id") ?? "";
  if (id) { const controller = queryWorkspaces.get(id); return controller ? { workspaceId: id, controller } : null; }
  // A single rendered Maestro workspace is the ordinary SPA case. If several
  // workspaces coexist, callers MUST supply their explicit workspace ID.
  if (queryWorkspaces.size !== 1) return null;
  const [workspaceId, controller] = queryWorkspaces.entries().next().value!;
  return { workspaceId, controller };
}
function declaredViewScope(headers?: HeadersInit): MaestroQueryScope | null {
  const values = new Headers(headers);
  const tab = values.get("x-maestro-view-tab");
  const ribbon = values.get("x-maestro-view-ribbon");
  if (tab === "shared" && ribbon === "query") return {tab,ribbon};
  if ((tab === "record" || tab === "personal") && ribbon === "session") return {tab,ribbon};
  if (tab === "browse" && (ribbon === null || ribbon === "browse")) return { tab, ribbon: "browse" };
  if ((tab === "view" || tab === "analyze") && ribbon) return { tab, ribbon };
  return null;
}
// Link the public request signal to its tracked controller so dispatch status
// reflects the existing browser scheduler without creating a second queue.
const pendingQueryOwnerBySignal = new WeakMap<AbortSignal, AbortController>();
let nextPendingQueryId = 0;
const pendingQueryDetailListeners = new Set<(queries: PendingMaestroQuery[]) => void>();
// React subscribers must not receive a fresh array when no observable detail changed.
// In particular, repeated scheduler notifications must not trigger setState loops.
let lastPendingDetails: PendingMaestroQuery[] = [];
function pendingDetailsEqual(a: readonly PendingMaestroQuery[], b: readonly PendingMaestroQuery[]): boolean {
  return a.length === b.length && a.every((item, index) =>
    item.id === b[index].id && item.label === b[index].label && item.workspaceId === b[index].workspaceId && item.viewOwnerKey === b[index].viewOwnerKey && item.actorOwner === b[index].actorOwner && item.state === b[index].state && item.queueIndex === b[index].queueIndex && item.serverQueueIndex === b[index].serverQueueIndex && item.queueServer === b[index].queueServer &&
    item.serverQueueLane === b[index].serverQueueLane && item.serverQueueLaneIndex === b[index].serverQueueLaneIndex &&
    item.serverQueueLaneNumber === b[index].serverQueueLaneNumber && item.serverQueueLanePosition === b[index].serverQueueLanePosition &&
    item.proxyDispatchConfirmed === b[index].proxyDispatchConfirmed);
}
/** Render the authoritative scheduler's waiting order, not registration order.
 * Active/pre-dispatch entries have no queue position and follow the queued rows. */
function orderedPendingQueryDetails(): PendingMaestroQuery[] {
  return [...pendingQueryDetails.values()].filter(query => {
    const workspace = queryWorkspaces.get(query.workspaceId);
    return workspace && (query.actorOwner ? actorQueryAllowed(query.actorOwner, workspace.getSelection()) : workspace.ownsPendingKey(query.viewOwnerKey)) && !workspace.getSnapshot().context.cancelled;
  }).sort((a, b) => {
    // Sort by *reported* stage then its own reported index; do not turn this
    // presentation order into a fictitious combined queue position.
    const stage = (item: PendingMaestroQuery) => item.serverQueueIndex && item.serverQueueIndex > 0 ? 0
      : item.queueIndex > 0 ? 1 : item.proxyDispatchConfirmed ? 3 : 2;
    const diff = stage(a) - stage(b);
    if (diff) return diff;
    const aPosition = a.serverQueueIndex && a.serverQueueIndex > 0 ? a.serverQueueIndex : a.queueIndex;
    const bPosition = b.serverQueueIndex && b.serverQueueIndex > 0 ? b.serverQueueIndex : b.queueIndex;
    return aPosition - bPosition || a.id - b.id;
  });
}
function notifyPendingQueryDetails() {
  const snapshot = orderedPendingQueryDetails();
  if (pendingDetailsEqual(snapshot, lastPendingDetails)) return;
  lastPendingDetails = snapshot;
  for (const listener of pendingQueryDetailListeners) listener(snapshot);
}
export function subscribePendingMaestroQueryDetails(listener: (queries: PendingMaestroQuery[]) => void): () => void {
  pendingQueryDetailListeners.add(listener);
  listener(orderedPendingQueryDetails());
  return () => { pendingQueryDetailListeners.delete(listener); };
}
export function cancelIndividualMaestroQuery(id: number): void {
  for (const [controller, detail] of pendingQueryDetails) {
    if (detail.id !== id) continue;
    controller.abort();
    pendingQueryControllers.delete(controller);
    pendingQueryDetails.delete(controller);
    refreshPendingQueueIndexes();
    notifyPendingQueries();
    return;
  }
}
function labelMaestroRequest(input: RequestInfo | URL, init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  const component = headers.get("x-maestro-debug-component") || "";
  const source = headers.get("x-maestro-debug-source") || "";
  return component || source || (typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url).split("?")[0].split("/").pop() || "Query";
}

let queryPipelineStopped = false;
const pendingQueryListeners = new Set<(count: number) => void>();
let lastPendingQueryCount = 0;
function notifyPendingQueries() {
  const count = orderedPendingQueryDetails().length;
  if (count !== lastPendingQueryCount) {
    lastPendingQueryCount = count;
    for (const listener of pendingQueryListeners) listener(count);
  }
  notifyPendingQueryDetails();
}
export function subscribePendingMaestroQueries(listener: (count: number) => void): () => void {
  pendingQueryListeners.add(listener);
  listener(orderedPendingQueryDetails().length);
  return () => { pendingQueryListeners.delete(listener); };
}
export function abortPendingMaestroQueries(): void {
  // Cancel all queued work in one transaction. Prevent a canceled job from
  // draining the next old job into a newly freed slot during teardown.
  schedulerTearingDown = true;
  try {
    for (const job of [...requestQueue]) job.abort();
    requestQueue.length = 0;
    for (const controller of [...pendingQueryControllers]) controller.abort();
    // Old request finalizers must not consume capacity in the next pipeline.
    browserQueueGeneration++;
    activeProxyRequests = 0;
    activeBackgroundProxyRequests = 0;
  } finally {
    schedulerTearingDown = false;
    // The X must immediately revert to Refresh, even before abort finalizers run.
    pendingQueryControllers.clear();
    pendingQueryDetails.clear();
    notifyPendingQueries();
  }
}
/** A semantic FCT change must not discard an unrelated authenticated History
 * write or session action. The queue retains its real capacity and ordering. */
export function abortQueryScopedMaestroQueries(): void {
  schedulerTearingDown = true;
  try {
    for (const [controller, detail] of pendingQueryDetails) {
      if (detail.viewOwnerKey === "personal:session" || detail.actorOwner === "bookmark-metadata" || detail.actorOwner === "personal-directory") continue;
      controller.abort();
    }
  } finally { schedulerTearingDown = false; refreshPendingQueueIndexes(); notifyPendingQueries(); dispatchScheduledRequests(); }
}
/** Cancel without altering loaded results; do not allow delayed effect timers to restart queries. */
export function stopPendingMaestroQueries(): void {
  queryPipelineStopped = true;
  for (const workspace of queryWorkspaces.values()) workspace.cancel();
  stopProxyQueryGeneration();
  abortPendingMaestroQueries();
}
/** Called at the beginning of a genuinely new query pipeline. */
export function resumePendingMaestroQueries(): void {
  queryPipelineStopped = false;
  for (const workspace of queryWorkspaces.values()) workspace.resume();
  resumeProxyQueryGeneration();
}
/** A caller proposes work; only the foreground XState child can invoke it.
 * Pending registration, scheduler admission and network fetch occur INSIDE
 * that child. Exiting the view stops the child and its AbortSignals. */
async function trackMaestroQuery<T>(signal: AbortSignal | null | undefined,
  operation: (signal: AbortSignal) => Promise<T>, label = "Query", headers?: HeadersInit, body?: BodyInit | null): Promise<T> {
  if (queryPipelineStopped) throw maestroOffstageError();
  const workspace = queryWorkspace(headers);
  const scope = declaredViewScope(headers);
  const actorOwner = getActorQueryAuthority(signal);
  if (!workspace || (!scope && !actorOwner)) throw new DOMException("Query has no explicit active XState workspace/view authority", "AbortError");
  if (actorOwner && (!actorQueryAllowed(actorOwner, workspace.controller.getSelection()) || workspace.controller.getSnapshot().context.cancelled)) throw maestroOffstageError();
  let explicitMutation = false;
  if (actorOwner && actorOwner !== "bookmark-metadata" && typeof body === "string") {
    let payload: { update?: unknown; personalWrite?: boolean } | undefined;
    try { payload = JSON.parse(body); } catch { /* ordinary non-JSON query */ }
    if (payload?.update !== undefined || payload?.personalWrite) {
      // An independent read actor may request a separate, explicitly declared
      // personal mutation. The personal-session worker, not the read lease,
      // owns that transport. Its caller signal still cancels the request.
      if (scope?.tab !== "personal" || scope.ribbon !== "session") throw new Error("This XState query actor owns reads only.");
      explicitMutation = true;
    }
  }
  const run = async (actorSignal: AbortSignal, ownerKey: string) => {
    if (queryPipelineStopped) throw maestroOffstageError();
    const controller = new AbortController();
    const combinedSignal = AbortSignal.any([actorSignal, controller.signal]);
    combinedSignal.throwIfAborted();
    inheritQueryQueueObservation(signal, combinedSignal);
    pendingQueryControllers.add(controller);
    pendingQueryOwnerBySignal.set(combinedSignal, controller);
    pendingQueryDetails.set(controller, { id: ++nextPendingQueryId, label, workspaceId: workspace.workspaceId,
      viewOwnerKey: ownerKey, ...(actorOwner && !explicitMutation ? { actorOwner } : {}), state: "preparing", queueIndex: 0 });
    notifyPendingQueries();
    try {
      const result = await operation(combinedSignal);
      combinedSignal.throwIfAborted();
      return result;
    } finally {
      pendingQueryOwnerBySignal.delete(combinedSignal);
      pendingQueryControllers.delete(controller);
      pendingQueryDetails.delete(controller);
      refreshPendingQueueIndexes();
      notifyPendingQueries();
    }
  };
  if (actorOwner && signal && !explicitMutation) return run(signal, `actor:${actorOwner}`);
  const ownerKey = scope!.tab === "browse" && scope!.ribbon === "browse" ? "browse" : `${scope!.tab}:${scope!.ribbon}`;
  return workspace.controller.execute(scope!, actorSignal => run(actorSignal, ownerKey), signal);
}

/**
 * One queue for all browser-issued graph-server queries. Interactive results
 * get the first free slot; low-priority counts (including alphabet counts)
 * use at most one slot per endpoint. Every queued request is abortable.
 */
type ScheduledRequest = {
  background: boolean;
  owner?: AbortController;
  signal?: AbortSignal | null;
  run: () => Promise<Response>;
  resolve: (value: Response) => void;
  reject: (reason: unknown) => void;
  abort: () => void;
};
let activeProxyRequests = 0;
let activeBackgroundProxyRequests = 0;
// A tab-shared telemetry SSE stream occupies one HTTP/1.1 connection.
// Reserve another connection for a foreground Results/SPARQL request even when
// all background facet/count/alphabet requests start earlier. Chrome generally
// permits six connections per HTTP/1.1 origin. The Sheet's *lower* user limit
// still applies; a one-connection setting cannot support preemption.
const MAX_BROWSER_BACKGROUND_CONNECTIONS = 4;
let browserQueueGeneration = 0;
const requestQueue: ScheduledRequest[] = [];
let schedulerTearingDown = false;
/** The existing browser transport queue is the sole source of order.
 * 0 means dispatched (or not yet admitted); positive positions are the
 * actual one-based waiting order after interactive-priority insertion. */
function refreshPendingQueueIndexes(): void {
  // The only browser queue positions are indexes into the actual browser
  // scheduler. Proxy positions are owned by the remote heavy/light scheduler,
  // reported separately by telemetry. Never manufacture a cross-stage index.
  const browserPositions = new Map<AbortController, number>();
  requestQueue.forEach((job, index) => {
    if (job.owner) browserPositions.set(job.owner, index + 1);
  });
  let changed = false;
  for (const [controller, detail] of pendingQueryDetails) {
    const next = detail.state === "queued" ? browserPositions.get(controller) ?? 0 : 0;
    if (detail.queueIndex !== next) {
      pendingQueryDetails.set(controller, { ...detail, queueIndex: next });
      changed = true;
    }
  }
  if (changed) notifyPendingQueryDetails();
}
function isBackgroundQuery(init?: RequestInit): boolean {
  const headers = new Headers(init?.headers);
  const label = `${headers.get("x-maestro-debug-source") ?? ""} ${headers.get("x-maestro-debug-component") ?? ""}`.toLowerCase();
  return /count|alphabet|breadcrumb-preview|facet-load|facet-value|facet-page|classes|properties|roles|graphs/.test(label);
}
function dispatchScheduledRequests(): void {
  if (schedulerTearingDown) return;
  const limit = readMaestroConcurrency().proxyConnections;
  for (let i = 0; i < requestQueue.length && activeProxyRequests < limit;) {
    const job = requestQueue[i];
    if (job.signal?.aborted) { requestQueue.splice(i, 1); job.abort(); continue; }
    const backgroundLimit = limit <= 1 ? 1 : Math.min(limit - 1, MAX_BROWSER_BACKGROUND_CONNECTIONS);
    if (job.background && activeBackgroundProxyRequests >= backgroundLimit) {
      // A waiting foreground request can pass blocked background work. Never
      // occupy the last browser network slot with another optional facet.
      i++;
      continue;
    }
    requestQueue.splice(i, 1);
    refreshPendingQueueIndexes();
    const generation = browserQueueGeneration;
    activeProxyRequests++;
    if (job.background) activeBackgroundProxyRequests++;
    void job.run().then(job.resolve, job.reject).finally(() => {
      job.signal?.removeEventListener("abort", job.abort);
      if (generation === browserQueueGeneration) {
        activeProxyRequests = Math.max(0, activeProxyRequests - 1);
        if (job.background) activeBackgroundProxyRequests = Math.max(0, activeBackgroundProxyRequests - 1);
      }
      dispatchScheduledRequests();
    });
  }
}
function scheduledGraphFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return observeProxyFetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!/\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) return observeProxyFetch(input, init);
  // The caller's lifecycle owns cancellation. A wall-clock watchdog attached
  // to the fetch would also abort a request already dispatched to Virtuoso.
  // Neither browser nor proxy queue residence is charged against execution.
  const background = isBackgroundQuery(init);
  return new Promise<Response>((resolve, reject) => {
    let started = false;
    let canceled = false;
    const abort = () => {
      if (started || canceled) return; // An active fetch owns its AbortSignal.
      canceled = true;
      const index = requestQueue.indexOf(job);
      if (index >= 0) requestQueue.splice(index, 1);
      refreshPendingQueueIndexes();
      reject(new DOMException("Query canceled", "AbortError"));
      dispatchScheduledRequests();
    };
    const clockScope = maestroQueryClockScope(init?.headers ? new Headers(init.headers) : undefined);
    const scopedHeader = new Headers(init?.headers).get("x-maestro-clock-component") ?? "";
    const componentClockScope = scopedHeader.startsWith("component:") && scopedHeader.length <= 512
      ? scopedHeader as `component:${string}` : null;
    const owner = init?.signal ? pendingQueryOwnerBySignal.get(init.signal) : undefined;
    const job: ScheduledRequest = { background, owner, signal: init?.signal, run: () => {
      started = true;
      init?.signal?.removeEventListener("abort", abort);
      const owner = init?.signal ? pendingQueryOwnerBySignal.get(init.signal) : undefined;
      const tracked = owner ? pendingQueryDetails.get(owner) : undefined;
      if (tracked && tracked.state !== "active") {
        pendingQueryDetails.set(owner!, { ...tracked, state: "active" });
        refreshPendingQueueIndexes();
      }
      const headers = new Headers(init?.headers);
      const telemetryId = crypto.randomUUID();
      headers.set("x-maestro-telemetry-id", telemetryId);
      const onServerQueuePosition = (queueIndex: number, server: string, lane?: "light" | "heavy", laneIndex?: number,
        laneNumber?: number, lanePosition?: number) => {
        if (!owner) return;
        const item = pendingQueryDetails.get(owner);
        if (!item) return;
        pendingQueryDetails.set(owner, { ...item,
          serverQueueIndex: queueIndex, queueServer: server, serverQueueLane: lane, serverQueueLaneIndex: laneIndex,
          serverQueueLaneNumber: laneNumber, serverQueueLanePosition: lanePosition,
          proxyDispatchConfirmed: queueIndex === 0, state: "active" });
        refreshPendingQueueIndexes();
        // Proxy position and lane can change without any browser waiting index
        // changing. Publish the authoritative telemetry update independently.
        notifyPendingQueryDetails();
      };
      return (async () => {
        // The independent SSE subscription is ready before dispatch, so the
        // first queue/dispatch event cannot race ahead of its listener.
        const channel = await subscribeMaestroQueryEvents(telemetryId, clockScope,
          init?.signal, onServerQueuePosition, componentClockScope).catch(() => null);
        if (channel) headers.set("x-maestro-telemetry-stream-id", channel.streamId);
        try {
          // The response remains ordinary FCT XML or SPARQL JSON/RDF; never
          // consume it as a telemetry stream and never wrap it in JSON.
          return await observeProxyFetch(input, { ...init, headers });
        } finally {
          // Release only this request's clocks/listener, not the shared
          // browser-tab telemetry connection used by concurrent FCT requests.
          channel?.close();
          if (init?.signal) pendingQueryOwnerBySignal.delete(init.signal);
        }
      })();
    }, resolve, reject, abort };
    if (init?.signal?.aborted) { reject(new DOMException("Query canceled", "AbortError")); return; }
    init?.signal?.addEventListener("abort", abort, { once: true });
    // Foreground requests jump ahead of background jobs already queued.
    if (background) requestQueue.push(job);
    else requestQueue.splice(requestQueue.findIndex((entry) => entry.background) >= 0
      ? requestQueue.findIndex((entry) => entry.background) : requestQueue.length, 0, job);
    // Only actual queue members are called queued. A registered request
    // awaiting FCT setup is preparing and has no fabricated position.
    if (owner) {
      const tracked = pendingQueryDetails.get(owner);
      if (tracked && tracked.state === "preparing")
        pendingQueryDetails.set(owner, { ...tracked, state: "queued" });
    }
    observeAdmittedQuery(init?.signal);
    refreshPendingQueueIndexes();
    dispatchScheduledRequests();
  });
}

/** A fresh FCT transport outcome is evidence about the *actual* graph server.
 * Proxy 5xx application errors do not imply a transport outage, so inspect the
 * small failure body before emitting a health observation. Cached responses
 * and optional status projections are deliberately excluded. */
export const MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS = "maestro:graph-server-request-success";
export const MAESTRO_GRAPH_SERVER_TRANSPORT_FAILURE = "maestro:graph-server-transport-failure";
export const MAESTRO_GRAPH_SERVER_QUERY_OUTCOME = "maestro:graph-server-query-outcome";
let graphQuerySequence=0;
let graphQueryScope=0;
let graphQueryIdentity="";
export function setGraphQueryHealthScope(identity:string){if(identity!==graphQueryIdentity){graphQueryIdentity=identity;graphQueryScope++;}}
const CONNECTIVITY_ERROR = /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|ERR_TLS_[A-Z_]+)\b|connect(?:ion)? (?:timed? ?out|refused)|unable to get local issuer certificate/i;
async function monitoredProxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = typeof init?.body === "string" ? init.body : "";
  let fctXml = body;
  let directAddr="";
  let directOperation="";
  if (body.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(body);
      const nested=parsed.recordSelect??parsed.recordValueLabels??parsed.facetValueCount;
      fctXml = typeof (nested?.queryXml??parsed.queryXml) === "string" ? nested?.queryXml??parsed.queryXml : "";
      if(!parsed.personalRead && !parsed.personalWrite && !parsed.update && parsed.operation!=="auth-probe"){
        directAddr=typeof (nested?.addr??parsed.addr)==="string" ? nested?.addr??parsed.addr : "";
        directOperation=typeof parsed.query==="string" ? "query" : Object.keys(parsed).find(key=>["recordSelect","recordValueLabels","facetValueCount","resultsQuery","facetIntersection"].includes(key))??"";
      }
    } catch { fctXml = ""; }
  }
  const isFctQuery = /\/proxy\/api\/fct(?:[/?]|$)/.test(url) &&
    (init?.method ?? "GET").toUpperCase() === "POST" &&
    /<(?:(?:[A-Za-z][\w.-]*):)?query(?:\s|>)/.test(fctXml);
  const isStatusProjection = /<view\b[^>]*\btype\s*=\s*["']list-status["']/i.test(fctXml);
  const isDirectQuery=/\/proxy\/api\/sparql(?:[/?]|$)/.test(url) && Boolean(directOperation);
  const address = (isFctQuery && !isStatusProjection || isDirectQuery) ? directAddr || fctXml.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] || "" : "";
  const headers=new Headers(init?.headers);
  const source=headers.get("x-maestro-debug-source")??"";
  const component=(headers.get("x-maestro-debug-component")??"").replace(/:[0-9a-f]{8,}(?::\d+)?$/i,"");
  const view=fctXml.match(/<view\b[^>]*\btype\s*=\s*["']([^"']+)/i)?.[1]??"";
  const operation=JSON.stringify([source,component,view,directOperation]);
  const sequence=++graphQuerySequence;
  const scope=graphQueryScope;
  const endpointUrl = (address.includes("@") ? address.slice(address.indexOf("@") + 1) : /^https?:\/\//i.test(address) ? address : "").replace(/&amp;/g, "&");
  let response: Response;
  try { response = await scheduledGraphFetch(input, init); }
  catch (error) {
    throw error;
  }
  if (scope===graphQueryScope && !init?.signal?.aborted && typeof window !== "undefined" && endpointUrl &&
      response.headers.get("X-Maestro-Cache") !== "HIT" &&
      response.headers.get("X-Maestro-Client-Cache") !== "HIT" &&
      response.headers.get("X-Maestro-Upstream-Source") !== "cache" && response.headers.get("X-Maestro-Upstream-Source") !== "federated") {
    const origin=response.headers.get("X-Maestro-Failure-Origin");
    const directNetwork=isDirectQuery && response.headers.get("X-Maestro-Upstream-Source")==="network";
    const upstreamStatus = response.headers.get("X-Maestro-Upstream-Status");
    const actual=upstreamStatus ? Number(upstreamStatus) : response.status;
    const partial = response.headers.get("X-Maestro-Incomplete") === "true";
    const timeout = origin === "upstream-transport" && response.status === 504 && !partial;
    const network = response.headers.get("X-Maestro-Upstream-Source") === "network";
    // A valid Anytime partial result is a supported execution outcome. It is
    // neither a hard transport failure nor proof that all requested values exist.
    const successful = response.ok && network && actual === 200 && !partial && ((isFctQuery && !isStatusProjection) || directNetwork);
    if (successful || ((origin === "upstream-http" || directNetwork) && actual >= 400 && actual !== 401 && !partial) || timeout) {
      if (!init?.signal?.aborted) window.dispatchEvent(new CustomEvent(MAESTRO_GRAPH_SERVER_QUERY_OUTCOME,{detail:{endpointUrl,operation,sequence,scope,status:successful ? 200 : timeout && actual===504 ? null : actual,timeout,diagnostic:timeout?"Upstream query transport timeout":successful?undefined:`Upstream query HTTP ${actual}`}}));
    }
    if (response.status === 200 && isFctQuery && !isStatusProjection && !timeout && !partial && response.headers.get("X-Maestro-Upstream-Source")==="network") {
      window.dispatchEvent(new CustomEvent(MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, { detail: { endpointUrl } }));
    } else if (response.status >= 500 && !partial) {
      // Only read the unsuccessful response's clone. It must remain available
      // in full to the FCT XML/error renderer. No success-body processing.
      const failureBody = await response.clone().text().catch(() => "");
      const diagnostic = failureBody.slice(0, 3072);
      if (scope===graphQueryScope && !init?.signal?.aborted && response.headers.get("X-Maestro-Failure-Origin") === "upstream-transport" && CONNECTIVITY_ERROR.test(diagnostic)) {
        window.dispatchEvent(new CustomEvent(MAESTRO_GRAPH_SERVER_TRANSPORT_FAILURE, {
          detail: { endpointUrl, status: response.status, diagnostic: diagnostic.slice(0, 1024), at: Date.now() },
        }));
      }
    }
  }
  return response;
}

/** Apply a saved per-widget deadline to non-FCT proxy requests (record graphs/policies). */
async function maestroQueryFetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-maestro-language", maestroLanguageHeader());
  const source = [headers.get("x-maestro-debug-source") || "", headers.get("x-maestro-debug-component") || ""].join(" ");
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "POST" && url.includes("/proxy/api/fct") && typeof init?.body === "string") {
    const resolved = resolveFctRequestTimeout(source, init.body);
    if (resolved.timeoutMs !== undefined) headers.set("x-maestro-query-timeout-ms", String(resolved.timeoutMs));
    return monitoredProxyFetch(input, { ...init, body: resolved.body, headers });
  }
  const timeoutMs = configuredTimeoutMs(source);
  if (!timeoutMs) return monitoredProxyFetch(input, { ...init, headers });
  if (!headers.has("x-maestro-query-timeout-ms")) headers.set("x-maestro-query-timeout-ms", String(timeoutMs));
  if (method === "POST" && /\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) {
    // Virtuoso owns its SQL execution budget. Preserve the owner signal.
    return monitoredProxyFetch(input, { ...init, headers });
  }
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const owner = init?.signal ? pendingQueryOwnerBySignal.get(init.signal) : undefined;
  if (owner) pendingQueryOwnerBySignal.set(signal, owner);
  try { return await monitoredProxyFetch(input, { ...init, headers, signal }); }
  finally { if (owner) pendingQueryOwnerBySignal.delete(signal); }
}

/**
 * Transparent fetch wrapper that checks client-side IndexedDB cache
 * for /proxy/api/fct and /proxy/api/sparql queries before making a network request.
 */
async function cachedFetchFctImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const isCacheableEndpoint = urlStr.includes("/proxy/api/fct") || urlStr.includes("/proxy/api/sparql");
  if (!isCacheableEndpoint) {
    return monitoredProxyFetch(input, init);
  }
  const requestHeaders = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  if (urlStr.includes("/proxy/api/fct")) requestHeaders.set("x-maestro-concurrency", JSON.stringify(readMaestroConcurrency()));
  requestHeaders.set("x-maestro-language", maestroLanguageHeader());
  const debugSource = [requestHeaders.get("x-maestro-debug-source") || "", requestHeaders.get("x-maestro-debug-component") || ""].join(" ");
  // Resolve the FCT view override before computing the cache key. Both
  // browser fetch paths use the same resolver and preserve the owner signal.
  if (init && typeof init.body === "string" && urlStr.includes("/proxy/api/fct")) {
    const resolved = resolveFctRequestTimeout(debugSource, init.body);
    if (resolved.timeoutMs !== undefined) requestHeaders.set("x-maestro-query-timeout-ms", String(resolved.timeoutMs));
    init = { ...init, body: resolved.body, headers: requestHeaders };
  } else {
    const timeoutMs = configuredTimeoutMs(debugSource);
    if (timeoutMs) requestHeaders.set("x-maestro-query-timeout-ms", String(timeoutMs));
    init = { ...init, headers: requestHeaders };
  }
  // Component identity is distinct from the operation/source. Several widgets
  // share `facet-load`; do not collapse their incomplete states into one entry.
  const source = requestHeaders.get("x-maestro-debug-component") || requestHeaders.get("x-maestro-debug-source") || urlStr;
  const requestId = requestHeaders.get("x-maestro-debug-request") || "";
  const track = (response: Response): Response => {
    const incomplete = response.headers.get("x-maestro-incomplete") === "true";
    if (response.ok) setMaestroIncompleteResults(source, { incomplete, requestId, message: incomplete ? "Virtuoso ANYTIME returned incomplete results." : "" });
    return response;
  };
  // Personal state assertions are mutable independently of the live XML.
  // A cache hit here could display a pre-Seen or pre-Hidden result set.
  if (urlStr.includes("/proxy/api/fct") && typeof init?.body === "string" &&
      (/<(?:[\w.-]+:)?status\b/i.test(init.body) || init.body.includes("urn:maestro:providers:"))) {
    return track(await monitoredProxyFetch(input, init));
  }
  const key = computeClientCacheKey(urlStr, init);
  if (!key) {
    return track(await monitoredProxyFetch(input, init));
  }

  const cached = requestHeaders.get("x-maestro-component-retry") === "1" ? null
    : await lookupCachedResponseWithDeadline(key, init?.signal);
  init?.signal?.throwIfAborted();
  if (cached) {
    return track(cached);
  }

  const response = await monitoredProxyFetch(input, init);
  if (response.status === 200 && response.headers.get("x-maestro-incomplete") !== "true" && !response.headers.has("x-maestro-enrichment-unavailable") && !response.headers.has("x-maestro-count-fallback") && !response.headers.has("x-maestro-ordering-fallback")) {
    try {
      const clone = response.clone();
      const bodyText = await clone.text();
      init?.signal?.throwIfAborted();
      const contentType = response.headers.get("Content-Type") || "application/xml; charset=utf-8";
      void setClientCachedResponse(key, bodyText, contentType, response.status);
    } catch {
      // Non-fatal clone failure
    }
  }
  return track(response);
}

/** Track query requests so a live FCT change or user Abort cancels outstanding work. */
export function maestroQueryFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  requireSparqlAttribution(input, init);
  return trackMaestroQuery(init?.signal, (signal) => maestroQueryFetchImpl(input, { ...init, signal }), labelMaestroRequest(input, init), init?.headers, init?.body);
}
export function cachedFetchFct(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  requireSparqlAttribution(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  // Endpoint selection, health checks, and other control-plane requests must
  // not be aborted merely because the live query changes.
  const body = typeof init?.body === "string" ? init.body : "";
  // GET /fct loads the endpoint registry or probes health. It is control-plane
  // work, not a live FCT query, and must survive query navigation/cancellation.
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if ((method === "GET" && /\/proxy\/api\/fct(?:[/?]|$)/.test(url)) ||
      !/\/proxy\/api\/(?:fct|sparql|policies|xslt)/.test(url) ||
      body.includes('"selectEndpointId"') || body.includes('"selectEndpointUrl"') || body.includes('"health"')) {
    return cachedFetchFctImpl(input, init);
  }
  return trackMaestroQuery(init?.signal, (signal) => cachedFetchFctImpl(input, { ...init, signal }), labelMaestroRequest(input, init), init?.headers, init?.body);
}
