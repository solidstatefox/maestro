import { maestroLanguageHeader } from "./maestro-language";
import { readMaestroConcurrency } from "./maestro-concurrency";
import { maestroQueryClockScope } from "./maestro-query-execution-clock";
import { unwrapMaestroQueryEvents } from "./client-query-events";
import { setMaestroIncompleteResults } from "./maestro-incomplete-results";
import { applyFctQueryTimeout, configuredTimeoutMs } from "./maestro-query-timeouts";
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

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

export function computeClientCacheKey(url: string, init?: RequestInit): string | null {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET") {
    // FCT endpoint lists depend on the user's Personal login and graph server
    // configuration. Never restore them from an old browser IndexedDB entry.
    // Health checks must also use fresh results.
    if (url.includes("/proxy/api/fct") || url.includes("health=1")) return null;
    return `GET::${url}`;
  }
  if (method === "POST") {
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    // Endpoint selection mutation should not be cached
    if ((bodyStr.includes('"selectEndpointId"') || bodyStr.includes('"selectEndpointUrl"'))) return null;
    const language = new Headers(init?.headers).get("x-maestro-language") ?? "";
    return `POST::${url}::lang=${language}::${bodyStr}`;
  }
  return null;
}

export async function getClientCachedResponse(key: string): Promise<Response | null> {
  const mem = memoryCache.get(key);
  if (mem) {
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
    if (record) {
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
  queueIndex: number; serverQueueIndex?: number; queueServer?: string };
const pendingQueryDetails = new Map<AbortController, PendingMaestroQuery>();
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
    item.id === b[index].id && item.label === b[index].label && item.state === b[index].state && item.queueIndex === b[index].queueIndex && item.serverQueueIndex === b[index].serverQueueIndex && item.queueServer === b[index].queueServer);
}
/** Render the authoritative scheduler's waiting order, not registration order.
 * Active/pre-dispatch entries have no queue position and follow the queued rows. */
