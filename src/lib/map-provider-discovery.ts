"use client";
import { useEffect, useState } from "react";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { compileProviderXsltQuery, transformProviderQueryResults } from "@/lib/provider-xslt-query";
import { discoverMapProvider } from "@/lib/map-provider";

export type MapProviderDefinition = { uri: string; label: string; stylesheet: string; kind: "map"; icon: string; shapeUri: string; queryStylesheet: string; resultStylesheet: string; paletteStylesheet: string };
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
        const parsed = new DOMParser().parseFromString(queryXml, "application/xml");
        const addr = parsed.documentElement.getAttribute("addr") ?? "";
        if (!addr || parsed.querySelector("parsererror")) return;
        const definition = await discoverMapProvider(controller.signal);
        const data = { provider: definition };
        if (!data.provider?.queryStylesheet || !data.provider.shapeUri || !data.provider.resultStylesheet || !data.provider.paletteStylesheet) return;
        const { sparql, timeoutMs } = await compileProviderXsltQuery(queryXml, data.provider.shapeUri, data.provider.queryStylesheet, controller.signal);
        const probe = await maestroQueryFetch("/proxy/api/sparql", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { "Content-Type": "application/json", ...(timeoutMs > 0 ? { "x-maestro-query-timeout-ms": String(timeoutMs) } : {}) },
            body: JSON.stringify({ addr, resultsQuery: { sparql } }),
          });
        if (!probe.ok) return;
        const mapped = await probe.json() as { results?: { bindings?: Record<string, { value?: string; type?: string }>[] } };
        if (!controller.signal.aborted && (await transformProviderQueryResults(mapped, data.provider.resultStylesheet, controller.signal)).documentElement.children.length > 0) {
          setProvider(data.provider ?? null);
        }
      } catch { /* No map ribbon item for invalid or unavailable geometry. */ }
    })();
    return () => controller.abort();
  }, [enabled, queryXml]);
  return provider;
}
