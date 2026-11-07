import { NextResponse } from "next/server";
import { getConfiguredFctEndpoints } from "@/lib/personal-sparql";

// Only configured SPARQL endpoints may be queried: never accept an arbitrary target URL.
const cache = new Map<string, { until: number; description: string }>();
const VOID = "http://rdfs.org/ns/void#sparqlEndpoint";
const SD = "http://www.w3.org/ns/sparql-service-description#endpoint";
const DCT = "http://purl.org/dc/terms/description";
const SCHEMA = "https://schema.org/description";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#comment";

function queryForEndpoint(endpoint: string): string {
  // Probe the endpoint's published RDF metadata, not arbitrary site content.
  const iri = `<${endpoint.replace(/[<>]/g, "")}>`;
  return `SELECT DISTINCT ?description WHERE {
    { ?dataset <${VOID}> ${iri} . ?dataset ?p ?description . }
    UNION { ?service <${SD}> ${iri} . ?service ?p ?description . }
    UNION { ${iri} ?p ?description . }
    FILTER (?p IN (<${DCT}>, <${SCHEMA}>, <${RDFS}>))
    FILTER (isLiteral(?description) && LANGMATCHES(LANG(?description), "en") || isLiteral(?description) && LANG(?description) = "")
  } LIMIT 5`;
}

export async function GET(request: Request) {
  const endpointId = new URL(request.url).searchParams.get("endpointId") ?? "";
  const endpoints = await getConfiguredFctEndpoints(request);
  const endpoint = endpoints.find((item) => item.id === endpointId);
  if (!endpoint) return NextResponse.json({ error: "Unknown graph server" }, { status: 404 });
  const prior = cache.get(endpoint.url);
  if (prior && prior.until > Date.now()) return NextResponse.json({ description: prior.description });
  let description = "";
  try {
    const url = new URL(endpoint.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error("Unsupported URL protocol");
    const response = await fetch(url, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(4500),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/sparql-results+json" },
      body: new URLSearchParams({ query: queryForEndpoint(endpoint.url) }),
    });
    if (response.ok) {
      const json = await response.json() as { results?: { bindings?: Array<{ description?: { value?: string } }> } };
      const candidates = (json.results?.bindings ?? []).map((r) => r.description?.value?.trim() ?? "").filter(Boolean);
      description = (candidates.find((value) => value.length >= 24) ?? candidates[0] ?? "").slice(0, 320);
    }
  } catch { /* Metadata is optional, including when the SPARQL service has no VoID description. */ }
  cache.set(endpoint.url, { until: Date.now() + 60 * 60 * 1000, description });
  return NextResponse.json({ description });
}
