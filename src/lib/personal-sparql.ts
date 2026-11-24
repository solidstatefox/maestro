import { GRAPH, resolveGraph, type GraphKey } from "@/lib/constants/graphs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { permittedGraphServerTarget, checkGraphServerDestination } from "./graph-server-target";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { graphForPrefix, personalAuthenticatedEndpoint, personalWriteEndpoint } from "./personal-auth";
import { parseRdfDocument } from "./rdf-to-sparql";
import { describeUpstreamError } from "@/lib/upstream-error";
import { graphServerUrlMatches } from "@/lib/graph-server-health";

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

/** Personal authentication is deliberately not implemented. */
export class PersonalSessionRequiredError extends Error {
  constructor() { super("Personal authentication disabled."); this.name="PersonalSessionRequiredError"; }
}
export function assertPersonalSession(_request?:Request): PersonalSession { throw new PersonalSessionRequiredError(); }
export function getPersonalSession(_request?:Request): PersonalSession | null { return null; }

/** Read and validate the file-to-Graph mapping. */
function getGraphManifest(): GraphManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(getGraphManifestPath(), "utf8"));
  } catch (error) {
    throw new Error(`Could not read graph/manifest.json: ${describeUpstreamError(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`graph/manifest.json must contain a JSON object mapping RDF filenames to Graph graph local paths or IRIs.`);
  }
  const result: GraphManifest = {};
  for (const [filename, rawGraph] of Object.entries(manifest as Record<string, unknown>)) {
    // Manifest keys are paths relative to /graph, not merely basenames.
    // Never let RDF manifests escape the graph directory.
    if (!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(filename) ||
        filename.split("/").some(part => part === "." || part === "..") ||
        filename === "manifest.json") {
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
  if (!Object.values(GRAPH).includes(rawPath as GraphKey)) throw new Error(`Unknown graph registry key in manifest: ${rawPath}`);
  return resolveGraph(rawPath as GraphKey, getUserGraph(request));
}

/** The user's Maestro graph: <graphPrefix>/query (no fragment). */
export function getUserGraph(request?: Request): string {
  const session = getPersonalSession(request);
  return graphForPrefix(session?.graphPrefix || DEFAULT_USER_GRAPH);
}

export const getDataserversGraph = (request?: Request): string => graphForFile("dataserver-seed.ttl", request);
/** History graph base IRI (<graph>/query). Callers append #history / #bookmarks. */
export const getHistoryGraph = (request?: Request): string => getUserGraph(request);
export const getOntologyGraph = (request?: Request): string => graphForFile("rdfs/maestro-ui-ontology.ttl", request);
export const getShapesGraph = (request?: Request): string => graphForFile("maestro-shacl-policies.ttl", request);
export const VFCT_NS = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
export const MAESTRO_IDS_NS = "gttp://ggg.maestro.ecosys/ids/";

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
  return endpoints.find((item) => graphServerUrlMatches(item.url, normalized, item.schemeInferred));
}
type SparqlJson = { results?: { bindings?: Record<string, { type?: string; value?: string }>[] } };

/** All personal SPARQL reads use the read-only /sparql URL entered at login. */
export function personalSparqlUrl(request?: Request): URL {
  return new URL(personalAuthenticatedEndpoint(assertPersonalSession(request)));
}

/** All personal SPARQL writes use the authentication method selected at login. */
export function personalSparqlWriteUrl(request?: Request): URL {
  return new URL(personalWriteEndpoint(assertPersonalSession(request)));
}

/** Content negotiation only; no Authorization header is generated. */
export function personalSparqlHeaders(_request?:Request, contentType="application/x-www-form-urlencoded; charset=UTF-8", accept="application/sparql-results+json, application/json;q=0.9"): Record<string,string> {
  return {"Content-Type":contentType,Accept:accept};
}

/** Preserve the real graph-server status and complete upstream error document. */
export class PersonalSparqlHttpError extends Error {
  constructor(public status: number, public responseBody: string, operation: string) {
    super(`Personal SPARQL ${operation} returned HTTP ${status}: ${responseBody.slice(0, 4000)}`);
    this.name = "PersonalSparqlHttpError";
  }
}

/** All personal-store data operations stop before any network request. */
export async function probePersonalSparqlAuth(_query:string,_timeoutMs=15000,_request?:Request): Promise<Response> {
  throw new PersonalSessionRequiredError();
}
export async function queryPersonalSparql(_query:string,_timeoutMs=20000,_request?:Request): Promise<SparqlJson> {
  throw new PersonalSessionRequiredError();
}
export async function askPersonalSparql(_query:string,_timeoutMs=20000,_request?:Request): Promise<boolean> {
  throw new PersonalSessionRequiredError();
}
export async function updatePersonalSparql(_update:string,_timeoutMs=30000,_request?:Request): Promise<string> {
  throw new PersonalSessionRequiredError();
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type PublicSeedSnapshot = { endpoints: FctEndpoint[]; digest: string };
let publicSeedCache: PublicSeedSnapshot | null = null;
let publicSeedInFlight: { digest: string; promise: Promise<PublicSeedSnapshot> } | null = null;

/** The proxy's flat-file list is a courtesy, not an execution allowlist.
 * Checking a digest reads only the small manifest-selected flat-file bytes,
 * never parses Turtle, hits a personal SPARQL endpoint, or downloads a list.
 * Recompute on each check so edits are seen without a process restart.
 */
async function courtesySeedFiles(): Promise<{ sources: { file: string; content: string }[]; digest: string }> {
  const files = Object.entries(getGraphManifest())
    .filter(([file, dest]) => dest === GRAPH.GRAPHS && /\.(?:ttl|n3)$/i.test(file))
    .map(([file]) => file).sort();
  if (!files.includes("dataserver-seed.ttl")) throw new Error("Missing graph-server courtesy seed list.");
  const allSources = await Promise.all(files.map(async file => ({
    file, content: await readFile(resolve(getGraphDirectory(), file), "utf8"),
  })));
  // The flat-file catalog can be spread across manifest-selected RDF files.
  // Only documents declaring an EntryPoint participate. This cheap text test
  // avoids reparsing unrelated ontology/label documents for digest checks.
  const sources = allSources.filter(({ content }) => /\bEntryPoint\b/.test(content));
  const hasher = createHash("sha256");
  for (const {file,content} of sources) hasher.update(file).update("\0").update(content).update("\0");
  const digest = `sha256:${hasher.digest("hex")}`;
  return {sources,digest};
}

async function publicSeedSnapshot(): Promise<PublicSeedSnapshot> {
  const {sources,digest} = await courtesySeedFiles();
  if (publicSeedCache?.digest === digest) return publicSeedCache;
  if (publicSeedInFlight?.digest === digest) return publicSeedInFlight.promise;

  const promise = (async () => {
    const parsed = await Promise.all(sources.map(async ({file,content}) => ({
      file, triples: await parseRdfDocument(content, ".ttl", `http://localhost/maestro-public/${file}`),
    })));
    const triples = parsed.flatMap(({triples}) => triples);
    const objects = (subject: string, predicate: string) => triples
      .filter(t => t.subject.value === subject && t.predicate.value === predicate).map(t => t.object);
    const first = (subject: string, predicate: string) => objects(subject, predicate)[0]?.value;
    const order = (subject: string, predicate: string) => {
      const n = Number(first(subject, predicate)); return Number.isFinite(n) ? n : 9999;
    };
    const isType = (subject: string, type: string) => objects(subject, `${RDF_NS}type`).some(o => o.value === type);
    const servers = [...new Set(triples.map(t => t.subject.value))]
      .filter(subject => isType(subject, `${SCHEMA_NS}EntryPoint`));
    const rows = servers.flatMap(server => {
      const label = first(server, `${RDFS_NS}label`)?.trim() ?? "";
      const rawUrl = first(server, `${SCHEMA_NS}url`)?.trim() ?? "";
      const url = normalizeGraphServerUri(rawUrl);
      if (!label || !permittedGraphServerTarget(url)) return [];
      const group = first(server, `${DCTERMS_NS}isPartOf`);
      const groupName = (group && isType(group, `${SKOS_NS}Collection`)
        ? first(group, `${RDFS_NS}label`)?.trim() : "") || "Endpoints";
      return [{ label, url, schemeInferred: !/^https?:\/\//i.test(rawUrl), group: groupName,
        groupOrder: group ? order(group, `${SCHEMA_NS}position`) : 9999,
        serverOrder: order(server, `${SCHEMA_NS}position`) }];
    });
    rows.sort((a,b) => a.groupOrder-b.groupOrder || a.serverOrder-b.serverOrder || a.label.localeCompare(b.label));
    const seenUrls = new Set<string>();
    const usedIds = new Set<string>();
    const endpoints: FctEndpoint[] = [];
    for (const row of rows) {
      if (seenUrls.has(row.url) || row.label.toLowerCase() === "personal sparql") continue;
      seenUrls.add(row.url);
      const base = row.group === "Endpoints" ? slugify(row.label) : slugify(`${row.group}-${row.label}`);
      let id = base;
      for (let suffix=2;usedIds.has(id);suffix++) id = `${base}-${suffix}`;
      usedIds.add(id);
      endpoints.push({id,label:row.label,url:row.url,group:row.group,schemeInferred:row.schemeInferred});
    }
    return {endpoints,digest};
  })();
  publicSeedInFlight = {digest,promise};
  void promise.then(snapshot => {
    if (publicSeedInFlight?.digest === digest) { publicSeedCache = snapshot; publicSeedInFlight = null; }
  }, () => { if (publicSeedInFlight?.digest === digest) publicSeedInFlight = null; });
  return promise;
}
export const getCourtesyGraphServerSnapshot = publicSeedSnapshot;
export const getSeedFctEndpoints = async (): Promise<FctEndpoint[]> => (await publicSeedSnapshot()).endpoints;
// A check compares raw flat-file content only; a list request is what parses RDF.
export const getCourtesyGraphServerDigest = async (): Promise<string> => (await courtesySeedFiles()).digest;

