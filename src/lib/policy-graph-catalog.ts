import { toLabel } from "@/lib/uri-labels";
import { fctAddrFromXml, getConfiguredFctEndpoints, resolveFctEndpointFromAddr } from "@/lib/personal-sparql";
import { unscopedGraph, ALL_GRAPHS } from "@/lib/graph-address-mode";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export type CatalogPolicy = { uri: string; label: string; description: string; target: string; detail: string; targetLabel?: string; detailLabel?: string; author?: string };
export const validCatalogIri = (uri: unknown): uri is string => typeof uri === "string" &&
  /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri) && uri.length <= 4096;

/** Find policy resources only at the graph address selected by the live FCT query.
 * The endpoint must be one of the authenticated user's configured graph servers.
 * This is read-only and does not run the discovered policies or their XSLT. */
export async function queryGraphPolicies(queryXml: string, request: Request, onlyUris?: string[]): Promise<CatalogPolicy[]> {
  const addr = fctAddrFromXml(queryXml);
  const split = addr.indexOf("@");
  if (split < 0) throw new Error("A graph@graphserver FCT address is required to discover policies.");
  const endpoint = resolveFctEndpointFromAddr(await getConfiguredFctEndpoints(request), addr);
  if (!endpoint) throw new Error("The selected graph server is not configured.");
  const graph = unscopedGraph(addr.slice(0,split));
  if (graph && graph !== ALL_GRAPHS && !validCatalogIri(graph)) throw new Error("Invalid selected graph IRI.");
  if (onlyUris && (onlyUris.length > 500 || onlyUris.some(uri => !validCatalogIri(uri))))
    throw new Error("Expected at most 500 policy IRIs.");
  const pattern = `?item a ?type . VALUES ?type { <${MUI}ClassPolicy> <${MUI}Provider> }\n` +
    (onlyUris ? `VALUES ?item { ${onlyUris.map(uri => `<${uri}>`).join(" ")} }\n` : "") +
    `OPTIONAL { ?item <${RDFS}label> ?label }\n` +
    `OPTIONAL { ?item <${DCT}description> ?description }\n` +
    `OPTIONAL { ?item <https://schema.org/author> ?author }\n` +
    `OPTIONAL { ?item <${MUI}forClass> ?target }\n` +
    `OPTIONAL { ?item <${MUI}recordShape> ?detail }\n` +
    `OPTIONAL { ?target <${RDFS}label> ?targetLabel FILTER(DATATYPE(?targetLabel) != <http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> || LANGMATCHES(LANG(?targetLabel), "en")) }\n` +
    `OPTIONAL { ?detail <${RDFS}label> ?detailLabel FILTER(DATATYPE(?detailLabel) != <http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> || LANGMATCHES(LANG(?detailLabel), "en")) }\n`;
  const inner = graph && graph !== ALL_GRAPHS ? `GRAPH <${graph}> { ${pattern} }` : pattern;
  const query = `SELECT DISTINCT ?item ?label ?description ?target ?detail ?targetLabel ?detailLabel ?author WHERE { ${inner} } LIMIT ${onlyUris ? 500 : 1000}`;
  const response = await fetch(endpoint.url, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query }).toString(),
  });
  if (!response.ok) throw new Error(`Policy graph query returned HTTP ${response.status}.`);
  const result = await response.json() as { results?: { bindings?: Record<string,{value?:string}>[] } };
  if (!Array.isArray(result.results?.bindings)) throw new Error("Policy graph returned invalid SPARQL JSON.");
  return result.results.bindings.map(row => ({
    uri: row.item?.value ?? "", label: row.label?.value ?? toLabel(row.item?.value ?? ""),
    description: row.description?.value ?? "", author: row.author?.value ?? "", target: row.target?.value ?? "", detail: row.detail?.value ?? "", targetLabel: row.targetLabel?.value ?? toLabel(row.target?.value ?? ""), detailLabel: row.detailLabel?.value ?? toLabel(row.detail?.value ?? ""),
  })).filter(item => validCatalogIri(item.uri));
}

/** Fetch a policy's RDF description from the graph address currently being viewed. */
export async function queryGraphPolicyTriples(queryXml: string, policy: string, request: Request): Promise<Array<{ predicate: string; value: string; type: string; datatype?: string; lang?: string }>> {
  if (!validCatalogIri(policy)) throw new Error("Invalid policy IRI.");
  const addr = fctAddrFromXml(queryXml);
  const split = addr.indexOf("@");
  if (split < 0) throw new Error("A graph@graphserver address is required.");
  const endpoint = resolveFctEndpointFromAddr(await getConfiguredFctEndpoints(request), addr);
  if (!endpoint) throw new Error("The graph server is not configured.");
  const graph = unscopedGraph(addr.slice(0, split));
  if (graph && graph !== ALL_GRAPHS && !validCatalogIri(graph)) throw new Error("Invalid graph IRI.");
  const clause = `<${policy}> ?predicate ?object .`;
  const query = `SELECT ?predicate ?object WHERE { ${graph && graph !== ALL_GRAPHS ? `GRAPH <${graph}> { ${clause} }` : clause} } ORDER BY ?predicate ?object LIMIT 1000`;
  const response = await fetch(endpoint.url, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query }).toString(),
  });
  if (!response.ok) throw new Error(`Policy graph source returned HTTP ${response.status}.`);
  const result = await response.json() as { results?: { bindings?: Array<Record<string, { type?: string; value?: string; datatype?: string; "xml:lang"?: string }>> } };
  if (!Array.isArray(result.results?.bindings)) throw new Error("The graph server returned invalid SPARQL JSON.");
  return result.results.bindings.map(row => ({ predicate: row.predicate?.value ?? "", value: row.object?.value ?? "", type: row.object?.type ?? "literal", datatype: row.object?.datatype, lang: row.object?.["xml:lang"] })).filter(row => row.predicate);
}
