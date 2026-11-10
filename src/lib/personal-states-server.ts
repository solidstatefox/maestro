import { getUserGraph, getOntologyGraph, personalSparqlUrl, queryPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";
import { MUI_NS, MUI_STATE, MUI_HIDDEN, MUI_LAST_LOCATED_AT, RECORD_STATES, type RecordStateName } from "@/lib/personal-state-vocabulary";

/** No state object or subject can be an RDF literal or blank node. */
function iri(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value)) throw new Error("Record states require an IRI.");
  return `<${value}>`;
}
function validatedHash(queryHash: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(queryHash)) throw new Error("A valid bookmarked-query hash is required.");
  return queryHash;
}
const stateGraph = (request: Request, queryHash: string) => iri(`${getUserGraph(request)}/state/${validatedHash(queryHash)}`);
const hideGraph = (request: Request) => iri(`${getUserGraph(request)}/query-hash/hide`);
const predicate = iri(MUI_STATE);
const hiddenObject = iri(MUI_HIDDEN);
const locatedPredicate = iri(MUI_LAST_LOCATED_AT);
const typeDate = iri("http://www.w3.org/2001/XMLSchema#dateTime");
const rdfType = iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const rdfsLabel = iri("http://www.w3.org/2000/01/rdf-schema#label");
const dctDescription = iri("http://purl.org/dc/terms/description");
const utilityGraph = iri(`${MUI_NS}UtilityGraph`);

/** A query-hash graph is a durable per-query bus, not a page of results. */
async function ensureQueryHashGraphMetadata(request: Request, queryHash: string): Promise<void> {
  const g = stateGraph(request, queryHash);
  const description = "Maestro's per-query resource observation and state bus. Each Results page adds distinct located resources and refreshes lastLocatedAt; Seen, Unseen, and Starred belong to those resource IRIs. Page size and offset do not change this graph's identity.";
  await updatePersonalSparql(`INSERT DATA { GRAPH ${g} { ${g} ${rdfType} ${utilityGraph} ; ${rdfsLabel} "query hash graph" ; ${dctDescription} ${JSON.stringify(description)} . } }`, 30000, request);
}

export async function ensurePersonalStateSchema(request: Request): Promise<void> {
  const g = iri(getOntologyGraph(request));
  const statements = [
    `${predicate} a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> ; <http://www.w3.org/2000/01/rdf-schema#label> "Record state" ; <http://www.w3.org/2000/01/rdf-schema#range> <http://www.w3.org/2000/01/rdf-schema#Resource> .`,
    `${locatedPredicate} a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> ; <http://www.w3.org/2000/01/rdf-schema#range> ${typeDate} .`,
    ...Object.entries({ ...RECORD_STATES, Hidden: MUI_HIDDEN }).map(([name, uri]) => `${iri(uri)} a <http://www.w3.org/2000/01/rdf-schema#Resource> ; <http://www.w3.org/2000/01/rdf-schema#label> ${JSON.stringify(name)} .`),
    `${iri(`${MUI_NS}RecordStateShape`)} a <http://www.w3.org/ns/shacl#NodeShape> ; <http://www.w3.org/ns/shacl#targetSubjectsOf> ${predicate} ; <http://www.w3.org/ns/shacl#property> ${iri(`${MUI_NS}RecordStatePropertyShape`)} .`,
    `${iri(`${MUI_NS}RecordStatePropertyShape`)} <http://www.w3.org/ns/shacl#path> ${predicate} ; <http://www.w3.org/ns/shacl#nodeKind> <http://www.w3.org/ns/shacl#IRI> .`,
  ];
  await updatePersonalSparql(`INSERT DATA { GRAPH ${g} { ${statements.join("\n")} } }`, 30000, request);
}

