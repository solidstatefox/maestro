/** Linked Data ontology ingestion for Categories. Uses Maestro's existing RDF parser,
 * authenticated SPARQL update endpoint and ontology graph. No additional graph loader.
 * Retrieval is deliberately bounded to avoid import storms from public ontologies.
 */
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { parseRdfDocument, buildInsertData } from "@/lib/rdf-to-sparql";
import { getUserGraph, updatePersonalSparql } from "@/lib/personal-sparql";

const RDFS_IS_DEFINED_BY = "http://www.w3.org/2000/01/rdf-schema#isDefinedBy";
const OWL_IMPORTS = "http://www.w3.org/2002/07/owl#imports";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PROV_ACTIVITY = "http://www.w3.org/ns/prov#Activity";
const PROV_USED = "http://www.w3.org/ns/prov#used";
const PROV_ENDED_AT = "http://www.w3.org/ns/prov#endedAtTime";
const PROV_WAS_DERIVED_FROM = "http://www.w3.org/ns/prov#wasDerivedFrom";
const XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime";
const MAX_DOCUMENTS = 12;
const MAX_DEPTH = 2;
const MAX_BYTES = 750_000;
const MAX_TRIPLES = 3500;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const recentAttempts = new Map<string, number>();

type Term = { termType: string; value: string; language?: string; datatype?: { value: string } };
type Triple = { subject: Term; predicate: Term; object: Term };
/** User-owned ontology graph; never overwrite Maestro's built-in policy/schema graphs. */
export const getPersonalOntologyGraph = (request: Request): string => `${getUserGraph(request)}/ontology`;
export type OntologyIngestionSummary = { fetched: number; imported: number; failures: string[] };
const iri = (value: string): Term => ({ termType: "NamedNode", value });
const literal = (value: string): Term => ({ termType: "Literal", value, datatype: { value: XSD_DATETIME } });
/** Deterministic skolemization prevents repeated imports from duplicating blank-node subgraphs. */
function skolemize(triples: Triple[], document: string): Triple[] {
  const term = (value: Term): Term => value.termType === "BlankNode"
    ? iri(`urn:maestro:lod:blank:${createHash("sha256").update(document).update("\0").update(value.value).digest("hex")}`)
    : value;
  return triples.map(triple => ({ subject: term(triple.subject), predicate: triple.predicate, object: term(triple.object) }));
}

/** Refuse loopback, link-local, private and metadata addresses, including DNS-resolved ones. */
export async function publicOntologyUrl(value: string): Promise<URL | null> {
  let uri: URL;
  try { uri = new URL(value); } catch { return null; }
  if (!(["http:", "https:"].includes(uri.protocol)) || uri.username || uri.password) return null;
  const host = uri.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) return null;
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    if (!results.length || results.some(({ address }) => {
      const a = address.toLowerCase();
      if (a.includes(":")) return a === "::1" || a === "::" || a.startsWith("fe80:") || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("::ffff:");
      const octets = a.split(".").map(Number);
      const [first, second] = octets;
      return first === 0 || first === 10 || first === 127 || first >= 224 ||
        (first === 169 && second === 254) || (first === 192 && second === 168) ||
        (first === 172 && second >= 16 && second <= 31) || (first === 100 && second >= 64 && second <= 127) ||
        (first === 192 && second === 0) || (first === 198 && (second === 18 || second === 19));
    })) return null;
  } catch { return null; }
  return uri;
}

function extension(contentType: string): string | null {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (["text/turtle", "application/x-turtle", "application/turtle", "application/n3"].includes(mime)) return ".ttl";
  if (["application/rdf+xml", "application/owl+xml"].includes(mime)) return ".rdf";
  if (mime === "application/n-triples") return ".nt";
  if (mime === "application/n-quads") return ".nq";
  if (mime === "application/ld+json") return ".jsonld";
  return null; // Never parse HTML or general-purpose JSON as RDF.
}

