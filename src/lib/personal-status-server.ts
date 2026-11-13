import { cloneFctListStatusView } from "@/lib/fct-status-projection";
export { cloneFctListStatusView } from "@/lib/fct-status-projection";
import { getOntologyGraph, personalSparqlUrl, queryPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";
import { getPersonalStatusGraph, getQueryObservationGraph } from "@/lib/personal-status-graph";
import { MUI_NS, MUI_STATUS, MUI_HIDDEN, MUI_LAST_LOCATED_AT, RECORD_STATUSES, type RecordStatusName } from "@/lib/personal-status-vocabulary";

/** No status object or subject can be an RDF literal or blank node. */
function iri(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value)) throw new Error("Record statuses require an IRI.");
  return `<${value}>`;
}
function validatedHash(queryHash: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(queryHash)) throw new Error("A valid bookmarked-query hash is required.");
  return queryHash;
}
const statusGraph = (request: Request, _queryHash?: string) => iri(getPersonalStatusGraph(request));
const observationGraph = (request: Request, queryHash: string) => iri(getQueryObservationGraph(request, validatedHash(queryHash)));
const predicate = iri(MUI_STATUS);
const hiddenObject = iri(MUI_HIDDEN);
const locatedPredicate = iri(MUI_LAST_LOCATED_AT);
const typeDate = iri("http://www.w3.org/2001/XMLSchema#dateTime");
const rdfType = iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const rdfsLabel = iri("http://www.w3.org/2000/01/rdf-schema#label");
const dctDescription = iri("http://purl.org/dc/terms/description");
const utilityGraph = iri(`${MUI_NS}UtilityGraph`);

/** A query-hash graph is a durable per-query bus, not a page of results. */
async function ensureQueryHashGraphMetadata(request: Request, queryHash: string): Promise<void> {
  const g = observationGraph(request, queryHash);
  const description = "Maestro's per-query resource observation and status bus. Each Results page adds distinct located resources and refreshes lastLocatedAt; Seen, Unseen, and Starred belong to those resource IRIs. Page size and offset do not change this graph's identity.";
  await updatePersonalSparql(`INSERT DATA { GRAPH ${g} { ${g} ${rdfType} ${utilityGraph} ; ${rdfsLabel} "query hash graph" ; ${dctDescription} ${JSON.stringify(description)} . } }`, 30000, request);
}

export async function ensurePersonalStatusSchema(request: Request): Promise<void> {
  const g = iri(getOntologyGraph(request));
  const statements = [
    `${predicate} a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> ; <http://www.w3.org/2000/01/rdf-schema#label> "Record status" ; <http://www.w3.org/2000/01/rdf-schema#range> <http://www.w3.org/2000/01/rdf-schema#Resource> .`,
    `${locatedPredicate} a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> ; <http://www.w3.org/2000/01/rdf-schema#range> ${typeDate} .`,
    ...Object.entries({ ...RECORD_STATUSES, Hidden: MUI_HIDDEN }).map(([name, uri]) => `${iri(uri)} a <http://www.w3.org/2000/01/rdf-schema#Resource> ; <http://www.w3.org/2000/01/rdf-schema#label> ${JSON.stringify(name)} .`),
    `${iri(`${MUI_NS}RecordStatusShape`)} a <http://www.w3.org/ns/shacl#NodeShape> ; <http://www.w3.org/ns/shacl#targetSubjectsOf> ${predicate} ; <http://www.w3.org/ns/shacl#property> ${iri(`${MUI_NS}RecordStatusPropertyShape`)} .`,
    `${iri(`${MUI_NS}RecordStatusPropertyShape`)} <http://www.w3.org/ns/shacl#path> ${predicate} ; <http://www.w3.org/ns/shacl#nodeKind> <http://www.w3.org/ns/shacl#IRI> .`,
  ];
  await updatePersonalSparql(`INSERT DATA { GRAPH ${g} { ${statements.join("\n")} } }`, 30000, request);
}