/** Atomic mutually exclusive read/unread transition. Stars are orthogonal. */
export async function updateRecordState(request: Request, queryHash: string, uri: string, state: RecordStateName, enabled: boolean): Promise<void> {
  const subject = iri(uri), g = stateGraph(request, queryHash), object = iri(RECORD_STATES[state]);
  if (state === "Seen" || state === "Unseen") {
    const desired = enabled ? state : (state === "Seen" ? "Unseen" : "Seen");
    const inverse = desired === "Seen" ? "Unseen" : "Seen";
    await updatePersonalSparql(`DELETE { GRAPH ${g} { ${subject} ${predicate} ${iri(RECORD_STATES[inverse])} } } INSERT { GRAPH ${g} { ${subject} ${predicate} ${iri(RECORD_STATES[desired])} } } WHERE { OPTIONAL { GRAPH ${g} { ${subject} ${predicate} ${iri(RECORD_STATES[inverse])} } } }`, 30000, request);
  } else {
    await updatePersonalSparql(enabled
      ? `INSERT DATA { GRAPH ${g} { ${subject} ${predicate} ${object} } }`
      : `DELETE DATA { GRAPH ${g} { ${subject} ${predicate} ${object} } }`, 30000, request);
  }
}

export async function updateHiddenRecord(request: Request, uri: string, hidden: boolean): Promise<void> {
  const g = hideGraph(request), subject = iri(uri);
  await updatePersonalSparql(hidden
    ? `INSERT DATA { GRAPH ${g} { ${subject} ${predicate} ${hiddenObject} } }`
    : `DELETE DATA { GRAPH ${g} { ${subject} ${predicate} ${hiddenObject} } }`, 30000, request);
}

export async function listHiddenRecords(request: Request): Promise<string[]> {
  const response = await queryPersonalSparql(`SELECT DISTINCT ?s WHERE { GRAPH ${hideGraph(request)} { ?s ${predicate} ${hiddenObject} } FILTER(isIRI(?s)) } ORDER BY STR(?s) LIMIT 500`, 20000, request);
  return (response.results?.bindings ?? []).map((row) => row.s?.value ?? "").filter(Boolean);
}

export async function recordPageStates(request: Request, queryHash: string, uris: string[]): Promise<{ states: Record<string, RecordStateName[]>; hidden: string[] }> {
  const items = [...new Set(uris)].slice(0, 150);
  if (!items.length) return { states: {}, hidden: [] };
  const values = items.map(iri).join(" ");
  const g = stateGraph(request, queryHash), h = hideGraph(request);
  const response = await queryPersonalSparql(`SELECT ?s ?state ?hidden WHERE { VALUES ?s { ${values} } OPTIONAL { GRAPH ${g} { ?s ${predicate} ?state } } OPTIONAL { GRAPH ${h} { ?s ${predicate} ${hiddenObject} } BIND(true AS ?hidden) } }`, 20000, request);
  const states: Record<string, RecordStateName[]> = {}, hidden = new Set<string>();
  const reverse = Object.fromEntries(Object.entries(RECORD_STATES).map(([key, value]) => [value, key])) as Record<string, RecordStateName>;
  for (const row of response.results?.bindings ?? []) {
    const uri = row.s?.value, name = reverse[row.state?.value ?? ""];
    if (!uri) continue;
    if (name) { const item = states[uri] ?? (states[uri] = []); if (!item.includes(name)) item.push(name); }
    if (row.hidden?.value === "true" || row.hidden?.value === "1") hidden.add(uri);
  }
  return { states, hidden: [...hidden] };
}

/** Every page of one query execution uses the SAME timestamp. Paging cannot change it.
 * The timestamp records the last execution observing an item, not a read transition.
 * A previously acknowledged entry never becomes Unseen merely because it reappeared.
 */
