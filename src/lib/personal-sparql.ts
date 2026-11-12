import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { graphForPrefix } from "./personal-auth";
import { authNote, fetchWithDigestFallback } from "./digest-auth";
import { buildInsertData, canParseRdfExtension, parseRdfDocument } from "./rdf-to-sparql";
import { describeUpstreamError } from "@/lib/upstream-error";

/** Shared server-side access to Maestro's personal SPARQL store and RDF-backed Graph registry. */
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";
const SCHEMA_NS = "https://schema.org/";

/** The manifest maps each RDF filename in /graph to its destination Graph graph IRI or local path. */
const getGraphDirectory = () => {
  const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
  return resolve(cwd, "graph");
};
const getGraphManifestPath = () => resolve(getGraphDirectory(), "manifest.json");

export const DEFAULT_USER_GRAPH = "http://localhost:8890/DAV/home/dba";
export const DEFAULT_GRAPH_STORE = "http://localhost:8890/sparql";

type GraphManifest = Record<string, string>;

export type PersonalSession = {
  graphStore: string;
  graphPrefix: string;
  authHeader?: string;
  authType?: string;
  userName?: string;
  userAvatar?: string;
};

/** Thrown when personal-graph-store functionality is used without a login session. Nothing is sent over the network. */
export class PersonalSessionRequiredError extends Error {
  constructor() {
    super("Not logged in: the personal graph server is only used with a login session.");
    this.name = "PersonalSessionRequiredError";
  }
}

/** Guard for every personal-store entry point: with no session there is no personal graph server to talk to. */
export function assertPersonalSession(request?: Request): PersonalSession {
  const session = getPersonalSession(request);
  if (!session) throw new PersonalSessionRequiredError();
  return session;
}

/** Extract the authenticated personal graph server session from request cookies or headers. */
export function getPersonalSession(request?: Request): PersonalSession | null {
  if (!request) return null;
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)maestro_session=([^;]+)/);
  if (match) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1])) as PersonalSession & { graphsitePrefix?: string };
      return { ...parsed, graphPrefix: parsed.graphPrefix || parsed.graphsitePrefix || "" };
    } catch {
      return null;
    }
  }
  const headerStore = request.headers.get("x-personal-graph-store");
  const headerPrefix = request.headers.get("x-personal-graph");
  const authHeader = request.headers.get("authorization") || request.headers.get("x-personal-auth") || undefined;
  if (headerStore && headerPrefix) {
    return {
      graphStore: headerStore,
      graphPrefix: headerPrefix,
      authHeader,
    };
  }
  return null;
}

