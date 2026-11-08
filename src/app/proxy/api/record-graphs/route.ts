import { NextResponse } from "next/server";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { logProxyCaller } from "@/lib/proxy-debug-server";
import { getConfiguredFctEndpoints, resolveConfiguredFctEndpoint, selectConfiguredFctEndpoint } from "@/lib/personal-sparql";
import { parseRdfDocument } from "@/lib/rdf-to-sparql";
import { proxyLog, proxyFailure } from "@/lib/maestro-logger";

const DCT = "http://purl.org/dc/terms/creator";
const PROV = "http://www.w3.org/ns/prov#wasAttributedTo";
const SCHEMA = "https://schema.org/creator";
const SCHEMA_HTTP = "http://schema.org/creator";

type GraphAuthor = { graph: string; author: string; predicate: string };
function validIri(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    /^(?:https?:|urn:|gttps?:)/i.test(value) && !/[<>"{}|^`\\\u0000-\u0020]/u.test(value);
}
function family(iri: string): string { return iri.split("#", 1)[0]; }
function graphPattern(resource: string): string {
  // A graph containing only an incoming reference is not a graph containing
  // this record's description.
  return `<${resource}> ?p ?o .`;
}
class GraphEndpointError extends Error {
  constructor(public status: number, public responseBody: string, public operation: string) {
    super(`Graph server returned HTTP ${status} during ${operation}: ${responseBody.slice(0, 4000)}`);
    this.name = "GraphEndpointError";
  }
}
async function execute(endpoint: string, query: string, accept: string, operation: string, timeoutMs = 30000): Promise<string> {
  const url = new URL("/sparql", endpoint);
  const started = Date.now();
  const result = await fetch(url, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: accept },
    body: new URLSearchParams({ query }).toString(),
  });
  const responseBody = await result.text();
  proxyLog("debug", "record-graphs.upstream", { operation, status: result.status, elapsedMs: Date.now() - started });
  if (!result.ok) throw new GraphEndpointError(result.status, responseBody, operation);
  return responseBody;
}
function readUris(payload: string, key: string): string[] {
  const parsed = JSON.parse(payload) as { results?: { bindings?: Record<string, { type?: string; value?: string }>[] } };
  return [...new Set((parsed.results?.bindings ?? []).map((row) => row[key])
    .filter((term): term is { type: string; value: string } => term?.type === "uri" && validIri(term.value))
    .map((term) => term.value))];
}
const GRAPH_CACHE_MS = 5 * 60 * 1000;
const graphDiscoveryCache = new Map<string, { expires: number; graphs: string[] }>();
async function discover(endpoint: string, iri: string): Promise<string[]> {
  const cacheKey = `${endpoint}\0${iri}`;
  const cached = graphDiscoveryCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return [...cached.graphs];
  // One bounded discovery query. An ASK preflight over GRAPH ?src does
  // essentially the same expensive scan and doubles the worst-case latency.
  // Graph metadata is optional and must not delay the main Record SELECT.
  const query = `SELECT DISTINCT ?src WHERE { GRAPH ?src { ${graphPattern(iri)} } } ORDER BY ?src`;
  const graphs = readUris(await execute(endpoint, query, "application/sparql-results+json", "discover", 10000), "src");
  // Store only successful discovery. An aborted request or upstream error is
  // never cached. This cache is best-effort on ephemeral Vercel instances.
  if (graphDiscoveryCache.size > 250) graphDiscoveryCache.clear();
  graphDiscoveryCache.set(cacheKey, { expires: Date.now() + GRAPH_CACHE_MS, graphs });
  return [...graphs];
}
/** Bind the blank node in the same SPARQL request that discovers its graphs.
 * Never use a result-set-local blank-node label in a separate query. */
async function discoverBoundBlankNodes(endpoint: string, xml: string, parent: string, predicate: string): Promise<string[]> {
  if (xml.length > 100_000 || !validIri(parent) || !validIri(predicate) ||
      !xml.includes(parent) || !xml.includes(predicate)) {
    throw new Error("Invalid FCT-derived blank-node graph binding.");
  }
  const compiled = compileFctXmlToSparql(xml);
  if (compiled.view !== "list-values" || compiled.limit > 10000 || compiled.offset !== 0) {
    throw new Error("Blank-node graph discovery requires a bounded list-values FCT query.");
  }
  const compiledText = compiled.query.trim();
  const preambleMatch = compiledText.match(/^((?:(?:DEFINE|PREFIX|BASE)\s+[^\n]*\n)*)/i);
  const preamble = preambleMatch?.[1] ?? "";
  const innerSelect = compiledText.slice(preamble.length).trim();
  if (!/^SELECT\b/i.test(innerSelect)) throw new Error("Invalid blank-node SELECT binding.");
  // A node's provenance includes graphs containing outgoing properties OR
  // incoming roles. Both branches share the FCT-bound ?node in this query.
  const query = `${preamble}SELECT DISTINCT ?src WHERE {
    { ${innerSelect} }
    BIND(?c1 AS ?node)
    FILTER(isBlank(?node))
    GRAPH ?src { { ?node ?p ?o } UNION { ?s ?p ?node } }
  } ORDER BY ?src LIMIT 500`;
  return readUris(await execute(endpoint, query, "application/sparql-results+json", "discover-blank-node", 15000), "src");
}

