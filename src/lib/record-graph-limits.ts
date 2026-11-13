/** User-controlled work ceilings for Record graph discovery.
 * Both limits bound SPARQL work, not the number of triples in a Record.
 * Persisted using Maestro's existing IndexedDB-backed storage mirror.
 */
import { maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";

const KEY = "maestro-record-graph-discovery-limits-v1";
export const RECORD_GRAPH_DISCOVERY_DEFAULTS = {
  candidates: 10000,
  graphs: 500,
} as const;
export const RECORD_GRAPH_CANDIDATE_OPTIONS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const RECORD_GRAPH_RESULT_OPTIONS = [5, 10, 25, 50, 100, 250, 500] as const;
export type RecordGraphDiscoveryLimits = { candidates: number; graphs: number };

export function readRecordGraphDiscoveryLimits(): RecordGraphDiscoveryLimits {
  try {
    const values = JSON.parse(maestroStorageGet(KEY) || "{}") as Record<string, unknown>;
    return {
      candidates: RECORD_GRAPH_CANDIDATE_OPTIONS.includes(values.candidates as typeof RECORD_GRAPH_CANDIDATE_OPTIONS[number])
        ? Number(values.candidates) : RECORD_GRAPH_DISCOVERY_DEFAULTS.candidates,
      graphs: RECORD_GRAPH_RESULT_OPTIONS.includes(values.graphs as typeof RECORD_GRAPH_RESULT_OPTIONS[number])
        ? Number(values.graphs) : RECORD_GRAPH_DISCOVERY_DEFAULTS.graphs,
    };
  } catch {
    return { ...RECORD_GRAPH_DISCOVERY_DEFAULTS };
  }
}
export function writeRecordGraphDiscoveryLimits(value: RecordGraphDiscoveryLimits): void {
  maestroStorageSet(KEY, JSON.stringify(value));
}
