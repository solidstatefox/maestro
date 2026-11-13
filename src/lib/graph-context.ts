"use client";

import { graphForPrefix, type PersonalAuthSession } from "@/lib/personal-auth";
import type { FeatureKind } from "@/lib/feature-view-xslt";

/** The same manifest-relative graph paths used by /graph seeding. No config HTTP request. */
export function featuresGraph(session: PersonalAuthSession | null | undefined, feature: FeatureKind) {
  if (!session?.graphPrefix || !session.graphStore) throw new Error("Log in to the personal graph server first.");
  const base = graphForPrefix(session.graphPrefix);
  const graph = feature === "formats" ? "$ALL$" : feature === "transcoders" ? `${base}/otc/transcoders` : `${base}/shacl/policies`;
  return { graph, personalEndpointUrl: session.graphStore };
}
export function historyGraph(session: PersonalAuthSession | null | undefined) {
  if (!session?.graphPrefix || !session.graphStore) throw new Error("Log in to the personal graph server first.");
  return { historyGraph: graphForPrefix(session.graphPrefix), personalEndpointUrl: session.graphStore };
}