/** Atomic mutually exclusive read/unread transition. Stars are orthogonal. */
export async function updateRecordStatus(request: Request, queryHash: string, uri: string, status: RecordStatusName, enabled: boolean): Promise<void> {
  const subject = iri(uri), g = statusGraph(request), object = iri(RECORD_STATUSES[status]);
  if (status === "Seen" || status === "Unseen") {
    const desired = enabled ? status : (status === "Seen" ? "Unseen" : "Seen");
    const inverse = desired === "Seen" ? "Unseen" : "Seen";
    await updatePersonalSparql(`DELETE { GRAPH ${g} { ${subject} ${predicate} ${iri(RECORD_STATUSES[inverse])} } } INSERT { GRAPH ${g} { ${subject} ${predicate} ${iri(RECORD_STATUSES[desired])} } } WHERE { OPTIONAL { GRAPH ${g} { ${subject} ${predicate} ${iri(RECORD_STATUSES[inverse])} } } }`, 30000, request);
  } else {
    await updatePersonalSparql(enabled
      ? `INSERT DATA { GRAPH ${g} { ${subject} ${predicate} ${object} } }`
      : `DELETE DATA { GRAPH ${g} { ${subject} ${predicate} ${object} } }`, 30000, request);
  }
}

export async function updateHiddenRecord(request: Request, uri: string, hidden: boolean): Promise<void> {
  const g = statusGraph(request), subject = iri(uri);
  await updatePersonalSparql(hidden
    ? `INSERT DATA { GRAPH ${g} { ${subject} ${predicate} ${hiddenObject} } }`
    : `DELETE DATA { GRAPH ${g} { ${subject} ${predicate} ${hiddenObject} } }`, 30000, request);
}

export async function listHiddenRecords(request: Request): Promise<string[]> {
  const response = await queryPersonalSparql(`SELECT DISTINCT ?s WHERE { GRAPH ${statusGraph(request)} { ?s ${predicate} ${hiddenObject} } FILTER(isIRI(?s)) } ORDER BY STR(?s) LIMIT 500`, 20000, request);
  return (response.results?.bindings ?? []).map((row) => row.s?.value ?? "").filter(Boolean);
}

export async function recordPageStatus(request: Request, queryHash: string, uris: string[]): Promise<{ statuses: Record<string, RecordStatusName[]>; hidden: string[] }> {
  const items = [...new Set(uris)].slice(0, 150);
  if (!items.length) return { statuses: {}, hidden: [] };
  const values = items.map(iri).join(" ");
  const g = statusGraph(request);
  const response = await queryPersonalSparql(`SELECT ?s ?status ?hidden WHERE { VALUES ?s { ${values} } OPTIONAL { GRAPH ${g} { ?s ${predicate} ?status } } OPTIONAL { GRAPH ${g} { ?s ${predicate} ${hiddenObject} } BIND(true AS ?hidden) } }`, 20000, request);
  const statuses: Record<string, RecordStatusName[]> = {}, hidden = new Set<string>();
  const reverse = Object.fromEntries(Object.entries(RECORD_STATUSES).map(([key, value]) => [value, key])) as Record<string, RecordStatusName>;
  for (const row of response.results?.bindings ?? []) {
    const uri = row.s?.value, name = reverse[row.status?.value ?? ""];
    if (!uri) continue;
    if (name) { const item = statuses[uri] ?? (statuses[uri] = []); if (!item.includes(name)) item.push(name); }
    if (row.hidden?.value === "true" || row.hidden?.value === "1") hidden.add(uri);
  }
  return { statuses, hidden: [...hidden] };
}

/** Every page of one query execution uses the SAME timestamp. Paging cannot change it.
 * The timestamp records the last execution observing an item, not a read transition.
 * A previously acknowledged entry never becomes Unseen merely because it reappeared.
 */
