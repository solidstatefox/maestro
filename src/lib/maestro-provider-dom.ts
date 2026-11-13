"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { executeProviderDerivedQuery, type ProviderQueryRequest } from "@/lib/maestro-provider-query-executor";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { compileProviderXsltQuery } from "@/lib/provider-xslt-query";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { publishXsltFacetDecorations, resetFacetDecorations, type DecorationFacet } from "@/lib/facet-decoration-contract";

/** The generic provider host resolves URI-addressed furniture; XSLT owns its UI. */
export function resolveMaestroComponent(urn: string): HTMLElement | null {
  return document.getElementById(urn);
}

/** Mount provider-authored HTML. Inline scripts must be replaced by executable
 * nodes because browser HTML parsing deliberately leaves them inert. */
export function mountMaestroProviderHtml(componentUrn: string, html: string): HTMLElement {
  const target = resolveMaestroComponent(componentUrn);
  if (!target) throw new Error(`Maestro component ${componentUrn} is not mounted.`);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();
  while (parsed.body.firstChild) fragment.appendChild(parsed.body.firstChild);
  // DOMParser-created script nodes are inert. Mount the ordinary markup first,
  // then replace placeholders with freshly created, *connected* script nodes.
  // This makes document.currentScript and sibling component lookups reliable.
  const pending = Array.from(fragment.querySelectorAll("script")).map(script => {
    const marker = document.createComment("provider-script");
    script.replaceWith(marker);
    return { script, marker };
  });
  target.replaceChildren(fragment);
  for (const { script, marker } of pending) {
    const executable = document.createElement("script");
    for (const attr of Array.from(script.attributes)) executable.setAttribute(attr.name, attr.value);
    executable.textContent = script.textContent;
    marker.replaceWith(executable);
  }
  return target;
}

/** Installed library housekeeping; never Map data or presentation logic. */
export async function loadMaestroUiLibrary(name: "maplibre-gl") {
  switch (name) {
    case "maplibre-gl": {
      const library = await import("maplibre-gl");
      library.setWorkerUrl("/maplibre-worker/maplibre-gl-worker.mjs");
      return library;
    }
  }
}

const mountedSignals = new Map<string, AbortSignal>();
export function registerMaestroProviderMount(urn: string, signal: AbortSignal): void { mountedSignals.set(urn, signal); }
export function unregisterMaestroProviderMount(urn: string, signal: AbortSignal): void {
  if (mountedSignals.get(urn) === signal) mountedSignals.delete(urn);
}

/** A thin bridge to the EXISTING proxy, XSLT and FCT value-projection systems.
 * The provider's XSLT/embedded code decides what to query and what to render. */
export type MaestroProviderBrowserApi = {
  getComponent: typeof resolveMaestroComponent;
  getMountSignal: (urn: string) => AbortSignal | undefined;
  executeQuery: (query: ProviderQueryRequest, signal?: AbortSignal) => Promise<string>;
  compileQuery: typeof compileProviderXsltQuery;
  transformXml: (stylesheet: string, xml: string, signal?: AbortSignal) => Promise<string>;
  projectValues: (queryXml: string, resources: { type: string; value: string }[], projections: { property: string; direction: string }[], signal?: AbortSignal) => Promise<string>;
  decorateFacets: (providerUri: string, stylesheet: string, facets: DecorationFacet[], selected: string, action: (name: string, facetKey: string) => void) => Promise<void>;
  clearFacetDecorations: (providerUri: string) => void;
  loadLibrary: typeof loadMaestroUiLibrary;
};
declare global { interface Window { MaestroProvider?: MaestroProviderBrowserApi } }

export function installMaestroProviderBridge(): MaestroProviderBrowserApi {
  if (!window.MaestroProvider) window.MaestroProvider = {
    getComponent: resolveMaestroComponent,
    getMountSignal: urn => mountedSignals.get(urn),
    executeQuery: executeProviderDerivedQuery,
    compileQuery: compileProviderXsltQuery,
    transformXml: (stylesheet, xml, signal) => transformWithMaestroSaxon(stylesheet, xml, { signal }),
    projectValues: async (queryXml, resources, projections, signal) => {
      const response = await cachedFetchFct("/proxy/api/fct", {
        method: "POST", cache: "no-store", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryXml, resources, projections }),
      });
      const result = await response.text();
      if (!response.ok) throw new Error(`Provider FCT projection failed (HTTP ${response.status}): ${result.slice(0, 250)}`);
      return result;
    },
    decorateFacets: (source, stylesheet, facets, selected, onAction) => publishXsltFacetDecorations(source, stylesheet, facets, selected, onAction),
    clearFacetDecorations: resetFacetDecorations,
    loadLibrary: loadMaestroUiLibrary,
  };
  return window.MaestroProvider;
}
