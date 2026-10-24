import { createHash } from "node:crypto";

type CacheEntry = { value: unknown; storedAt: number; sizeBytes: number };
type QueryCacheGlobal = typeof globalThis & {
  __maestroQueryResultCache?: Map<string, CacheEntry>;
  __maestroQueryResultCacheBytes?: number;
};

const CACHE_TTL_MS = Math.max(1_000, Number(process.env.MAESTRO_QUERY_CACHE_TTL_MS) || 5 * 60 * 1000);
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

function configuredLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function cacheDisabled(): boolean {
  return configuredLimit("MAESTRO_QUERY_CACHE_MAX_ENTRIES", DEFAULT_MAX_ENTRIES) === 0 ||
    configuredLimit("MAESTRO_QUERY_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES) === 0;
}

function cacheMap(): Map<string, CacheEntry> {
  const root = globalThis as QueryCacheGlobal;
  if (!root.__maestroQueryResultCache) {
    root.__maestroQueryResultCache = new Map<string, CacheEntry>();
    root.__maestroQueryResultCacheBytes = 0;
  }
  return root.__maestroQueryResultCache;
}

function estimateBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function removeEntry(cache: Map<string, CacheEntry>, key: string): void {
  const root = globalThis as QueryCacheGlobal;
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  root.__maestroQueryResultCacheBytes = Math.max(0, (root.__maestroQueryResultCacheBytes ?? 0) - (entry.sizeBytes ?? 0));
}

function removeExpiredEntries(cache: Map<string, CacheEntry>, now = Date.now()): void {
  for (const [key, entry] of cache) {
    if (now - entry.storedAt > CACHE_TTL_MS) removeEntry(cache, key);
  }
}

/** Hash endpoint plus exact query/response-affecting options; results never cross endpoints. */
export function queryCacheKey(kind: string, endpoint: string, query: string): string {
  return createHash("sha256")
    .update(`maestro-cache-v3\\u0000${kind}\\u0000${endpoint}\\u0000${query}`)
    .digest("hex");
}

export function getQueryCache<T>(key: string): T | undefined {
  const cache = cacheMap();
  if (cacheDisabled()) {
    cache.clear();
    (globalThis as QueryCacheGlobal).__maestroQueryResultCacheBytes = 0;
    return undefined;
  }
  removeExpiredEntries(cache);
  const entry = cache.get(key);
  if (!entry) return undefined;
  // LRU: a hit moves the live entry to the newest position.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
}

export function setQueryCache<T>(key: string, value: T): void {
  const cache = cacheMap();
  const root = globalThis as QueryCacheGlobal;
  if (cacheDisabled()) {
    cache.clear();
    root.__maestroQueryResultCacheBytes = 0;
    return;
  }

  const sizeBytes = estimateBytes(value);
  const maxBytes = configuredLimit("MAESTRO_QUERY_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES);
  const maxEntries = configuredLimit("MAESTRO_QUERY_CACHE_MAX_ENTRIES", DEFAULT_MAX_ENTRIES);
  // A single entry larger than the entire budget cannot be retained safely.
  if (!Number.isFinite(sizeBytes) || sizeBytes > maxBytes || maxEntries === 0) return;

  removeExpiredEntries(cache);
  removeEntry(cache, key);
  while (cache.size >= maxEntries || (root.__maestroQueryResultCacheBytes ?? 0) + sizeBytes > maxBytes) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    removeEntry(cache, oldestKey);
  }

  cache.set(key, { value, storedAt: Date.now(), sizeBytes });
  root.__maestroQueryResultCacheBytes = (root.__maestroQueryResultCacheBytes ?? 0) + sizeBytes;
}

/** Remove every cached response, for use after an endpoint's data is changed. */
export function clearQueryCache(): void {
  const root = globalThis as QueryCacheGlobal;
  root.__maestroQueryResultCache?.clear();
  root.__maestroQueryResultCacheBytes = 0;
}