export async function recordLocatedPage(request: Request, queryHash: string, uris: string[], executionTime: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(executionTime) || !Number.isFinite(Date.parse(executionTime))) throw new Error("Invalid query execution timestamp.");
  const items = [...new Set(uris)].slice(0, 150);
  if (!items.length) return;
  const values = items.map(iri).join(" "), g = stateGraph(request, queryHash);
  await ensureQueryHashGraphMetadata(request, queryHash);
  // Exclude SELECT-listed existing states; resources with only Stars remain Unseen.
  await updatePersonalSparql(`INSERT { GRAPH ${g} { ?s ${predicate} ${iri(RECORD_STATES.Unseen)} } } WHERE { VALUES ?s { ${values} } FILTER NOT EXISTS { GRAPH ${g} { ?s ${predicate} ${iri(RECORD_STATES.Seen)} } } FILTER NOT EXISTS { GRAPH ${g} { ?s ${predicate} ${iri(RECORD_STATES.Unseen)} } } }`, 30000, request);
  // A resource's lastLocatedAt is updated on an explicit new execution only.
  await updatePersonalSparql(`DELETE { GRAPH ${g} { ?s ${locatedPredicate} ?old } } INSERT { GRAPH ${g} { ?s ${locatedPredicate} "${executionTime}"^^${typeDate} } } WHERE { VALUES ?s { ${values} } OPTIONAL { GRAPH ${g} { ?s ${locatedPredicate} ?old } } }`, 30000, request);
}

/** A SERVICE containing only graph patterns avoids Virtuoso's ODS permission
 * error on remote subqueries. Avoid an enclosing SELECT as well: Virtuoso's
 * optimizer can report SQ156 when that subquery is joined to a personal GRAPH
 * and wrapped in a COUNT or ASK. The enclosing ASK/COUNT/SELECT DISTINCT
 * performs the required projection and deduplication instead.
 *
 * The list-states view projects a simple focus variable AS ?c1. Rebinding
 * the focus variable inside its graph patterns preserves its identity without
 * a subquery or a BIND expression. */
/** Compare resolved SPARQL request targets, not graph IRIs or ODS profile URLs.
 * URL canonicalization handles default ports and an optional trailing slash;
 * schemes, paths, and query parameters must otherwise match. */
function sameSparqlEndpoint(a: string, b: string): boolean {
  const left = new URL(a);
  const right = new URL(b);
  const canonicalPath = (url: URL) => url.pathname.replace(/\/+$/, "") || "/";
  return left.protocol === right.protocol && left.host === right.host &&
    canonicalPath(left) === canonicalPath(right) && left.search === right.search;
}

function federatedFocusSource(focusSelection: string, endpointUrl: string, personalEndpointUrl: string): string {
  const match = /^SELECT DISTINCT\s+(\?[A-Za-z][\w]*)\s+AS\s+\?c1\s+WHERE\s*\{([\s\S]*)\}\s*$/i.exec(focusSelection);
  if (!match) throw new Error("Cannot derive the federated focus projection from the list-states FCT view.");
  const focusVariable = match[1];
  const patterns = match[2].trim();
  // Use a variable-token boundary rather than a plain string substitution so
  // ?s1 never changes ?s10. FCT's generated variable names are ASCII names.
  const focusPattern = new RegExp(`\\?${focusVariable.slice(1)}(?![A-Za-z0-9_])`, "g");
  const focusPatterns = patterns.replace(focusPattern, "?c1");
  return sameSparqlEndpoint(endpointUrl, personalEndpointUrl)
    ? focusPatterns
    : `SERVICE ${iri(endpointUrl)} { ${focusPatterns} }`;
}

/** Build the exact federated ASK used for States facets without executing it.
 * The preview and the executable query share one construction path. */
