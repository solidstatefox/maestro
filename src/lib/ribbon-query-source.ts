"use client";

import { buildAnalysisDiscoverySparql, buildViewDiscoverySparql, personalDiscoveryTarget } from "@/lib/personal-sparql-reads";
import { providerCatalogGraph } from "@/lib/graph-context";
import { graphServerUrlMatches } from "@/lib/graph-server-health";
import { hasProviderFctFilters, providerFctQuery } from "@/lib/provider-fct-query";
import { serializeFctQuery, type FctQueryTree } from "@/lib/fct-query-api";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import type { PersonalAuthSession } from "@/lib/personal-auth";
import type { RibbonDiscoveryLimits } from "@/lib/ribbon-discovery-limits";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";

export type RibbonQueryFormat = "perspectives-sparql" | "providers-sparql" | "analysis-sparql";
export const RIBBON_QUERY_FORMATS = [
  { value: "perspectives-sparql", label: "View > Perspectives" },
  { value: "providers-sparql", label: "View > Providers" },
  { value: "analysis-sparql", label: "Analyze > Analysis" },
] as const;
export function isRibbonQueryFormat(value: string): value is RibbonQueryFormat {
  return RIBBON_QUERY_FORMATS.some(item => item.value === value);
}
export const PROVIDER_QUERY_KINDS: readonly { value: ProviderKind; label: string }[] = [
  { value: "policies", label: "Policies" },
  { value: "formats", label: "Formats" },
  { value: "facet-widgets", label: "Facets" },
  { value: "transcoders", label: "Transcoders" },
  { value: "curators", label: "Curators" },
  { value: "kinds", label: "Kinds" },
  { value: "perspectives", label: "Perspectives" },
  { value: "analysis-providers", label: "Analysis" },
  { value: "fsm-providers", label: "FSM Providers" },
];

type Source = { code: string; addr?: string; filename: string; note: string };
type Input = {
  format: RibbonQueryFormat;
  session: PersonalAuthSession | null | undefined;
  tree: FctQueryTree;
  endpoints: readonly { url: string; schemeInferred?: boolean }[];
  batchSize: number;
  limits?: RibbonDiscoveryLimits;
  providerKind: ProviderKind;
  analysisClasses: string[];
  /** null means no validated contextual evidence for this exact History visit. */
  contextualProviders: string[] | null;
};
/** Inspection only: the existing discovery builders and FCT compiler generate
 * code locally. Opening the Code Block neither runs nor navigates a query. */
export function ribbonQuerySource(input: Input): Source {
  const { format, session, providerKind } = input;
  const filename = format === "providers-sparql" ? `view-providers-${providerKind}.sparql`
    : format === "perspectives-sparql" ? "view-perspectives.sparql" : "analyze-analysis.sparql";
  const unavailable = (note: string): Source => ({ filename, code: `# ${note.replace(/\r?\n/g, "\n# ")}`, note });
  if (!session) return unavailable("Log in to the Personal Graph Server to resolve the discovery graph and endpoint.");
  try {
    if (format === "providers-sparql") {
      // The Providers ribbon is static; its buttons select real FCT queries.
      // Use precisely the same graph/endpoint and scope selection as navigation.
      const { graph, personalEndpointUrl } = providerCatalogGraph(session, providerKind);
      const existing = hasProviderFctFilters(input.tree, providerKind, graph, personalEndpointUrl);
      const endpoint = input.endpoints.find(item => graphServerUrlMatches(item.url, personalEndpointUrl, item.schemeInferred));
      if (!existing && !endpoint) return unavailable("The Providers query personal graph server is not registered.");
      const tree = existing ? input.tree : providerFctQuery(input.tree, providerKind, graph, endpoint!.url, input.batchSize);
      return { filename, addr: tree.attributes.addr, code: compileFctXmlToSparql(serializeFctQuery(tree)).query,
        note: "The Providers buttons are fixed. This is the selected catalog's FCT-compiled SPARQL preview; transport-time rewrites and card enrichment are separate." };
    }
    const { graphs, addr } = personalDiscoveryTarget(session);
    if (format === "perspectives-sparql") return { filename, addr, code: buildViewDiscoverySparql(graphs,input.limits?.perspectives),
      note: "Exact Perspective candidate SELECT. Class matching, contextual SHACL, effective approval and population probes are separate browser-side eligibility steps." };
    return { filename, addr, code: buildAnalysisDiscoverySparql(graphs, input.analysisClasses, input.contextualProviders ?? [],input.limits?.analysis),
      note: input.contextualProviders === null
        ? "Class-only preview: contextual SHACL has not been validated for this History visit. The actual Analysis discovery may include additional provider IRIs after validation."
        : "Analysis discovery using the current focus classes and the last validated contextual provider IRIs for this History visit." };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}
