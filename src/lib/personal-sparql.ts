import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

/** Shared server-side access to Maestro's personal SPARQL store and RDF-backed Graphsite registry. */
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";
const SCHEMA_NS = "https://schema.org/";

/** The manifest maps each RDF filename in /graph to its destination Graphsite graph IRI. */
const GRAPH_DIRECTORY = resolve(process.cwd(), "graph");
const GRAPH_MANIFEST_PATH = resolve(GRAPH_DIRECTORY, "manifest.json");
const DEFAULT_HISTORY_GRAPH = "gttp://ggg.maestro.ecosys/query/history";

type GraphManifest = Record<string, string>;

/** Read and validate the file-to-Graphsite mapping. */
function getGraphManifest(): GraphManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(GRAPH_MANIFEST_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${GRAPH_MANIFEST_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${GRAPH_MANIFEST_PATH} must contain a JSON object mapping RDF filenames to Graphsite graph IRIs.`);
  }
  const result: GraphManifest = {};
  for (const [filename, rawGraph] of Object.entries(manifest as Record<string, unknown>)) {
    if (!filename || filename === "manifest.json" || filename.includes("/") || filename.includes("\\") || filename.startsWith(".")) {
      throw new Error(`Invalid RDF filename in ${GRAPH_MANIFEST_PATH}: ${filename}`);
    }
    if (typeof rawGraph !== "string") throw new Error(`Graphsite for ${filename} must be a string in ${GRAPH_MANIFEST_PATH}.`);
    const graph = rawGraph.trim().replace(/\\:/g, ":");
    if (!/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(graph)) {
      throw new Error(`Graphsite for ${filename} is not a valid absolute graph IRI: ${graph}`);
    }
    result[filename] = graph;
  }
  return result;
}

/** Resolve the target graph for an RDF file listed in /graph/manifest.json. */
function graphForFile(filename: string): string {
  const graph = getGraphManifest()[filename];
  if (!graph) throw new Error(`No Graphsite mapping for ${filename} in ${GRAPH_MANIFEST_PATH}.`);
  return graph;
}

export const getDataserversGraph = (): string => graphForFile("dataserver-seed.ttl");
export const getHistoryGraph = (): string => DEFAULT_HISTORY_GRAPH;
export const getOntologyGraph = (): string => graphForFile("maestro-ui-ontology.ttl");
export const getShapesGraph = (): string => graphForFile("maestro-shacl-policies.rdf");
export const VFCT_NS = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
export const MAESTRO_IDS_NS = "gttp://ggg.maestro.ecosys/ids/";

let graphDirectorySeedPromise: Promise<void> | null = null;

/** Upload each RDF document in /graph to the Graphsite assigned by manifest.json. */
export async function ensureGraphDirectorySeeded(): Promise<void> {
  if (graphDirectorySeedPromise) return graphDirectorySeedPromise;
  graphDirectorySeedPromise = (async () => {
    const entries = await readdir(GRAPH_DIRECTORY, { withFileTypes: true });
    const mediaTypes: Record<string, string> = {
      ".rdf": "application/rdf+xml; charset=utf-8",
      ".rdfs": "application/rdf+xml; charset=utf-8",
      ".owl": "application/rdf+xml; charset=utf-8",
      ".xml": "application/rdf+xml; charset=utf-8",
      ".ttl": "text/turtle; charset=utf-8",
      ".nt": "application/n-triples; charset=utf-8",
      ".n3": "text/n3; charset=utf-8",
      ".jsonld": "application/ld+json; charset=utf-8",
      ".trig": "application/trig; charset=utf-8",
      ".nq": "application/n-quads; charset=utf-8",
      ".n4": "application/n-quads; charset=utf-8",
      ".rdfa": "application/xhtml+xml; charset=utf-8",
      ".grdf": "application/x-grdf; charset=utf-8",
    };
    const manifest = getGraphManifest();
    const files = entries.filter((entry) => entry.isFile() && mediaTypes[extname(entry.name).toLowerCase()]);
    if (files.length === 0) throw new Error(`No supported RDF documents were found in ${GRAPH_DIRECTORY}.`);
    const listedFiles = new Set(files.map((file) => file.name));
    for (const filename of Object.keys(manifest)) {
      if (!listedFiles.has(filename)) throw new Error(`Manifest entry ${filename} has no matching supported RDF file in ${GRAPH_DIRECTORY}.`);
    }
    for (const file of files) {
      if (!manifest[file.name]) throw new Error(`No Graphsite mapping for ${file.name} in ${GRAPH_MANIFEST_PATH}.`);
    }

    const endpoint = personalSparqlUrl();
    const graphStoreUrl = new URL(endpoint);
    graphStoreUrl.pathname = /\/sparql-auth\/?$/i.test(graphStoreUrl.pathname)
      ? graphStoreUrl.pathname.replace(/\/sparql-auth\/?$/i, "/sparql-graph-crud-auth")
      : graphStoreUrl.pathname.replace(/\/sparql\/?$/i, "/sparql-graph-crud");
    graphStoreUrl.search = "";
    graphStoreUrl.hash = "";

    // Clear every distinct manifest destination before loading any documents.
    // Multiple RDF files may intentionally map to the same graph, so clear each graph
    // exactly once and do all clears up front; otherwise later clears could erase
    // triples loaded from earlier files.
    const destinationGraphs = [...new Set(files.map((file) => manifest[file.name]))].sort();
    for (const destinationGraph of destinationGraphs) {
      const clearGraphUrl = new URL(graphStoreUrl.toString());
      clearGraphUrl.searchParams.set("graph", destinationGraph);
      const clearResponse = await fetch(clearGraphUrl, {
        method: "DELETE",
        headers: personalSparqlHeaders("text/plain; charset=utf-8", "text/plain, text/html, application/json, */*"),
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      const clearResponseText = (await clearResponse.text()).slice(0, 3000);
      // A missing graph is already empty; all other unsuccessful responses are errors.
      if (!clearResponse.ok && clearResponse.status !== 404) {
        throw new Error(`Could not clear manifest graph ${destinationGraph} before loading (HTTP ${clearResponse.status}): ${clearResponseText || "no response details"}`);
      }
      console.info(`Maestro cleared manifest graph ${destinationGraph}${clearResponse.status === 404 ? " (already absent)" : ""}.`);
    }

    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const destinationGraph = manifest[file.name];
      const fileGraphStoreUrl = new URL(graphStoreUrl.toString());
      fileGraphStoreUrl.searchParams.set("graph", destinationGraph);
      const path = resolve(GRAPH_DIRECTORY, file.name);
      let content = await readFile(path, "utf8");
      if (!content.trim()) {
        console.warn(`Maestro skipped empty RDF document ${path}.`);
        continue;
      }
      // Preserve the previous convenience behavior: make the active personal SPARQL endpoint
      // selectable even when the static registry seed does not list it explicitly.
      if (file.name.toLowerCase() === "dataserver-seed.ttl") {
        const normalizeEndpointUrl = (value: string): string => {
          const url = new URL(value);
          url.hash = "";
          url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
          return url.toString().replace(/\/$/u, "");
        };
        const listed = [...content.matchAll(/schema:url\s+<([^>]+)>/gu)].map((match) => match[1]);
        const personalUrl = normalizeEndpointUrl(endpoint.toString());
        const alreadyListed = listed.some((value) => {
          try { return normalizeEndpointUrl(value) === personalUrl; } catch { return false; }
        });
        if (!alreadyListed) {
          content += `\n\n# Automatically added personal SPARQL endpoint (not explicitly listed in the seed).\n<${MAESTRO_IDS_NS}dataservers/endpoints#personal-sparql> a schema:EntryPoint ;\n    rdfs:label "Personal SPARQL" ;\n    schema:url <${endpoint.toString()}> ;\n    dcterms:isPartOf <${MAESTRO_IDS_NS}dataservers/endpoints> ;\n    schema:position "-1"^^xsd:integer .\n`;
        }
      }
      const response = await fetch(fileGraphStoreUrl, {
        // POST merges RDF into the graph; PUT would replace everything loaded by earlier files.
        method: "POST",
        headers: personalSparqlHeaders(mediaTypes[extname(file.name).toLowerCase()], "text/plain, text/html, application/json, */*"),
        body: content,
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      const responseText = (await response.text()).slice(0, 3000);
      if (!response.ok || /(?:Virtuoso\s+Exception|Error\s+SR|SPARQL\s+.*Error|failed)/i.test(responseText) && !/0 errors/i.test(responseText)) {
        throw new Error(`Could not load RDF document ${path} into graph ${destinationGraph} (HTTP ${response.status}): ${responseText || "no response details"}`);
      }
      console.info(`Maestro loaded ${file.name} into ${destinationGraph}.`);
    }
  })().catch((error) => {
    graphDirectorySeedPromise = null;
    throw error;
  });
  return graphDirectorySeedPromise;
}

/** Compatibility wrapper: policy discovery loads the manifest-mapped RDF files from /graph. */
export async function ensureShapesGraphSeeded(): Promise<void> {
  await ensureGraphDirectorySeeded();
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
  await ensureGraphDirectorySeeded();
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
