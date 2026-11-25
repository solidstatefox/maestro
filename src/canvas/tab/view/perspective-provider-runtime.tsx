"use client";
import { useMemo } from "react";
import { MaestroProviderHost } from "@/components/ui/maestro-provider-host";
import type { FctQueryTree } from "@/lib/fct-query-api";
import type { DiscoveredViewProvider } from "@/lib/personal-sparql-reads";

/** Domain-neutral renderer: the selected mui:Provider owns its UI and behavior
 * in the RDF-hosted XSLT. This React boundary only supplies source XML and the
 * generic host; domain-specific behavior belongs entirely to the provider. */
export function PerspectiveProviderRuntime({ provider, queryXml, pageRows, pageKey, visibleFacetTerms }: {
  provider: DiscoveredViewProvider;
  queryXml: string;
  pageRows: readonly {uri:string;title:string}[];
  pageKey: string;
  queryTree: FctQueryTree;
  addr: string;
  visibleFacetTerms: Record<string, string[]>;
}) {
  const metadata = useMemo(() => ({ providerUri: provider.uri, shapeUri: provider.shapeUri ?? "",
    queryStylesheet: provider.queryStylesheet ?? "", resultStylesheet: provider.resultStylesheet ?? "",
    paletteStylesheet: provider.paletteStylesheet ?? "", facetStylesheet: provider.stylesheet,
  }), [provider.uri, provider.shapeUri, provider.queryStylesheet, provider.resultStylesheet, provider.paletteStylesheet, provider.stylesheet]);
  const pageJson=JSON.stringify(pageRows);
  const pageMetadata=useMemo(()=>({...metadata, pageRows:pageJson,pageKey}),[metadata,pageJson,pageKey]);
  const facetValuesKey = JSON.stringify(Object.entries(visibleFacetTerms).sort(([a],[b]) => a.localeCompare(b)).map(([key, values]) => [key, [...new Set(values)].sort()]));
  const stableFacetTerms = useMemo(() => Object.fromEntries(JSON.parse(facetValuesKey)) as Record<string, string[]>, [facetValuesKey]);
  return <MaestroProviderHost
    providerUri={provider.uri}
    componentUrn="urn:maestro:component:view:provider"
    stylesheet={provider.stylesheet}
    queryXml={queryXml}
    approved={true}
    metadata={pageMetadata}
    facetValues={stableFacetTerms}
  />;
}
