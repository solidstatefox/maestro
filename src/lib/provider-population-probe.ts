"use client";

import { compileProviderXsltQuery } from "@/lib/provider-xslt-query";
import { splitCompiledSelect } from "@/lib/provider-fct-context";
import { snapshotFctQueryXml, fctQueryExecutionAddress } from "@/lib/fct-query-clone";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { isBoundedReadOnlySparql } from "@/lib/sparql-read-guard";
import { browserLog } from "@/lib/maestro-client-logging";

/** A shape-authored runtime must have at least one matching focus resource.
 * The same provider query stylesheet supplies the WHERE constraints as its
 * actual renderer. Discard ordering, paging and grouping presentation; do
 * not move the live view or change its graph. The bounded existence SELECT
 * uses the existing Results transport, which preserves Anytime evidence.
 * No coordinates or provider identifiers are hardcoded in the host. */
export async function probeProviderPopulation(
  queryXml: string, shapeUri: string, stylesheet: string, providerUri: string, signal?: AbortSignal,
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    const snapshot = snapshotFctQueryXml(queryXml, "data");
    const addr = fctQueryExecutionAddress(snapshot);
    if (!addr) return false;
    const compiled = await compileProviderXsltQuery(snapshot, shapeUri, stylesheet, signal);
    const { prefix, where } = splitCompiledSelect(compiled.sparql);
    // The provider's selection is expressed in WHERE (the query-template
    // contract); the projection, DISTINCT ordering and pagination are not
    // needed to prove that at least one such resource exists.
    const sparql = `${prefix}SELECT (1 AS ?c1) WHERE {\n${where}\n} LIMIT 1`;
    if (!isBoundedReadOnlySparql(sparql, 100000)) return false;
    const response = await maestroQueryFetch("/proxy/api/sparql", {
      method: "POST", cache: "no-store", signal,
      headers: {"x-maestro-view-tab": "view", "x-maestro-view-ribbon": `perspectives:${providerUri}`,  "Content-Type": "application/json", ...proxyDebugHeaders("view-discover", `PerspectiveEligibility:${providerUri}`),
        "X-Maestro-Query-Timeout-Ms": String(Math.min(5000, Math.max(1000, compiled.timeoutMs || 5000))) },
      body: JSON.stringify({ addr, resultsQuery: { sparql } }),
    });
    signal?.throwIfAborted();
    if (!response.ok) throw new Error(`Perspective eligibility HTTP ${response.status}`);
    const result = await response.json() as { results?: { bindings?: Array<{ c1?: { value?: string } }> }; incomplete?: boolean };
    signal?.throwIfAborted();
    // A returned witness proves existence even if the endpoint reports
    // Anytime; an empty incomplete result does not prove absence or permit
    // admission. Failed probes likewise cannot authorize a ribbon entry.
    return Array.isArray(result.results?.bindings) && result.results.bindings.some(row => row.c1?.value === "1");
  } catch (error) {
    if (signal?.aborted) throw error;
    browserLog.warn("perspective.eligibility.failed", { providerUri, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