/** Manual redirects: check each hop, not just the initial class URI. */
async function fetchRdf(start: string): Promise<{ text: string; ext: string; document: string } | null> {
  let target = start;
  for (let redirect = 0; redirect < 5; redirect++) {
    const url = await publicOntologyUrl(target);
    if (!url) return null;
    const response = await fetch(url, {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(7000),
      headers: { Accept: "text/turtle, application/rdf+xml;q=0.95, application/n-triples;q=0.8" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      target = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) return null;
    const ext = extension(response.headers.get("content-type") ?? "");
    if (!ext) return null;
    if (Number(response.headers.get("content-length")) > MAX_BYTES) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
    return { text: new TextDecoder().decode(bytes), ext, document: url.toString() };
  }
  return null;
}

/** Process distinct class documents, their rdfs:isDefinedBy documents, and bounded owl:imports.
 * The provenance triples are stored in the same personal ontology named graph so no
 * private graph name or credential is sent to any external ontology publisher.
 */
export async function ingestOntologyDocuments(classes: string[], request: Request): Promise<OntologyIngestionSummary> {
  const graph = getPersonalOntologyGraph(request);
  // Vocabulary URIs commonly share one RDF document (hash namespace or slash
  // namespace). Never schedule one HTTP request per visible class.
  const namespaceOf = (uri: string): string => {
    const hash = uri.lastIndexOf("#");
    return hash >= 0 ? uri.slice(0, hash) : uri.slice(0, uri.lastIndexOf("/") + 1);
  };
  const byNamespace = new Map<string, string>();
  for (const uri of classes) {
    const namespace = namespaceOf(uri);
    if (namespace && !byNamespace.has(namespace)) byNamespace.set(namespace, uri);
  }
  const queue = [...byNamespace].slice(0, MAX_DOCUMENTS).map(([uri, representative]) => ({ uri, representative, depth: 0 }));
  const seen = new Set<string>();
  const summary: OntologyIngestionSummary = { fetched: 0, imported: 0, failures: [] };
  while (queue.length && seen.size < MAX_DOCUMENTS) {
    const current = queue.shift()!;
    if (seen.has(current.uri)) continue;
    seen.add(current.uri);
    const attemptKey = `${graph}|${current.uri}`;
    const prior = recentAttempts.get(attemptKey);
    if (prior && Date.now() - prior < RETRY_AFTER_MS) continue;
    recentAttempts.set(attemptKey, Date.now());
    if (recentAttempts.size > 1024) recentAttempts.delete(recentAttempts.keys().next().value!);
    try {
      // A slash namespace may serve HTML while individual class URIs serve RDF.
      // Try a single representative once rather than retrying every class.
      const fetched = await fetchRdf(current.uri) ??
        (current.representative && current.representative !== current.uri
          ? await fetchRdf(current.representative) : null);
      if (!fetched) continue;
      summary.fetched++;
      let triples: Triple[];
      if (fetched.ext === ".jsonld") {
        // A real JSON-LD expansion, never regexp-based RDF extraction. Disallow
        // outbound remote @context loads (prevent SSRF via JSON-LD document loaders).
        const jsonld = (await import("jsonld")).default;
        const nquads = await jsonld.toRDF(JSON.parse(fetched.text), {
          base: fetched.document,
          format: "application/n-quads",
          documentLoader: async () => { throw new Error("Remote JSON-LD contexts are disabled during LOD ingestion."); },
        });
        triples = await parseRdfDocument(String(nquads), ".nq", fetched.document) as Triple[];
      } else {
        triples = await parseRdfDocument(fetched.text, fetched.ext, fetched.document) as Triple[];
      }
      if (!triples.length || triples.length > MAX_TRIPLES) continue;
      triples = skolemize(triples, fetched.document);
      const relevant = triples.filter(t => t.subject.termType === "NamedNode" && t.predicate.termType === "NamedNode" && t.object.termType === "NamedNode");
      if (current.depth < MAX_DEPTH) {
        for (const triple of relevant) {
          if (triple.predicate.value === RDFS_IS_DEFINED_BY || triple.predicate.value === OWL_IMPORTS) {
            if (!seen.has(triple.object.value) && !queue.some(q => q.uri === triple.object.value)) {
              queue.push({ uri: triple.object.value, representative: triple.object.value, depth: current.depth + 1 });
            }
          }
        }
      }
      const now = new Date().toISOString();
      const activity = iri(`urn:maestro:lod:retrieval:${createHash("sha256").update(fetched.document).update("\0").update(now).digest("hex")}`);
      const provenance: Triple[] = [
        { subject: activity, predicate: iri(RDF_TYPE), object: iri(PROV_ACTIVITY) },
        { subject: activity, predicate: iri(PROV_USED), object: iri(fetched.document) },
        { subject: activity, predicate: iri(PROV_ENDED_AT), object: literal(now) },
        { subject: iri(graph), predicate: iri(PROV_WAS_DERIVED_FROM), object: iri(fetched.document) },
      ];
      await updatePersonalSparql(buildInsertData(graph, [...triples, ...provenance]), 60000, request);
      summary.imported++;
    } catch (error) {
      if (summary.failures.length < 12) summary.failures.push(`${current.uri}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