export async function buildFederatedStatesAsk(request: Request, liveQueryXml: string, queryHash: string): Promise<{
  askQuery: string; base: string; service: string; stateSource: string; endpointUrl: string;
}> {
  validatedHash(queryHash);
  if (!liveQueryXml || liveQueryXml.length > 100_000) throw new Error("The live FCT query is unavailable or too large.");
  const { compileFctXmlToSparql } = await import("@/lib/fct-sparql-translator");
  const { FCT_VIEW_TYPES } = await import("@/lib/fct-view-types");
  const { XMLParser } = await import("fast-xml-parser");
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true }).parse(liveQueryXml) as { query?: { "@_addr"?: unknown } };
  const address = typeof parsed.query?.["@_addr"] === "string" ? parsed.query["@_addr"] : "";
  const separator = address.indexOf("@");
  if (separator < 0) throw new Error("The FCT query does not identify a graph server.");
  const requestedServer = address.slice(separator + 1);
  const { getConfiguredFctEndpoints, resolveConfiguredFctEndpoint } = await import("@/lib/personal-sparql");
  const endpoint = resolveConfiguredFctEndpoint(await getConfiguredFctEndpoints(request), requestedServer);
  if (!endpoint?.url || !/^https?:\/\//i.test(endpoint.url)) throw new Error("The query graph server is not registered for federated States.");
  const compiled = compileFctXmlToSparql(liveQueryXml, FCT_VIEW_TYPES.LIST_STATES);
  const prologue = compiled.query.match(/^(?:DEFINE [^\n]+\n)*/)?.[0] ?? "";
  const focusSelection = compiled.query.slice(prologue.length).trim();
  if (!focusSelection.startsWith("SELECT DISTINCT ") || !focusSelection.includes("WHERE {")) throw new Error("Cannot derive a federated focus selection from this FCT query.");
  const base = `${prologue}PREFIX mui: <${MUI_NS}>\n`;
  const service = federatedFocusSource(focusSelection, endpoint.url, personalSparqlUrl(request).toString());
  const g = stateGraph(request, queryHash);
  const stateSource = `GRAPH ${g} { ?c1 ${predicate} ?state }`;
  const askQuery = `${base}ASK WHERE { ${service} ${stateSource} FILTER(isIRI(?c1) && isIRI(?state)) }`;
  return { askQuery, base, service, stateSource, endpointUrl: endpoint.url };
}

/** Counts come from the accumulated query-hash graph, never from just the
 * current page and never from a remote SERVICE join. A located resource with
 * no Seen assertion is New, regardless of whether Unseen was explicitly set. */
