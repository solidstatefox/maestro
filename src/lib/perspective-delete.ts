"use client";

import { loadPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";

const validIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
const TYPES = {
  bookmarks: "http://www.w3.org/2002/01/bookmark#Bookmark",
  history: "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit",
} as const;

/** Delete confirmed personal collection entries via the one SPARQL update transport. */
export async function deletePerspectiveEntries(kind: keyof typeof TYPES, ids: string[], signal?: AbortSignal): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length > 100 || unique.some(item => !validIri(item))) throw new Error("Invalid History/Bookmark entry IRI.");
  if (!unique.length) return;
  const session = await loadPersonalAuthSession();
  if (!session) throw new Error("Log in to delete personal collection entries.");
  const graph = `${graphForPrefix(session.graphPrefix)}#${kind}`;
  if (!validIri(graph)) throw new Error("Invalid personal collection graph.");
  const update = `DELETE { GRAPH <${graph}> { ?entry ?predicate ?object } }
WHERE { VALUES ?entry { ${unique.map(item => `<${item}>`).join(" ")} }
  GRAPH <${graph}> { ?entry a <${TYPES[kind]}> ; ?predicate ?object . } }`;
  const response = await fetch("/proxy/api/sparql", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {error?: string};
    throw new Error(body.error || `SPARQL DELETE failed (HTTP ${response.status}).`);
  }
}