export async function recordLocatedPage(request: Request, queryHash: string, uris: string[], executionTime: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(executionTime) || !Number.isFinite(Date.parse(executionTime))) throw new Error("Invalid query execution timestamp.");
  const items = [...new Set(uris)].slice(0, 150);
  if (!items.length) return;
  const values = items.map(iri).join(" "), g = statusGraph(request), observation = observationGraph(request, queryHash);
  await ensureQueryHashGraphMetadata(request, queryHash);
  // Exclude SELECT-listed existing statuses; resources with only Stars remain Unseen.
  await updatePersonalSparql(`INSERT { GRAPH ${g} { ?s ${predicate} ${iri(RECORD_STATUSES.Unseen)} } } WHERE { VALUES ?s { ${values} } FILTER NOT EXISTS { GRAPH ${g} { ?s ${predicate} ${iri(RECORD_STATUSES.Seen)} } } FILTER NOT EXISTS { GRAPH ${g} { ?s ${predicate} ${iri(RECORD_STATUSES.Unseen)} } } }`, 30000, request);
  // A resource's lastLocatedAt is updated on an explicit new execution only.
  await updatePersonalSparql(`DELETE { GRAPH ${observation} { ?s ${locatedPredicate} ?old } } INSERT { GRAPH ${observation} { ?s ${locatedPredicate} "${executionTime}"^^${typeDate} } } WHERE { VALUES ?s { ${values} } OPTIONAL { GRAPH ${observation} { ?s ${locatedPredicate} ?old } } }`, 30000, request);
}

/** A SERVICE containing only graph patterns avoids Virtuoso's ODS permission
 * error on remote subqueries. Avoid an enclosing SELECT as well: Virtuoso's
 * optimizer can report SQ156 when that subquery is joined to a personal GRAPH
 * and wrapped in a COUNT or ASK. The enclosing ASK/COUNT/SELECT DISTINCT
 * performs the required projection and deduplication instead.
 *
 * The list-status view projects a simple focus variable AS ?c1. Rebinding
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
  if (!match) throw new Error("Cannot derive the federated focus projection from the list-status FCT view.");
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

/** Build the exact federated ASK used for Status facets without executing it.
 * The preview and the executable query share one construction path. */
