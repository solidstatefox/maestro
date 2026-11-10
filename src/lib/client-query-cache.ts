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
    return `POST::${url}::${bodyStr}`;
  }
  return null;
}

export async function getClientCachedResponse(key: string): Promise<Response | null> {
  const mem = memoryCache.get(key);
  if (mem) {
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
      memoryCache.set(key, record);
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
  const record: CachedResponseRecord = {
    key,
    body,
    contentType,
    status,
    timestamp: Date.now(),
  };
  memoryCache.set(key, record);
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
const pendingQueryListeners = new Set<(count: number) => void>();
function notifyPendingQueries() {
  for (const listener of pendingQueryListeners) listener(pendingQueryControllers.size);
}
export function subscribePendingMaestroQueries(listener: (count: number) => void): () => void {
  pendingQueryListeners.add(listener);
  listener(pendingQueryControllers.size);
  return () => { pendingQueryListeners.delete(listener); };
}
export function abortPendingMaestroQueries(): void {
  for (const controller of [...pendingQueryControllers]) controller.abort();
}
async function trackMaestroQuery<T>(signal: AbortSignal | null | undefined,
  operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  pendingQueryControllers.add(controller);
  notifyPendingQueries();
  try {
    const result = await operation(combinedSignal);
    if (combinedSignal.aborted) throw new DOMException("Maestro query aborted", "AbortError");
    return result;
  } finally {
    pendingQueryControllers.delete(controller);
    notifyPendingQueries();
  }
}

/**
 * One queue for all browser-issued graph-server queries. Interactive results
 * get the first free slot; low-priority counts (including alphabet counts)
 * use at most one slot per endpoint. Every queued request is abortable.
 */
type ScheduledRequest = {
  endpoint: string;
  background: boolean;
  signal?: AbortSignal | null;
  run: () => Promise<Response>;
  resolve: (value: Response) => void;
  reject: (reason: unknown) => void;
  abort: () => void;
};
const endpointSlots = new Map<string, { total: number; background: number }>();
const requestQueue: ScheduledRequest[] = [];
function queryEndpointKey(url: string, init?: RequestInit): string {
  const body = typeof init?.body === "string" ? init.body : "";
  let address = "";
  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { queryXml?: string; facetValueCount?: { addr?: string }; addr?: string };
      address = parsed.facetValueCount?.addr ?? parsed.addr ??
        parsed.queryXml?.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
    } catch { /* XML / malformed JSON is routed to a conservative pool */ }
  } else {
    address = body.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
  }
  const explicit = init?.headers ? new Headers(init.headers).get("x-maestro-graph-server") ?? "" : "";
  const server = explicit || (address.includes("@") ? address.slice(address.indexOf("@") + 1) : "");
  return server || "default-graph-server";
}
function isBackgroundQuery(init?: RequestInit): boolean {
  const headers = new Headers(init?.headers);
  const label = `${headers.get("x-maestro-debug-source") ?? ""} ${headers.get("x-maestro-debug-component") ?? ""}`.toLowerCase();
  return /count|alphabet|breadcrumb-preview|facet-load|facet-value|facet-page|classes|properties|roles|graphs/.test(label);
}
function dispatchScheduledRequests(): void {
  for (let i = 0; i < requestQueue.length;) {
    const job = requestQueue[i];
    if (job.signal?.aborted) { requestQueue.splice(i, 1); job.abort(); continue; }
    const slots = endpointSlots.get(job.endpoint) ?? { total: 0, background: 0 };
    if (slots.total >= 2 || (job.background && slots.background >= 1)) { i++; continue; }
    requestQueue.splice(i, 1);
    slots.total++;
    if (job.background) slots.background++;
    endpointSlots.set(job.endpoint, slots);
    void job.run().then(job.resolve, job.reject).finally(() => {
      job.signal?.removeEventListener("abort", job.abort);
      slots.total--;
      if (job.background) slots.background--;
      if (!slots.total) endpointSlots.delete(job.endpoint);
      dispatchScheduledRequests();
    });
  }
}
function scheduledGraphFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!/\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) return fetch(input, init);
  const background = isBackgroundQuery(init);
  const endpoint = queryEndpointKey(url, init);
  return new Promise<Response>((resolve, reject) => {
    let started = false;
    let canceled = false;
    const abort = () => {
      if (started || canceled) return; // An active fetch owns its AbortSignal.
      canceled = true;
      const index = requestQueue.indexOf(job);
      if (index >= 0) requestQueue.splice(index, 1);
      reject(new DOMException("Query canceled", "AbortError"));
      dispatchScheduledRequests();
    };
    const job: ScheduledRequest = { endpoint, background, signal: init?.signal, run: () => { started = true; return fetch(input, init); }, resolve, reject, abort };
    if (init?.signal?.aborted) { reject(new DOMException("Query canceled", "AbortError")); return; }
    init?.signal?.addEventListener("abort", abort, { once: true });
    // Foreground requests jump ahead of background jobs already queued.
    if (background) requestQueue.push(job);
    else requestQueue.splice(requestQueue.findIndex((entry) => entry.background) >= 0
      ? requestQueue.findIndex((entry) => entry.background) : requestQueue.length, 0, job);
    dispatchScheduledRequests();
  });
}

