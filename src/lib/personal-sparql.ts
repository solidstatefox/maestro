/** Shared server-side access to the user's personal SPARQL store and RDF-backed Datasites registry. */
const DEFAULT_DATASERVERS_GRAPH = "gttp://ggg.maestro.ecosys/dataservers";
const DEFAULT_QUERY_FAVORITES_GRAPH = "gttp://ggg.maestro.ecosys/query-favorites";
const DEFAULT_ONTOLOGY_GRAPH = "gttp://ggg.maestro.ecosys/ontology-cache";

/** Read the app's named-graph list from SPARQL_ENDPOINTS. Each URI is identified by its final path segment. */
export function configuredNamedGraph(name: "dataservers" | "query-favorites" | "ontology-cache", fallback: string): string {
  const configured = (process.env.SPARQL_ENDPOINTS || "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  const graph = configured.find((value) => value.replace(/\\:/g, ":").replace(/\/+$/, "").endsWith(`/${name}`));
  const selected = graph?.replace(/\\:/g, ":") || fallback;
  if (/[<>"{}|^`\\\s]/u.test(selected)) throw new Error(`Configured ${name} graph contains characters that are not allowed in an IRI.`);
  return selected;
}

export const DATASERVERS_GRAPH = configuredNamedGraph("dataservers", DEFAULT_DATASERVERS_GRAPH);
export const QUERY_FAVORITES_GRAPH = configuredNamedGraph("query-favorites", DEFAULT_QUERY_FAVORITES_GRAPH);
export const VFCT_NS = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";
const SCHEMA_NS = "https://schema.org/";
export const MAESTRO_IDS_NS = "gttp://ggg.maestro.ecosys/ids/";
export const getOntologyGraph = (): string => configuredNamedGraph("ontology-cache", DEFAULT_ONTOLOGY_GRAPH);

export type FctEndpoint = { id: string; label: string; url: string; group: string };
type SparqlJson = { results?: { bindings?: Record<string, { type?: string; value?: string }>[] } };

/** Return the configured personal endpoint without embedding credentials in its URL. */
export function personalSparqlUrl(): URL {
  const raw = (process.env.PERSONAL_SPARQL_ENDPOINT || process.env.RDF_LOADER_ENDPOINT || "http://localhost:8890/sparql").trim();
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("PERSONAL_SPARQL_ENDPOINT must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("PERSONAL_SPARQL_ENDPOINT must not contain embedded credentials; use RDF_LOADER_USERNAME and RDF_LOADER_PASSWORD.");
  return url;
}

/** Build authenticated request headers for the personal SPARQL endpoint. */
export function personalSparqlHeaders(contentType: string, accept = "application/sparql-results+json, application/json;q=0.9"): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": contentType, Accept: accept };
  const username = process.env.RDF_LOADER_USERNAME;
  const password = process.env.RDF_LOADER_PASSWORD;
  if (username && password) headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  return headers;
}

/** Execute a read-only SPARQL query against the personal endpoint. */
export async function queryPersonalSparql(query: string, timeoutMs = 20000): Promise<SparqlJson> {
  const endpoint = personalSparqlUrl();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders("application/x-www-form-urlencoded; charset=UTF-8"),
    body: new URLSearchParams({ query }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Personal SPARQL query returned HTTP ${response.status}: ${body.slice(0, 1000)}`);
  try {
    const parsed = JSON.parse(body) as SparqlJson;
    if (!parsed || !Array.isArray(parsed.results?.bindings)) throw new Error("missing results.bindings");
    return parsed;
  } catch (error) {
    throw new Error(`Personal SPARQL endpoint returned invalid SPARQL Results JSON: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

/** Execute a SPARQL Update against the personal endpoint. */
export async function updatePersonalSparql(update: string, timeoutMs = 30000): Promise<string> {
  const endpoint = personalSparqlUrl();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders("application/sparql-update; charset=UTF-8", "text/plain, text/html, application/json, */*"),
    body: update,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.text()).slice(0, 3000);
  if (!response.ok) throw new Error(`Personal SPARQL update returned HTTP ${response.status}: ${body}`);
  if (/(?:Virtuoso\s+Exception|Error\s+SR|SPARQL\s+UPDATE\s+Error|failed)/i.test(body) && !/0 errors/i.test(body)) {
    throw new Error(`Personal SPARQL update failed: ${body}`);
  }
  return body;
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Load endpoint records and their groups from the configured RDF dataservers graph. No env-list fallback is intentional. */
export async function getConfiguredFctEndpoints(): Promise<FctEndpoint[]> {
  const legacyNs = `${DATASERVERS_GRAPH}#`;
  const query = `PREFIX rdf: <${RDF_NS}>\nPREFIX rdfs: <${RDFS_NS}>\nPREFIX dcterms: <${DCTERMS_NS}>\nPREFIX skos: <${SKOS_NS}>\nPREFIX schema: <${SCHEMA_NS}>\nSELECT DISTINCT ?server ?name ?url ?groupName ?groupOrder ?serverOrder WHERE { GRAPH <${DATASERVERS_GRAPH}> { { ?server rdf:type schema:EntryPoint ; rdfs:label ?name ; schema:url ?url . OPTIONAL { ?server schema:position ?serverOrder } OPTIONAL { ?server dcterms:isPartOf ?group . ?group rdf:type skos:Collection ; rdfs:label ?groupName . OPTIONAL { ?group schema:position ?groupOrder } } } UNION { ?server rdf:type <${legacyNs}Dataserver> ; <${legacyNs}serverName> ?name ; <${legacyNs}serverURL> ?url . OPTIONAL { ?server <${legacyNs}serverOrder> ?serverOrder } OPTIONAL { ?server <${legacyNs}inGroup> ?group . ?group <${legacyNs}groupName> ?groupName . OPTIONAL { ?group <${legacyNs}groupOrder> ?groupOrder } } } } } ORDER BY COALESCE(?groupOrder, 9999) COALESCE(?serverOrder, 9999) STR(?name)`;
  const payload = await queryPersonalSparql(query);
  const endpoints: FctEndpoint[] = [];
  for (const binding of payload.results?.bindings ?? []) {
    const label = binding.name?.value?.trim() ?? "";
    const url = binding.url?.value?.trim() ?? "";
    const group = binding.groupName?.value?.trim() || "Endpoints";
    if (!label || !/^https?:\/\//i.test(url)) continue;
    const id = group === "Endpoints" ? slugify(label) : slugify(`${group}-${label}`);
    endpoints.push({ id, label, url, group });
  }
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    if (seen.has(endpoint.id)) return false;
    seen.add(endpoint.id);
    return true;
  });
}
