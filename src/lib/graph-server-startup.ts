"use client";

import type { EndpointOption } from "@/canvas/top/appbar";
import type { FctQueryTree } from "@/lib/fct-query";
import { ALL_GRAPHS } from "@/lib/graph-address-mode";
import { graphServerUrlMatches } from "@/lib/graph-server-health";
import { flattenGraphServerDirectory, validGraphServerUrl, type GraphServerDirectory } from "@/lib/graph-server-directory";
import { maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";

/** Only the missing-addr branch of URL restoration uses this fallback.
 * A saved query with a valid explicit addr never enters that branch. */
export const DEFAULT_PUBLIC_GRAPH_SERVER = "https://dbpedia.org/sparql";
const PERSONAL_DIRECTORY_PREFIX = "maestro-personal-graph-servers-v1:";

function isPersonal(entry: EndpointOption): boolean {
  return entry.id === "personal-sparql" || /personal/i.test(entry.group ?? "");
}

/** Cached personal endpoints are scoped to the restored login identity, never
 * exposed to another account just because it uses the same browser. No secrets
 * or authentication headers are persisted here. */
function personalDirectoryKey(graphStore: string, userName: string): string {
  return `${PERSONAL_DIRECTORY_PREFIX}${encodeURIComponent(graphStore.trim())}:${encodeURIComponent(userName.trim())}`;
}

export function readCachedPersonalGraphServers(graphStore: string, userName: string): EndpointOption[] {
  if (!graphStore.trim()) return [];
  try {
    const rows: unknown = JSON.parse(maestroStorageGet(personalDirectoryKey(graphStore, userName)) ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 100).flatMap((entry: unknown, index): EndpointOption[] => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Partial<EndpointOption>;
      const url = typeof row.url === "string" ? validGraphServerUrl(row.url) : null;
      if (!url) return [];
      return [{ id: typeof row.id === "string" && row.id ? row.id : `cached-personal-${index}`,
        url, label: typeof row.label === "string" && row.label ? row.label : url, group: "Personal" }];
    });
  } catch { return []; }
}

export function rememberPersonalGraphServers(graphStore: string, userName: string, entries: readonly EndpointOption[]): void {
  if (!graphStore.trim()) return;
  const rows = entries.slice(0, 100).flatMap((row): EndpointOption[] => {
    const url = validGraphServerUrl(row.url);
    return url ? [{ id: row.id, url, label: row.label, group: "Personal" }] : [];
  });
  // An empty transient RDF read must not erase the last usable personal list.
  if (rows.length) maestroStorageSet(personalDirectoryKey(graphStore, userName), JSON.stringify(rows));
}

export type StartupGraphServerCandidates = {
  preferredUrl: string;
  loginPersonalUrl?: string;
  personalEndpoints: readonly EndpointOption[];
  directory: GraphServerDirectory;
};

/** Ordered, deterministic fallback: last-selected personal -> configured
 * personal -> last-selected public -> configured public -> DBpedia. No health
 * probes, menu selections or remote queries are performed by this resolver. */
export function chooseStartupGraphServer({
  preferredUrl, loginPersonalUrl = "", personalEndpoints, directory,
}: StartupGraphServerCandidates): { url: string; addedDefault: boolean } {
  const preferred = validGraphServerUrl(preferredUrl);
  const loginEntries: EndpointOption[] = loginPersonalUrl
    ? [{ id: "login-personal", label: "Personal SPARQL", group: "Personal", url: loginPersonalUrl }] : [];
  const personal: EndpointOption[] = [
    ...loginEntries,
    ...personalEndpoints.filter(isPersonal),
    ...flattenGraphServerDirectory(directory).filter(isPersonal),
  ].filter((row) => validGraphServerUrl(row.url));
  const preferredPersonal = preferred && personal.find((item) => graphServerUrlMatches(item.url, preferred, item.schemeInferred));
  if (preferredPersonal) return { url: preferred, addedDefault: false };
  if (personal.length) return { url: validGraphServerUrl(personal[0].url)!, addedDefault: false };

  const publicEntries = flattenGraphServerDirectory(directory).filter((entry) => !isPersonal(entry));
  const preferredPublic = preferred && publicEntries.find((entry) => graphServerUrlMatches(entry.url, preferred, entry.schemeInferred));
  if (preferredPublic) return { url: preferred, addedDefault: false };
  const firstPublic = publicEntries.find((entry) => validGraphServerUrl(entry.url));
  if (firstPublic) return { url: validGraphServerUrl(firstPublic.url)!, addedDefault: false };
  return { url: DEFAULT_PUBLIC_GRAPH_SERVER, addedDefault: true };
}

/** Stage 1 of the URL conveyor: no `q` means a blank query, without
 * an address or any server selection. Stage 2 supplies `addr` only when
 * missing. Nothing in this constructor reads browser storage or authentication. */
export function createBlankStartupQuery(): FctQueryTree {
  return {
    name: "query",
    attributes: { xmlns: "http://openlinksw.com/services/facets/1.0", inference: "", "same-as": "" },
    children: [
      { id: "query-text", name: "text", attributes: { property: "http://www.w3.org/2000/01/rdf-schema#label" }, text: "", children: [] },
      { id: "query-view", name: "view", attributes: { type: "text", limit: "30", offset: "0" }, children: [] },
    ],
  };
}

/** Convenience for existing callers that explicitly request a new, already
 * addressed query. URL startup itself goes through createBlankStartupQuery(). */
export function createAddressedStartupQuery(graphServerUrl: string): FctQueryTree {
  const url = validGraphServerUrl(graphServerUrl);
  if (!url) throw new TypeError("A graph-server URL must be valid.");
  const blank = createBlankStartupQuery();
  return { ...blank, attributes: { ...blank.attributes, addr: `${ALL_GRAPHS}@${url}` } };
}

/** Stage 2 of the URL conveyor: supply an address only if q lacks a valid
 * execution server. Preserve its filters, view, IDs and graph intent. Neither
 * this helper nor stage 1 mutates the live FCT store, menu or URL. */
export function prepareInitialFctQuery(
  restoredQuery: FctQueryTree | null,
  graphServerUrl: string,
): FctQueryTree {
  const url = validGraphServerUrl(graphServerUrl);
  if (!url) throw new TypeError("Initial FCT query requires a valid graph-server URL.");
  if (!restoredQuery) return createAddressedStartupQuery(url);
  const existingAddress = (restoredQuery.attributes.addr ?? "").trim();
  const at = existingAddress.indexOf("@");
  // Only a valid existing execution endpoint is authoritative. An incomplete
  // `addr` is missing a server and must continue along the same conveyor.
  if (at >= 0 && validGraphServerUrl(existingAddress.slice(at + 1))) return restoredQuery;
  // Accept a legacy bare endpoint IRI as an explicitly supplied server.
  if (at < 0 && validGraphServerUrl(existingAddress))
    return { ...restoredQuery, attributes: { ...restoredQuery.attributes, addr: `${ALL_GRAPHS}@${existingAddress}` } };
  const graph = (at >= 0 ? existingAddress.slice(0, at).trim() : "") ||
    (restoredQuery.attributes.graph ?? "").trim() || ALL_GRAPHS;
  return {
    ...restoredQuery,
    attributes: {
      ...restoredQuery.attributes,
      xmlns: restoredQuery.attributes.xmlns?.trim() || "http://openlinksw.com/services/facets/1.0",
      addr: `${graph}@${url}`,
    },
  };
}