function orderedPendingQueryDetails(): PendingMaestroQuery[] {
  return [...pendingQueryDetails.values()].sort((a, b) => {
    const aQueued = a.queueIndex > 0;
    const bQueued = b.queueIndex > 0;
    if (aQueued !== bQueued) return aQueued ? -1 : 1;
    return aQueued ? a.queueIndex - b.queueIndex || a.id - b.id : a.id - b.id;
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
  if (component && source && component.toLowerCase() !== source.toLowerCase()) return `${component} · ${source}`;
  return component || source || (typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url).split("?")[0].split("/").pop() || "Query";
}

let queryPipelineStopped = false;
const pendingQueryListeners = new Set<(count: number) => void>();
let lastPendingQueryCount = 0;
function notifyPendingQueries() {
  const count = pendingQueryControllers.size;
  if (count !== lastPendingQueryCount) {
    lastPendingQueryCount = count;
    for (const listener of pendingQueryListeners) listener(count);
  }
  notifyPendingQueryDetails();
}
export function subscribePendingMaestroQueries(listener: (count: number) => void): () => void {
  pendingQueryListeners.add(listener);
  listener(pendingQueryControllers.size);
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
  } finally {
    schedulerTearingDown = false;
    // The X must immediately revert to Refresh, even before abort finalizers run.
    pendingQueryControllers.clear();
    pendingQueryDetails.clear();
    notifyPendingQueries();
  }
}
/** Cancel without altering loaded results; do not allow delayed effect timers to restart queries. */
export function stopPendingMaestroQueries(): void {
  queryPipelineStopped = true;
  abortPendingMaestroQueries();
}
/** Called at the beginning of a genuinely new query pipeline. */
export function resumePendingMaestroQueries(): void {
  queryPipelineStopped = false;
}
async function trackMaestroQuery<T>(signal: AbortSignal | null | undefined,
  operation: (signal: AbortSignal) => Promise<T>, label = "Query"): Promise<T> {
  if (queryPipelineStopped) throw new DOMException("Query execution stopped", "AbortError");
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  pendingQueryControllers.add(controller);
  pendingQueryOwnerBySignal.set(combinedSignal, controller);
  pendingQueryDetails.set(controller, { id: ++nextPendingQueryId, label, state: "preparing", queueIndex: 0 });
  notifyPendingQueries();
  try {
    const result = await operation(combinedSignal);
    if (combinedSignal.aborted) throw new DOMException("Maestro query aborted", "AbortError");
    return result;
  } finally {
    pendingQueryOwnerBySignal.delete(combinedSignal);
    pendingQueryControllers.delete(controller);
    pendingQueryDetails.delete(controller);
    refreshPendingQueueIndexes();
    notifyPendingQueries();
  }
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
let browserQueueGeneration = 0;
const requestQueue: ScheduledRequest[] = [];
let schedulerTearingDown = false;
/** The existing browser transport queue is the sole source of order.
 * 0 means dispatched (or not yet admitted); positive positions are the
 * actual one-based waiting order after interactive-priority insertion. */
function refreshPendingQueueIndexes(): void {
  // There are two real scheduling stages: requests still waiting in the
  // browser transport, and requests admitted to the proxy but waiting for its
  // heavy/light slot. The latter already have authoritative proxy-wide
  // positions. Merge those two disjoint waiting sets here (never in React)
  // and give each visible pending item a *unique* one-based ordinal. Running
  // requests and requests awaiting their first scheduling event have none.
  const browserPositions = new Map<AbortController, number>();
  requestQueue.forEach((job, index) => {
    if (job.owner) browserPositions.set(job.owner, index + 1);
  });
  const waiting = [...pendingQueryDetails.entries()].flatMap(([controller, detail]) => {
    if (detail.state === "active") {
      return detail.serverQueueIndex && detail.serverQueueIndex > 0
        ? [{ controller, stage: 0, position: detail.serverQueueIndex, id: detail.id }]
        : [];
    }
    const browserPosition = browserPositions.get(controller);
    return browserPosition ? [{ controller, stage: 1, position: browserPosition, id: detail.id }] : [];
  }).sort((a, b) => a.stage - b.stage || a.position - b.position || a.id - b.id);
  const displayPositions = new Map(waiting.map((item, index) => [item.controller, index + 1]));
  let changed = false;
  for (const [controller, detail] of pendingQueryDetails) {
    const next = displayPositions.get(controller) ?? 0;
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
    requestQueue.splice(i, 1);
    refreshPendingQueueIndexes();
    const generation = browserQueueGeneration;
    activeProxyRequests++;
    void job.run().then(job.resolve, job.reject).finally(() => {
      job.signal?.removeEventListener("abort", job.abort);
      if (generation === browserQueueGeneration) activeProxyRequests = Math.max(0, activeProxyRequests - 1);
      dispatchScheduledRequests();
    });
  }
}
function scheduledGraphFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!/\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) return fetch(input, init);
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
    const owner = init?.signal ? pendingQueryOwnerBySignal.get(init.signal) : undefined;
    const job: ScheduledRequest = { background, owner, signal: init?.signal, run: () => {
      started = true;
      const owner = init?.signal ? pendingQueryOwnerBySignal.get(init.signal) : undefined;
      const tracked = owner ? pendingQueryDetails.get(owner) : undefined;
      if (tracked && tracked.state !== "active") {
        pendingQueryDetails.set(owner!, { ...tracked, state: "active" });
        refreshPendingQueueIndexes();
      }
      const headers = new Headers(init?.headers);
      headers.set("x-maestro-query-events", "1");
      const onServerQueuePosition = (queueIndex: number, server: string) => {
        if (!owner) return;
        const item = pendingQueryDetails.get(owner);
        if (!item) return;
        pendingQueryDetails.set(owner, { ...item,
          serverQueueIndex: queueIndex, queueServer: server, state: "active" });
        refreshPendingQueueIndexes();
      };
      return fetch(input, { ...init, headers }).then(response =>
        unwrapMaestroQueryEvents(response, clockScope, init?.signal, onServerQueuePosition));
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
    refreshPendingQueueIndexes();
    dispatchScheduledRequests();
  });
}

