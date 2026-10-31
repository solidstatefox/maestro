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
    // Health checks are live probes, don't cache
    if (url.includes("health=1")) return null;
    return `GET::${url}`;
  }
  if (method === "POST") {
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    // Endpoint selection mutation should not be cached
    if (bodyStr.includes('"selectEndpointId"')) return null;
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

/**
 * Transparent fetch wrapper that checks client-side IndexedDB cache
 * for /proxy/api/fct and /proxy/api/sparql queries before making a network request.
 */
export async function cachedFetchFct(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const isCacheableEndpoint = urlStr.includes("/proxy/api/fct") || urlStr.includes("/proxy/api/sparql");
  if (!isCacheableEndpoint) {
    return fetch(input, init);
  }
  const key = computeClientCacheKey(urlStr, init);
  if (!key) {
    return fetch(input, init);
  }

  const cached = await getClientCachedResponse(key);
  if (cached) {
    return cached;
  }

  const response = await fetch(input, init);
  if (response.ok && (response.status === 200 || response.status === 206)) {
    try {
      const clone = response.clone();
      const bodyText = await clone.text();
      const contentType = response.headers.get("Content-Type") || "application/xml; charset=utf-8";
      void setClientCachedResponse(key, bodyText, contentType, response.status);
    } catch {
      // Non-fatal clone failure
    }
  }
  return response;
}
