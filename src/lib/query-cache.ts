import { createHash } from "node:crypto";

type CacheEntry = { value: unknown; storedAt: number };
type QueryCacheGlobal = typeof globalThis & {
  __maestroQueryResultCache?: Map<string, CacheEntry>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Set MAESTRO_QUERY_CACHE_MAX_ENTRIES=0 to disable shared query caching.
 * Live entries are not evicted early due to a capacity limit: doing so would
 * violate the cache's five-minute reuse guarantee and re-fetch seen queries.
 */
function cacheDisabled(): boolean {
  return process.env.MAESTRO_QUERY_CACHE_MAX_ENTRIES?.trim() === "0";
}

function removeExpiredEntries(cache: Map<string, CacheEntry>, now = Date.now()): void {
  for (const [key, entry] of cache) {
    if (now - entry.storedAt > CACHE_TTL_MS) cache.delete(key);
  }
}

function cacheMap(): Map<string, CacheEntry> {
  const root = globalThis as QueryCacheGlobal;
  if (!root.__maestroQueryResultCache) {
    root.__maestroQueryResultCache = new Map<string, CacheEntry>();
  }
  return root.__maestroQueryResultCache;
}

/** Hash the endpoint and exact query identity so identical queries share results
 * across every UI component and route, without leaking results between endpoints. */
export function queryCacheKey(kind: "fct" | "sparql", endpoint: string, query: string): string {
  return createHash("sha256")
    .update(`maestro-cache-v2\u0000${kind}\u0000${endpoint}\u0000${query}`)
    .digest("hex");
}

export function getQueryCache<T>(key: string): T | undefined {
  const cache = cacheMap();
  if (cacheDisabled()) {
    cache.clear();
    return undefined;
  }
  removeExpiredEntries(cache);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Refresh insertion order for diagnostics; live entries remain until TTL expiry.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
}

export function setQueryCache<T>(key: string, value: T): void {
  const cache = cacheMap();
  if (cacheDisabled()) {
    cache.clear();
    return;
  }
  removeExpiredEntries(cache);
  cache.delete(key);
  cache.set(key, { value, storedAt: Date.now() });
}
