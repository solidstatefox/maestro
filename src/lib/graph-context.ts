"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { graphForPrefix, type PersonalAuthSession } from "@/lib/personal-auth";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";

/** The same manifest-relative graph paths used by /graph seeding. No config HTTP request. */
export function providerCatalogGraph(session: PersonalAuthSession | null | undefined, providerKind: ProviderKind) {
  if (!session?.graphPrefix || !session.graphStore) throw new Error("Log in to the personal graph server first.");
  const base = graphForPrefix(session.graphPrefix);
  const graph = providerKind === "formats" ? "$ALL$" : providerKind === "transcoders" ? `${resolveGraph(GRAPH.OTC_TRANSCODERS, base)}` : `${resolveGraph(GRAPH.SHACL_POLICIES, base)}`;
  return { graph, personalEndpointUrl: session.graphStore };
}
export function historyGraph(session: PersonalAuthSession | null | undefined) {
  if (!session?.graphPrefix || !session.graphStore) throw new Error("Log in to the personal graph server first.");
  return { historyGraph: graphForPrefix(session.graphPrefix), personalEndpointUrl: session.graphStore };
}

/** Private per-account graph for append-only Graph Server health history. */
export const GRAPH_SERVER_STATUS_GRAPH_SUFFIX = "/graph/server-status" as const;
export const graphServerStatusGraph = (base: string) => `${base}${GRAPH_SERVER_STATUS_GRAPH_SUFFIX}`;
