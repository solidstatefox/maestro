/** User-supplied IteraCompute credential. Stored locally in IndexedDB, never in URLs or shared queries. */
import { initializeMaestroStorage, maestroStorageGet, maestroStorageSet, maestroStorageRemove } from "@/lib/maestro-storage";
export const ITERACOMPUTE_KEY_STORAGE = "maestro-iteracompute-api-key";
export const ITERACOMPUTE_KEY_HEADER = "X-Maestro-IteraCompute-Key";
export async function readIteraComputeKey(): Promise<string> {
  await initializeMaestroStorage();
  return maestroStorageGet(ITERACOMPUTE_KEY_STORAGE)?.trim() ?? "";
}
export function writeIteraComputeKey(value: string): void {
  const key = value.trim();
  if (key && (key.length > 512 || /[\x00-\x1f\x7f]/.test(key))) throw new Error("Invalid IteraCompute API key.");
  if (key) maestroStorageSet(ITERACOMPUTE_KEY_STORAGE, key);
  else maestroStorageRemove(ITERACOMPUTE_KEY_STORAGE);
}
export async function iteracomputeRequestHeaders(): Promise<Record<string, string>> {
  const key = await readIteraComputeKey();
  return key ? { [ITERACOMPUTE_KEY_HEADER]: key } : {};
}
