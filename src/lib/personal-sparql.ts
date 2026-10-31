import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { graphSiteForPrefix } from "./personal-auth";
import { authNote, fetchWithDigestFallback } from "./digest-auth";
import { buildInsertData, canParseRdfExtension, parseRdfDocument } from "./rdf-to-sparql";

/** Shared server-side access to Maestro's personal SPARQL store and RDF-backed Graphsite registry. */
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";
const SCHEMA_NS = "https://schema.org/";

/** The manifest maps each RDF filename in /graph to its destination Graphsite graph IRI or local path. */
const getGraphDirectory = () => {
  const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
  return resolve(cwd, "graph");
};
const getGraphManifestPath = () => resolve(getGraphDirectory(), "manifest.json");

export const DEFAULT_USER_GRAPHSITE = "http://localhost:8890/DAV/home/dba";
export const DEFAULT_GRAPH_STORE = "http://localhost:8890/sparql";

type GraphManifest = Record<string, string>;

export type PersonalSession = {
  graphStore: string;
  graphsitePrefix: string;
  authHeader?: string;
  authType?: string;
  userName?: string;
  userAvatar?: string;
};

/** Extract the authenticated personal graph server session from request cookies or headers. */
export function getPersonalSession(request?: Request): PersonalSession | null {
  if (!request) return null;
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)maestro_session=([^;]+)/);
  if (match) {
    try {
      return JSON.parse(decodeURIComponent(match[1])) as PersonalSession;
    } catch {
      return null;
    }
  }
  const headerStore = request.headers.get("x-personal-graph-store");
  const headerPrefix = request.headers.get("x-personal-graphsite");
  const authHeader = request.headers.get("authorization") || request.headers.get("x-personal-auth") || undefined;
  if (headerStore && headerPrefix) {
    return {
      graphStore: headerStore,
      graphsitePrefix: headerPrefix,
      authHeader,
    };
  }
  return null;
}

/** Read and validate the file-to-Graphsite mapping. */
function getGraphManifest(): GraphManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(getGraphManifestPath(), "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${getGraphManifestPath()}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${getGraphManifestPath()} must contain a JSON object mapping RDF filenames to Graphsite graph local paths or IRIs.`);
  }
  const result: GraphManifest = {};
  for (const [filename, rawGraph] of Object.entries(manifest as Record<string, unknown>)) {
    if (!filename || filename === "manifest.json" || filename.includes("/") || filename.includes("\\") || filename.startsWith(".")) {
      throw new Error(`Invalid RDF filename in ${getGraphManifestPath()}: ${filename}`);
    }
    if (typeof rawGraph !== "string") throw new Error(`Graphsite for ${filename} must be a string in ${getGraphManifestPath()}.`);
    result[filename] = rawGraph.trim().replace(/\\:/g, ":");
  }
  return result;
}

