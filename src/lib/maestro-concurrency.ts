/** Browser-owned preferences, transmitted to the proxy after login and on edits. */
import { maestroStorageGet, maestroStorageSet } from "./maestro-storage";
export type MaestroConcurrency = { proxyConnections: number; lightPerServer: number; heavyPerServer: number };
export const DEFAULT_MAESTRO_CONCURRENCY: MaestroConcurrency = {
  proxyConnections: 6, lightPerServer: 4, heavyPerServer: 2,
};
export const MAESTRO_CONCURRENCY_STORAGE_KEY = "maestro-concurrency-v1";
export function normalizeMaestroConcurrency(input: unknown): MaestroConcurrency {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const clamp = (field: keyof MaestroConcurrency, min: number, max: number) => {
    const value = source[field];
    return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : DEFAULT_MAESTRO_CONCURRENCY[field];
  };
  const proxyConnections = clamp("proxyConnections", 1, 16);
  const lightPerServer = clamp("lightPerServer", 1, 16);
  const heavyPerServer = Math.min(lightPerServer, clamp("heavyPerServer", 1, 8));
  return { proxyConnections, lightPerServer, heavyPerServer };
}
export function readMaestroConcurrency(): MaestroConcurrency {
  try { return normalizeMaestroConcurrency(JSON.parse(maestroStorageGet(MAESTRO_CONCURRENCY_STORAGE_KEY) ?? "null")); }
  catch { return DEFAULT_MAESTRO_CONCURRENCY; }
}
export function writeMaestroConcurrency(value: MaestroConcurrency): void {
  maestroStorageSet(MAESTRO_CONCURRENCY_STORAGE_KEY, JSON.stringify(normalizeMaestroConcurrency(value)));
}
export async function syncMaestroConcurrency(value: MaestroConcurrency): Promise<void> {
  // The FCT transport carries these preferences on its next query. A separate
  // preference POST was a redundant network round trip on every Sheet edit.
  writeMaestroConcurrency(value);
}
