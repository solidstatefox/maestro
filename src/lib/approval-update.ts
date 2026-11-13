"use client";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const validIri = (value: string) => /^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);

/** A standard SPARQL Update sent through the ONE SPARQL transport.
 * No feature-specific JSON API; the live query must be bookmarked on the server.
 */
export async function changeApprovals(uris: string[], status: "Approved" | "Pending" | null,
  graphPrefix: string, bookmarkedQueryXml: string, signal?: AbortSignal): Promise<void> {
  if (!validIri(graphPrefix) || !bookmarkedQueryXml || !uris.length) throw new Error("Login and bookmarked FCT query required.");
  const resources = [...new Set(uris)];
  if (resources.length > 500 || resources.some(uri => !validIri(uri))) throw new Error("Invalid provider IRI.");
  const graph = `${graphPrefix.replace(/\/+$/, "")}/query/status`;
  const values = resources.map(uri => `<${uri}>`).join(" ");
  const where = `VALUES ?resource { ${values} } OPTIONAL { GRAPH <${graph}> { ?resource <${MUI}status> ?old } }`;
  const update = status
    ? `DELETE { GRAPH <${graph}> { ?resource <${MUI}status> ?old } }\nINSERT { GRAPH <${graph}> { ?resource <${MUI}status> <${MUI}${status}> } } WHERE { ${where} }`
    : `DELETE { GRAPH <${graph}> { ?resource <${MUI}status> ?old } } WHERE { ${where} }`;
  const response = await fetch("/proxy/api/sparql", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update, bookmarkQueryXml: bookmarkedQueryXml }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `SPARQL Update failed (HTTP ${response.status})`);
  }
}