export async function queryFederatedStateCounts(request: Request, _liveQueryXml: string, queryHash: string): Promise<{
  hasStates: boolean; counts: Record<RecordStateName | "New" | "Hidden", number>; sparql: string;
}> {
  const g = stateGraph(request, queryHash);
  const h = hideGraph(request);
  const located = `GRAPH ${g} { ?c1 ${locatedPredicate} ?located }`;
  const base = `PREFIX mui: <${MUI_NS}>\n`;
  const definitions = {
    New: `${located} FILTER NOT EXISTS { GRAPH ${g} { ?c1 ${predicate} ${iri(RECORD_STATES.Seen)} } }`,
    Seen: `${located} GRAPH ${g} { ?c1 ${predicate} ${iri(RECORD_STATES.Seen)} }`,
    Starred: `${located} GRAPH ${g} { ?c1 ${predicate} ${iri(RECORD_STATES.Starred)} }`,
    Hidden: `${located} GRAPH ${h} { ?c1 ${predicate} ${hiddenObject} }`,
  } as const;
  const query = (where: string) => `${base}SELECT (COUNT(DISTINCT ?c1) AS ?ct) WHERE { ${where} }`;
  const entries = await Promise.all(Object.entries(definitions).map(async ([name, where]) => {
    const response = await queryPersonalSparql(query(where), 30000, request);
    const value = Number(response.results?.bindings?.[0]?.ct?.value ?? NaN);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid personal ${name} count.`);
    return [name, value] as const;
  }));
  const counts: Record<RecordStateName | "New" | "Hidden", number> = { New: 0, Unseen: 0, Seen: 0, Starred: 0, Hidden: 0 };
  for (const [name, value] of entries) counts[name as keyof typeof counts] = value;
  counts.Unseen = counts.New; // Legacy internal alias; only New is displayed.
  const sparql = query(definitions.New);
  return { hasStates: counts.New + counts.Seen + counts.Starred + counts.Hidden > 0, counts, sparql };
}

/** The paged Results view and facet counts share the same unpaginated FCT focus
 * selection. State predicates are joined on the personal server before paging. */
export async function queryFederatedStateResults(request: Request, liveQueryXml: string, queryHash: string,
  selected: string[], limit: number, offset: number): Promise<{ results: Array<{uri:string;title:string;matches: never[];termType:string}>; total: number; sparql: string; incomplete: boolean }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid Results pagination.");
  const valid = new Set(["New", "Unseen", "Seen", "Starred", "Hidden"]);
  if (selected.some((name) => !valid.has(name))) throw new Error("Unknown state filter.");
  // Use exactly the same FCT list-states compilation and SERVICE placement as
  // the previewed ASK and federated counts.
  const { base, service: source, endpointUrl } = await buildFederatedStatesAsk(request, liveQueryXml, queryHash);
  const g = stateGraph(request, queryHash), h = hideGraph(request);
  const ordinary = selected.filter((name) => name !== "Hidden");
  const stateConstraints = ordinary.length
    ? `FILTER EXISTS { GRAPH ${g} { ?c1 ${predicate} ?selectedState } FILTER(?selectedState IN (${[...new Set(ordinary.map((name) => iri(RECORD_STATES[name === "New" ? "Unseen" : name as RecordStateName])))].join(", ")})) }`
    : "";
  const hideConstraint = selected.includes("Hidden")
    ? `FILTER EXISTS { GRAPH ${h} { ?c1 ${predicate} ${hiddenObject} } }`
    : `FILTER NOT EXISTS { GRAPH ${h} { ?c1 ${predicate} ${hiddenObject} } }`;
  const where = `${source} FILTER(isIRI(?c1)) ${stateConstraints} ${hideConstraint}`;
  const countResponse = await queryPersonalSparql(`${base}SELECT (COUNT(DISTINCT ?c1) AS ?ct) WHERE { ${where} }`, 30000, request);
  const total = Number(countResponse.results?.bindings?.[0]?.ct?.value ?? 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Invalid federated Results count.");
  const sparql = `${base}SELECT DISTINCT ?c1 WHERE { ${where} } ORDER BY STR(?c1) LIMIT ${limit} OFFSET ${offset}`;
  const rows = await queryPersonalSparql(sparql, 30000, request);
  const resources = (rows.results?.bindings ?? []).filter((row) => row.c1?.type === "uri" && Boolean(row.c1?.value)).map((row) => String(row.c1?.value));
  const labelMap = new Map<string, string>();
  if (resources.length) {
    // Labels are descriptive only: a label lookup must not remove a focus row.
    // Query just the already-paged resources; never paginate their remote labels.
    try {
      const values = resources.map(iri).join(" ");
      const labelPatterns = `?c1 <http://www.w3.org/2000/01/rdf-schema#label> ?label . FILTER(LANG(?label) = "" || LANGMATCHES(LANG(?label), "en"))`;
      const labelSource = sameSparqlEndpoint(endpointUrl, personalSparqlUrl(request).toString())
        ? labelPatterns
        : `SERVICE ${iri(endpointUrl)} { ${labelPatterns} }`;
      const labelQuery = `SELECT ?c1 (SAMPLE(?label) AS ?name) WHERE { VALUES ?c1 { ${values} } OPTIONAL { ${labelSource} } } GROUP BY ?c1`;
      const labelRows = await queryPersonalSparql(labelQuery, 20000, request);
      for (const row of labelRows.results?.bindings ?? []) {
        if (row.c1?.value && row.name?.value) labelMap.set(row.c1.value, row.name.value);
      }
    } catch { /* Continue with URI-derived labels if optional metadata is unavailable. */ }
  }
  const results = resources.map((uri) => {
    const suffix = uri.split(/[\/#]/).pop() ?? uri;
    let local = suffix;
    try { local = decodeURIComponent(suffix); } catch { /* Preserve raw URI suffix. */ }
    return { uri, title: labelMap.get(uri) ?? local.replace(/_/g, " "), matches: [] as never[], termType: "uri" };
  });
  return { results, total, sparql, incomplete: false };
}
