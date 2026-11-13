"use client";
import { useMemo } from "react";
import { MaestroProviderHost } from "@/components/ui/maestro-provider-host";
import type { FctQueryTree } from "@/lib/fct-query-api";
import type { MapProviderDefinition } from "@/lib/map-provider-discovery";

/** Domain-neutral renderer: the selected mui:Provider owns its UI and behavior
 * in the RDF-hosted XSLT. This React boundary only supplies source XML and the
 * generic host; MapLibre itself is guaranteed by the library bridge. */
export function PerspectiveProviderRuntime({ provider, queryXml, visibleFacetTerms }: {
  provider: MapProviderDefinition;
  queryXml: string;
  queryTree: FctQueryTree;
  addr: string;
  visibleFacetTerms: Record<string, string[]>;
}) {
  const metadata = useMemo(() => ({ providerUri: provider.uri, shapeUri: provider.shapeUri,
    queryStylesheet: provider.queryStylesheet, resultStylesheet: provider.resultStylesheet,
    paletteStylesheet: provider.paletteStylesheet, facetStylesheet: provider.stylesheet,
  }), [provider.uri, provider.shapeUri, provider.queryStylesheet, provider.resultStylesheet, provider.paletteStylesheet, provider.stylesheet]);
  return <MaestroProviderHost
    providerUri={provider.uri}
    componentUrn="urn:maestro:component:view:provider"
    stylesheet={provider.stylesheet}
    queryXml={queryXml}
    approved={true}
    metadata={metadata}
    facetValues={visibleFacetTerms}
  />;
}
