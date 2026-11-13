"use client";

/** Provider-neutral execution of XSLT-generated queries. The existing FCT and
 * SPARQL proxy/dispatch/cancellation pipeline remains authoritative; there is
 * no second queue, revision token or domain-specific lookup here.
 */
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { sparqlBindingsToXml } from "@/lib/sparql-results-xml";

export type ProviderQueryRequest =
  | { kind: "fct"; queryXml: string }
  | { kind: "sparql"; addr: string; sparql: string };

export { sparqlBindingsToXml } from "@/lib/sparql-results-xml";
export async function executeProviderDerivedQuery(query: ProviderQueryRequest, signal?: AbortSignal): Promise<string> {
  if (query.kind === "fct") {
    if (!query.queryXml || query.queryXml.length > 200000) throw new Error("A bounded derived FCT query is required.");
    const response = await cachedFetchFct("/proxy/api/fct", {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "text/xml; charset=utf-8", "X-Maestro-Query-Label": "XSLTProvider" },
      body: query.queryXml,
    });
    const xml = await response.text();
    if (!response.ok) throw new Error(`Provider FCT query failed (HTTP ${response.status}): ${xml.slice(0, 300)}`);
    return xml;
  }
  if (!query.addr || !query.sparql || query.sparql.length > 250000) throw new Error("A graph address and bounded SPARQL query are required.");
  const response = await maestroQueryFetch("/proxy/api/sparql", {
    method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addr: query.addr, resultsQuery: { sparql: query.sparql } }),
  });
  const result = await response.json() as {
    head?: { vars?: string[] }; boolean?: boolean;
    results?: { bindings?: Record<string, { type?: string; value?: string; datatype?: string; "xml:lang"?: string }>[] };
    error?: string;
  };
  if (!response.ok) throw new Error(result.error ?? `Provider SPARQL query failed (HTTP ${response.status})`);
  return sparqlBindingsToXml(result);
}
