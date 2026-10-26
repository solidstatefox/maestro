import { NextResponse } from "next/server";

/** Public vocabulary namespace documents used by Maestro's RDF record-label map. */
const VOCABULARIES = [
  { namespace: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", document: "https://www.w3.org/1999/02/22-rdf-syntax-ns", prefix: "rdf", label: "RDF Syntax" },
  { namespace: "http://www.w3.org/2000/01/rdf-schema#", document: "https://www.w3.org/2000/01/rdf-schema", prefix: "rdfs", label: "RDF Schema" },
  { namespace: "http://www.w3.org/2002/07/owl#", document: "https://www.w3.org/2002/07/owl", prefix: "owl", label: "Web Ontology Language" },
  { namespace: "http://www.w3.org/2001/XMLSchema#", document: "https://www.w3.org/2001/XMLSchema", prefix: "xsd", label: "XML Schema Datatypes" },
  { namespace: "http://purl.org/dc/terms/", document: "https://www.dublincore.org/specifications/dublin-core/dcmi-terms/dublin_core_terms.ttl", prefix: "dcterms", label: "DCMI Metadata Terms" },
  { namespace: "http://www.w3.org/2004/02/skos/core#", document: "https://www.w3.org/2009/08/skos-reference/skos.rdf", prefix: "skos", label: "SKOS Vocabulary" },
  { namespace: "http://rdfs.org/scot/ns#", document: "http://rdfs.org/scot/ns", prefix: "scot", label: "Social Semantic Cloud of Tags Ontology" },
  { namespace: "http://www.w3.org/2002/01/bookmark#", document: "https://www.w3.org/2002/01/bookmark", prefix: "bookmark", label: "Annotea Bookmark Schema" },
  { namespace: "http://www.w3.org/2000/10/annotation-ns#", document: "https://www.w3.org/2000/10/annotation-ns", prefix: "a", label: "Annotea Annotation Schema" },
  { namespace: "http://rdfs.org/sioc/ns#", document: "http://rdfs.org/sioc/ns", prefix: "sioc", label: "Semantically-Interlinked Online Communities Ontology" },
  { namespace: "https://schema.org/", document: "https://schema.org/docs/schemaorg-current-https.jsonld", prefix: "schema", label: "Schema.org Vocabulary" },
  { namespace: "http://xmlns.com/foaf/0.1/", document: "http://xmlns.com/foaf/spec/index.rdf", prefix: "foaf", label: "Friend of a Friend Vocabulary" },
  { namespace: "http://www.w3.org/2006/vcard/ns#", document: "https://www.w3.org/2006/vcard/ns", prefix: "vcard", label: "vCard Ontology" },
  { namespace: "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#", document: "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs", prefix: "vfct", label: "Virtuoso Faceted Browser API" },
];

type NamespaceMetadata = { namespace: string; prefix: string; label: string };
const metadataCache = new Map<string, NamespaceMetadata>();

function literalValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return literalValue(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["@value"] === "string") return record["@value"] as string;
    if (typeof record.value === "string") return record.value as string;
  }
  return undefined;
}

function findRdfsLabel(text: string, contentType: string, namespace: string): string | undefined {
  if (contentType.includes("json") || /^[\s\uFEFF]*[\[{]/u.test(text)) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const graph = Array.isArray(json["@graph"]) ? json["@graph"] as Record<string, unknown>[] : [json];
      const subject = graph.find((node) => node["@id"] === namespace || node["@id"] === namespace.replace(/#$/u, ""));
      if (subject) {
        const label = subject["http://www.w3.org/2000/01/rdf-schema#label"] ?? subject["rdfs:label"];
        const found = literalValue(label);
        if (found) return found;
      }
    } catch { /* Continue with RDF/XML/Turtle lexical extraction. */ }
  }
  const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const about = new RegExp(`<[^>]*(?:about|aboutNodeID)=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "iu").exec(text)?.[1];
  const rdfXmlLabel = about && /<(?:(?:[A-Za-z0-9_-]+):)?label\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z0-9_-]+):)?label>/iu.exec(about)?.[1];
  if (rdfXmlLabel) return rdfXmlLabel.replace(/<[^>]+>/gu, "").trim();
  const turtleLabel = new RegExp(`(?:<${escaped}>|<>)\\s+(?:rdfs:label|<http://www\\.w3\\.org/2000/01/rdf-schema#label>)\\s+(["'][^"']+["'])`, "iu").exec(text)?.[1];
  return turtleLabel?.slice(1, -1);
}

async function loadMetadata(item: typeof VOCABULARIES[number]): Promise<NamespaceMetadata> {
  const cached = metadataCache.get(item.namespace);
  if (cached) return cached;
  let label = item.label;
  try {
    const url = new URL(item.document);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported vocabulary URL protocol");
    const response = await fetch(url, {
      headers: { Accept: "application/ld+json, application/rdf+xml;q=0.9, text/turtle;q=0.8, application/json;q=0.7, */*;q=0.1" },
      redirect: "follow",
      cache: "force-cache",
      signal: AbortSignal.timeout(4500),
    });
    if (response.ok) {
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (/(json|xml|turtle|n3|rdf|text\/plain)/u.test(contentType)) {
        const text = (await response.text()).slice(0, 1_000_000);
        label = findRdfsLabel(text, contentType, item.namespace) ?? label;
      }
    }
  } catch { /* Keep the vocabulary's known label when its public RDF is unavailable. */ }
  const result = { namespace: item.namespace, prefix: item.prefix, label };
  metadataCache.set(item.namespace, result);
  return result;
}

/** Dereference public ontology documents following Linked Data content negotiation. */
export async function GET() {
  const namespaces = await Promise.all(VOCABULARIES.map(loadMetadata));
  return NextResponse.json({ namespaces }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
