"use client";

import { cachedFetchFct } from "@/lib/client-query-cache";
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { cloneFctListStatusView } from "@/lib/fct-status-projection";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { isClientQueryBookmarked } from "@/lib/client-provider-provenance";
import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";
import { withFctQueryExecutionAddress } from "@/lib/fct-query-clone";
import { parseFctResponse, parseListValuesXml, listValuesQueryClone, type EnrichedTerm } from "@/canvas/utils/fct-response";

export type Projection = { property: string; direction: "forward" | "reverse"; path?: string[] };
export type ProjectedRecord = { uri: string; label: string; properties: Map<string, EnrichedTerm[]> };
const validIri = (iri: string) => /^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri);

/** Reuse the ordinary FCT XML pipeline and its client cache; never call a provider-specific API. */
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
export function fctListStatusClone(liveXml: string, executionAddr?: string): string {
  const clone = cloneFctListStatusView(liveXml);
  return executionAddr ? withFctQueryExecutionAddress(clone, executionAddr) : clone;
}

export async function fctStatusFacet(liveXml: string, signal?: AbortSignal) {
  const fctQuery = fctListStatusClone(liveXml);
  if (!(await isClientQueryBookmarked(liveXml, signal)))
    throw new Error("Bookmark the live query before reading Status.");
  const ctx = await personalContext();
  const xml = new DOMParser().parseFromString(liveXml, "application/xml");
  if (xml.querySelector("parsererror") || xml.documentElement.localName !== "query")
    throw new Error("The bookmarked Status FCT query is malformed.");
  const sourceAddr = xml.documentElement.getAttribute("addr") ?? "";
  const splitAt = sourceAddr.lastIndexOf("@");
  const endpoint = splitAt >= 0 ? sourceAddr.slice(splitAt + 1) : "";
  if (!/^https?:\/\//i.test(endpoint) || !sourceAddr || sourceAddr.length > 8192)
    throw new Error("The bookmarked FCT query has no valid graph-server address for Status.");
  const graph = `<${ctx.base}/status>`;
  const predicate = `<gttp://ggg.maestro.ecosys/ns/ui#status>`;
  const where = `GRAPH ${graph} { ?s ${predicate} ?status } FILTER(isIRI(?s) && isIRI(?status))`;
  const countQuery = `SELECT (COUNT(*) AS ?ct) WHERE { ${where} }`;
  const totalRows = await selectPersonal(countQuery, ctx, signal, "status-facet-count");
  const total = Number(totalRows[0]?.ct?.value ?? NaN);
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("The personal Status graph returned an invalid resource count.");
  if (total > 25_000)
    throw new Error(`Status graph has ${total} assertions; the bounded client join supports at most 25,000. No partial counts were shown.`);
  const byResource = new Map<string, Set<string>>();
  let received = 0;
  const batchSize = 400;
  while (received < total) {
    const query = `SELECT ?s ?status WHERE { ${where} } ORDER BY ?s ?status LIMIT ${batchSize} OFFSET ${received}`;
    const rows = await selectPersonal(query, ctx, signal, "status-facet-personal");
    if (!rows.length) throw new Error(`Personal Status pagination ended after ${received} of ${total} assertions.`);
    received += rows.length;
    for (const row of rows) {
      const resource = row.s?.value ?? "", status = row.status?.value ?? "";
      if (!validIri(resource) || !validIri(status)) continue;
      const items = byResource.get(resource) ?? new Set<string>();
      items.add(status); byResource.set(resource, items);
    }
  }
  if (received !== total)
    throw new Error(`Personal Status enumeration returned ${received} assertions; expected ${total}.`);

  const candidates = [...byResource.keys()];
  const counts = new Map<string, Set<string>>();
  let firstRemoteQuery = "";
  // The same query compiler that supplies the ordinary FCT viewport derives
  // the unpaginated focus and adds a bounded RDF-term constraint via its AST.
  // Keep each request well under the logged-in 10 KB generic /sparql limit.
  let cursor = 0;
  while (cursor < candidates.length) {
    const batch: string[] = [];
    let uriBytes = 0;
    while (cursor < candidates.length && batch.length < 40 &&
        (!batch.length || uriBytes + candidates[cursor].length < 2400)) {
      batch.push(candidates[cursor]); uriBytes += candidates[cursor].length;
      cursor++;
    }
    const compiled = compileFctXmlToSparql(fctQuery, undefined, false, false, false,
      false, undefined, undefined, batch);
    if (compiled.view !== "list-status" || compiled.query.length > 9500)
      throw new Error("The bounded remote Status query exceeds the available read-only SPARQL transport.");
    if (!firstRemoteQuery) firstRemoteQuery = compiled.query;
    const response = await cachedFetchFct("/proxy/api/sparql", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "Accept": "application/json",
        "x-maestro-debug-source": "status-facet-remote", "x-maestro-debug-component": "StatusFacet" },
      body: JSON.stringify({ addr: sourceAddr, query: compiled.query }),
    });
    const raw = await response.text();
    let data: {error?: string; message?: string; incomplete?: boolean;
      results?: {bindings?: Array<{c1?: {type?: string; value?: string}}>}};
    try { data = JSON.parse(raw) as typeof data; }
    catch (error) {
      throw new Error(`Remote Status SPARQL returned invalid JSON (HTTP ${response.status}): ${sanitizeUpstreamDiagnostic(raw)}; ${describeUpstreamError(error)}`, {cause: error});
    }
    if (!response.ok || data.error || data.incomplete)
      throw new Error(`Remote Status SPARQL returned HTTP ${response.status}: ${sanitizeUpstreamDiagnostic(data.error || data.message || raw)}${data.incomplete ? " (incomplete result)" : ""}`);
    if (!Array.isArray(data.results?.bindings))
      throw new Error("Remote Status SPARQL returned no SELECT bindings; counts cannot be trusted.");
    const allowed = new Set(batch);
    for (const row of data.results.bindings) {
      const resource = row.c1?.value ?? "";
      if (!allowed.has(resource)) continue;
      for (const status of byResource.get(resource) ?? []) {
        const matches = counts.get(status) ?? new Set<string>();
        matches.add(resource); counts.set(status, matches);
      }
    }
  }
  return { fctQuery: fctListStatusClone(liveXml, sourceAddr), entries: [...counts].map(([uri, resources]) => ({uri, count: resources.size}))
    .filter(item => item.count > 0),
    sparql: firstRemoteQuery || compileFctXmlToSparql(fctQuery).query, addr: sourceAddr };
}
