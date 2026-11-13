"use client";

import { cachedFetchFct } from "@/lib/client-query-cache";
import { cloneFctListStatusView } from "@/lib/fct-status-projection";
import { parseFctResponse, parseListValuesXml, listValuesQueryClone, type EnrichedTerm } from "@/canvas/utils/fct-response";

export type Projection = { property: string; direction: "forward" | "reverse"; path?: string[] };
export type ProjectedRecord = { uri: string; label: string; properties: Map<string, EnrichedTerm[]> };
const validIri = (iri: string) => /^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri);

/** Reuse the ordinary FCT XML pipeline and its client cache; never call a feature-specific API. */
export async function fctRead(xml: string, signal?: AbortSignal) {
  const response = await cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "text/xml; charset=utf-8" }, body: xml });
  const result = parseFctResponse(await response.text());
  if (!response.ok || result.error) throw new Error(result.error || `FCT returned HTTP ${response.status}`);
  return result;
}

/** Existing FCT list-values: one bounded projection query for all page resources. */
export async function fctProjectPage(liveXml: string, resources: string[], columns: Projection[], signal?: AbortSignal, isBookmarked = false): Promise<ProjectedRecord[]> {
  const unique = [...new Set(resources.filter(validIri))].slice(0, 500);
  if (!unique.length) return [];
  const queryXml = listValuesQueryClone(liveXml);
  const response = await cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queryXml, ...(isBookmarked ? { bookmarkQueryXml: liveXml } : {}),
      resources: unique.map(uri => ({ type: "uri", value: uri })), projections: columns }) });
  const xml = await response.text();
  if (!response.ok) {
    const parsed = parseFctResponse(xml);
    throw new Error(parsed.error || `FCT list-values returned HTTP ${response.status}`);
  }
  const scopes = parseListValuesXml(xml);
  const parsed = parseFctResponse(xml);
  if (parsed.error) throw new Error(parsed.error);
  const byUri = new Map(parsed.results.map(item => [item.uri, item]));
  return unique.map(uri => ({ uri, label: byUri.get(uri)?.title ?? uri,
    properties: new Map((scopes.get(uri) ?? []).map(scope => [scope.property, scope.values.filter(value => value.value !== "-")])) }));
}

/** Shared Status clone: no DOMParser or XMLSerializer round trip. The server
 * derives its own projection from the independently verified bookmark. */
export function fctListStatusClone(liveXml: string): string {
  return cloneFctListStatusView(liveXml);
}

export async function fctStatusFacet(liveXml: string, signal?: AbortSignal) {
  const fctQuery = fctListStatusClone(liveXml);
  const responseRaw = await cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queryXml: fctQuery, bookmarkQueryXml: liveXml }),
  });
  const response = parseFctResponse(await responseRaw.text());
  if (!responseRaw.ok || response.error) throw new Error(response.error || `Status FCT returned HTTP ${responseRaw.status}`);
  const entries = response.rows.map(row => ({ uri: row[0]?.value ?? "", count: Number(row[1]?.value ?? 0) }))
    .filter(item => validIri(item.uri) && Number.isSafeInteger(item.count) && item.count > 0);
  return { fctQuery, entries, sparql: response.sparql };
}
