/** Browser-owned settings for the root URI combobox; no Maestro backend state. */
import { maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";
export type UriAutocompleteSettings = Readonly<{ limit: number; timeoutSeconds: number }>;
const KEY = "maestro-uri-autocomplete-v1";
const DEFAULT: UriAutocompleteSettings = { limit: 10, timeoutSeconds: 15 };
let current: UriAutocompleteSettings = DEFAULT;
export function readUriAutocompleteSettings(): UriAutocompleteSettings {
  try {
    const input = JSON.parse(maestroStorageGet(KEY) ?? "{}") as Partial<UriAutocompleteSettings>;
    current = {
      limit: Number.isInteger(input.limit) && Number(input.limit) >= 1 && Number(input.limit) <= 10 ? Number(input.limit) : DEFAULT.limit,
      timeoutSeconds: Number.isInteger(input.timeoutSeconds) && Number(input.timeoutSeconds) >= 1 && Number(input.timeoutSeconds) <= 120 ? Number(input.timeoutSeconds) : DEFAULT.timeoutSeconds,
    };
  } catch { current = DEFAULT; }
  return current;
}
export function writeUriAutocompleteSettings(next: UriAutocompleteSettings): void {
  current = {
    limit: Math.max(1, Math.min(10, Math.trunc(next.limit))),
    timeoutSeconds: Math.max(1, Math.min(120, Math.trunc(next.timeoutSeconds))),
  };
  maestroStorageSet(KEY, JSON.stringify(current));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("maestro-uri-autocomplete-settings"));
}