/** Data-request errors are diagnostic, not endpoint connectivity status. */
export const MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS = "maestro:graph-server-request-success";
async function monitoredProxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = typeof init?.body === "string" ? init.body : "";
  const isFctQuery = /\/proxy\/api\/fct(?:[/?]|$)/.test(url) &&
    (init?.method ?? "GET").toUpperCase() === "POST" &&
    /<(?:(?:[A-Za-z][\w.-]*):)?query(?:\s|>)/.test(body);
  // A query's addr is authoritative. Don't mark the *selected* endpoint
  // healthy because an unrelated personal-store or other proxy call worked.
  const address = isFctQuery ? body.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "" : "";
  const endpointUrl = address.includes("@") ? address.slice(address.indexOf("@") + 1) : "";
  try {
    const response = await scheduledGraphFetch(input, init);
    if (!init?.signal?.aborted && typeof window !== "undefined") {
      if (response.status === 200 && endpointUrl) {
        window.dispatchEvent(new CustomEvent(MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, { detail: { endpointUrl } }));
      } else if (response.status >= 400 && /\/proxy\/api\/(?:fct|sparql|record-graphs|policies|xslt)(?:[/?]|$)/.test(url)) {
        console.warn(`[Maestro] Request returned HTTP ${response.status}: ${url}`);
      }
    }
    return response;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError") && !init?.signal?.aborted) {
      console.warn(`[Maestro] Request failed: ${url}`, error);
    }
    throw error;
  }
}

/** Apply a saved per-widget deadline to non-FCT proxy requests (record graphs/policies). */
async function maestroQueryFetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const source = [headers.get("x-maestro-debug-source") || "", headers.get("x-maestro-debug-component") || ""].join(" ");
  const timeoutMs = configuredTimeoutMs(source);
  if (!timeoutMs) return monitoredProxyFetch(input, init);
  headers.set("x-maestro-query-timeout-ms", String(timeoutMs));
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  return monitoredProxyFetch(input, { ...init, headers, signal });
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
  if (urlStr.includes("/proxy/api/fct") && typeof init?.body === "string" && /<(?:[\w.-]+:)?state\b/i.test(init.body)) {
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
  if (response.ok && response.status === 200 && response.headers.get("x-maestro-incomplete") !== "true") {
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
  return trackMaestroQuery(init?.signal, (signal) => maestroQueryFetchImpl(input, { ...init, signal }));
}
export function cachedFetchFct(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  // Endpoint selection, health checks, and other control-plane requests must
  // not be aborted merely because the live query changes.
  const body = typeof init?.body === "string" ? init.body : "";
  if (!/\/proxy\/api\/(?:fct|sparql|policies|xslt)/.test(url) ||
      body.includes('"selectEndpointId"') || body.includes('"selectEndpointUrl"') || body.includes('"health"')) {
    return cachedFetchFctImpl(input, init);
  }
  return trackMaestroQuery(init?.signal, (signal) => cachedFetchFctImpl(input, { ...init, signal }));
}
