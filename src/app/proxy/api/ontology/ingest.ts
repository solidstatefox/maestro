/** Bounded Linked Data discovery and RDF ingestion for the Categories hierarchy. */
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const GRAPH = (process.env.MAESTRO_ONTOLOGY_GRAPH || "urn:maestro:ontology-cache").trim();
const MAX_DOCS = 250;
const loadedRdfSources = new Set<string>();

function publicUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url;
  } catch { return null; }
}
function authHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": contentType, Accept: "text/plain, text/html, application/json, */*" };
  const user = process.env.RDF_LOADER_USERNAME;
  const pass = process.env.RDF_LOADER_PASSWORD;
  if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  return headers;
}
function refsFrom(text: string, contentType: string, subject: string): string[] {
  const refs = new Set<string>();
  if (contentType.includes("json") || /^[\s\uFEFF]*[\[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown> | Record<string, unknown>[];
      const graph = Array.isArray(parsed) ? parsed : Array.isArray(parsed["@graph"]) ? parsed["@graph"] as Record<string, unknown>[] : [parsed];
      for (const node of graph) {
        const id = typeof node["@id"] === "string" ? node["@id"] as string : "";
        if (id === subject || id.replace(/#$/, "") === subject.replace(/#$/, "")) {
          for (const key of [`${RDFS}subClassOf`, "rdfs:subClassOf", `${RDFS}isDefinedBy`, "rdfs:isDefinedBy"]) {
            const raw = node[key];
            for (const value of Array.isArray(raw) ? raw : [raw]) {
              const uri = typeof value === "string" ? value : value && typeof value === "object" ? (value as Record<string, unknown>)["@id"] : undefined;
              if (typeof uri === "string") refs.add(uri);
            }
          }
        }
        const types = Array.isArray(node["@type"]) ? node["@type"] as unknown[] : [node["@type"]];
        if (types.some((type) => type === `${OWL}Ontology` || type === "owl:Ontology")) {
          const imports = node[`${OWL}imports`] ?? node["owl:imports"];
          for (const value of Array.isArray(imports) ? imports : [imports]) {
            const uri = typeof value === "string" ? value : value && typeof value === "object" ? (value as Record<string, unknown>)["@id"] : undefined;
            if (typeof uri === "string") refs.add(uri);
          }
        }
      }
    } catch { /* use RDF/XML/Turtle patterns below */ }
  }
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const subjectRegion = new RegExp(`(?:rdf:about=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/[^>]+>|<${escaped}>[\\s\\S]*?\\.)`, "i").exec(text)?.[0] ?? text;
  for (const match of subjectRegion.matchAll(/(?:subClassOf|isDefinedBy)[^>]*?(?:rdf:resource|resource)=["']([^"']+)["']|(?:subClassOf|isDefinedBy)\s*<([^>]+)>/gi)) {
    const uri = match[1] ?? match[2]; if (uri) refs.add(uri);
  }
  for (const match of text.matchAll(/(?:owl:imports|imports)[^>]*?(?:rdf:resource|resource)=["']([^"']+)["']|(?:owl:imports|imports)\s*<([^>]+)>/gi)) {
    const uri = match[1] ?? match[2]; if (uri) refs.add(uri);
  }
  for (const predicate of [`${RDFS}subClassOf`, `${RDFS}isDefinedBy`]) {
    for (const match of text.matchAll(new RegExp(`<${escaped}>\\s+<${predicate}>\\s+<([^>]+)>`, "g"))) refs.add(match[1]);
  }
  return [...refs].filter((uri) => /^https?:\/\//i.test(uri));
}

/** Fetches public RDF documents, recursively follows class/ontology references, and LOADs each
 * negotiated RDF document into a dedicated named graph in the personal SPARQL endpoint. */
export async function discoverAndIngestOntology(uris: string[]): Promise<void> {
  const endpoint = new URL((process.env.PERSONAL_SPARQL_ENDPOINT || process.env.RDF_LOADER_ENDPOINT || "http://localhost:8890/sparql").trim());
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("Personal SPARQL endpoint must use HTTP or HTTPS.");
  if (!/^(?:https?:\/\/|urn:)[^\s<>"{}|\\^`]+$/i.test(GRAPH)) throw new Error("MAESTRO_ONTOLOGY_GRAPH must be an absolute HTTP(S) or URN IRI.");
  const seen = new Set<string>();
  let queue = uris.map((url) => ({ url, depth: 0 }));
  let loaded = 0;
  while (queue.length && seen.size < MAX_DOCS && loaded < MAX_DOCS) {
    const batch = queue.splice(0, 5).filter((entry) => {
      const safe = publicUrl(entry.url);
      if (!safe || seen.has(safe.href)) return false;
      seen.add(safe.href); return true;
    });
    if (!batch.length) continue;
    const results = await Promise.all(batch.map(async (entry) => {
      let current = publicUrl(entry.url);
      if (!current) return { refs: [] as string[], loaded: false, depth: entry.depth };
      let response: Response | undefined;
      for (let hop = 0; hop < 4; hop++) {
        try {
          response = await fetch(current, { headers: { Accept: "application/ld+json, application/rdf+xml;q=0.95, text/turtle;q=0.9, application/n-triples;q=0.8, application/json;q=0.7" }, redirect: "manual", cache: "force-cache", signal: AbortSignal.timeout(8000) });
        } catch { return { refs: [] as string[], loaded: false, depth: entry.depth }; }
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location) return { refs: [] as string[], loaded: false, depth: entry.depth };
        const next = publicUrl(new URL(location, current).href);
        if (!next) return { refs: [] as string[], loaded: false, depth: entry.depth };
        current = next;
      }
      if (!response?.ok) return { refs: [] as string[], loaded: false, depth: entry.depth };
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!/(json|xml|turtle|n-triples|n3|rdf)/.test(contentType)) return { refs: [] as string[], loaded: false, depth: entry.depth };
      const text = (await response.text()).slice(0, 1_000_000);
      const refs = entry.depth < 8 ? refsFrom(text, contentType, entry.url) : [];
      const source = current.href.replace(/[<>"{}|\\^`\s]/g, "");
      if (loadedRdfSources.has(source)) return { refs, loaded: false, depth: entry.depth };
      const update = `LOAD <${source}> INTO GRAPH <${GRAPH}>`;
      try {
        const loadedResponse = await fetch(endpoint, { method: "POST", headers: authHeaders("application/sparql-update; charset=utf-8"), body: update, cache: "no-store", signal: AbortSignal.timeout(45_000) });
        const resultText = (await loadedResponse.text()).slice(0, 2000);
        if (!loadedResponse.ok || (/(?:error|failed|not found|no such|Virtuoso\s+Exception|Error\s+SR)/i.test(resultText) && !/0 errors/i.test(resultText))) {
          console.info(`Maestro ontology RDF LOAD failed for ${source}: HTTP ${loadedResponse.status}; ${resultText}`);
          return { refs, loaded: false, depth: entry.depth };
        }
        loadedRdfSources.add(source);
        return { refs, loaded: true, depth: entry.depth };
      } catch (error) { console.info("Maestro ontology RDF LOAD failed.", error); return { refs, loaded: false, depth: entry.depth }; }
    }));
    for (const result of results) {
      if (result.loaded) loaded++;
      queue.push(...result.refs.map((url) => ({ url, depth: result.depth + 1 })));
      if (queue.length > MAX_DOCS) queue = queue.slice(0, MAX_DOCS);
    }
  }
  if (loaded) console.info(`Maestro ingested ${loaded} ontology RDF document(s) into ${GRAPH}.`);
}
