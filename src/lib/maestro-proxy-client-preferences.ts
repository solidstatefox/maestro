/** Process-local preference registry, isolated by an opaque server-issued browser cookie.
 * On horizontally scaled deployments, replace this store and scheduler with shared state.
 */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_MAESTRO_CONCURRENCY, type MaestroConcurrency } from "./maestro-concurrency";

export const MAESTRO_CLIENT_COOKIE = "maestro_proxy_client";
const registry = new Map<string, { value: MaestroConcurrency; touched: number }>();
const context = new AsyncLocalStorage<string>();
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function clientFromRequest(request: Request): string | null {
  const raw = request.headers.get("cookie")?.match(/(?:^|;\s*)maestro_proxy_client=([a-f0-9-]{36})(?:;|$)/i)?.[1];
  return raw ?? null;
}
export function newProxyClientId(): string { return randomUUID(); }
export function withProxyClient<T>(request: Request, execute: () => T): T {
  return context.run(clientFromRequest(request) ?? "anonymous", execute);
}
export function currentProxyClient(): string { return context.getStore() ?? "anonymous"; }
export function saveProxyClientPreferences(id: string, value: MaestroConcurrency): void {
  if (registry.size > 4096) {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [key, record] of registry) if (record.touched < cutoff) registry.delete(key);
  }
  registry.set(id, { value, touched: Date.now() });
}
export function getProxyClientPreferences(id: string): MaestroConcurrency {
  const entry = registry.get(id);
  return entry?.value ?? DEFAULT_MAESTRO_CONCURRENCY;
}