/** Resolve the target graph for an RDF file listed in /graph/manifest.json: <graphsite>/query + manifest fragment. */
export function graphForFile(filename: string, request?: Request): string {
  const rawPath = getGraphManifest()[filename];
  if (!rawPath) throw new Error(`No Graphsite mapping for ${filename} in ${getGraphManifestPath()}.`);
  if (/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(rawPath)) {
    return rawPath;
  }
  const graphSite = getUserGraphSite(request);
  const local = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${graphSite}${local}`;
}

/** The user's Maestro graphsite: <graphsitePrefix>/query (no fragment). */
export function getUserGraphSite(request?: Request): string {
  const session = getPersonalSession(request);
  return graphSiteForPrefix(session?.graphsitePrefix || DEFAULT_USER_GRAPHSITE);
}

export const getDataserversGraph = (request?: Request): string => graphForFile("dataserver-seed.ttl", request);
/** History graph base IRI (<graphsite>/query). Callers append #history / #bookmarks. */
export const getHistoryGraph = (request?: Request): string => getUserGraphSite(request);
export const getOntologyGraph = (request?: Request): string => graphForFile("maestro-ui-ontology.ttl", request);
export const getShapesGraph = (request?: Request): string => graphForFile("maestro-shacl-policies.rdf", request);
export const VFCT_NS = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
export const MAESTRO_IDS_NS = "gttp://ggg.maestro.ecosys/ids/";

export type GraphSeedResult = { file: string; graph: string }[];

/** One seed per personal session (store + graphsite + credentials), not one per server process. */
const graphDirectorySeedPromises = new Map<string, Promise<GraphSeedResult>>();

function seedSessionKey(request?: Request): string {
  const session = getPersonalSession(request);
  return [session?.graphStore ?? "", session?.graphsitePrefix ?? "", session?.authHeader ?? ""].join("|");
}

/** Upload each RDF document in /graph to <graphsitePrefix>/query + manifest fragment on the user's graph server. Pass force to reload (used right after login). */
export async function ensureGraphDirectorySeeded(request?: Request, options: { force?: boolean } = {}): Promise<GraphSeedResult> {
  const sessionKey = seedSessionKey(request);
  if (!options.force) {
    const existing = graphDirectorySeedPromises.get(sessionKey);
    if (existing) return existing;
  }
  const promise = (async (): Promise<GraphSeedResult> => {
    const loaded: GraphSeedResult = [];
    const entries = await readdir(getGraphDirectory(), { withFileTypes: true });
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
    if (files.length === 0) throw new Error(`No supported RDF documents were found in ${getGraphDirectory()}.`);
    const listedFiles = new Set(files.map((file) => file.name));
    for (const filename of Object.keys(manifest)) {
      if (!listedFiles.has(filename)) throw new Error(`Manifest entry ${filename} has no matching supported RDF file in ${getGraphDirectory()}.`);
    }
    for (const file of files) {
      if (!manifest[file.name]) throw new Error(`No Graphsite mapping for ${file.name} in ${getGraphManifestPath()}.`);
    }

    const endpoint = personalSparqlUrl(request); // read endpoint (/sparql), advertised in the Datasites seed
    const writeEndpoint = personalSparqlWriteUrl(request); // /sparql-auth for sparql-auth logins
    const graphStoreUrl = new URL(writeEndpoint);
    graphStoreUrl.pathname = /\/sparql-auth\/?$/i.test(graphStoreUrl.pathname)
      ? graphStoreUrl.pathname.replace(/\/sparql-auth\/?$/i, "/sparql-graph-crud-auth")
      : graphStoreUrl.pathname.replace(/\/sparql\/?$/i, "/sparql-graph-crud");
    graphStoreUrl.search = "";
    graphStoreUrl.hash = "";

    // Clear every distinct manifest destination before loading any documents. The clear is a SPARQL Update
    // (CLEAR SILENT GRAPH) POSTed to the write endpoint (/sparql-auth for sparql-auth logins), the same
    // call path as every other Maestro write; a graph that does not exist yet is already empty.
    const destinationGraphs = [...new Set(files.map((file) => graphForFile(file.name, request)))].sort();
    for (const destinationGraph of destinationGraphs) {
      try {
        await updatePersonalSparql(`CLEAR SILENT GRAPH <${destinationGraph}>`, 30000, request);
      } catch (error) {
        throw new Error(`Could not clear manifest graph ${destinationGraph} before loading via ${writeEndpoint.toString()}: ${error instanceof Error ? error.message : String(error)}`);
      }
      console.info(`Maestro cleared manifest graph ${destinationGraph}.`);
    }

    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const destinationGraph = graphForFile(file.name, request);
      const fileGraphStoreUrl = new URL(graphStoreUrl.toString());
      // Graph IRI is sent as-is (only URL-structural characters escaped), as in Virtuoso's own curl examples.
      fileGraphStoreUrl.search = `?graph=${destinationGraph.replace(/[%&#+\s]/g, (c) => encodeURIComponent(c))}`;
      const path = resolve(getGraphDirectory(), file.name);
      let content = await readFile(path, "utf8");
      if (!content.trim()) {
        console.warn(`Maestro skipped empty RDF document ${path}.`);
        continue;
      }
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
      const extension = extname(file.name).toLowerCase();
      if (canParseRdfExtension(extension)) {
        // Preferred path: parse the document here and load it with SPARQL INSERT DATA through the write endpoint
        // (/sparql-auth). The graph-store endpoint runs DB.DBA.TTLP_RL_NEW_GRAPH, which ordinary accounts such as
        // OpenLink's demo "acme" user are not permitted to execute (SR575), whereas SPARQL updates are allowed.
        let update: string;
        try {
          const triples = await parseRdfDocument(content, extension, destinationGraph);
          update = buildInsertData(destinationGraph, triples);
        } catch (error) {
          throw new Error(`Could not parse RDF document ${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          await updatePersonalSparql(update, 60000, request);
        } catch (error) {
          throw new Error(`Could not load RDF document ${path} into graph ${destinationGraph} via ${writeEndpoint.toString()}: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        // Formats Maestro cannot parse itself (JSON-LD, RDFa, ...) still go through the graph-store endpoint,
        // which requires the account to be allowed to run Virtuoso's RDF loader procedures.
        const response = await fetchWithDigestFallback(fileGraphStoreUrl, {
          method: "POST",
          headers: personalSparqlHeaders(request, mediaTypes[extension], "text/plain, text/html, application/json, */*"),
          body: content,
          cache: "no-store",
          signal: AbortSignal.timeout(30000),
        });
        const responseText = (await response.text()).slice(0, 3000);
        if (!response.ok || /(?:Virtuoso\s+Exception|Error\s+SR|SPARQL\s+.*Error|failed)/i.test(responseText) && !/0 errors/i.test(responseText)) {
          throw new Error(`Could not load RDF document ${path} into graph ${destinationGraph} (HTTP ${response.status}): ${responseText || "no response details"}${authNote(response) ? ` [${authNote(response)}]` : ""}`);
        }
      }
      console.info(`Maestro loaded ${file.name} into ${destinationGraph}.`);
      loaded.push({ file: file.name, graph: destinationGraph });
    }
    return loaded;
  })();
  graphDirectorySeedPromises.set(sessionKey, promise);
  promise.catch(() => {
    if (graphDirectorySeedPromises.get(sessionKey) === promise) graphDirectorySeedPromises.delete(sessionKey);
  });
  return promise;
}

/** Compatibility wrapper: policy discovery loads the manifest-mapped RDF files from /graph. */
export async function ensureShapesGraphSeeded(request?: Request): Promise<void> {
  await ensureGraphDirectorySeeded(request);
}

export type FctEndpoint = { id: string; label: string; url: string; group: string };
type SparqlJson = { results?: { bindings?: Record<string, { type?: string; value?: string }>[] } };

/** Return the personal READ endpoint (/sparql) without embedding credentials in its URL. A pasted /sparql-auth is normalised to /sparql. */
export function personalSparqlUrl(request?: Request): URL {
  const session = getPersonalSession(request);
  const raw = (session?.graphStore || DEFAULT_GRAPH_STORE).trim();
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Personal graph store must use HTTP or HTTPS.");
  url.pathname = url.pathname.replace(/\/sparql-auth\/?$/i, "/sparql");
  return url;
}

/** Return the personal WRITE endpoint: the user's /sparql endpoint switched to /sparql-auth for sparql-auth logins. */
export function personalSparqlWriteUrl(request?: Request): URL {
  const url = personalSparqlUrl(request);
  const session = getPersonalSession(request);
  if (session?.authType === "sparql-auth") {
    url.pathname = url.pathname.replace(/\/sparql\/?$/i, "/sparql-auth");
  }
  return url;
}

/** Build authenticated request headers for the personal SPARQL endpoint. */
export function personalSparqlHeaders(request?: Request, contentType = "application/x-www-form-urlencoded; charset=UTF-8", accept = "application/sparql-results+json, application/json;q=0.9"): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": contentType, Accept: accept };
  const session = getPersonalSession(request);
  if (session?.authHeader) {
    headers.Authorization = session.authHeader;
  }
  return headers;
}

/** Execute a read-only SPARQL query against the personal endpoint. */
export async function queryPersonalSparql(query: string, timeoutMs = 20000, request?: Request): Promise<SparqlJson> {
  const endpoint = personalSparqlUrl(request);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders(request, "application/x-www-form-urlencoded; charset=UTF-8"),
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
export async function askPersonalSparql(query: string, timeoutMs = 20000, request?: Request): Promise<boolean> {
  const endpoint = personalSparqlUrl(request);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders(request, "application/x-www-form-urlencoded; charset=UTF-8"),
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

/** Execute a SPARQL Update against the personal WRITE endpoint (/sparql-auth for sparql-auth logins). */
export async function updatePersonalSparql(update: string, timeoutMs = 30000, request?: Request): Promise<string> {
  const endpoint = personalSparqlWriteUrl(request);
  const response = await fetchWithDigestFallback(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders(request, "application/sparql-update; charset=UTF-8", "text/plain, text/html, application/json, */*"),
    body: update,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.text()).slice(0, 3000);
  if (!response.ok) throw new Error(`Personal SPARQL update returned HTTP ${response.status}: ${body || "no response details"}${authNote(response) ? ` [${authNote(response)}]` : ""}`);
  if (/(?:Virtuoso\s+Exception|Error\s+SR|SPARQL\s+UPDATE\s+Error|failed)/i.test(body) && !/0 errors/i.test(body)) {
    throw new Error(`Personal SPARQL update failed: ${body}`);
  }
  return body;
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Seed the registry once, then load endpoint records and groups from its configured RDF graph. */
export async function getConfiguredFctEndpoints(request?: Request): Promise<FctEndpoint[]> {
  await ensureGraphDirectorySeeded(request);
  const dataserversGraph = getDataserversGraph(request);
  const legacyNs = `${dataserversGraph}#`;
  const query = `PREFIX rdf: <${RDF_NS}>\nPREFIX rdfs: <${RDFS_NS}>\nPREFIX dcterms: <${DCTERMS_NS}>\nPREFIX skos: <${SKOS_NS}>\nPREFIX schema: <${SCHEMA_NS}>\nSELECT DISTINCT ?server ?name ?url ?groupName ?groupOrder ?serverOrder WHERE { GRAPH <${dataserversGraph}> { { ?server rdf:type schema:EntryPoint ; rdfs:label ?name ; schema:url ?url . OPTIONAL { ?server schema:position ?serverOrder } OPTIONAL { ?server dcterms:isPartOf ?group . ?group rdf:type skos:Collection ; rdfs:label ?groupName . OPTIONAL { ?group schema:position ?groupOrder } } } UNION { ?server rdf:type <${legacyNs}Dataserver> ; <${legacyNs}serverName> ?name ; <${legacyNs}serverURL> ?url . OPTIONAL { ?server <${legacyNs}serverOrder> ?serverOrder } OPTIONAL { ?server <${legacyNs}inGroup> ?group . ?group <${legacyNs}groupName> ?groupName . OPTIONAL { ?group <${legacyNs}groupOrder> ?groupOrder } } } } } ORDER BY COALESCE(?groupOrder, 9999) COALESCE(?serverOrder, 9999) STR(?name)`;
  const payload = await queryPersonalSparql(query, 20000, request);
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
  return selectConfiguredFctEndpoint(request, await getConfiguredFctEndpoints(request));
}