/** Read and validate the file-to-Graph mapping. */
function getGraphManifest(): GraphManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(getGraphManifestPath(), "utf8"));
  } catch (error) {
    throw new Error(`Could not read graph/manifest.json: ${error instanceof Error ? error.name : "Unknown error"}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`graph/manifest.json must contain a JSON object mapping RDF filenames to Graph graph local paths or IRIs.`);
  }
  const result: GraphManifest = {};
  for (const [filename, rawGraph] of Object.entries(manifest as Record<string, unknown>)) {
    if (!filename || filename === "manifest.json" || filename.includes("/") || filename.includes("\\") || filename.startsWith(".")) {
      throw new Error(`Invalid RDF filename in graph/manifest.json: ${filename}`);
    }
    if (typeof rawGraph !== "string") throw new Error(`Graph for ${filename} must be a string in graph/manifest.json.`);
    result[filename] = rawGraph.trim().replace(/\\:/g, ":");
  }
  return result;
}

/** Resolve the target graph for an RDF file listed in /graph/manifest.json: <graph>/query + manifest fragment. */
export function graphForFile(filename: string, request?: Request): string {
  const rawPath = getGraphManifest()[filename];
  if (!rawPath) throw new Error(`No Graph mapping for ${filename} in graph/manifest.json.`);
  if (/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(rawPath)) {
    return rawPath;
  }
  const graph = getUserGraph(request);
  const local = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${graph}${local}`;
}

/** The user's Maestro graph: <graphPrefix>/query (no fragment). */
export function getUserGraph(request?: Request): string {
  const session = getPersonalSession(request);
  return graphForPrefix(session?.graphPrefix || DEFAULT_USER_GRAPH);
}

export const getDataserversGraph = (request?: Request): string => graphForFile("dataserver-seed.ttl", request);
/** History graph base IRI (<graph>/query). Callers append #history / #bookmarks. */
export const getHistoryGraph = (request?: Request): string => getUserGraph(request);
export const getOntologyGraph = (request?: Request): string => graphForFile("maestro-ui-ontology.ttl", request);
export const getShapesGraph = (request?: Request): string => graphForFile("maestro-shacl-policies.ttl", request);
export const VFCT_NS = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
export const MAESTRO_IDS_NS = "gttp://ggg.maestro.ecosys/ids/";

export type GraphSeedResult = { file: string; graph: string }[];

/** One seed per personal session (store + graph + credentials), not one per server process. */
const graphDirectorySeedPromises = new Map<string, Promise<GraphSeedResult>>();
const graphDirectorySeedInProgress = new Set<string>();

function seedSessionKey(request?: Request): string {
  const session = getPersonalSession(request);
  return [session?.graphStore ?? "", session?.graphPrefix ?? "", session?.authHeader ?? ""].join("|");
}

/** Wait for an in-progress login/reload of this session's RDF policy graph.
 * Policy queries must never observe the interval between CLEAR GRAPH and INSERT DATA.
 * This does not trigger a reload when no seeding is in progress.
 */
export async function waitForPersonalGraphSeed(request?: Request): Promise<void> {
  const pending = graphDirectorySeedPromises.get(seedSessionKey(request));
  if (pending) await pending;
}

/** Upload each RDF document in /graph to <graphPrefix>/query + manifest fragment on the user's graph server. Pass force to reload (used right after login). */
export async function ensureGraphDirectorySeeded(request?: Request, options: { force?: boolean } = {}): Promise<GraphSeedResult> {
  assertPersonalSession(request);
  const sessionKey = seedSessionKey(request);
  // A force reload must not overtake another in-progress reload for this session.
  const existing = graphDirectorySeedPromises.get(sessionKey);
  if (existing && (!options.force || graphDirectorySeedInProgress.has(sessionKey))) return existing;
  graphDirectorySeedInProgress.add(sessionKey);
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
    const files = entries.filter((entry) => entry.isFile() && Object.hasOwn(manifest, entry.name) && mediaTypes[extname(entry.name).toLowerCase()]);
    if (files.length === 0) throw new Error(`No supported RDF documents were found in ./graph.`);
    const listedFiles = new Set(files.map((file) => file.name));
    for (const filename of Object.keys(manifest)) {
      if (!listedFiles.has(filename)) throw new Error(`Manifest entry ${filename} has no matching supported RDF file in ${getGraphDirectory()}.`);
    }

    const endpoint = personalSparqlUrl(request); // read endpoint (/sparql), advertised in the Datasites seed
    const writeEndpoint = personalSparqlWriteUrl(request); // /sparql-auth for sparql-auth logins
    const graphStoreUrl = new URL(writeEndpoint);
    graphStoreUrl.pathname = /\/sparql-auth\/?$/i.test(graphStoreUrl.pathname)
      ? graphStoreUrl.pathname.replace(/\/sparql-auth\/?$/i, "/sparql-graph-crud-auth")
      : graphStoreUrl.pathname.replace(/\/sparql\/?$/i, "/sparql-graph-crud");
    graphStoreUrl.search = "";
    graphStoreUrl.hash = "";

    // Clear a destination immediately before reloading its manifest files,
    // not all destinations upfront. Load the graph-server registry first so
    // it is never empty for the duration of the entire manifest import.
    const clearedGraphs = new Set<string>();

    for (const file of files.sort((a, b) =>
      (a.name === "dataserver-seed.ttl" ? -1 : b.name === "dataserver-seed.ttl" ? 1 : a.name.localeCompare(b.name)))) {
      const destinationGraph = graphForFile(file.name, request);
      if (!clearedGraphs.has(destinationGraph)) {
        try {
          await updatePersonalSparql(`CLEAR SILENT GRAPH <${destinationGraph}>`, 30000, request);
        } catch (error) {
          throw new Error(`Could not clear manifest graph ${destinationGraph} before loading: ${describeUpstreamError(error)}`);
        }
        clearedGraphs.add(destinationGraph);
        console.info(`Maestro cleared manifest graph ${destinationGraph}.`);
      }
      const fileGraphStoreUrl = new URL(graphStoreUrl.toString());
      // Graph IRI is sent as-is (only URL-structural characters escaped), as in Virtuoso's own curl examples.
      fileGraphStoreUrl.search = `?graph=${destinationGraph.replace(/[%&#+\s]/g, (c) => encodeURIComponent(c))}`;
      const path = resolve(getGraphDirectory(), file.name);
      let content = await readFile(path, "utf8");
      if (!content.trim()) {
        console.warn(`Maestro skipped empty RDF document ${file.name}.`);
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
          throw new Error(`Could not parse RDF document ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          await updatePersonalSparql(update, 60000, request);
        } catch (error) {
          throw new Error(`Could not load RDF document ${file.name} into graph ${destinationGraph}: ${describeUpstreamError(error)}`);
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
          throw new Error(`Could not load RDF document ${file.name} into graph ${destinationGraph} (HTTP ${response.status}): ${responseText || "no response details"}${authNote(response) ? ` [${authNote(response)}]` : ""}`);
        }
      }
      console.info(`Maestro loaded ${file.name} into ${destinationGraph}.`);
      loaded.push({ file: file.name, graph: destinationGraph });
    }
    // After the manifest reload, reinstate the shared Record state vocabulary/SHACL restriction.
    const { ensurePersonalStatusSchema } = await import("@/lib/personal-status-server");
    await ensurePersonalStatusSchema(request!);
    return loaded;
  })();
  graphDirectorySeedPromises.set(sessionKey, promise);
  void promise.then(() => {
    graphDirectorySeedInProgress.delete(sessionKey);
  }, () => {
    graphDirectorySeedInProgress.delete(sessionKey);
    if (graphDirectorySeedPromises.get(sessionKey) === promise) graphDirectorySeedPromises.delete(sessionKey);
  });
  return promise;
}

/** Accept a host-only graph-server identifier, defaulting to HTTPS SPARQL. */
export function normalizeGraphServerUri(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (!(["https:", "http:"].includes(parsed.protocol)) || !parsed.hostname || parsed.username || parsed.password) return raw;
    // Only a host-only endpoint gets /sparql; retain explicit paths unchanged.
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) parsed.pathname = "/sparql";
    return parsed.toString();
  } catch { return raw; }
}

export type FctEndpoint = { id: string; label: string; url: string; group: string; schemeInferred?: boolean };

/** HTTP fallback is permitted only for host-only registry entries whose HTTPS probe returned 404. */
export function resolveConfiguredFctEndpoint(endpoints: FctEndpoint[], requested: string): FctEndpoint | undefined {
  const normalized = normalizeGraphServerUri(requested);
  return endpoints.find((item) => item.url === normalized ||
    (item.schemeInferred && normalized === item.url.replace(/^https:\/\//i, "http://")));
}
type SparqlJson = { results?: { bindings?: Record<string, { type?: string; value?: string }>[] } };

/** Return the personal READ endpoint (/sparql) without embedding credentials in its URL. A pasted /sparql-auth is normalised to /sparql. */
export function personalSparqlUrl(request?: Request): URL {
  const session = assertPersonalSession(request);
  const raw = (session.graphStore || DEFAULT_GRAPH_STORE).trim();
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

/** Preserve the real graph-server status and complete upstream error document. */
export class PersonalSparqlHttpError extends Error {
  constructor(public status: number, public responseBody: string, operation: string) {
    super(`Personal SPARQL ${operation} returned HTTP ${status}: ${responseBody.slice(0, 4000)}`);
    this.name = "PersonalSparqlHttpError";
  }
}

/** Execute a read-only SPARQL query against the personal endpoint. */
export async function queryPersonalSparql(query: string, timeoutMs = 20000, request?: Request): Promise<SparqlJson> {
  assertPersonalSession(request);
  const endpoint = personalSparqlUrl(request);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders(request, "application/x-www-form-urlencoded; charset=UTF-8"),
    body: new URLSearchParams({ query }).toString(),
    cache: "no-store",
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  const body = await response.text();
  if (!response.ok) throw new PersonalSparqlHttpError(response.status, body, "query");
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
  assertPersonalSession(request);
  const endpoint = personalSparqlUrl(request);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: personalSparqlHeaders(request, "application/x-www-form-urlencoded; charset=UTF-8"),
    body: new URLSearchParams({ query }).toString(),
    cache: "no-store",
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  const body = await response.text();
  if (!response.ok) throw new PersonalSparqlHttpError(response.status, body, "ASK");
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
  assertPersonalSession(request);
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

let seedEndpointsPromise: Promise<FctEndpoint[]> | null = null;

/**
 * Endpoint list for visitors who are not logged in: read straight from the local ./graph/dataserver-seed.ttl
 * (the same document that seeds the personal registry after login). No personal graph server is contacted.
 */
export function getSeedFctEndpoints(): Promise<FctEndpoint[]> {
  if (seedEndpointsPromise) return seedEndpointsPromise;
  const promise = (async (): Promise<FctEndpoint[]> => {
    const content = await readFile(resolve(getGraphDirectory(), "dataserver-seed.ttl"), "utf8");
    const triples = await parseRdfDocument(content, ".ttl", "http://localhost/dataserver-seed");
    const objects = (subject: string, predicate: string) => triples.filter((t) => t.subject.value === subject && t.predicate.value === predicate).map((t) => t.object);
    const first = (subject: string, predicate: string) => objects(subject, predicate)[0]?.value;
    const order = (subject: string, predicate: string) => { const n = Number(first(subject, predicate)); return Number.isFinite(n) ? n : 9999; };
    const isType = (subject: string, type: string) => objects(subject, `${RDF_NS}type`).some((o) => o.value === type);
    const servers = [...new Set(triples.map((t) => t.subject.value))].filter((subject) => isType(subject, `${SCHEMA_NS}EntryPoint`));
    const rows = servers.flatMap((server) => {
      const label = first(server, `${RDFS_NS}label`)?.trim() ?? "";
      const url = normalizeGraphServerUri(first(server, `${SCHEMA_NS}url`)?.trim() ?? "");
      if (!label || !/^https?:\/\//i.test(url)) return [];
      const group = first(server, `${DCTERMS_NS}isPartOf`);
      const groupName = (group && isType(group, `${SKOS_NS}Collection`) ? first(group, `${RDFS_NS}label`)?.trim() : "") || "Endpoints";
      return [{ label, url, schemeInferred: !/^https?:\/\//i.test(first(server, `${SCHEMA_NS}url`)?.trim() ?? ""), group: groupName, groupOrder: group ? order(group, `${SCHEMA_NS}position`) : 9999, serverOrder: order(server, `${SCHEMA_NS}position`) }];
    });
    rows.sort((a, b) => a.groupOrder - b.groupOrder || a.serverOrder - b.serverOrder || a.label.localeCompare(b.label));
    const seen = new Set<string>();
    const endpoints: FctEndpoint[] = [];
    for (const row of rows) {
      const id = row.group === "Endpoints" ? slugify(row.label) : slugify(`${row.group}-${row.label}`);
      if (seen.has(id)) continue;
      seen.add(id);
      endpoints.push({ id, label: row.label, url: row.url, group: row.group, schemeInferred: row.schemeInferred });
    }
    return endpoints;
  })();
  seedEndpointsPromise = promise;
  promise.catch(() => { if (seedEndpointsPromise === promise) seedEndpointsPromise = null; });
  return promise;
}

/** Logged in: read endpoint records from the existing personal RDF registry without mutating it.
 * Graph uploads happen explicitly on login via /proxy/api/graph-seed, never during
 * normal FCT refresh, endpoint discovery, or query execution. Logged-out
 * visitors use the local seed file only. */
export async function getConfiguredFctEndpoints(request?: Request): Promise<FctEndpoint[]> {
  if (!getPersonalSession(request)) {
    const seeded = await getSeedFctEndpoints();
    // A locally seeded Personal SPARQL entry must never be selected or probed by visitors.
    return seeded.filter((endpoint) => endpoint.id !== "personal-sparql" && endpoint.label.trim().toLowerCase() !== "personal sparql");
  }
  const dataserversGraph = getDataserversGraph(request);
  const legacyNs = `${dataserversGraph}#`;
  const query = `PREFIX rdf: <${RDF_NS}>\nPREFIX rdfs: <${RDFS_NS}>\nPREFIX dcterms: <${DCTERMS_NS}>\nPREFIX skos: <${SKOS_NS}>\nPREFIX schema: <${SCHEMA_NS}>\nSELECT DISTINCT ?server ?name ?url ?groupName ?groupOrder ?serverOrder WHERE { GRAPH <${dataserversGraph}> { { ?server rdf:type schema:EntryPoint ; rdfs:label ?name ; schema:url ?url . OPTIONAL { ?server schema:position ?serverOrder } OPTIONAL { ?server dcterms:isPartOf ?group . ?group rdf:type skos:Collection ; rdfs:label ?groupName . OPTIONAL { ?group schema:position ?groupOrder } } } UNION { ?server rdf:type <${legacyNs}Dataserver> ; <${legacyNs}serverName> ?name ; <${legacyNs}serverURL> ?url . OPTIONAL { ?server <${legacyNs}serverOrder> ?serverOrder } OPTIONAL { ?server <${legacyNs}inGroup> ?group . ?group <${legacyNs}groupName> ?groupName . OPTIONAL { ?group <${legacyNs}groupOrder> ?groupOrder } } } } } ORDER BY COALESCE(?groupOrder, 9999) COALESCE(?serverOrder, 9999) STR(?name)`;
  const payload = await queryPersonalSparql(query, 20000, request);
  const endpoints: FctEndpoint[] = [];
  for (const binding of payload.results?.bindings ?? []) {
    const label = binding.name?.value?.trim() ?? "";
    const rawUrl = binding.url?.value?.trim() ?? "";
    const url = normalizeGraphServerUri(rawUrl);
    const group = binding.groupName?.value?.trim() || "Endpoints";
    if (!label || !/^https?:\/\//i.test(url)) continue;
    const id = group === "Endpoints" ? slugify(label) : slugify(`${group}-${label}`);
    endpoints.push({ id, label, url, group, schemeInferred: !/^https?:\/\//i.test(rawUrl) });
  }
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    if (seen.has(endpoint.id)) return false;
    seen.add(endpoint.id);
    return true;
  });
}

/** Select only the graph server explicitly declared by the current FCT query.
 * No request cookies, per-browser selection, or implicit first-server fallback. */
export function resolveFctEndpointFromAddr(endpoints: FctEndpoint[], addr: unknown): FctEndpoint | null {
  if (typeof addr !== "string") return null;
  const separator = addr.indexOf("@");
  if (separator < 0) return null;
  const server = normalizeGraphServerUri(addr.slice(separator + 1).trim());
  if (!server) return null;
  const configured = resolveConfiguredFctEndpoint(endpoints, server);
  return configured ? { ...configured, url: server } : null;
}

/** Extract the address from serialized FCT query XML for auxiliary operations. */
export function fctAddrFromXml(xml: unknown): string {
  if (typeof xml !== "string") return "";
  const root = xml.match(/<query\b([^>]*)>/i)?.[1] ?? "";
  const raw = root.match(/\baddr\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
  return raw.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
