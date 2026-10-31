import { logProxyCaller } from "@/lib/proxy-debug";
import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { compileFctXmlToSparql, type SparqlJsonResults, type SparqlBindingTerm } from "@/lib/fct-sparql-translator";
import { getQueryCache, queryCacheKey, setQueryCache } from "@/lib/query-cache";
import { getDataserversGraph, getConfiguredFctEndpoints, selectConfiguredFctEndpoint } from "@/lib/personal-sparql";


function parseResults(text: string): SparqlJsonResults | null {
  try {
    const parsed = JSON.parse(text) as SparqlJsonResults;
    if (!parsed || !parsed.head || !Array.isArray(parsed.head.vars) || !parsed.results || !Array.isArray(parsed.results.bindings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const VIRTRDF_LABEL = "http://www.openlinksw.com/schemas/virtrdf#label";

/** Parse browser language preferences in their declared order. */
function preferredLanguages(header: string | null): string[] {
  return (header ?? "").split(",").map((part, index) => {
    const [tag, ...parameters] = part.trim().split(";");
    const q = parameters.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { tag: (tag ?? "").toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
  }).filter((item) => item.tag && item.tag !== "*" && Number.isFinite(item.q) && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index).map((item) => item.tag);
}

function labelLanguage(term: SparqlBindingTerm): string {
  return (term["xml:lang"] ?? "").toLowerCase();
}

function uriFallbackLabel(uri: string): string {
  const hash = uri.lastIndexOf("#");
  const fragment = hash >= 0 ? uri.slice(hash + 1).split(/[?]/, 1)[0] : "";
  const withoutQueryOrFragment = uri.split(/[?#]/, 1)[0];
  const pathSegment = withoutQueryOrFragment.slice(withoutQueryOrFragment.lastIndexOf("/") + 1);
  const candidate = fragment || pathSegment || uri;
  try { return decodeURIComponent(candidate); } catch { return candidate; }
}

/**
 * Reproduce FCT's label-wrapper architecture: first fetch RDF terms in the
 * list query, then resolve labels through Virtuoso's virtrdf:label inference
 * graph instead of invoking the SQL-only fct_label() function in SPARQL.
 */
async function resolveFctLabels(
  endpoint: string,
  bindings: Record<string, SparqlBindingTerm>[],
  acceptLanguage: string | null,
  timeoutMs: number,
): Promise<Map<string, string>> {
  // Resolve every URI term in the result rows, not just the primary list-view
  // column. Properties, Roles, Classes, Graphs and DESCRIBE all need labels too.
  const uris = [...new Set(bindings.flatMap((row) => Object.values(row)).filter(
    (term): term is SparqlBindingTerm => term?.type === "uri" && Boolean(term.value),
  ).map((term) => term.value))];
  // Keep only authoritative labels in this map. The browser's toLabel() owns
  // compact-IRI fallbacks when Virtuoso has no label for a URI.
  const labels = new Map<string, string>();
  if (!uris.length) return labels;

  // Only use RDF IRIREF-safe values. Invalid terms retain the URI fallback.
  const safeUris = uris.filter((uri) => !/[<>"{}|^`]/u.test(uri) && !/\s/u.test(uri) && !uri.includes("\\"));
  if (!safeUris.length) return labels;
  const values = safeUris.map((uri) => `<${uri}>`).join(" ");
  const query = [
    'DEFINE input:inference "facets"',
    "SELECT ?s ?p ?label WHERE {",
    `  VALUES ?s { ${values} }`,
    "  ?s ?p ?label .",
    "  FILTER (?p IN (",
    `    <${VIRTRDF_LABEL}>,`,
    "    <http://www.w3.org/2000/01/rdf-schema#label>,",
    "    <http://www.w3.org/2004/02/skos/core#prefLabel>,",
    "    <http://xmlns.com/foaf/0.1/name>,",
    "    <http://purl.org/dc/terms/title>,",
    "    <http://purl.org/dc/elements/1.1/title>,",
    "    <https://schema.org/name>",
    "  ))",
    "  FILTER (isLiteral(?label))",
    "}",
    "ORDER BY STR(?s)",
  ].join("\n");
  try {
    const result = await executeSparql(endpoint, query, undefined, timeoutMs || 20000);
    if (!result.response.ok) return labels;
    const parsed = parseResults(result.text);
    if (!parsed) return labels;
    if (result.response.status === 200) setQueryCache(result.key, result.text);

    const candidates = new Map<string, { predicate: string; label: SparqlBindingTerm }[]>();
    const predicatePriority = new Map<string, number>([
      [VIRTRDF_LABEL, 0],
      ["http://www.w3.org/2000/01/rdf-schema#label", 1],
      ["http://www.w3.org/2004/02/skos/core#prefLabel", 2],
      ["http://xmlns.com/foaf/0.1/name", 3],
      ["http://purl.org/dc/terms/title", 4],
      ["http://purl.org/dc/elements/1.1/title", 5],
      ["https://schema.org/name", 6],
    ]);
    for (const row of parsed.results?.bindings ?? []) {
      const subject = row.s?.value;
      const predicate = row.p?.value;
      const label = row.label;
      if (!subject || !predicate || !label || label.type !== "literal" || !predicatePriority.has(predicate)) continue;
      const existing = candidates.get(subject) ?? [];
      existing.push({ predicate, label });
      candidates.set(subject, existing);
    }
    const languages = preferredLanguages(acceptLanguage);
    for (const [uri, options] of candidates) {
      options.sort((a, b) => {
        const predicateRank = (predicatePriority.get(a.predicate) ?? 99) - (predicatePriority.get(b.predicate) ?? 99);
        if (predicateRank) return predicateRank;
        const aLang = labelLanguage(a.label);
        const bLang = labelLanguage(b.label);
        const aIndex = aLang ? languages.findIndex((lang) => aLang === lang || aLang.startsWith(`${lang}-`)) : languages.length;
        const bIndex = bLang ? languages.findIndex((lang) => bLang === lang || bLang.startsWith(`${lang}-`)) : languages.length;
        const aRank = aIndex < 0 ? languages.length + 1 : aIndex;
        const bRank = bIndex < 0 ? languages.length + 1 : bIndex;
        return aRank - bRank;
      });
      labels.set(uri, options[0].label.value);
    }
  } catch {
    // Label lookup is supplementary: preserve the URI-derived fallback.
  }
  return labels;
}

type ExecutedSparql = { response: Response; text: string; key: string };
const inFlightFctSparql = new Map<string, Promise<ExecutedSparql>>();

async function executeSparql(endpoint: string, query: string, accept = "application/sparql-results+json, application/json;q=0.9", timeoutMs = 20000): Promise<ExecutedSparql> {
  const url = endpoint;
  const key = queryCacheKey("sparql", url, `${accept}\\u0000${query}`);
  const cached = getQueryCache<string>(key);
  if (cached !== undefined) {
    return {
      response: new Response(cached, { status: 200, headers: { "Content-Type": accept.toLowerCase().includes("xml") || accept.toLowerCase().includes("rdf") ? "application/rdf+xml; charset=utf-8" : "application/sparql-results+json; charset=utf-8" } }),
      text: cached,
      key,
    };
  }
  const pending = inFlightFctSparql.get(key);
  if (pending) return pending;

  const requestPromise = (async (): Promise<ExecutedSparql> => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: accept,
      },
      body: new URLSearchParams({ query, ...(timeoutMs >= 1000 ? { timeout: String(timeoutMs) } : {}) }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs || 20000)),
    });
    const text = await response.text();
    return { response, text, key };
  })();
  inFlightFctSparql.set(key, requestPromise);
  try {
    return await requestPromise;
  } finally {
    if (inFlightFctSparql.get(key) === requestPromise) inFlightFctSparql.delete(key);
  }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const FCT_NS = "http://openlinksw.com/services/facets/1.0/";

function xmlText(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fctError(message: string, status: number, details?: string): Response {
  const body = `<fct:facets xmlns:fct="${FCT_NS}"><fct:error>${xmlText(message)}${details ? `: ${xmlText(details)}` : ""}</fct:error></fct:facets>`;
  return new Response(body, { status, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}

function fctColumn(term: SparqlBindingTerm | undefined, label?: string, extraAttrs?: Record<string, string>): string {
  if (!term) return "<fct:column/>";
  const datatype = term.type === "uri" ? "uri" : term.type === "bnode" ? "bnode" : term.datatype;
  const safeLabel = term.type === "uri" && label && label !== term.value ? label : "";
  const extraAttrStr = extraAttrs
    ? Object.entries(extraAttrs).map(([k, v]) => ` ${k}="${xmlText(v)}"`).join("")
    : "";
  const attrs = [
    datatype ? ` datatype="${xmlText(datatype)}"` : "",
    term["xml:lang"] ? ` xml:lang="${xmlText(term["xml:lang"])}"` : "",
    safeLabel ? ` label="${xmlText(safeLabel)}"` : "",
    extraAttrStr,
  ].join("");
  return `<fct:column${attrs}>${xmlText(term.value)}</fct:column>`;
}

function fctResponseXml(args: {
  query: string; view: string; limit: number; offset: number; bindings?: Record<string, SparqlBindingTerm>[];
  vars?: string[]; elapsedMs: number; complete: boolean; timeoutMs?: number; graphOnly?: boolean; countOnly?: boolean;
  labels?: Map<string, string>; error?: string;
  badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse" }>;
}): string {
  const { query, view, limit, offset, elapsedMs, complete } = args;
  if (args.error) return `<fct:facets xmlns:fct="${FCT_NS}"><fct:sparql>${xmlText(query)}</fct:sparql><fct:time>${elapsedMs}</fct:time><fct:complete>no</fct:complete><fct:error>${xmlText(args.error)}</fct:error></fct:facets>`;
  const vars = args.vars ?? [];
  const bindings = args.bindings ?? [];
  const badgeMap = new Map((args.badgeColumns ?? []).map((b) => [b.colName, b]));
  let resultType = args.graphOnly ? "graphs" : args.countOnly ? "count" : view;
  const labelFor = (term: SparqlBindingTerm | undefined) =>
    term?.type === "uri" ? args.labels?.get(term.value) : undefined;
  const rows = bindings.map((binding) => {
    if (args.countOnly) {
      const count = binding.n ?? Object.values(binding)[0];
      return `<fct:row>${fctColumn(count, labelFor(count))}</fct:row>`;
    }
    return `<fct:row>${vars.map((name) => {
      const badgeInfo = badgeMap.get(name);
      const extraAttrs = badgeInfo ? { property: badgeInfo.property, direction: badgeInfo.direction } : undefined;
      return fctColumn(binding[name], labelFor(binding[name]), extraAttrs);
    }).join("")}</fct:row>`;
  }).join("");
  return `<fct:facets xmlns:fct="${FCT_NS}"><fct:sparql>${xmlText(query)}</fct:sparql><fct:time>${elapsedMs}</fct:time><fct:complete>${complete ? "yes" : "no"}</fct:complete><fct:timeout>${args.timeoutMs ?? 0}</fct:timeout><fct:db-activity/><fct:processed>${bindings.length}</fct:processed><fct:view offset="${offset}" limit="${limit}"/><fct:result type="${xmlText(resultType)}">${rows}</fct:result></fct:facets>`;
}

function parseDescribeRdfXml(source: string): Record<string, SparqlBindingTerm>[] {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false, parseTagValue: false, trimValues: true }).parse(source) as Record<string, unknown>;
  const rootKey = Object.keys(parsed).find((key) => key === "rdf:RDF" || key.endsWith(":RDF") || key === "RDF");
  if (!rootKey || !parsed[rootKey] || typeof parsed[rootKey] !== "object") throw new Error("Virtuoso DESCRIBE did not return parseable RDF/XML.");
  const root = parsed[rootKey] as Record<string, unknown>;
  const namespaces = new Map<string, string>();
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith("@_xmlns:")) namespaces.set(key.slice(8), String(value));
    else if (key === "@_xmlns") namespaces.set("", String(value));
  }
  const descriptions = Object.entries(root).filter(([key]) => !key.startsWith("@_") && key !== "#text");
  const rows: Record<string, SparqlBindingTerm>[] = [];
  for (const rawDescription of descriptions.map(([, value]) => value)) {
    for (const description of Array.isArray(rawDescription) ? rawDescription : [rawDescription]) {
      if (!description || typeof description !== "object") continue;
      const node = description as Record<string, unknown>;
      const about = String(node["@_rdf:about"] ?? "");
      const nodeId = String(node["@_rdf:nodeID"] ?? "");
      const subject: SparqlBindingTerm | null = about ? { type: "uri", value: about } : nodeId ? { type: "bnode", value: nodeId } : null;
      if (!subject) continue;
      for (const [predicateQName, rawObjects] of Object.entries(node)) {
        if (predicateQName.startsWith("@_") || predicateQName === "#text") continue;
        const [prefix, local] = predicateQName.includes(":") ? predicateQName.split(":", 2) : ["", predicateQName];
        const namespace = namespaces.get(prefix);
        if (!namespace) continue;
        const predicate = { type: "uri", value: namespace + local };
        for (const rawObject of Array.isArray(rawObjects) ? rawObjects : [rawObjects]) {
          if (rawObject && typeof rawObject === "object") {
            const objectNode = rawObject as Record<string, unknown>;
            const resource = objectNode["@_rdf:resource"];
            const blank = objectNode["@_rdf:nodeID"];
            const datatype = objectNode["@_rdf:datatype"];
            const lang = objectNode["@_xml:lang"];
            const textValue = String(objectNode["#text"] ?? "");
            const object: SparqlBindingTerm = resource ? { type: "uri", value: String(resource) } : blank ? { type: "bnode", value: String(blank) } : { type: "literal", value: textValue, ...(datatype ? { datatype: String(datatype) } : {}), ...(lang ? { "xml:lang": String(lang) } : {}) };
            rows.push({ s: subject, p: predicate, o: object });
          } else rows.push({ s: subject, p: predicate, o: { type: "literal", value: String(rawObject ?? "") } });
        }
      }
    }
  }
  return rows;
}

export async function GET(request: Request) {
  logProxyCaller(request, "fct.GET");
  let endpoints: Awaited<ReturnType<typeof getConfiguredFctEndpoints>>;
  try { endpoints = await getConfiguredFctEndpoints(); }
  catch (error) {
    return NextResponse.json({ error: `Could not load Datasites from the personal SPARQL store: ${error instanceof Error ? error.message : "unknown error"}` }, { status: 503 });
  }
  const url = new URL(request.url);
  const selectedId = selectConfiguredFctEndpoint(request, endpoints)?.id ?? "";
  if (url.searchParams.get("health") !== "1") {
    return NextResponse.json({ endpoints: endpoints.map(({ id, label, url, group }) => ({ id, label, url, group })), selectedId });
  }

  const endpointId = url.searchParams.get("endpointId") ?? "";
  const endpoint = endpoints.find((item) => item.id === endpointId);
  if (!endpoint) return NextResponse.json({ error: "Unknown SPARQL endpoint health check." }, { status: 400 });

  const testedUrl = endpoint.url;
  try {
    const response = await fetch(testedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/sparql-results+json, application/json;q=0.9",
      },
      body: new URLSearchParams({ query: "ASK WHERE { ?s ?p ?o }" }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const responseText = await response.text();
    let askSucceeded = false;
    try { askSucceeded = Boolean(JSON.parse(responseText)?.boolean === true || JSON.parse(responseText)?.boolean === false); } catch { askSucceeded = false; }
    const validResults = response.ok && askSucceeded;
    const status = validResults ? response.status : response.ok ? 502 : response.status;
    return NextResponse.json({
      check: {
        id: endpoint.id,
        status,
        state: validResults ? "ok" : status >= 500 ? "server-error" : "http-error",
        testedUrl,
      },
    });
  } catch (error) {
    return NextResponse.json({ check: {
      id: endpoint.id,
      status: null,
      state: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable",
      testedUrl,
    } });
  }
}

export async function POST(request: Request) {
  logProxyCaller(request, "fct.POST");
  let stage: "compile" | "execute" = "compile";
  try {
    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    const requestBodyText = await request.text();
    const body: Record<string, unknown> | null = contentType.includes("xml")
      ? { queryXml: requestBodyText }
      : (() => { try { return JSON.parse(requestBodyText) as Record<string, unknown>; } catch { return null; } })();
    let endpoints: Awaited<ReturnType<typeof getConfiguredFctEndpoints>>;
    try { endpoints = await getConfiguredFctEndpoints(); }
    catch (error) {
      return fctError(`Could not load Datasites from the personal SPARQL store: ${error instanceof Error ? error.message : "unknown error"}`, 503);
    }

    if (typeof body?.selectEndpointId === "string") {
      const selected = endpoints.find((endpoint) => endpoint.id === body.selectEndpointId);
      if (!selected) return NextResponse.json({ error: "Unknown SPARQL endpoint selection." }, { status: 400 });
      const response = NextResponse.json({ selectedId: selected.id, label: selected.label });
      response.cookies.set("fct_endpoint", selected.id, { httpOnly: true, sameSite: "lax", path: "/" });
      return response;
    }

    let queryXml = typeof body?.queryXml === "string" ? body.queryXml.trim() : "";
    if (!queryXml && typeof body?.text === "string") {
      const fallbackEndpoint = selectConfiguredFctEndpoint(request, endpoints);
      if (!fallbackEndpoint) return fctError(`No graph servers are configured in the personal SPARQL store graph ${getDataserversGraph()}.`, 503);
      queryXml = `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" inference="" same-as="" addr="@${xmlEscape(fallbackEndpoint.id)}"><text>${xmlEscape(body.text.trim())}</text><view type="text" limit="30" offset="0"/></query>`;
    }
    if (!queryXml) return fctError("An FCT query XML document is required.", 400);

    // Resolve the endpoint from this query's address, not the mutable selection
    // cookie. Only the first @ separates graphsite from graph-server ID.
    const rootTag = queryXml.match(/<query\b([^>]*)>/i)?.[1] ?? "";
    const addrMatch = rootTag.match(/\baddr\s*=\s*(["'])(.*?)\1/i);
    let address = addrMatch?.[2];
    if (!address) {
      const fallbackEndpoint = selectConfiguredFctEndpoint(request, endpoints);
      if (fallbackEndpoint) {
        address = `@${fallbackEndpoint.id}`;
        queryXml = queryXml.replace(/<query\b/i, `<query addr="@${xmlEscape(fallbackEndpoint.id)}" `);
      }
    }
    const delimiter = address?.indexOf("@") ?? -1;
    if (delimiter < 0 || !address?.slice(delimiter + 1).trim()) {
      return fctError('Every FCT query must have a valid addr="graphsite@graphserver" attribute; graphsite may be empty.', 400);
    }
    if (delimiter > 0) {
      const graphValue = address.slice(0, delimiter);
      const hash = graphValue.indexOf("#");
      const localName = hash >= 0 ? graphValue.slice(hash + 1) : "";
      if (hash >= 0 && localName !== "history" && localName !== "bookmarks") {
        const normalizedAddress = `${graphValue.slice(0, hash)}@${address.slice(delimiter + 1)}`;
        if (addrMatch) {
          queryXml = queryXml.replace(addrMatch[0], `addr=${addrMatch[1]}${normalizedAddress}${addrMatch[1]}`);
        }
      }
    }
    const serverAddress = address.slice(delimiter + 1).trim();
    const endpoint = endpoints.find((item) => item.id === serverAddress || item.url === serverAddress || item.label === serverAddress);
    if (!endpoint) return fctError(`The graph server in query addr is not configured: ${serverAddress}`, 400);

    // Maestro uses #history and #bookmarks as client-side names for its two
    // private storage graphs. Other graphsite fragments are local labels only
    // and must not change the named graph requested by an ordinary FCT query.
    const graphAttribute = rootTag.match(/\bgraph\s*=\s*(["'])(.*?)\1/i);
    if (graphAttribute) {
      const graphValue = graphAttribute[2];
      const hash = graphValue.indexOf("#");
      const localName = hash >= 0 ? graphValue.slice(hash + 1) : "";
      if (hash >= 0 && localName !== "history" && localName !== "bookmarks") {
        const normalizedGraph = graphValue.slice(0, hash);
        queryXml = queryXml.replace(graphAttribute[0], `graph=${graphAttribute[1]}${normalizedGraph}${graphAttribute[1]}`);
      }
    }
    const view = typeof body?.view === "string" ? body.view : undefined;
    const graphOnly = body?.graphOnly === true;
    const countOnly = body?.countOnly === true;
    const compiled = compileFctXmlToSparql(queryXml, view, graphOnly, countOnly);
    const isDescribe = compiled.view === "describe";
    const responseCacheKey = queryCacheKey(
      "fct-response",
      endpoint.url,
      JSON.stringify([queryXml, view ?? null, graphOnly, countOnly, request.headers.get("accept-language") ?? ""]),
    );
    const cachedResponse = getQueryCache<{ body: string; contentType: string; status: number }>(responseCacheKey);
    if (cachedResponse) {
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers: { "Content-Type": cachedResponse.contentType, "Cache-Control": "no-store", "X-Maestro-Cache": "HIT" },
      });
    }
    stage = "execute";
    const startedAt = Date.now();
    const { response, text, key } = await executeSparql(endpoint.url, compiled.query, isDescribe ? "application/rdf+xml, application/xml;q=0.9" : undefined, compiled.timeoutMs || 20000);
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) return fctError(`Virtuoso SPARQL endpoint returned HTTP ${response.status}`, 502, text.slice(0, 2000));

    if (isDescribe) {
      if (response.status === 200) setQueryCache(key, text);
      let bindings: Record<string, SparqlBindingTerm>[];
      try { bindings = parseDescribeRdfXml(text); }
      catch (error) { return fctError(error instanceof Error ? error.message : "Invalid DESCRIBE response", 502, text.slice(0, 1000)); }
      const labels = await resolveFctLabels(endpoint.url, bindings, request.headers.get("accept-language"), compiled.timeoutMs);
      const labelFor = (term: SparqlBindingTerm | undefined) => term?.type === "uri" ? labels.get(term.value) : undefined;
      const describeRows = bindings.map((binding) => `<fct:row>${fctColumn(binding.s, labelFor(binding.s))}${fctColumn(binding.p, labelFor(binding.p))}${fctColumn(binding.o, labelFor(binding.o))}</fct:row>`).join("");
      const xml = `<fct:facets xmlns:fct="${FCT_NS}"><fct:sparql>${xmlText(compiled.query)}</fct:sparql><fct:time>${elapsedMs}</fct:time><fct:complete>yes</fct:complete><fct:timeout>${compiled.timeoutMs}</fct:timeout><fct:db-activity/><fct:processed>${bindings.length}</fct:processed><fct:view offset="${compiled.offset}" limit="${compiled.limit}"/><fct:result type="describe">${describeRows}</fct:result></fct:facets>`;
      if (response.status === 200) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
      return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Maestro-Cache": "MISS" } });
    }

    const parsed = parseResults(text);
    if (!parsed) return fctError("Virtuoso SPARQL endpoint returned an invalid SPARQL Results JSON document", 502, text.slice(0, 1500));
    let bindings = parsed.results?.bindings ?? [];
    let vars = parsed.head?.vars ?? [];
    if (response.status === 200) setQueryCache(key, text);
    const labels = countOnly
      ? new Map<string, string>()
      : await resolveFctLabels(endpoint.url, bindings, request.headers.get("accept-language"), compiled.timeoutMs);
    if (compiled.view === "list" && !countOnly && !graphOnly) {
      bindings = bindings.map((binding) => {
        const uri = binding.c1?.type === "uri" ? binding.c1.value : "";
        if (!uri) return binding;
        // FCT list views expose the label as column 2. If no RDF label exists,
        // provide a compact URI-segment fallback instead of the full IRI.
        return { ...binding, c2: { type: "literal", value: labels.get(uri) ?? uriFallbackLabel(uri) } };
      });
      if (!vars.includes("c2")) vars = [...vars, "c2"];
    }
    // FCT <complete> reports execution completion, not whether another page
    // exists. Virtuoso uses HTTP 206 for partial results.
    const complete = response.status !== 206;
    const xml = fctResponseXml({
      query: compiled.query, view: compiled.view, limit: compiled.limit, offset: compiled.offset,
      bindings, vars, elapsedMs, complete, timeoutMs: compiled.timeoutMs, graphOnly, countOnly, labels,
      badgeColumns: compiled.badgeColumns,
    });
    if (response.status === 200) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Maestro-Cache": "MISS" } });
  } catch (error) {
    console.error("FCT-to-SPARQL API error:", error);
    return fctError(error instanceof Error ? error.message : "Failed to compile or execute the FCT query as SPARQL.", stage === "compile" ? 400 : 502);
  }
}
