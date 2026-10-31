import { ensureGraphDirectorySeeded, getOntologyGraph, personalSparqlUrl, personalSparqlHeaders } from "@/lib/personal-sparql";
import { NextResponse } from "next/server";

export const maxDuration = 300;

/** Minimal Linked Data dereferencer for category classes. It prefers machine-readable RDF and
 * extracts ontology membership and direct superclass links; failures are intentionally non-fatal. */
type ClassMetadata = { uri: string; ontology: string; parent?: string; ontologyLabel?: string };
const metadataCache = new Map<string, ClassMetadata>();
const RDFS_IS_DEFINED_BY = "http://www.w3.org/2000/01/rdf-schema#isDefinedBy";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const OWL_ONTOLOGY = "http://www.w3.org/2002/07/owl#Ontology";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

function safePublicHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" ||
        /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
        /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]") return null;
    return url;
  } catch { return null; }
}

function namespaceFallback(uri: string): string {
  const hash = uri.lastIndexOf("#");
  const slash = uri.lastIndexOf("/");
  const split = Math.max(hash, slash);
  return split > uri.indexOf("://") + 2 ? uri.slice(0, split + (uri[split] === "#" ? 1 : 1)) : uri;
}

function compactMetadata(uri: string, text: string, contentType: string): ClassMetadata {
  let ontology = "";
  let parent: string | undefined;
  let ontologyLabel: string | undefined;
  const decode = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record["@id"] === "string") return record["@id"] as string;
      if (typeof record["@value"] === "string") return record["@value"] as string;
    }
    return undefined;
  };
  if (contentType.includes("json") || /^[\s\uFEFF]*[\[{]/.test(text)) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const graph = Array.isArray(json["@graph"]) ? json["@graph"] as Record<string, unknown>[] : [json];
      const subject = graph.find((node) => node["@id"] === uri) ?? graph.find((node) => typeof node["@id"] === "string" && (node["@id"] as string).replace(/#$/, "") === uri.replace(/#$/, ""));
      if (subject) {
        const definedBy = subject[RDFS_IS_DEFINED_BY] ?? subject["http://www.w3.org/2000/01/rdf-schema#isDefinedBy"] ?? subject["rdfs:isDefinedBy"];
        ontology = decode(Array.isArray(definedBy) ? definedBy[0] : definedBy) ?? "";
        const subclass = subject[RDFS_SUBCLASS] ?? subject["http://www.w3.org/2000/01/rdf-schema#subClassOf"] ?? subject["rdfs:subClassOf"];
        parent = decode(Array.isArray(subclass) ? subclass[0] : subclass);
      }
      const ontologyNode = graph.find((node) => {
        const types = node["@type"];
        return (Array.isArray(types) ? types : [types]).some((type) => type === OWL_ONTOLOGY || type === "owl:Ontology");
      });
      if (!ontology && ontologyNode && typeof ontologyNode["@id"] === "string") ontology = ontologyNode["@id"] as string;
      if (ontologyNode) {
        const label = ontologyNode[RDFS_LABEL] ?? ontologyNode["http://www.w3.org/2000/01/rdf-schema#label"] ?? ontologyNode["rdfs:label"];
        ontologyLabel = decode(Array.isArray(label) ? label[0] : label);
      }
    } catch { /* try RDF/XML and Turtle below */ }
  }
  if (!ontology || !parent) {
    const escaped = uri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const subjectBlock = new RegExp(`(?:<[^>]*about=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/[^>]+>|<${escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>[\\s\\S]*?\\.)`, "i").exec(text)?.[0] ?? text;
    if (!ontology) {
      const defined = new RegExp(`(?:rdfs:isDefinedBy|isDefinedBy)[^>]*?(?:resource=["']([^"']+)["']|<([^>]+)>)`, "i").exec(subjectBlock) ??
        new RegExp(`<[^>]*isDefinedBy[^>]*resource=["']([^"']+)["']`, "i").exec(subjectBlock);
      ontology = defined?.[1] ?? defined?.[2] ?? "";
    }
    if (!parent) {
      const subclass = new RegExp(`(?:rdfs:subClassOf|subClassOf)[^>]*?(?:resource=["']([^"']+)["']|<([^>]+)>)`, "i").exec(subjectBlock) ??
        new RegExp(`<[^>]*subClassOf[^>]*resource=["']([^"']+)["']`, "i").exec(subjectBlock);
      parent = subclass?.[1] ?? subclass?.[2];
    }
  }
  return { uri, ontology: ontology || namespaceFallback(uri), ...(parent ? { parent } : {}), ...(ontologyLabel ? { ontologyLabel } : {}) };
}

async function dereferenceClass(uri: string): Promise<ClassMetadata> {
  const cached = metadataCache.get(uri);
  if (cached) return cached;
  const fallback: ClassMetadata = { uri, ontology: namespaceFallback(uri) };
  const start = safePublicHttpUrl(uri);
  if (!start) return fallback;
  try {
    let current = start;
    let response: Response | null = null;
    for (let hop = 0; hop < 4; hop += 1) {
      response = await fetch(current, {
        headers: { Accept: "application/ld+json, application/rdf+xml;q=0.9, text/turtle;q=0.8, application/json;q=0.7" },
        redirect: "manual",
        cache: "force-cache",
        signal: AbortSignal.timeout(6500),
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      const next = safePublicHttpUrl(new URL(location, current).toString());
      if (!next) return fallback;
      current = next;
    }
    if (!response?.ok) return fallback;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!/(json|xml|turtle|n3|rdf)/.test(contentType)) return fallback;
    const body = (await response.text()).slice(0, 750_000);
    const metadata = compactMetadata(uri, body, contentType);
    metadataCache.set(uri, metadata);
    return metadata;
  } catch { return fallback; }
}

const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL_NS = "http://www.w3.org/2002/07/owl#";
function sparqlTerm(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const term = value as { type?: unknown; value?: unknown };
  return typeof term.value === "string" ? term.value : undefined;
}
async function queryPersonalStore(uris: string[], request?: Request): Promise<ClassMetadata[]> {
  const endpoint = personalSparqlUrl(request);
  const values = uris.map((uri) => `<${uri.replace(/[<>\\"{}|^`\s]/g, "")}>`).join(" ");
  const graph = getOntologyGraph(request).replace(/[<>\\"{}|^`\s]/g, "");
  const graphIri = `<${graph}>`;
  const either = (triple: string) => `{ ${triple} } UNION { GRAPH ${graphIri} { ${triple} } }`;
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

