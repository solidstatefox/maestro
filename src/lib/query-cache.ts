import { createHash } from "node:crypto";

type CacheEntry = { value: unknown; storedAt: number };
type QueryCacheGlobal = typeof globalThis & {
  __maestroQueryResultCache?: Map<string, CacheEntry>;
};

const DEFAULT_MAX_CACHE_ENTRIES = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Set MAESTRO_QUERY_CACHE_MAX_ENTRIES in the server environment to control the
 * shared cache capacity. Zero disables storage and lookups; invalid or missing
 * values fall back to the default capacity.
 */
function maxCacheEntries(): number {
  const raw = process.env.MAESTRO_QUERY_CACHE_MAX_ENTRIES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_CACHE_ENTRIES;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return DEFAULT_MAX_CACHE_ENTRIES;
  return parsed;
}

function enforceCacheCapacity(cache: Map<string, CacheEntry>): void {
  const maxEntries = maxCacheEntries();
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
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
    .update(`${kind}\u0000${endpoint}\u0000${query}`)
    .digest("hex");
}

export function getQueryCache<T>(key: string): T | undefined {
  const cache = cacheMap();
  if (maxCacheEntries() === 0) {
    cache.clear();
    return undefined;
  }
  enforceCacheCapacity(cache);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Refresh insertion order so the capacity bound evicts the least recently used entry.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
}

export function setQueryCache<T>(key: string, value: T): void {
  const cache = cacheMap();
  const maxEntries = maxCacheEntries();
  if (maxEntries === 0) {
    cache.clear();
    return;
  }
  cache.delete(key);
  cache.set(key, { value, storedAt: Date.now() });
  enforceCacheCapacity(cache);
}
