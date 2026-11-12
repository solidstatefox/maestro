"use client";
import { useEffect, useState } from "react";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { compileMapQuery, readMapRows } from "@/providers/map/query";

export type MapProviderDefinition = { uri: string; label: string; stylesheet: string; kind: "map"; icon: string };
/** Generic discovery of the SHACL map provider. No hard-coded map stylesheet. */
export function useMapProviderDefinition(enabled: boolean, queryXml: string) {
  const [provider, setProvider] = useState<MapProviderDefinition | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setProvider(null);
    if (!enabled || !queryXml) return () => controller.abort();
    void (async () => {
      try {
        // Provider registration alone does not make every FCT result mappable.
        // Check the current view-bearing focus, using exactly the same graph
        // address, FCT constraints and geometry support as the Map runtime.
        const { sparql, timeoutMs } = compileMapQuery(queryXml, "");
        const parsed = new DOMParser().parseFromString(queryXml, "application/xml");
        const addr = parsed.documentElement.getAttribute("addr") ?? "";
        if (!addr || parsed.querySelector("parsererror")) return;
        const [discovery, probe] = await Promise.all([
          fetch("/proxy/api/map-provider", { method: "POST", cache: "no-store", signal: controller.signal }),
          maestroQueryFetch("/proxy/api/sparql", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { "Content-Type": "application/json", ...(timeoutMs > 0 ? { "x-maestro-query-timeout-ms": String(timeoutMs) } : {}) },
            body: JSON.stringify({ addr, resultsQuery: { sparql } }),
          }),
        ]);
        if (!discovery.ok || !probe.ok) return;
        const [data, mapped] = await Promise.all([
          discovery.json() as Promise<{ provider?: MapProviderDefinition | null }>,
          probe.json() as Promise<{ results?: { bindings?: Record<string, { value?: string; type?: string }>[] } }>,
        ]);
        if (!controller.signal.aborted && readMapRows(mapped.results?.bindings ?? []).length > 0) {
          setProvider(data.provider ?? null);
        }
      } catch { /* No map ribbon item for invalid or unavailable geometry. */ }
    })();
    return () => controller.abort();
  }, [enabled, queryXml]);
  return provider;
}
