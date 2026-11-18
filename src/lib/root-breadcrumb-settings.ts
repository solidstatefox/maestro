/** Persistent browser-only policy for opening the root breadcrumb editor. */
import { maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";
const KEY = "maestro-root-editor-hover-delay-ms-v1";
export const DEFAULT_ROOT_HOVER_DELAY_MS = 2000;
export function readRootHoverDelayMs(): number {
  const stored = Number(maestroStorageGet(KEY));
  return Number.isFinite(stored) && stored >= 250 && stored <= 3000
    ? Math.round(stored / 250) * 250 : DEFAULT_ROOT_HOVER_DELAY_MS;
}
export function writeRootHoverDelayMs(value: number): void {
  const delay = Math.max(250, Math.min(3000, Math.round(value / 250) * 250));
  maestroStorageSet(KEY, String(delay));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("maestro-root-hover-settings"));
}