/** Registry is a courtesy directory only. No authenticated SPARQL lookup is
 * needed for a public read, and a Shared server never needs registration. */
export async function getConfiguredFctEndpoints(_request?: Request): Promise<FctEndpoint[]> {
  return getSeedFctEndpoints();
}

/** Select only the graph server explicitly declared by the current FCT query.
 * No request cookies, per-browser selection, or implicit first-server fallback. */
export function resolveFctEndpointFromAddr(endpoints: FctEndpoint[], addr: unknown): FctEndpoint | null {
  if (typeof addr !== "string") return null;
  const separator = addr.indexOf("@");
  if (separator < 0) return null;
  const server = normalizeGraphServerUri(addr.slice(separator + 1).trim());
  if (!server) return null;
  if (!permittedGraphServerTarget(server)) return null;
  const configured = resolveConfiguredFctEndpoint(endpoints, server);
  return configured ? { ...configured, url: server }
    : { id: `shared:${encodeURIComponent(server)}`, label: server, url: server, group: "Shared" };
}

/** Extract the address from serialized FCT query XML for auxiliary operations. */
export function fctAddrFromXml(xml: unknown): string {
  if (typeof xml !== "string") return "";
  const root = xml.match(/<query\b([^>]*)>/i)?.[1] ?? "";
  const raw = root.match(/\baddr\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
  return raw.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
