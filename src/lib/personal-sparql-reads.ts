"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { loadPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";
import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { personalAuthenticatedFetch } from "@/lib/client-personal-request";
import { personalWriteEndpoint } from "@/lib/personal-endpoints";
import { proxyDebugHeaders } from "@/lib/proxy-debug";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const MA = "gttp://ggg.maestro.ecosys/ns/analyze#";
const safeIri = (iri: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri) && iri.length <= 4096;

type Binding = { type?: string; value?: string };
type Row = Record<string, Binding>;
const get = (row: Row, key: string) => row[key]?.value ?? "";

/** The approved /sparql transport returns ordinary W3C Results JSON, not a
 * special Analyze/View JSON shape. Ontology joins aren't currently expressible
 * by the FCT constraint grammar without changing their meaning. */
async function personalSelect(makeQuery: (graphs: { shapes: string; ontology: string; status: string }) => string,
  signal?: AbortSignal): Promise<Row[]> {
  const session = await loadPersonalAuthSession();
  if (!session) throw new Error("Log in to discover personal providers.");
  const base = graphForPrefix(session.graphPrefix);
  const graphs = { shapes: `${resolveGraph(GRAPH.SHACL_POLICIES, base)}`, ontology: `${resolveGraph(GRAPH.ONTOLOGY_CACHE, base)}`, status: `${resolveGraph(GRAPH.STATUS, base)}` };
  const query = makeQuery(graphs);
  if (query.length > 100000) throw new Error("Provider discovery query is too long.");
  const response = await personalAuthenticatedFetch(session,"/proxy/api/sparql", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", ...proxyDebugHeaders("urn:maestro:component:view-discover", "view-perspective:provider-discovery") },
    body: JSON.stringify({ addr: `${graphs.shapes}@${personalWriteEndpoint(session)}`, query, personalRead: true }) }, maestroQueryFetch);
  // The retired separate discovery routes returned JSON.
  // Their replacement is a W3C SPARQL Results SELECT through /proxy/api/sparql.
  // Never silently treat a Next.js HTML error page as zero discovered providers.
  const contentType = response.headers.get("content-type") ?? "unknown content type";
  const body = await response.text();
  let result: { error?: string; results?: { bindings?: Row[] } };
  try {
    result = JSON.parse(body) as typeof result;
  } catch (error) {
    const kind = /\bhtml\b/i.test(contentType) || /^\s*<!doctype\s+html/i.test(body)
      ? "an HTML error page" : "non-JSON content";
    throw new Error(`Personal provider discovery received ${kind} from /proxy/api/sparql (HTTP ${response.status} ${response.statusText}, ${contentType}): ${describeUpstreamError(error)}; upstream: ${sanitizeUpstreamDiagnostic(body)}`, { cause: error });
  }
  if (!response.ok || result.error) throw new Error(result.error || `SPARQL discovery failed (HTTP ${response.status}).`);
  if (!Array.isArray(result.results?.bindings)) throw new Error("Personal provider discovery returned no W3C SPARQL Results bindings.");
  return result.results.bindings;
}

export type AnalysisProvider = {uri: string; label: string; icon: string; stylesheet: string; order: number};
/** Preserve the original cross-graph subclass acceptance test in one SELECT. */
export async function discoverAnalyses(classes: string[], signal?: AbortSignal, queryProviders: string[] = []): Promise<AnalysisProvider[]> {
  const requested = classes.filter(safeIri).slice(0, 60);
  const queryTargets = [...new Set(queryProviders.filter(safeIri))].slice(0,100);
  const rows = await personalSelect(({shapes, ontology}) => {
    const classConstraint = requested.length ? requested.map(uri =>
      `(?target = <${uri}> || EXISTS { GRAPH <${ontology}> { <${uri}> <${RDFS}subClassOf>+ ?target } })`).join(" || ") : "false";
    // A provider can match EITHER the FCT result population (legacy class
    // target) OR the validated structured RDF of the current History query.
    const queryConstraint = queryTargets.length ? `?uri IN (${queryTargets.map(uri=>`<${uri}>`).join(",")})` : "false";
    return `PREFIX ma: <${MA}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
      SELECT ?uri ?label ?icon ?stylesheet ?order WHERE {
        GRAPH <${shapes}> {
          ?uri a ma:Analysis ; rdfs:label ?label ; ma:lucideIcon ?icon ; ma:stylesheet/rdf:value ?stylesheet .
          OPTIONAL { ?uri ma:order ?order }
          OPTIONAL { ?uri <${MUI}accepts> / <${SH}class> ?target }
          FILTER((BOUND(?target) && (${classConstraint})) || (${queryConstraint}) ||
            (!BOUND(?target) && NOT EXISTS { ?uri <${MUI}accepts> ?queryShape . ?queryShape <${SH}class> <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#query> }))
        }
      } ORDER BY ?order ?label LIMIT 50`;
  }, signal);
  return rows.map(row => ({uri:get(row,"uri"),label:get(row,"label"),icon:get(row,"icon"),
    stylesheet:get(row,"stylesheet"),order:Number(get(row,"order") || 100)}))
    .filter(row => row.uri && row.stylesheet && Number.isFinite(row.order));
}

export type DiscoveredViewProvider = {uri: string; label: string; icon?: string; template: string; matchedClass: string; stylesheet: string;
  shapeUri?: string; queryStylesheet?: string; resultStylesheet?: string; paletteStylesheet?: string};
/** A Perspective is an effectively approved provider whose declared SHACL
 * input applies to the active FCT population (or whose contextual query shape
 * has already matched). SHACL shapes are not independent approval subjects.
 * The caller supplies actual population classes, not just syntactic FCT class
 * constraints, so a query of EntryPoint resources remains eligible without a
 * hand-authored <class> filter. */
