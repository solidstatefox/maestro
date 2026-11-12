"use client";

import { createElement, useEffect, useMemo, useState, type ReactNode } from "react";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { publishXsltFacetDecorations, resetFacetDecorations, type DecorationFacet } from "@/lib/facet-decoration-contract";
import { Map, useMap, MapMarker, MarkerContent, MarkerTooltip, MapControls } from "@/components/ui/map";
import { compileMapQuery, readMapRows, currentViewColorFacets, currentMapFacetNodes, type MapRow } from "@/providers/map/query";
import type { FctQueryTree } from "@/lib/fct-query-api";
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { listValuesQueryClone, parseListValuesXml, fctTermKey } from "@/canvas/utils/fct-response";
import { LIST_VALUES_MAX_RESOURCES } from "@/lib/list-values-transport";
import { toLabel } from "@/lib/uri-labels";

// Reuse the same MapLibre/shadcn map primitives as Place record formatting.
type Facet = { uri: string; label: string; direction: "forward" | "reverse" | "class"; key: string };
const EMPTY_FACET_TERMS: string[] = [];
/** Provider-owned palette. Sort the actual assigned RDF term keys, then
 * distribute hues evenly around the entire wheel. Saturation and lightness
 * stay in the color spectrum: no white, pale grey or near-white values.
 * The same map is passed to XSLT for facet bars and to MapLibre markers. */
