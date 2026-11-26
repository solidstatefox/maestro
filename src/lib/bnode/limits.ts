/** Browser-owned, persisted blank-node retrieval preferences. These are defaults,
 * not policy ceilings; the Sheet owns the selected positive integer values. */
import { maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";

const KEY = "maestro-blank-node-record-limits";
export const MIB = 1024 * 1024;
export type BlankNodeRecordLimits = { window: number; rows: number; responseMiB: number };
export const DEFAULT_BLANK_NODE_RECORD_LIMITS: Readonly<BlankNodeRecordLimits> = {
  window: 100, rows: 2000, responseMiB: 8,
};
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function validBlankNodeRecordLimit(key: keyof BlankNodeRecordLimits, value: unknown): value is number {
  return isPositiveSafeInteger(value) && (key !== "responseMiB" || Number.isSafeInteger(value * MIB));
}
export function readBlankNodeRecordLimits(): BlankNodeRecordLimits {
  try {
    const saved = JSON.parse(maestroStorageGet(KEY) ?? "{}") as Partial<BlankNodeRecordLimits> | null;
    return {
      window: validBlankNodeRecordLimit("window", saved?.window) ? saved.window : DEFAULT_BLANK_NODE_RECORD_LIMITS.window,
      rows: validBlankNodeRecordLimit("rows", saved?.rows) ? saved.rows : DEFAULT_BLANK_NODE_RECORD_LIMITS.rows,
      responseMiB: validBlankNodeRecordLimit("responseMiB", saved?.responseMiB) ? saved.responseMiB : DEFAULT_BLANK_NODE_RECORD_LIMITS.responseMiB,
    };
  } catch { return { ...DEFAULT_BLANK_NODE_RECORD_LIMITS }; }
}
export function writeBlankNodeRecordLimits(value: BlankNodeRecordLimits): void {
  if (!validBlankNodeRecordLimit("window", value.window) || !validBlankNodeRecordLimit("rows", value.rows) || !validBlankNodeRecordLimit("responseMiB", value.responseMiB)) {
    throw new Error("Blank-node limits must be positive integers with a safely representable byte count.");
  }
  maestroStorageSet(KEY, JSON.stringify(value));
}