/** Data-request errors are diagnostic, not endpoint connectivity status. */
export const MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS = "maestro:graph-server-request-success";
async function monitoredProxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = typeof init?.body === "string" ? init.body : "";
  // Most FCT requests use JSON.stringify({ queryXml }). Regexing the JSON
  // directly misses addr=\"...\" and discards valid success evidence.
  let fctXml = body;
  if (body.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { queryXml?: unknown };
      fctXml = typeof parsed.queryXml === "string" ? parsed.queryXml : "";
    } catch { fctXml = ""; }
  }
  const isFctQuery = /\/proxy\/api\/fct(?:[/?]|$)/.test(url) &&
    (init?.method ?? "GET").toUpperCase() === "POST" &&
    /<(?:(?:[A-Za-z][\w.-]*):)?query(?:\s|>)/.test(fctXml);
  // A query's addr is authoritative. Don't mark an unrelated personal
  // SPARQL endpoint healthy because an FCT proxy request completed.
  const isStatusProjection = /<view\b[^>]*\btype\s*=\s*["']list-status["']/i.test(fctXml);
  const address = isFctQuery && !isStatusProjection ? fctXml.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "" : "";
  const endpointUrl = address.includes("@") ? address.slice(address.indexOf("@") + 1).replace(/&amp;/g, "&") : "";
  const response = await scheduledGraphFetch(input, init);
  if (!init?.signal?.aborted && typeof window !== "undefined") {
    // A proxy cache hit and a federated Status projection do not prove the
    // underlying graph server responded to this request.
    if (response.status === 200 && endpointUrl && response.headers.get("X-Maestro-Cache") !== "HIT") {
      window.dispatchEvent(new CustomEvent(MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, { detail: { endpointUrl } }));
    }
  }
  return response;
}

/** Apply a saved per-widget deadline to non-FCT proxy requests (record graphs/policies). */
async function maestroQueryFetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-maestro-language", maestroLanguageHeader());
  const source = [headers.get("x-maestro-debug-source") || "", headers.get("x-maestro-debug-component") || ""].join(" ");
  const timeoutMs = configuredTimeoutMs(source);
  if (!timeoutMs) return monitoredProxyFetch(input, { ...init, headers });
  headers.set("x-maestro-query-timeout-ms", String(timeoutMs));
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  // The timeout signal is a new AbortSignal. Preserve the existing request's
  // tracked owner so the scheduler (and X/Refresh hover) can attribute it.
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
  const timeoutMs = configuredTimeoutMs(debugSource);
  if (timeoutMs) requestHeaders.set("x-maestro-query-timeout-ms", String(timeoutMs));
  // Apply per-widget timeout before computing the cache key; distinct timeouts
  // must not accidentally reuse a completed response for another setting.
  if (init && typeof init.body === "string" && urlStr.includes("/proxy/api/fct")) {
    const body = init.body.trimStart().startsWith("{")
      ? (() => {
          try {
            const object = JSON.parse(init.body as string) as Record<string, unknown>;
            if (typeof object.queryXml === "string") object.queryXml = applyFctQueryTimeout(debugSource, object.queryXml);
            return JSON.stringify(object);
          } catch { return init.body as string; }
        })()
      : applyFctQueryTimeout(debugSource, init.body);
    init = { ...init, body, headers: requestHeaders };
  } else {
    init = { ...init, headers: requestHeaders };
  }
  // Component identity is distinct from the operation/source. Several widgets
  // share `facet-load`; do not collapse their incomplete states into one entry.
  const source = requestHeaders.get("x-maestro-debug-component") || requestHeaders.get("x-maestro-debug-source") || urlStr;
  const requestId = requestHeaders.get("x-maestro-debug-request") || "";
  const track = (response: Response): Response => {
    const incomplete = response.headers.get("x-maestro-incomplete") === "true";
    setMaestroIncompleteResults(source, { incomplete, requestId, message: incomplete ? "Virtuoso ANYTIME returned incomplete results." : "" });
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

  const cached = await getClientCachedResponse(key);
  if (cached) {
    return track(cached);
  }

  const response = await monitoredProxyFetch(input, init);
  if (response.ok && response.headers.get("x-maestro-incomplete") !== "true") {
    try {
      const clone = response.clone();
      const bodyText = await clone.text();
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
  return trackMaestroQuery(init?.signal, (signal) => maestroQueryFetchImpl(input, { ...init, signal }), labelMaestroRequest(input, init));
}
export function cachedFetchFct(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
  return trackMaestroQuery(init?.signal, (signal) => cachedFetchFctImpl(input, { ...init, signal }), labelMaestroRequest(input, init));
}