function hueHex(hue: number): string {
  const s = .76, l = .43, chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const m = l - chroma / 2;
  const rgb = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${rgb.map(n => Math.round((n + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
function colorPalette(keys: string[]): ReadonlyMap<string, string> {
  const unique = [...new Set(keys.filter(Boolean))].sort();
  return new globalThis.Map(unique.map((key, index) => [key, hueHex(20 + (360 * index) / unique.length)]));
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

export function MapProviderRuntime({ queryXml, queryTree, addr, stylesheet, visibleFacetTerms }: { queryXml: string; queryTree: FctQueryTree; addr: string; stylesheet: string; visibleFacetTerms: Record<string, string[]> }) {
  const facets: Facet[] = useMemo(() => currentViewColorFacets(queryTree).map(facet => ({ ...facet, label: facet.direction === "class" ? "Categories" : `${toLabel(facet.uri, "Property")}${facet.direction === "reverse" ? " of" : ""}` })), [queryXml]);
  type Layout = { name: string; text: string; className: string; ariaLabel: string; id: string; htmlFor: string; value: string; role: string; action: string; slot: string; children: Layout[] };
  const [layout, setLayout] = useState<Layout | null>(null);
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
        // The dropdown stores a direction-qualified key ("forward|IRI" or "reverse|IRI").
        // The map compiler accepts an IRI only; direction is used by list-values below.
        const selectedColorFacet = facets.find(facet => facet.key === colorBy);
        if (colorBy && !selectedColorFacet) throw new Error("Invalid Color by selection.");
        const { sparql, timeoutMs } = compileMapQuery(queryXml, selectedColorFacet?.uri ?? "");
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
          const projectionXml = listValuesQueryClone(queryXml);
          type ColorTerm = { value: string; termKey: string };
          const projected = new globalThis.Map<string, ColorTerm[]>();
          const projectionDirection = selectedFacet.direction === "class" ? "forward" : selectedFacet.direction;
          for (let offset = 0; offset < mapped.length; offset += LIST_VALUES_MAX_RESOURCES) {
            if (controller.signal.aborted) return;
            const batch = mapped.slice(offset, offset + LIST_VALUES_MAX_RESOURCES);
            const projection = await cachedFetchFct("/proxy/api/fct", {
              method: "POST", cache: "no-store", signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queryXml: projectionXml, resources: batch.map(point => ({ type: "uri", value: point.uri })), projections: [{ property: selectedFacet.uri, direction: projectionDirection }] }),
            });
            const xml = await projection.text();
            if (!projection.ok) throw new Error(`Map Color by projection failed (HTTP ${projection.status}): ${xml.slice(0, 250)}`);
            for (const [resource, values] of parseListValuesXml(xml)) {
              const terms = values
                .filter(value => value.property === selectedFacet.uri && value.direction === projectionDirection)
                .flatMap(value => value.values)
                .filter(term => term.value && term.value !== "-")
                .map(term => ({ value: term.value, termKey: fctTermKey(term.value, term.type === "uri" ? "uri" : term.datatype ?? (term.lang ? undefined : "string"), term.lang) }));
              // Collect every RDF value for a resource. A Category or other
              // multi-valued property must not collapse to the first value.
              projected.set(resource, [...new globalThis.Map([...(projected.get(resource) ?? []), ...terms].map(term => [term.termKey, term])).values()]);
            }
          }
          // Selected values belong to the very same live facet scope. Prefer
          // these when multiple values compete for a single marker color.
          const selected = new Set<string>();
          for (const node of currentMapFacetNodes(queryTree)) {
            if (selectedFacet.direction === "class" && node.name === "class" && node.attributes.iri) {
              selected.add(fctTermKey(node.attributes.iri, "uri"));
            } else if (node.attributes.iri === selectedFacet.uri &&
                ((selectedFacet.direction === "forward" && node.name === "property") ||
                 (selectedFacet.direction === "reverse" && node.name === "property-of"))) {
              for (const value of node.children.filter(child => child.name === "value" && child.text)) {
                selected.add(fctTermKey(value.text ?? "", value.attributes.datatype ?? (value.attributes["xml:lang"] ? undefined : "string"), value.attributes["xml:lang"]));
              }
            }
          }
          const frequency = new globalThis.Map<string, number>();
          for (const terms of projected.values()) for (const term of terms) {
            frequency.set(term.termKey, (frequency.get(term.termKey) ?? 0) + 1);
          }
          // A marker can display only one color. Prefer selected values, then
          // the least-common value (which best separates overlapping classes),
          // then a stable lexical tie-breaker. Facet bars show assigned colors.
          mapped = mapped.map(point => {
            const values = [...(projected.get(point.uri) ?? [])].sort((a, b) =>
              Number(selected.has(b.termKey)) - Number(selected.has(a.termKey)) ||
              (frequency.get(a.termKey) ?? 0) - (frequency.get(b.termKey) ?? 0) ||
              a.termKey.localeCompare(b.termKey));
            const chosen = values[0];
            return { ...point, colorValue: chosen?.value ?? "", colorTermKey: chosen?.termKey ?? "" };
          });
          if (alive) setPoints(mapped);
        }
      } catch (cause) {
        if (alive && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Map query failed.");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; controller.abort(); };
  }, [key, addr, colorBy, queryXml]);
  // The visible FCT facet can contain values without geocoded resources.
  // Build one palette from both sources so those items receive colors too,
  // while markers and facet bars continue to share the exact same palette.
  const activeTermKeys = visibleFacetTerms[colorBy] ?? EMPTY_FACET_TERMS;
  const palette = useMemo(() => colorPalette([
    ...points.map(point => point.colorTermKey), ...activeTermKeys,
  ]), [points, activeTermKeys]);
  // Render the facet controls AND item decorations from the same provider
  // XSLT. TSX knows only the neutral direction/IRI/value slot contract.
  useEffect(() => {
    const specs: DecorationFacet[] = facets.map(facet => ({
      direction: facet.direction, iri: facet.uri, items: [] as { value: string; color: string }[],
    }));
    for (const spec of specs) if (`${spec.direction}|${spec.iri}` === colorBy) {
      spec.items = [...new Set([...points.map(point => point.colorTermKey), ...activeTermKeys].filter(Boolean))].map(value => ({ value, color: palette.get(value) ?? "" }));
    }
    void publishXsltFacetDecorations("map-provider", stylesheet, specs, colorBy, (action, key) => {
      if (action === "toggle-colorby") setColorBy(current => current === key ? "" : key);
    }).catch(() => { /* A stale XSLT render must not remove current facet controls. */ });
  }, [stylesheet, facets, colorBy, points, palette, activeTermKeys]);
  useEffect(() => () => resetFacetDecorations("map-provider"), []);
  const center = useMemo<[number, number]>(() => points.length ? [points.reduce((sum, point) => sum + point.lng, 0) / points.length, points.reduce((sum, point) => sum + point.lat, 0) / points.length] : [0, 15], [points]);
  // Provider-authored XSLT creates the entire Map layout and Color-by toolbar,
  // including the options, labels, and status. The runtime contributes only
  // trusted MapLibre and select-change behavior to the XSLT-chosen slots.
  useEffect(() => {
    let active = true;
    const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const input = `<context mode="view"><facets>${facets.map(facet => `<facet direction="${facet.direction}" iri="${escapeXml(facet.uri)}" label="${escapeXml(facet.label)}"/>`).join("")}</facets>` +
      `<status mapped="${points.length}" loading="${loading}" incomplete="${incomplete}" error="${escapeXml(error)}" styleError="${escapeXml(mapStyleError)}"/></context>`;
    void transformWithMaestroSaxon(stylesheet, input).then(markup => {
      if (!active) return;
      const doc = new DOMParser().parseFromString(markup, "application/xml");
      const root = doc.documentElement;
      if (root.localName !== "section" || doc.querySelector("parsererror")) throw new Error("Invalid map provider layout.");
      const allowed = new Set(["section", "div", "label", "select", "option", "span"]);
      const read = (node: Node): Layout => {
        if (node.nodeType === Node.TEXT_NODE) return { name: "#text", text: node.textContent ?? "", className: "", ariaLabel: "", id: "", htmlFor: "", value: "", role: "", action: "", slot: "", children: [] };
        if (node.nodeType !== Node.ELEMENT_NODE) throw new Error("Unsupported map provider output node.");
        const element = node as Element;
        if (!allowed.has(element.localName)) throw new Error("Unsupported map provider output element.");
        const slot = element.getAttribute("data-provider-slot") ?? "";
        const action = element.getAttribute("data-provider-action") ?? "";
        if (slot && slot !== "map" || action && action !== "colorby") throw new Error("Unsupported map provider slot/action.");
        return { name: element.localName, text: "", className: (element.getAttribute("class") ?? "").slice(0, 1024),
          ariaLabel: (element.getAttribute("aria-label") ?? "").slice(0, 128), id: (element.getAttribute("id") ?? "").slice(0, 128),
          htmlFor: (element.getAttribute("for") ?? "").slice(0, 128), value: element.getAttribute("value") ?? "",
          role: (element.getAttribute("role") ?? "").slice(0, 32), action, slot,
          children: Array.from(element.childNodes).filter(child => child.nodeType === Node.ELEMENT_NODE || child.nodeType === Node.TEXT_NODE).map(read) };
      };
      const next = read(root);
      const slots = (function walk(node: Layout): string[] { return [node.slot, ...node.children.flatMap(walk)]; })(next);
      if (slots.filter(slot => slot === "map").length !== 1) throw new Error("Map provider must supply exactly one map slot.");
      setLayout(next);
    }).catch(() => { if (active) setLayout(null); });
    return () => { active = false; };
  }, [stylesheet, facets, points.length, loading, incomplete, error, mapStyleError]);

  const mapContent = <Map center={center} zoom={points.length ? 4 : 1} className="h-full w-full" onMapError={setMapStyleError} onMapReady={() => setMapStyleError("")}>
    <MapControls position="top-right" showZoom showCompass showFullscreen showLocate />
    <MapExtent points={points} />
    {points.map(point => <MapMarker key={point.uri} longitude={point.lng} latitude={point.lat}>
      <MarkerContent><div className="size-4 rounded-full border-2 border-white shadow-lg" style={{ backgroundColor: palette.get(point.colorTermKey) ?? "#7c3aed" }} /></MarkerContent>
      <MarkerTooltip><div className="max-w-72 rounded-lg bg-background p-3 text-foreground shadow-md">
        <div className="line-clamp-2 text-sm font-semibold">{point.title === point.uri ? toLabel(point.uri, "OBJECT") : point.title}</div>
        <div className="mt-1 break-all text-xs text-muted-foreground">{point.uri}</div>
        {colorBy && point.colorValue && <div className="mt-2 text-xs"><span className="font-medium">{facets.find(facet => facet.key === colorBy)?.label ?? "Color"}: </span>{point.colorValue}</div>}
        <div className="mt-1 text-xs tabular-nums text-muted-foreground">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</div>
      </div></MarkerTooltip>
    </MapMarker>)}
  </Map>;
  const renderLayout = (node: Layout, key: string): ReactNode => {
    if (node.name === "#text") return node.text;
    const props: Record<string, unknown> = { key, ...(node.className ? { className: node.className } : {}),
      ...(node.ariaLabel ? { "aria-label": node.ariaLabel } : {}), ...(node.id ? { id: node.id } : {}),
      ...(node.htmlFor ? { htmlFor: node.htmlFor } : {}), ...(node.role ? { role: node.role } : {}) };
    if (node.name === "option") props.value = node.value;
    if (node.name === "select" && node.action === "colorby") {
      props.value = colorBy;
      props.onChange = (event: { currentTarget: HTMLSelectElement }) => setColorBy(event.currentTarget.value);
    }
    return createElement(node.name, props, node.slot === "map" ? mapContent : node.children.map((child, index) => renderLayout(child, `${key}-${index}`)));
  };
  return layout ? <>{renderLayout(layout, "map-provider")}</> : <div role="status" className="min-h-72 p-3 text-xs text-muted-foreground">Loading map provider…</div>;
}
