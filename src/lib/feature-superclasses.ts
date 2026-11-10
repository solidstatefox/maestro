/** Discover superclass IRIs from the live graph server, then dereference class RDF.
 * Read-only, cached, bounded and independent of Virtuoso inference privileges.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { getConfiguredFctEndpoints, resolveConfiguredFctEndpoint } from "@/lib/personal-sparql";

const SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const DEFINED_BY = "http://www.w3.org/2000/01/rdf-schema#isDefinedBy";
const SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
const IMPORTS = "http://www.w3.org/2002/07/owl#imports";
const iriOk = (value: string) => /^https?:\/\/[^\s<>"{}|^`\\]+$/i.test(value) && value.length < 2048;
type Term = { type?: string; value?: string };
type Binding = { ancestor?: Term };
const cache = new Map<string, { expires: number; classes: string[] }>();
type Quad = { subject: {value:string}; predicate: {value:string}; object: {value:string; termType:string} };

function publicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const ip = isIP(host);
  if (ip === 4) {
    const a = host.split(".").map(Number);
    return a[0] !== 0 && a[0] !== 10 && a[0] !== 127 && a[0] < 224 && !(a[0] === 169 && a[1] === 254) &&
      !(a[0] === 172 && a[1] >= 16 && a[1] <= 31) && !(a[0] === 192 && a[1] === 168) &&
      !(a[0] === 100 && a[1] >= 64 && a[1] <= 127) && !(a[0] === 192 && a[1] === 0) &&
      !(a[0] === 198 && (a[1] === 18 || a[1] === 19));
  }
  if (ip === 6) return !(/^(::|::1|fc|fd|fe[89ab]|ff)/i.test(host) || host.startsWith("::ffff:"));
  return true;
}
async function safeDereferenceUrl(raw: string): Promise<URL | null> {
  if (!iriOk(raw)) return null;
  try {
    const url = new URL(raw);
    if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.port && !["80","443"].includes(url.port) || !publicHost(url.hostname)) return null;
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => !publicHost(entry.address))) return null;
    return url;
  } catch { return null; }
}
async function readLimited(response: Response, limit = 600_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) return "";
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(data);
}
async function dereferenceRdf(iri: string, timeoutMs: number): Promise<Quad[]> {
  let url = await safeDereferenceUrl(iri);
  for (let redirects = 0; url && redirects < 3; redirects++) {
    const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "text/turtle, application/n-triples;q=0.95, application/rdf+xml;q=0.9, application/ld+json;q=0.8" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      url = location ? await safeDereferenceUrl(new URL(location, url).toString()) : null;
      continue;
    }
    if (!response.ok) return [];
    const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const source = await readLimited(response);
    if (!source) return [];
    if (["text/turtle", "application/x-turtle", "application/n-triples", "text/n3"].includes(mime)) {
      const { Parser } = await import("n3");
      return new Parser({ baseIRI: url.toString(), format: mime === "application/n-triples" ? "N-Triples" : "Turtle" }).parse(source) as unknown as Quad[];
    }
    if (["application/rdf+xml", "application/xml", "text/xml"].includes(mime)) {
      const { RdfXmlParser } = await import("rdfxml-streaming-parser");
      const parser = new RdfXmlParser({ baseIRI: url.toString() });
      return await new Promise<Quad[]>((resolve, reject) => {
        const quads: Quad[] = [];
        parser.on("data", (quad: Quad) => quads.push(quad));
        parser.on("error", reject);
        parser.on("end", () => resolve(quads));
        parser.end(source);
      });
    }
    if (["application/ld+json", "application/json"].includes(mime)) {
      // JSON-LD's full context expansion needs an RDF parser. Handle absolute-predicate JSON-LD without resolving remote contexts.
      const payload = JSON.parse(source) as Record<string, unknown>;
      const nodes = Array.isArray(payload["@graph"]) ? payload["@graph"] as Record<string,unknown>[] : [payload];
      const quads: Quad[] = [];
      for (const node of nodes) for (const predicate of [SUBCLASS, DEFINED_BY, SEE_ALSO, IMPORTS]) {
        const values = node[predicate];
        for (const item of Array.isArray(values) ? values : values ? [values] : []) {
          const obj = item as { "@id"?: unknown };
          if (typeof node["@id"] === "string" && typeof obj?.["@id"] === "string") quads.push({ subject: {value: node["@id"]}, predicate: {value: predicate}, object: {value: obj["@id"], termType: "NamedNode"} });
        }
      }
      return quads;
    }
    return [];
  }
  return [];
}

/** Return the class itself and its known superclasses, ordered from more specific to less specific. */
export async function discoverFeatureSuperclasses(queryXml: string, seeds: string[], request: Request): Promise<string[]> {
  const closure = new Set(seeds);
  const addr = queryXml.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1]?.replace(/&amp;/g, "&") || "";
  const server = addr.includes("@") ? addr.slice(addr.indexOf("@") + 1) : "";
  const cacheKey = JSON.stringify([server, [...seeds].sort()]);
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.classes;
  const deadline = Date.now() + 8_500;
  const configured = await getConfiguredFctEndpoints(request);
  // Endpoint registry entries may use HTTP while the live query uses HTTPS
  // (or the reverse). Match the configured host and SPARQL path, never an
  // arbitrary address supplied by the client.
  const endpoint = resolveConfiguredFctEndpoint(configured, server) ?? configured.find((item) => {
    try {
      const requested = new URL(server);
      const listed = new URL(item.url);
      return requested.hostname.toLowerCase() === listed.hostname.toLowerCase() &&
        requested.pathname.replace(/\/+$/, "") === listed.pathname.replace(/\/+$/, "") &&
        requested.port === listed.port;
    } catch { return false; }
  });
  let complete = false;
  if (endpoint) {
    const values = seeds.map((iri) => `<${iri}>`).join(" ");
    // Start with the standards-based transitive closure. Some remote SPARQL
    // installations reject POST or have incomplete property-path execution:
    // GET is legal SPARQL protocol, and direct edges are the fallback.
    const queries = [
      `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT DISTINCT ?ancestor WHERE { VALUES ?class { ${values} } ?class rdfs:subClassOf* ?ancestor FILTER(isIRI(?ancestor)) } LIMIT 250`,
      `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT DISTINCT ?ancestor WHERE { VALUES ?class { ${values} } ?class rdfs:subClassOf ?ancestor FILTER(isIRI(?ancestor)) } LIMIT 250`,
    ];
    for (const query of queries) {
      if (Date.now() >= deadline - 900) break;
      for (const method of ["GET", "POST"] as const) {
        if (Date.now() >= deadline - 900) break;
        try {
          const url = new URL(endpoint.url);
          const params = new URLSearchParams({ query, format: "application/sparql-results+json" });
          if (method === "GET") url.search = params.toString();
          const response = await fetch(url, {
            method, cache: "no-store",
            headers: method === "POST" ? {
              "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json",
            } : { Accept: "application/sparql-results+json" },
            ...(method === "POST" ? { body: params } : {}),
            signal: AbortSignal.timeout(Math.min(2800, Math.max(300, deadline - Date.now() - 500))),
          });
          if (!response.ok) continue;
          const payload = await response.json() as { results?: { bindings?: Binding[] }; incomplete?: boolean };
          const bindings = payload.results?.bindings ?? [];
          for (const row of bindings) {
            if ((row.ancestor?.type === "uri" || row.ancestor?.type === "iri") && row.ancestor.value && iriOk(row.ancestor.value)) closure.add(row.ancestor.value);
          }
          complete = complete || (!payload.incomplete && bindings.length < 250 &&
            response.headers.get("x-maestro-incomplete") !== "true" &&
            response.headers.get("x-sql-state")?.toUpperCase() !== "S1TAT");
          if (closure.size > seeds.length) break;
        } catch { /* Try the other HTTP method or dereference the class IRI. */ }
      }
      if (closure.size > seeds.length && complete) break;
    }
  }
  // A complete answer with ancestors is sufficient for the first version; when absent or incomplete, follow Linked Data.
  if (closure.size > seeds.length && complete) {
    const found = [...closure];
    if (cache.size > 200) cache.clear();
    cache.set(cacheKey, { expires: Date.now() + 300_000, classes: found });
    return found;
  }
  const visited = new Set<string>();
  const queue = seeds.slice(0, 12);
  while (queue.length && visited.size < 16 && closure.size < 150 && Date.now() < deadline) {
    const current = queue.shift()!;
    if (visited.has(current) || !iriOk(current)) continue;
    visited.add(current);
    try {
      const quads = await dereferenceRdf(current, Math.max(250, Math.min(2400, deadline - Date.now())));
      for (const quad of quads) {
        if (quad.object.termType !== "NamedNode" || !iriOk(quad.object.value)) continue;
        if (quad.predicate.value === SUBCLASS && quad.subject.value === current) {
          closure.add(quad.object.value);
          if (!visited.has(quad.object.value)) queue.push(quad.object.value);
        } else if ([DEFINED_BY, SEE_ALSO, IMPORTS].includes(quad.predicate.value) && quad.subject.value === current && queue.length < 30) {
          // Ontology documents can define superclasses without sharing the class's HTTP URL.
          if (!visited.has(quad.object.value)) queue.push(quad.object.value);
        } else if (quad.predicate.value === SUBCLASS && closure.has(quad.subject.value)) {
          closure.add(quad.object.value);
          if (!visited.has(quad.object.value)) queue.push(quad.object.value);
        }
      }
    } catch { /* Missing Linked Data never erases direct-class policy matches. */ }
  }
  const found = [...closure];
  if (cache.size > 200) cache.clear();
  cache.set(cacheKey, { expires: Date.now() + (complete ? 300_000 : 45_000), classes: found });
  return found;
}
