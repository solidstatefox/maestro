"use client";
/** Opt-in, privacy-safe Record diagnostics. No XML, SPARQL or credentials. */
import { browserLog } from "@/lib/maestro-client-logging";
export type RecordPerfEvent = { phase: string; elapsedMs: number; mode?: string };
export const RECORD_PERF_EVENT = "maestro:record-performance";
export function recordPerformanceDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("maestroDebug") === "record";
}
export function reportRecordPerformance(phase: string, started: number, mode?: string): void {
  if (!recordPerformanceDebugEnabled()) return;
  const elapsedMs = Math.max(0, Math.round((performance.now() - started) * 10) / 10);
  const detail: RecordPerfEvent = { phase, elapsedMs, ...(mode ? { mode } : {}) };
  window.dispatchEvent(new CustomEvent<RecordPerfEvent>(RECORD_PERF_EVENT, { detail }));
  browserLog.debug("record.performance", detail);
}
