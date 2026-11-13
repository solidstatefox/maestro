import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";
import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { isApprovedPolicy, readPolicyApprovals, discoverPolicyApprovals, verifyApprovalBookmark } from "@/lib/policy-approval-store";
import { getHistoryGraph, getShapesGraph, getOntologyGraph, queryPersonalSparql, waitForPersonalGraphSeed, fctAddrFromXml, getConfiguredFctEndpoints, resolveFctEndpointFromAddr } from "@/lib/personal-sparql";
import { unscopedGraph, ALL_GRAPHS } from "@/lib/graph-address-mode";

const safeIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
type Binding = Record<string, { value?: string }>;
const get = (row: Binding, key: string) => row[key]?.value ?? "";

/** Check the actual selected Record, not an arbitrary resource selected in Results.
 * The VALUES pairs are the SHACL provider acceptance classes. A provider is
 * discovered only if its condition is true for this Record; opening a ribbon
 * or the entire Features library must never rewrite requester provenance.
 */
async function matchedPerspectiveProviders(queryXml: string, record: string, candidates: {uri: string; target: string}[], request: Request): Promise<Set<string>> {
  if (!safeIri(record) || !candidates.length) return new Set();
  const address = fctAddrFromXml(queryXml);
  const split = address.indexOf("@");
  if (split < 0) return new Set();
  const endpoint = resolveFctEndpointFromAddr(await getConfiguredFctEndpoints(request), address);
  if (!endpoint) return new Set();
  const graph = unscopedGraph(address.slice(0, split));
  if (graph && graph !== ALL_GRAPHS && !safeIri(graph)) return new Set();
  const pairs = [...new Set(candidates.filter(item => safeIri(item.uri) && safeIri(item.target))
    .map(item => `(<${item.uri}> <${item.target}>)`))];
  if (!pairs.length) return new Set();
  const typePattern = `<${record}> a ?recordClass .`;
  const scopedPattern = graph && graph !== ALL_GRAPHS ? `GRAPH <${graph}> { ${typePattern} }` : typePattern;
  const sparql = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT DISTINCT ?provider WHERE { VALUES (?provider ?target) { ${pairs.join(" ")} }
      ${scopedPattern}
      FILTER(?recordClass = ?target || EXISTS { ?recordClass rdfs:subClassOf+ ?target }) }`;
  try {
    const response = await fetch(endpoint.url, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" },
      body: new URLSearchParams({ query: sparql }).toString() });
    if (!response.ok) return new Set();
    const data = await response.json() as { results?: { bindings?: {provider?: {value?: string}}[] } };
    return new Set((data.results?.bindings ?? []).map(row => row.provider?.value ?? "").filter(Boolean));
  } catch { return new Set(); }
}

/** Discover perspective implementations from the personal SHACL graph, never a hardcoded UI registry. */
export async function POST(request: Request) {
  const auth = requirePersonalLogin(request);
  if (auth) return auth;
  try {
    const body = await request.json() as { kind?: unknown; action?: unknown; classes?: unknown; providerUri?: unknown; queryXml?: unknown; trigger?: unknown; historyUri?: unknown };
    const queryClasses = Array.isArray(body.classes) ? body.classes.filter((iri): iri is string => typeof iri === "string" && safeIri(iri)).slice(0, 100) : [];
    const kind = body.kind === "bookmarks" || body.kind === "history" ? body.kind : "";
    const action = body.action === "list" || body.action === "approved" ? body.action : "discover";
    const providerUri = typeof body.providerUri === "string" && safeIri(body.providerUri) ? body.providerUri : "";
    await waitForPersonalGraphSeed(request);
    if (action === "approved") {
      if (!providerUri) return NextResponse.json({ error: "Provider IRI required" }, { status: 400 });
      return NextResponse.json({ approved: await isApprovedPolicy(providerUri, request) }, { headers: { "Cache-Control": "no-store" } });
    }
    const shapesGraph = getShapesGraph(request);
    const ontologyGraph = getOntologyGraph(request);
    // A provider matches any <class> in the live FCT query, including subclasses
    // found through the user's ontology graph. The query must explicitly contain
    // a class: collection membership alone does not reveal perspective buttons.
    const classMatch = action === "discover" ? (queryClasses.length
      ? `?provider mui:accepts ?input . ?input <http://www.w3.org/ns/shacl#class> ?target .
         VALUES ?queryClass { ${queryClasses.map(iri => `<${iri}>`).join(" ")} }
         FILTER(?queryClass = ?target || EXISTS { GRAPH <${ontologyGraph}> {
           ?queryClass <http://www.w3.org/2000/01/rdf-schema#subClassOf>+ ?target .
         } })`
      : "FILTER(false)") : "";
    const query = `PREFIX mui: <gttp://ggg.maestro.ecosys/ns/ui#> PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?provider ?kind ?label ?template ?stylesheet ?target WHERE { GRAPH <${shapesGraph}> {
        ?provider a mui:Provider ; mui:perspectiveKind ?kind ; mui:widget ?template .
        ?template a mui:PerspectiveWidget ; (mui:templateContent|rdf:value) ?stylesheet .
        OPTIONAL { ?provider rdfs:label ?label }
        ${classMatch}
        ${providerUri ? `FILTER(?provider = <${providerUri}>)` : ""}
        ${kind ? `FILTER(STR(?kind) = ${JSON.stringify(kind)})` : ""}
      } } ORDER BY ?label LIMIT 20`;
    const definitions = (await queryPersonalSparql(query, 20000, request)).results?.bindings?.map((r: Binding) => ({
      uri: get(r,"provider"), kind: get(r,"kind"), label: get(r,"label") || get(r,"kind"), template: get(r,"template"), stylesheet: get(r,"stylesheet"), target: get(r,"target"),
    })).filter(v => (v.kind === "bookmarks" || v.kind === "history") && v.stylesheet.length > 0 && v.stylesheet.length <= 250000) ?? [];
    if (action === "discover") {
      if (definitions.length && typeof body.queryXml === "string" &&
          typeof body.trigger === "string" && safeIri(body.trigger) &&
          await verifyApprovalBookmark(body.queryXml, request)) {
        const matched = await matchedPerspectiveProviders(body.queryXml, body.trigger, definitions, request);
        if (matched.size) await discoverPolicyApprovals([...matched], {
          component: UI_COMPONENT.perspectiveRibbon,
          queryXml: body.queryXml,
          record: body.trigger,
          history: typeof body.historyUri === "string" && safeIri(body.historyUri) ? body.historyUri : undefined,
        }, request);
      }
      // The selected Record must satisfy the provider's class acceptance.
      // Discovery alone never grants execution permission. The ribbon exposes only Approved
      // providers so selecting a Pending provider cannot bypass consent.
      const statuses = await readPolicyApprovals(definitions.map(definition => definition.uri), request);
      const approved = new Set(statuses.filter(entry => entry.status === "Approved").map(entry => entry.uri));
      return NextResponse.json({ providers: definitions.filter(definition => approved.has(definition.uri)).map(({ uri, kind, label, template }) => ({ uri, kind, label, template })) }, { headers: { "Cache-Control": "no-store" } });
    }
    const provider = definitions.find(v => v.kind === kind);
    if (!provider) return NextResponse.json({ error: "No SHACL provider registered for this perspective." }, { status: 404 });
    if (!(await isApprovedPolicy(provider.uri, request)))
      return NextResponse.json({ error: "This provider is Pending approval and may not execute." }, { status: 403 });
    const base = getHistoryGraph(request).split("#",1)[0];
    if (!safeIri(base)) throw new Error("Invalid personal graph address.");
    const historyGraph = `<${base}#history>`, bookmarkGraph = `<${base}#bookmarks>`;
    // Read only the user's collection graph; never enumerate arbitrary named graphs.
    const listQuery = kind === "bookmarks" ? `
PREFIX b: <http://www.w3.org/2002/01/bookmark#> PREFIX dcterms: <http://purl.org/dc/terms/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX schema: <https://schema.org/> PREFIX vfct: <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#>
SELECT ?entry ?label ?created ?description ?url ?queryXML ?tag ?tagPredicate ?lastResultCount ?lastNewCount WHERE { GRAPH ${bookmarkGraph} {
 ?entry a b:Bookmark . OPTIONAL { ?entry dcterms:title ?title } OPTIONAL { ?entry rdfs:label ?rlabel }
 BIND(COALESCE(?title,?rlabel,STR(?entry)) AS ?label)
 OPTIONAL { ?entry dcterms:created ?created } OPTIONAL { ?entry dcterms:description ?description }
 OPTIONAL { ?entry schema:url ?url } OPTIONAL { ?entry vfct:historyQueryXML ?queryXML }
 OPTIONAL { ?entry ?tagPredicate ?tag . VALUES ?tagPredicate { <http://www.w3.org/2004/02/skos/core#prefLabel> <http://purl.org/dc/terms/subject> <http://rdfs.org/scot/ns#has_tag> } }
 OPTIONAL { ?entry <gttp://ggg.maestro.ecosys/ns/ui#lastResultCount> ?lastResultCount }
 OPTIONAL { ?entry <gttp://ggg.maestro.ecosys/ns/ui#lastNewCount> ?lastNewCount }
} } ORDER BY DESC(?created) LIMIT 500` : `
PREFIX vfct: <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#> PREFIX dcterms: <http://purl.org/dc/terms/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?entry ?label ?created ?url ?queryXML ?lastResultCount ?lastNewCount WHERE { GRAPH ${historyGraph} {
 ?entry a vfct:QueryHistoryVisit ; vfct:historyCreated ?created .
 OPTIONAL { ?entry dcterms:title ?title } OPTIONAL { ?entry rdfs:label ?rlabel }
 BIND(COALESCE(?title,?rlabel,STR(?entry)) AS ?label)
 OPTIONAL { ?entry vfct:historyStateUrl ?url } OPTIONAL { ?entry vfct:historyQueryXML ?queryXML }
 OPTIONAL { ?entry <gttp://ggg.maestro.ecosys/ns/ui#lastResultCount> ?lastResultCount }
 OPTIONAL { ?entry <gttp://ggg.maestro.ecosys/ns/ui#lastNewCount> ?lastNewCount }
} } ORDER BY DESC(?created) LIMIT 500`;
    type PerspectiveRow = { uri: string; label: string; created: string; description: string;
      url: string; queryXml: string; tags: string[]; tagPredicates: string[];
      lastResultCount: number | null; lastNewCount: number | null };
    const byUri = new Map<string, PerspectiveRow>();
    const numberOrNull = (value: string) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
    for (const r of (await queryPersonalSparql(listQuery, 30000, request)).results?.bindings ?? []) {
      const uri = get(r, "entry");
      if (!safeIri(uri)) continue;
      let item = byUri.get(uri);
      if (!item) {
        item = { uri, label: get(r,"label"), created: get(r,"created"),
          description: get(r,"description"), url: get(r,"url"), queryXml: get(r,"queryXML"),
          tags: [], tagPredicates: [], lastResultCount: numberOrNull(get(r,"lastResultCount")),
          lastNewCount: numberOrNull(get(r,"lastNewCount")) };
        byUri.set(uri, item);
      }
      const tag = get(r, "tag");
      const predicate = get(r, "tagPredicate");
      if (tag && !item.tags.includes(tag)) item.tags.push(tag);
      if (predicate && !item.tagPredicates.includes(predicate)) item.tagPredicates.push(predicate);
    }
    return NextResponse.json({ provider, rows: [...byUri.values()] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Perspective request failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
