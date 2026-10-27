import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Shared server-side access to Maestro's personal SPARQL store and Datasites registry. */
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";
const SCHEMA_NS = "https://schema.org/";

/** Required graph configuration is read from its dedicated environment property, never inferred from SPARQL_ENDPOINTS. */
function requiredGraph(property: "SITE_SPARQL_ENDPOINTS" | "SITE_HISTORY" | "SITE_ONTOLOGY"): string {
  const graph = (process.env[property] ?? "").trim().replace(/\\:/g, ":");
  if (!graph) throw new Error(`${property} must be configured with a Datasite graph IRI.`);
  if (!/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(graph)) {
    throw new Error(`${property} must be a valid absolute Datasite graph IRI.`);
  }
  return graph;
}

export const getDataserversGraph = (): string => requiredGraph("SITE_SPARQL_ENDPOINTS");
export const getHistoryGraph = (): string => requiredGraph("SITE_HISTORY");
export const getOntologyGraph = (): string => requiredGraph("SITE_ONTOLOGY");
export const VFCT_NS = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
export const MAESTRO_IDS_NS = "gttp://ggg.maestro.ecosys/ids/";

let dataserversSeedPromise: Promise<void> | null = null;

/** Read the configured Turtle seed and replace the configured Datasites graph through Virtuoso's Graph Store HTTP Protocol. */
export async function ensureDataserversRegistrySeeded(): Promise<void> {
  if (dataserversSeedPromise) return dataserversSeedPromise;
  dataserversSeedPromise = (async () => {
    const configuredPath = (process.env.SPARQL_ENDPOINTS ?? "").trim();
    if (!configuredPath) throw new Error("SPARQL_ENDPOINTS must be configured with a path to the Datasites Turtle seed file.");
    const seedPath = resolve(process.cwd(), configuredPath);
    const turtle = await readFile(seedPath, "utf8");
    if (!turtle.trim()) throw new Error(`The Datasites Turtle seed file is empty: ${seedPath}`);

    const endpoint = personalSparqlUrl();
    const graph = getDataserversGraph();
    const graphStoreUrl = new URL(endpoint);
    graphStoreUrl.pathname = /\/sparql-auth\/?$/i.test(graphStoreUrl.pathname)
      ? graphStoreUrl.pathname.replace(/\/sparql-auth\/?$/i, "/sparql-graph-crud-auth")
      : graphStoreUrl.pathname.replace(/\/sparql\/?$/i, "/sparql-graph-crud");
    graphStoreUrl.search = "";
    graphStoreUrl.hash = "";
    graphStoreUrl.searchParams.set("graph", graph);

    const response = await fetch(graphStoreUrl, {
      method: "PUT",
      headers: personalSparqlHeaders("text/turtle; charset=utf-8", "text/plain, text/html, application/json, */*"),
      body: turtle,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const responseText = (await response.text()).slice(0, 3000);
    if (!response.ok || /(?:Virtuoso\s+Exception|Error\s+SR|SPARQL\s+.*Error|failed)/i.test(responseText) && !/0 errors/i.test(responseText)) {
      throw new Error(`Could not replace Datasites graph ${graph} from ${seedPath} (HTTP ${response.status}): ${responseText || "no response details"}`);
    }
    console.info(`Maestro replaced Datasites graph ${graph} from ${seedPath}.`);
  })().catch((error) => {
    dataserversSeedPromise = null;
    throw error;
  });
  return dataserversSeedPromise;
}

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

/** Execute a SPARQL ASK against the personal endpoint and return its boolean result. */
export async function askPersonalSparql(query: string, timeoutMs = 20000): Promise<boolean> {
  const endpoint = personalSparqlUrl();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders("application/x-www-form-urlencoded; charset=UTF-8"),
    body: new URLSearchParams({ query }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Personal SPARQL ASK returned HTTP ${response.status}: ${body.slice(0, 1000)}`);
  try {
    const parsed = JSON.parse(body) as { boolean?: unknown };
    if (typeof parsed.boolean !== "boolean") throw new Error("missing boolean result");
    return parsed.boolean;
  } catch (error) {
    throw new Error(`Personal SPARQL endpoint returned an invalid ASK result: ${error instanceof Error ? error.message : "invalid JSON"}`);
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

/** Seed the registry once, then load endpoint records and groups from its configured RDF graph. No env-list fallback is intentional. */
export async function getConfiguredFctEndpoints(): Promise<FctEndpoint[]> {
  await ensureDataserversRegistrySeeded();
  const dataserversGraph = getDataserversGraph();
  const legacyNs = `${dataserversGraph}#`;
  const query = `PREFIX rdf: <${RDF_NS}>\nPREFIX rdfs: <${RDFS_NS}>\nPREFIX dcterms: <${DCTERMS_NS}>\nPREFIX skos: <${SKOS_NS}>\nPREFIX schema: <${SCHEMA_NS}>\nSELECT DISTINCT ?server ?name ?url ?groupName ?groupOrder ?serverOrder WHERE { GRAPH <${dataserversGraph}> { { ?server rdf:type schema:EntryPoint ; rdfs:label ?name ; schema:url ?url . OPTIONAL { ?server schema:position ?serverOrder } OPTIONAL { ?server dcterms:isPartOf ?group . ?group rdf:type skos:Collection ; rdfs:label ?groupName . OPTIONAL { ?group schema:position ?groupOrder } } } UNION { ?server rdf:type <${legacyNs}Dataserver> ; <${legacyNs}serverName> ?name ; <${legacyNs}serverURL> ?url . OPTIONAL { ?server <${legacyNs}serverOrder> ?serverOrder } OPTIONAL { ?server <${legacyNs}inGroup> ?group . ?group <${legacyNs}groupName> ?groupName . OPTIONAL { ?group <${legacyNs}groupOrder> ?groupOrder } } } } } ORDER BY COALESCE(?groupOrder, 9999) COALESCE(?serverOrder, 9999) STR(?name)`;
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


/** Resolve the endpoint selected by the shared fct_endpoint cookie, falling back to the first Datasite. */
export function selectConfiguredFctEndpoint(request: Request, endpoints: FctEndpoint[]): FctEndpoint | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)fct_endpoint=([^;]+)/);
  let selectedId = "";
  try { selectedId = match ? decodeURIComponent(match[1]) : ""; } catch { selectedId = ""; }
  return endpoints.find((endpoint) => endpoint.id === selectedId) ?? endpoints[0] ?? null;
}

/** Load the shared RDF-backed endpoint list and resolve the selected endpoint for routes that do not need the full list. */
export async function getSelectedFctEndpoint(request: Request): Promise<FctEndpoint | null> {
  return selectConfiguredFctEndpoint(request, await getConfiguredFctEndpoints());
}
