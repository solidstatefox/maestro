import { logProxyCaller } from "@/lib/proxy-debug-server";
import { personalSparqlUrl, personalSparqlHeaders } from "@/lib/personal-sparql";
import { NextResponse } from "next/server";
import { describeUpstreamError } from "@/lib/upstream-error";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getPersonalOntologyGraph, ingestOntologyDocuments } from "@/lib/ontology-ingest";

export const maxDuration = 300;

/** Categories is backed exclusively by the user's ingested ontology graph. */
type ClassMetadata = { uri: string; ontology: string; parent?: string; ontologyLabel?: string };
function namespaceFallback(uri: string): string {
  const hash = uri.lastIndexOf("#");
  if (hash >= 0) return uri.slice(0, hash + 1);
  const slash = uri.lastIndexOf("/");
  return slash >= 0 ? uri.slice(0, slash + 1) : uri;
}

const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL_NS = "http://www.w3.org/2002/07/owl#";
function sparqlTerm(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const term = value as { type?: unknown; value?: unknown };
  return typeof term.value === "string" ? term.value : undefined;
}
async function queryPersonalStore(uris: string[], request: Request): Promise<ClassMetadata[]> {
  const endpoint = personalSparqlUrl(request);
  const values = uris.map((uri) => `<${uri.replace(/[<>\\"{}|^`\s]/g, "")}>`).join(" ");
  const graphIri = `<${getPersonalOntologyGraph(request)}>`;
  const either = (triple: string) => `GRAPH ${graphIri} { ${triple} }`;
  const query = `PREFIX rdfs: <${RDFS_NS}>\nPREFIX owl: <${OWL_NS}>\nSELECT DISTINCT ?class ?parent ?ontology ?ontologyLabel WHERE { VALUES ?class { ${values} } OPTIONAL { ${either("?class rdfs:subClassOf ?parent . FILTER(isIRI(?parent))")} } OPTIONAL { ${either("?class rdfs:isDefinedBy ?ontology . FILTER(isIRI(?ontology))")} } OPTIONAL { ${either("?ontology a owl:Ontology . OPTIONAL { ?ontology rdfs:label ?ontologyLabel }")} } }`;
  const headers = personalSparqlHeaders(request, "application/sparql-query; charset=utf-8", "application/sparql-results+json");
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: query,
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Personal SPARQL endpoint returned HTTP ${response.status}.`);
  const payload = await response.json() as { results?: { bindings?: Record<string, unknown>[] } };
  const byUri = new Map<string, ClassMetadata>();
  for (const binding of payload.results?.bindings ?? []) {
    const uri = sparqlTerm(binding.class);
    if (!uri || !uris.includes(uri)) continue;
    const item = byUri.get(uri) ?? { uri, ontology: namespaceFallback(uri) };
    item.parent = sparqlTerm(binding.parent) ?? item.parent;
    item.ontology = sparqlTerm(binding.ontology) ?? item.ontology;
    item.ontologyLabel = sparqlTerm(binding.ontologyLabel) ?? item.ontologyLabel;
    byUri.set(uri, item);
  }
  return uris.map((uri) => byUri.get(uri) ?? { uri, ontology: namespaceFallback(uri) });
}

async function queryNearestListedParents(uris: string[], request: Request): Promise<Map<string, string>> {
  const parents = new Map<string, string>();
  if (uris.length < 2) return parents;
  const endpoint = personalSparqlUrl(request);
  const values = uris.map((uri) => `<${uri.replace(/[<>\\"{}|^`\s]/g, "")}>`).join(" ");
  const graphIri = `<${getPersonalOntologyGraph(request)}>`;
  const path = (start: string, end: string) => `GRAPH ${graphIri} { ${start} rdfs:subClassOf+ ${end} }`;
  const query = `PREFIX rdfs: <${RDFS_NS}>\nSELECT DISTINCT ?class ?candidateParent WHERE { VALUES ?class { ${values} } VALUES ?candidateParent { ${values} } FILTER(?class != ?candidateParent) ${path("?class", "?candidateParent")} FILTER NOT EXISTS { VALUES ?middle { ${values} } FILTER(?middle != ?class && ?middle != ?candidateParent) ${path("?class", "?middle")} ${path("?middle", "?candidateParent")} } }`;
  const headers = personalSparqlHeaders(request, "application/sparql-query; charset=utf-8", "application/sparql-results+json");
  const response = await fetch(endpoint, { method: "POST", headers, body: query, cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Personal SPARQL hierarchy query returned HTTP ${response.status}.`);
  const payload = await response.json() as { results?: { bindings?: Record<string, unknown>[] } };
  const candidates = new Map<string, string[]>();
  for (const binding of payload.results?.bindings ?? []) {
    const child = sparqlTerm(binding.class);
    const parent = sparqlTerm(binding.candidateParent);
    if (!child || !parent || child === parent) continue;
    const list = candidates.get(child) ?? [];
    list.push(parent);
    candidates.set(child, list);
  }
  // Multiple inheritance is legal RDF; this tree view chooses a deterministic listed parent.
  for (const [child, list] of candidates) parents.set(child, list.sort((a, b) => a.localeCompare(b))[0]);
  return parents;
}

export async function GET(request: Request) {
  logProxyCaller(request, "ontology.GET");
  const loginRequired = requirePersonalLogin(request);
  if (loginRequired) return loginRequired;
  return NextResponse.json({ endpoint: personalSparqlUrl(request).toString(), graph: getPersonalOntologyGraph(request) });
}

export async function POST(request: Request) {
  logProxyCaller(request, "ontology.POST");
  const loginRequired = requirePersonalLogin(request);
  if (loginRequired) return loginRequired;
  const body = await request.json().catch(() => null) as { uris?: unknown } | null;
  const uris = Array.isArray(body?.uris) ? [...new Set(body.uris.filter((uri): uri is string => typeof uri === "string" && uri.length <= 4096 && /^https?:\/\//i.test(uri)).slice(0, 100))] : [];
  try {
    // Fetch at most once per namespace (plus bounded authoritative imports),
    // persisting parsed RDF in the single personal ontology graph before reading it.
    const ingestion = await ingestOntologyDocuments(uris, request).catch((error) => ({
      fetched: 0, imported: 0, failures: [error instanceof Error ? error.message : String(error)],
    }));
    let output = await queryPersonalStore(uris, request);
    const listedParents = await queryNearestListedParents(uris, request);
    output = output.map((item) => ({ ...item, parent: listedParents.get(item.uri) ?? item.parent }));
    return NextResponse.json({ items: output, graph: getPersonalOntologyGraph(request), ingestion });
  } catch (error) {
    return NextResponse.json({ error: describeUpstreamError(error, "Ontology discovery failed.") }, { status: 502 });
  }
}