export async function buildFederatedStatusAsk(request: Request, liveQueryXml: string, queryHash: string, legacyResultScope = false): Promise<{
  askQuery: string; base: string; service: string; statusSource: string; endpointUrl: string;
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
  if (!endpoint?.url || !/^https?:\/\//i.test(endpoint.url)) throw new Error("The query graph server is not registered for federated Status.");
  const personalEndpoint = personalSparqlUrl(request).toString();
  const personalAddress = `${getPersonalStatusGraph(request)}@${personalEndpoint}`;
  const escapedAddress = personalAddress.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const clone = cloneFctListStatusView(liveQueryXml);
  // Derive the preview ASK by changing the FCT view and adding a real Status
  // constraint. The translator owns SERVICE and GRAPH generation.
  const askXml = clone.replace('<view type="list-status"/>',
    `<status addr="${escapedAddress}"/><view type="ask"/>`);
  const askQuery = compileFctXmlToSparql(askXml, FCT_VIEW_TYPES.ASK, false, false, false, false, {
    liveEndpoint: endpoint.url, executionEndpoint: personalEndpoint,
    defaultStatusAddr: personalAddress,
  }).query;
  // The old Results action still needs extra FCT semantics for Hidden/Not
  // Hidden and same-focus status conjunction. Keep this legacy extraction
  // isolated to that action until those constraints are expressible in FCT.
  if (!legacyResultScope) return { askQuery, base: "", service: "", statusSource: "", endpointUrl: endpoint.url };
  const compiled = compileFctXmlToSparql(clone, FCT_VIEW_TYPES.LIST_STATUS);
  const prologue = compiled.query.match(/^(?:DEFINE [^\n]+\n)*/)?.[0] ?? "";
  const focusSelection = compiled.query.slice(prologue.length).trim();
  const base = `${prologue}PREFIX mui: <${MUI_NS}>\n`;
  const service = federatedFocusSource(focusSelection, endpoint.url, personalEndpoint);
  const statusSource = `GRAPH ${statusGraph(request)} { ?c1 ${predicate} ?status }`;
  return { askQuery, base, service, statusSource, endpointUrl: endpoint.url };
}

/** Counts come from the accumulated query-hash graph, never from just the
 * current page and never from a remote SERVICE join. A located resource with
 * no Seen assertion is New, regardless of whether Unseen was explicitly set. */
export async function queryFederatedStatusCounts(request: Request, _liveQueryXml: string, queryHash: string): Promise<{
  hasStatuses: boolean; counts: Record<RecordStatusName | "New" | "Hidden", number>; sparql: string;
}> {
  const g = statusGraph(request);
  const observation = observationGraph(request, queryHash);
  const h = g;
  const located = `GRAPH ${observation} { ?c1 ${locatedPredicate} ?located }`;
  const base = `PREFIX mui: <${MUI_NS}>\n`;
  const definitions = {
    New: `${located} FILTER NOT EXISTS { GRAPH ${g} { ?c1 ${predicate} ${iri(RECORD_STATUSES.Seen)} } }`,
    Seen: `${located} GRAPH ${g} { ?c1 ${predicate} ${iri(RECORD_STATUSES.Seen)} }`,
    Starred: `${located} GRAPH ${g} { ?c1 ${predicate} ${iri(RECORD_STATUSES.Starred)} }`,
    Hidden: `${located} GRAPH ${g} { ?c1 ${predicate} ${hiddenObject} }`,
  } as const;
  const query = (where: string) => `${base}SELECT (COUNT(DISTINCT ?c1) AS ?ct) WHERE { ${where} }`;
  const entries = await Promise.all(Object.entries(definitions).map(async ([name, where]) => {
    const response = await queryPersonalSparql(query(where), 30000, request);
    const value = Number(response.results?.bindings?.[0]?.ct?.value ?? NaN);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid personal ${name} count.`);
    return [name, value] as const;
  }));
  const counts: Record<RecordStatusName | "New" | "Hidden", number> = { New: 0, Unseen: 0, Seen: 0, Starred: 0, Hidden: 0 };
  for (const [name, value] of entries) counts[name as keyof typeof counts] = value;
  counts.Unseen = counts.New; // Legacy internal alias; only New is displayed.
  const sparql = query(definitions.New);
  return { hasStatuses: counts.New + counts.Seen + counts.Starred + counts.Hidden > 0, counts, sparql };
}

/** The paged Results view and facet counts share the same unpaginated FCT focus
 * selection. Status predicates are joined on the personal server before paging. */
export async function queryFederatedStatusResults(request: Request, liveQueryXml: string, queryHash: string,
  selected: string[], limit: number, offset: number): Promise<{ results: Array<{uri:string;title:string;matches: never[];termType:string}>; total: number; sparql: string; incomplete: boolean }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid Results pagination.");
  const valid = new Set(["New", "Unseen", "Seen", "Starred", "Hidden"]);
  if (selected.some((name) => !valid.has(name))) throw new Error("Unknown status filter.");
  // Use exactly the same FCT list-status compilation and SERVICE placement as
  // the previewed ASK and federated counts.
  const { base, service: source, endpointUrl } = await buildFederatedStatusAsk(request, liveQueryXml, queryHash, true);
  const g = statusGraph(request);
  const ordinary = selected.filter((name) => name !== "Hidden");
  const statusConstraints = ordinary.length
    ? `FILTER EXISTS { GRAPH ${g} { ?c1 ${predicate} ?selectedStatus } FILTER(?selectedStatus IN (${[...new Set(ordinary.map((name) => iri(RECORD_STATUSES[name === "New" ? "Unseen" : name as RecordStatusName])))].join(", ")})) }`
    : "";
  const hideConstraint = selected.includes("Hidden")
    ? `FILTER EXISTS { GRAPH ${g} { ?c1 ${predicate} ${hiddenObject} } }`
    : `FILTER NOT EXISTS { GRAPH ${g} { ?c1 ${predicate} ${hiddenObject} } }`;
  const where = `${source} FILTER(isIRI(?c1)) ${statusConstraints} ${hideConstraint}`;
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
      const labelPatterns = `?c1 <http://www.w3.org/2000/01/rdf-schema#label> ?label . FILTER(DATATYPE(?label) != <http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> || LANGMATCHES(LANG(?label), "en"))`;
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
