"use client";
import dynamic from "next/dynamic";
import type { FctQueryTree } from "@/lib/fct-query-api";
import type { MapProviderDefinition } from "@/lib/map-provider-discovery";

// Provider runtime host. The native View tab has no Map-specific code. The
// runtime is selected by the discovered mui:Provider definition, and its XSLT
// determines its presentation and the facet decorations.
const MapProviderRuntime = dynamic(() => import("@/providers/map/runtime").then(mod => mod.MapProviderRuntime), { ssr: false });
export function PerspectiveProviderRuntime({ provider, queryXml, queryTree, addr, visibleFacetTerms }: {
  provider: MapProviderDefinition; queryXml: string; queryTree: FctQueryTree; addr: string; visibleFacetTerms: Record<string, string[]>;
}) {
  if (provider.kind === "map") return <MapProviderRuntime stylesheet={provider.stylesheet} queryXml={queryXml} queryTree={queryTree} addr={addr} visibleFacetTerms={visibleFacetTerms}/>;
  return null;
}