export async function discoverViews(classes: string[], signal?: AbortSignal, queryProviders: string[] = []): Promise<DiscoveredViewProvider[]> {
  const requested = [...new Set(classes.filter(safeIri))].slice(0, 70);
  const contextual = [...new Set(queryProviders.filter(safeIri))].slice(0, 100);
  // Shape-authored providers may describe their input by sh:or/sh:property
  // without a targetClass; discovery is generic and not tied to any domain.
  // Do not gate all providers solely on class availability.
  // Keep provider/widget/shape bindings in one basic graph pattern. Match
  // eligibility with correlated filters, not independent UNION branches
  // which can expose unrelated providers on Virtuoso.
  const classMatch = requested.length ? `EXISTS {
    ?inputShape (sh:class|sh:targetClass) ?matchedClass .
    VALUES ?matchedClass { ${requested.map(iri => `<${iri}>`).join(" ")} }
  }` : "false";
  const contextualMatch = contextual.length ? `?provider IN (${contextual.map(iri => `<${iri}>`).join(", ")})` : "false";
  // Shape-driven query/result runtimes validate their own property evidence.
  // Do not offer ordinary class-only widgets based on someone else's sh:or.
  const runtimeMatch = `EXISTS {
    ?provider mui:queryTemplate ?queryTemplate ; mui:resultTemplate ?resultTemplate .
    ?inputShape sh:or ?conditions .
    ?conditions (rdf:rest*/rdf:first) ?choice .
    ?choice sh:property/sh:path ?predicate .
  }`;
  const matchedClassProjection = requested.length ? `OPTIONAL {
    ?inputShape (sh:class|sh:targetClass) ?matchedClass .
    FILTER(?matchedClass IN (${requested.map(iri => `<${iri}>`).join(", ")}))
  }` : "";
  const rows = await personalSelect(({ shapes }) => `PREFIX sh: <${SH}> PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
SELECT DISTINCT ?provider ?matchedClass ?label ?icon ?template ?stylesheet ?shapeUri ?queryStylesheet ?resultStylesheet ?paletteStylesheet WHERE {
  GRAPH <${shapes}> {
    ?provider a mui:Provider ; mui:widget ?template ; mui:accepts ?inputShape .
    ?template a mui:PerspectiveWidget ; (rdf:value|mui:templateContent) ?stylesheet .
    OPTIONAL { ?provider rdfs:label ?label FILTER(LANG(?label) = "" || LANGMATCHES(LANG(?label), "en")) }
    OPTIONAL { ?provider mui:icon ?icon }
    BIND(?inputShape AS ?shapeUri)
    OPTIONAL { ?provider mui:queryTemplate ?qTemplate . ?qTemplate (rdf:value|mui:templateContent) ?queryStylesheet }
    OPTIONAL { ?provider mui:resultTemplate ?rTemplate . ?rTemplate (rdf:value|mui:templateContent) ?resultStylesheet }
    OPTIONAL { ?provider mui:paletteTemplate ?pTemplate . ?pTemplate (rdf:value|mui:templateContent) ?paletteStylesheet }
    FILTER((${classMatch}) || (${contextualMatch}) || (${runtimeMatch}))
    ${matchedClassProjection}
    FILTER(CONTAINS(STR(?stylesheet), 'xsl:stylesheet') || CONTAINS(STR(?stylesheet), 'xsl:transform'))
  }
} ORDER BY ?provider ?template ?shapeUri LIMIT 1000`, signal);
  const byProvider = new Map<string, DiscoveredViewProvider>();
  for (const row of rows) {
    const uri = get(row, "provider"), template = get(row, "template"), stylesheet = get(row, "stylesheet");
    if (!safeIri(uri) || !safeIri(template) || !stylesheet || stylesheet.length > 250000) continue;
    const matchedClass = get(row, "matchedClass");
    const queryStylesheet = get(row, "queryStylesheet"), resultStylesheet = get(row, "resultStylesheet");
    // Reject rows whose claimed eligibility is not in the requested scope.
    if (!requested.includes(matchedClass) && !contextual.includes(uri) && !(queryStylesheet && resultStylesheet)) continue;
    if (!byProvider.has(uri)) byProvider.set(uri, {
      uri, matchedClass: get(row, "matchedClass"), label: get(row, "label") || uri, icon: get(row, "icon") || undefined,
      template, stylesheet, shapeUri: get(row, "shapeUri"),
      queryStylesheet: get(row, "queryStylesheet"), resultStylesheet: get(row, "resultStylesheet"),
      paletteStylesheet: get(row, "paletteStylesheet"),
    });
  }
  if (!byProvider.size) return [];
  const { readClientPolicyApprovals } = await import("@/lib/client-policy-approvals");
  const decisions = await readClientPolicyApprovals([...byProvider.keys()], signal, "urn:maestro:component:view-discover");
  const approved = new Set(decisions.filter(decision => decision.status === "Approved").map(decision => decision.uri));
  const widgets = new Map<string, DiscoveredViewProvider>();
  const implementations = new Set<string>();
  for (const view of byProvider.values()) {
    if (!approved.has(view.uri)) continue;
    const key = view.template;
    const implementation = JSON.stringify([view.stylesheet, view.queryStylesheet, view.resultStylesheet, view.paletteStylesheet]);
    if (!widgets.has(key) && !implementations.has(implementation)) {
      widgets.set(key, view);
      implementations.add(implementation);
    }
  }
  return [...widgets.values()];
}
