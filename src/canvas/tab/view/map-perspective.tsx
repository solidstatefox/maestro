"use client";

import { useEffect, useMemo, useState } from "react";
import { Map, useMap, MapMarker, MarkerContent, MarkerTooltip, MapControls } from "@/components/ui/map";
import { compileMapQuery, readMapRows, type MapRow } from "@/lib/map-perspective";
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { listValuesQueryClone, parseListValuesXml } from "@/canvas/utils/fct-response";
import { LIST_VALUES_MAX_RESOURCES } from "@/lib/list-values-transport";
import { toLabel } from "@/lib/uri-labels";

// Reuse the same MapLibre/shadcn map primitives as Place record formatting.
type Facet = { uri: string; label: string; direction: "forward" | "reverse"; key: string };
function colorFor(value: string): string {
  if (!value) return "#64748b";
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 68% 44%)`;
}

function MapExtent({ points }: { points: MapRow[] }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || !points.length) return;
    const minLng = Math.min(...points.map(point => point.lng));
    const maxLng = Math.max(...points.map(point => point.lng));
    const minLat = Math.min(...points.map(point => point.lat));
    const maxLat = Math.max(...points.map(point => point.lat));
    // Resize before fitting: this View tab can have been mounted while hidden
    // or while the center pane was being resized.
    map.resize();
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 48, maxZoom: 12, duration: 0 });
    const container = map.getContainer();
    const observer = new ResizeObserver(() => { map.resize(); map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 48, maxZoom: 12, duration: 0 }); });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map, isLoaded, points]);
  return null;
}

export function MapPerspective({ queryXml, facets, addr }: { queryXml: string; facets: Facet[]; addr: string }) {
  const [colorBy, setColorBy] = useState("");
  const [mapStyleError, setMapStyleError] = useState("");
  useEffect(() => { if (colorBy && !facets.some(f => f.key === colorBy)) setColorBy(""); }, [colorBy, facets]);
  const [points, setPoints] = useState<MapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const key = useMemo(() => queryXml + "\u0000" + colorBy, [queryXml, colorBy]);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true); setError(""); setIncomplete(false);
    void (async () => {
      try {
        const { sparql, timeoutMs } = compileMapQuery(queryXml, colorBy);
        const response = await maestroQueryFetch("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...(timeoutMs > 0 ? { "x-maestro-query-timeout-ms": String(timeoutMs) } : {}) },
          body: JSON.stringify({ addr, resultsQuery: { sparql } }),
        });
        const data = await response.json() as { results?: { bindings?: Record<string, { value?: string; type?: string }>[] }; error?: string; incomplete?: boolean };
        if (!response.ok) throw new Error(data.error || `Map query failed (HTTP ${response.status})`);
        let mapped = readMapRows(data.results?.bindings ?? []);
        if (alive) { setPoints(mapped); setIncomplete(Boolean(data.incomplete)); }
        // Reuse the *same* FCT list-values projection as the Results badges.
        // It accepts resources already bound by the map query, so Color by
        // does not change the faceted population or the selected date scope.
        if (colorBy && mapped.length) {
          const selectedFacet = facets.find(facet => facet.key === colorBy);
          if (!selectedFacet) return;
          const projectionXml = listValuesQueryClone(queryXml, [{ property: selectedFacet.uri, direction: selectedFacet.direction }]);
          const colors = new globalThis.Map<string, string>();
          for (let offset = 0; offset < mapped.length; offset += LIST_VALUES_MAX_RESOURCES) {
            if (controller.signal.aborted) return;
            const batch = mapped.slice(offset, offset + LIST_VALUES_MAX_RESOURCES);
            const projection = await cachedFetchFct("/proxy/api/fct", {
              method: "POST", cache: "no-store", signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queryXml: projectionXml, resources: batch.map(point => ({ type: "uri", value: point.uri })) }),
            });
            const xml = await projection.text();
            if (!projection.ok) throw new Error(`Map Color by projection failed (HTTP ${projection.status}): ${xml.slice(0, 250)}`);
            for (const [resource, values] of parseListValuesXml(xml)) {
              const term = values.find(value => value.property === selectedFacet.uri && value.direction === selectedFacet.direction)?.values
                .find(value => value.value && value.value !== "-");
              if (term) colors.set(resource, term.value);
            }
          }
          mapped = mapped.map(point => ({ ...point, colorValue: colors.get(point.uri) ?? "" }));
          if (alive) setPoints(mapped);
        }
      } catch (cause) {
        if (alive && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Map query failed.");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; controller.abort(); };
  }, [key, addr, colorBy, queryXml]);
  const center = useMemo<[number, number]>(() => points.length ? [points.reduce((sum, point) => sum + point.lng, 0) / points.length, points.reduce((sum, point) => sum + point.lat, 0) / points.length] : [0, 15], [points]);
  const legend = useMemo(() => [...new Set(points.map(point => point.colorValue).filter(Boolean))].sort().slice(0, 20), [points]);
  return <section className="flex min-h-0 flex-1 flex-col" aria-label="Map perspective">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
      <label htmlFor="maestro-map-color-by" className="shrink-0 font-medium">Color by:</label>
      <select id="maestro-map-color-by" value={colorBy} onChange={event => setColorBy(event.target.value)} className="min-w-0 max-w-72 rounded-md border bg-background px-2 py-1 text-sm">
        <option value="">None</option>
        {facets.map(facet => <option key={facet.key} value={facet.key}>{facet.label}</option>)}
      </select>
      {loading && <span className="text-xs text-muted-foreground" role="status">Locating map resources…</span>}
      {!loading && <span className="text-xs text-muted-foreground">{points.length} mapped resources{incomplete ? " (partial)" : ""}</span>}
      {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
      {mapStyleError && <span className="text-xs text-destructive" role="alert">{mapStyleError}</span>}
    </div>
    <div className="flex min-h-[300px] min-w-0 flex-1 overflow-hidden">
      <div className="relative min-w-0 flex-1">
      <Map center={center} zoom={points.length ? 4 : 1} className="h-full w-full" onMapError={setMapStyleError} onMapReady={() => setMapStyleError("")}>
        <MapControls position="top-right" showZoom showCompass showFullscreen showLocate />
        <MapExtent points={points} />
        {points.map(point => <MapMarker key={point.uri} longitude={point.lng} latitude={point.lat}>
          <MarkerContent><div className="size-4 rounded-full border-2 border-white shadow-lg" style={{ backgroundColor: colorFor(point.colorValue) }} /></MarkerContent>
          <MarkerTooltip><div className="max-w-72 rounded-lg bg-background p-3 text-foreground shadow-md">
            <div className="line-clamp-2 text-sm font-semibold">{point.title === point.uri ? toLabel(point.uri, "OBJECT") : point.title}</div>
            <div className="mt-1 break-all text-xs text-muted-foreground">{point.uri}</div>
            {colorBy && point.colorValue && <div className="mt-2 text-xs"><span className="font-medium">{facets.find(facet => facet.key === colorBy)?.label}: </span>{point.colorValue}</div>}
            <div className="mt-1 text-xs tabular-nums text-muted-foreground">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</div>
          </div></MarkerTooltip>
        </MapMarker>)}
      </Map>
      </div>
      {colorBy && <aside aria-label="Map color legend" className="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto border-l bg-background p-3 sm:w-52">
        <div className="text-xs font-semibold text-muted-foreground">{facets.find(facet => facet.key === colorBy)?.label ?? "Colors"}</div>
        {legend.length ? legend.map(value => <div key={value} className="flex items-start gap-2 text-xs"><span className="mt-0.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(value) }} /><span className="min-w-0 break-words">{value}</span></div>)
          : <span className="text-xs text-muted-foreground">No values for this property in mapped resources.</span>}
      </aside>}
    </div>
  </section>;
}