async function authors(endpoint: string, graphs: string[]): Promise<GraphAuthor[]> {
  if (!graphs.length) return [];
  // Graph-name metadata may live in the default graph or a named metadata graph.
  // A graph IRI is the subject of its own provenance triples, not a URL query parameter.
  const records: GraphAuthor[] = [];
  for (let i = 0; i < graphs.length; i += 80) {
    const values = graphs.slice(i, i + 80).map((graph) => `<${graph}>`).join(" ");
    const query = `SELECT DISTINCT ?graph ?author ?pred WHERE { VALUES ?graph { ${values} } VALUES ?pred { <${DCT}> <${PROV}> <${SCHEMA}> <${SCHEMA_HTTP}> } { ?graph ?pred ?author } UNION { GRAPH ?metadata { ?graph ?pred ?author } } }`;
    const parsed = JSON.parse(await execute(endpoint, query, "application/sparql-results+json", "authors")) as {
      results?: { bindings?: { graph?: { value?: string }; author?: { value?: string }; pred?: { value?: string } }[] }
    };
    for (const row of parsed.results?.bindings ?? []) {
      if (row.graph?.value && row.author?.value && row.pred?.value && graphs.includes(row.graph.value))
        records.push({ graph: row.graph.value, author: row.author.value, predicate: row.pred.value });
    }
  }
  return [...new Map(records.map((row) => [`${row.graph}\0${row.predicate}\0${row.author}`, row])).values()];
}

export async function POST(request: Request) {
  logProxyCaller(request, "record-graphs.POST");
  const started = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const blankQuery = typeof body?.queryXml === "string" ? body.queryXml : "";
    const blankIdentity = Boolean(blankQuery);
    if (blankIdentity ? (!validIri(body?.parent) || !validIri(body?.predicate)) : !validIri(body?.iri))
      return NextResponse.json({ error: "A valid resource IRI or FCT-derived blank-node binding is required." }, { status: 400 });
    const endpoints = await getConfiguredFctEndpoints(request);
    // The live query's graph-server address is authoritative, not the
    // fct_endpoint cookie (which may be stale after restoring a share URL).
    const addr = typeof body.addr === "string" ? body.addr : "";
    const server = addr.includes("@") ? addr.slice(addr.indexOf("@") + 1).trim() : "";
    const configured = server
      ? resolveConfiguredFctEndpoint(endpoints, server) ?? endpoints.find((item) => item.id === server || item.label === server)
      : selectConfiguredFctEndpoint(request, endpoints);
    const endpoint = configured && server.startsWith("http") ? { ...configured, url: server } : configured;
    if (!endpoint) return NextResponse.json({ error: server ? `Graph server from query addr is not configured: ${server}` : "No configured graph server." }, { status: 503 });
    const iri: string = blankIdentity ? "" : body.iri;
    // Graph membership is always verified on the selected graph server. For
    // blank nodes, the complete FCT path binds the node in each request.
    const discoverRecordGraphs = () => blankIdentity
      ? discoverBoundBlankNodes(endpoint.url, blankQuery, body.parent, body.predicate)
      : discover(endpoint.url, iri);
    if (body.operation === "graphs") {
      // Do not block the Graph dropdown on a metadata query.
      const graphs = await discoverRecordGraphs();
      return NextResponse.json({ graphs }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.operation === "authors") {
      const requested = Array.isArray(body.graphs) ? body.graphs : [];
      if (requested.length > 50 || requested.some((graph: unknown) => !validIri(graph)))
        return NextResponse.json({ error: "Invalid author graph selection." }, { status: 400 });
      // Verify author graph names against physical graph membership; never
      // execute arbitrary named graph metadata lookups supplied by the client.
      const available = await discoverRecordGraphs();
      const allowed = requested.filter((graph: string) => available.includes(graph));
      const graphAuthors = await authors(endpoint.url, allowed);
      return NextResponse.json({ authors: graphAuthors }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.operation === "describe") {
      if (blankIdentity) return NextResponse.json({ error: "Use the FCT-derived blank-node Record SELECT for graph-filtered descriptions." }, { status: 400 });
      const graph: unknown = body.graph;
      const authorGraph: unknown = body.authorGraph;
      if (typeof graph !== "string" || (graph && !validIri(graph)) ||
          typeof authorGraph !== "string" || (authorGraph && !validIri(authorGraph)))
        return NextResponse.json({ error: "Invalid graph or author graph selection." }, { status: 400 });
      const available = await discoverRecordGraphs();
      // A graph family ignores the fragment of its named graph IRI.
      // The author selection is the exact physical named graph IRI (#ID included).
      // Neither condition introduces a regex or unsupported FROM NAMED syntax.
      const selected = available.filter((candidate) => (!graph || family(candidate) === graph) &&
        (!authorGraph || candidate === authorGraph));
      if (!selected.length) return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });
      if (selected.length > 50)
        return NextResponse.json({ error: "More than 50 matching named graphs; select an author to narrow the set." }, { status: 400 });
      const datasets = selected.map((candidate) => `FROM NAMED <${candidate}>`).join("\n");
      const graphValues = selected.map((candidate) => `<${candidate}>`).join(" ");
      // Include incoming roles as well as outgoing properties in a filtered
      // record description; graph discovery itself uses outgoing triples only.
      const query = `DESCRIBE <${iri}>\n${datasets}\nWHERE { GRAPH ?src { VALUES ?src { ${graphValues} } { <${iri}> ?p ?o } UNION { ?s ?p <${iri}> } } }`;
      const rdfXml = await execute(endpoint.url, query, "application/rdf+xml", "describe");
      const quads = await parseRdfDocument(rdfXml, ".rdf", iri);
      return NextResponse.json({ rows: quads.map((quad) => ({
        subject: quad.subject.value,
        predicate: quad.predicate.value,
        object: quad.object.termType === "BlankNode" ? `_:${quad.object.value}` : quad.object.value,
        objectType: quad.object.termType,
      })) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Unknown record graph operation." }, { status: 400 });
  } catch (error) {
    return proxyFailure(request, "record-graphs", error, { elapsedMs: Date.now() - started });
  }
}