async function queryNearestListedParents(uris: string[], request?: Request): Promise<Map<string, string>> {
  const parents = new Map<string, string>();
  if (uris.length < 2) return parents;
  const endpoint = personalSparqlUrl(request);
  const values = uris.map((uri) => `<${uri.replace(/[<>\\"{}|^`\s]/g, "")}>`).join(" ");
  const graph = getOntologyGraph(request).replace(/[<>\\"{}|^`\s]/g, "");
  const graphIri = `<${graph}>`;
  const path = (start: string, end: string) => `{{ ${start} rdfs:subClassOf+ ${end} } UNION { GRAPH ${graphIri} { ${start} rdfs:subClassOf+ ${end} } }}`;
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
  return NextResponse.json({ endpoint: personalSparqlUrl(request).toString(), graph: getOntologyGraph(request) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { uris?: unknown } | null;
  const uris = Array.isArray(body?.uris) ? [...new Set(body.uris.filter((uri): uri is string => typeof uri === "string" && uri.length <= 4096 && /^https?:\/\//i.test(uri)).slice(0, 100))] : [];
  try {
    // Load the manifest-mapped RDF files before querying the configured ontology graph.
    await ensureGraphDirectorySeeded(request);
    let output = await queryPersonalStore(uris, request);
    // Collapse superclass paths through classes that are not in the visible list, so a listed
    // class nests beneath its nearest listed ancestor instead of becoming an unrelated root.
    const listedParents = await queryNearestListedParents(uris, request);
    output = output.map((item) => ({ ...item, parent: listedParents.get(item.uri) ?? item.parent }));
    // A dereferenced class response is a useful fallback for endpoints that do not expose a
    // subclass triple in the store yet; the loaded personal-store result takes precedence.
    const incomplete = output.filter((item) => !item.parent || item.ontology === namespaceFallback(item.uri));
    for (let offset = 0; offset < incomplete.length; offset += 6) {
      const fallbacks = await Promise.all(incomplete.slice(offset, offset + 6).map((item) => dereferenceClass(item.uri)));
      output = output.map((item) => {
        const fallback = fallbacks.find((candidate) => candidate.uri === item.uri);
        return fallback ? { ...fallback, ...item, parent: item.parent ?? fallback.parent, ontologyLabel: item.ontologyLabel ?? fallback.ontologyLabel, ontology: item.ontology !== namespaceFallback(item.uri) ? item.ontology : fallback.ontology } : item;
      });
    }
    return NextResponse.json({ items: output, graph: getOntologyGraph(request) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ontology discovery failed." }, { status: 502 });
  }
}
