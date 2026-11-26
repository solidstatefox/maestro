"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { loadPersonalAuthSession, graphForPrefix, type PersonalAuthSession } from "@/lib/personal-auth";
import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { personalAuthenticatedFetch } from "@/lib/client-personal-request";
import { personalWriteEndpoint } from "@/lib/personal-endpoints";
import { RIBBON_DISCOVERY_DEFAULTS, ribbonDiscoveryLimit } from "@/lib/ribbon-discovery-limits";
import { BUILTIN_ANALYSIS_URIS } from "./builtin-analyses";
import type { DiscoveryResult } from "./app-lifecycle/view-discovery";
import { proxyDebugHeaders } from "@/lib/proxy-debug";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const MA = "gttp://ggg.maestro.ecosys/ns/analyze#";
const safeIri = (iri: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri) && iri.length <= 4096;

type Binding = { type?: string; value?: string };
type Row = Record<string, Binding>;
type DiscoveryGraphs = { shapes: string; ontology: string; status: string };
export function personalDiscoveryTarget(session: PersonalAuthSession) {
  const base = graphForPrefix(session.graphPrefix);
  const graphs = { shapes: `${resolveGraph(GRAPH.SHACL_POLICIES, base)}`, ontology: `${resolveGraph(GRAPH.ONTOLOGY_CACHE, base)}`, status: `${resolveGraph(GRAPH.STATUS, base)}` };
  return { graphs, addr: `${graphs.shapes}@${personalWriteEndpoint(session)}` };
}
const get = (row: Row, key: string) => row[key]?.value ?? "";

/** The approved /sparql transport returns ordinary W3C Results JSON, not a
 * special Analyze/View JSON shape. Ontology joins aren't currently expressible
 * by the FCT constraint grammar without changing their meaning. */
async function personalSelect(makeQuery: (graphs: DiscoveryGraphs) => string,
  signal?: AbortSignal): Promise<Row[]> {
  const session = await loadPersonalAuthSession();
  if (!session) throw new Error("Log in to discover personal providers.");
  const { graphs, addr } = personalDiscoveryTarget(session);
  const query = makeQuery(graphs);
  if (query.length > 100000) throw new Error("Provider discovery query is too long.");
  const response = await personalAuthenticatedFetch(session,"/proxy/api/sparql", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", ...proxyDebugHeaders("urn:maestro:component:view-discover", "view-perspective:provider-discovery") },
    body: JSON.stringify({ addr, query, personalRead: true }) }, maestroQueryFetch);
  // The retired separate discovery routes returned JSON.
  // Their replacement is a W3C SPARQL Results SELECT through /proxy/api/sparql.
  // Never silently treat a Next.js HTML error page as zero discovered providers.
  const contentType = response.headers.get("content-type") ?? "unknown content type";
  const body = await response.text();
  let result: { error?: string; incomplete?: boolean; results?: { bindings?: Row[] } };
  try {
    result = JSON.parse(body) as typeof result;
  } catch (error) {
    const kind = /\bhtml\b/i.test(contentType) || /^\s*<!doctype\s+html/i.test(body)
      ? "an HTML error page" : "non-JSON content";
    throw new Error(`Personal provider discovery received ${kind} from /proxy/api/sparql (HTTP ${response.status} ${response.statusText}, ${contentType}): ${describeUpstreamError(error)}; upstream: ${sanitizeUpstreamDiagnostic(body)}`, { cause: error });
  }
  if (!response.ok || result.error) throw new Error(result.error || `SPARQL discovery failed (HTTP ${response.status}).`);
  if (result.incomplete || response.headers.get("X-Maestro-Incomplete") === "true") throw new Error("Personal provider discovery returned an incomplete result.");
  if (!Array.isArray(result.results?.bindings)) throw new Error("Personal provider discovery returned no W3C SPARQL Results bindings.");
  return result.results.bindings;
}

/** Shared by discovery and the Browse Code Block; this function performs no I/O. */
export function buildAnalysisDiscoverySparql(graphs: DiscoveryGraphs, classes: string[], queryProviders: string[] = [], limit:number=RIBBON_DISCOVERY_DEFAULTS.analysis): string {
  const requested = classes.filter(safeIri).slice(0, 60);
  const queryTargets = [...new Set(queryProviders.filter(safeIri))].slice(0,100);
  const { shapes, ontology } = graphs;
  const classConstraint = requested.length ? requested.map(uri =>
    `(?target = <${uri}> || EXISTS { GRAPH <${ontology}> { <${uri}> <${RDFS}subClassOf>+ ?target } })`).join(" || ") : "false";
  // A provider can match EITHER the FCT result population (legacy class
  // target) OR the validated structured RDF of the current History query.
  const queryConstraint = queryTargets.length ? `?uri IN (${queryTargets.map(uri=>`<${uri}>`).join(",")})` : "false";
  return `PREFIX ma: <${MA}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
      SELECT ?uri ?label ?icon ?stylesheet ?order ?pageValidationShape WHERE {
        GRAPH <${shapes}> {
          ?uri a ma:Analysis, <${MUI}Provider> ; rdfs:label ?label ; ma:lucideIcon ?icon ; ma:stylesheet/rdf:value ?stylesheet .
          OPTIONAL { ?uri ma:order ?order }
          OPTIONAL { ?uri ma:pageValidationShape ?pageValidationShape }
          OPTIONAL { ?uri <${MUI}accepts> / (<${SH}class>|<${SH}targetClass>) ?target }
          FILTER((BOUND(?target) && (${classConstraint})) || (${queryConstraint}))
        }
      } ORDER BY ?order ?label LIMIT ${ribbonDiscoveryLimit("analysis",limit)}`;
}

export type AnalysisProvider = {uri: string; label: string; icon: string; stylesheet: string; order: number; pageValidationShape?: string};
/** Preserve the original cross-graph subclass acceptance test in one SELECT. */
export async function discoverAnalyses(classes: string[], signal?: AbortSignal, queryProviders: string[] = [], limit:number=RIBBON_DISCOVERY_DEFAULTS.analysis): Promise<DiscoveryResult<AnalysisProvider>> {
  const boundedLimit=ribbonDiscoveryLimit("analysis",limit);
  const rows = await personalSelect(graphs => buildAnalysisDiscoverySparql(graphs, classes, queryProviders,boundedLimit), signal);
  if(rows.length>=boundedLimit)throw new Error("Analysis discovery reached its Sheet LIMIT; eligibility may be incomplete.");
  const definitions = rows.map(row => ({uri:get(row,"uri"),label:get(row,"label"),icon:get(row,"icon"),
    stylesheet:get(row,"stylesheet"),order:Number(get(row,"order") || 100),pageValidationShape:get(row,"pageValidationShape") || undefined}))
    .filter(row => safeIri(row.uri) && !BUILTIN_ANALYSIS_URIS.has(row.uri) && row.stylesheet && Number.isFinite(row.order) && (!row.pageValidationShape || safeIri(row.pageValidationShape)));
  // Conflicting RDF definitions must not silently select an arbitrary stylesheet.
  const byUri = new Map<string, AnalysisProvider>();
  const conflicts = new Set<string>();
  for (const definition of definitions) {
    const previous = byUri.get(definition.uri);
    if (previous && JSON.stringify(previous) !== JSON.stringify(definition)) conflicts.add(definition.uri);
    else byUri.set(definition.uri, definition);
  }
  for (const uri of conflicts) byUri.delete(uri);
  const warnings = [...conflicts].map(uri => `Conflicting Analysis definitions: ${uri}`);
  const eligible: AnalysisProvider[] = [];
  const {readClientPolicyApprovals}=await import("@/lib/client-policy-approvals");
  const candidates = [...byUri.values()];
  // Batch, but retain successfully verified independent batches. No provider
  // whose approval could not be read becomes eligible. Never persist grants.
  for (let offset = 0; offset < candidates.length; offset += 20) {
    signal?.throwIfAborted();
    const batch = candidates.slice(offset, offset + 20);
    try {
      const decisions = await readClientPolicyApprovals(batch.map(row => row.uri), signal, "urn:maestro:component:view-discover");
      const approved = new Set(decisions.filter(row => row.status === "Approved").map(row => row.uri));
      eligible.push(...batch.filter(row => approved.has(row.uri)));
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push(`Approval could not be verified for ${batch.map(row => row.label || row.uri).join(", ")}: ${describeUpstreamError(error)}`);
    }
  }
  return {items: eligible, warnings};
}

/** The exact candidate SELECT dispatched by discoverViews (eligibility is client-side). */
export function buildViewDiscoverySparql({ shapes }: DiscoveryGraphs,limit:number=RIBBON_DISCOVERY_DEFAULTS.perspectives): string {
  return `PREFIX sh: <${SH}> PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
SELECT ?provider ?matchedClass ?targetClass ?label ?icon ?template ?stylesheet ?shapeUri ?runtimePredicate ?queryStylesheet ?resultStylesheet ?paletteStylesheet ?endpointDiscoveryQuery WHERE {
  GRAPH <${shapes}> {
    ?provider a mui:Provider ; mui:widget ?template ; mui:accepts ?shapeUri .
    ?template a mui:PerspectiveWidget ; (rdf:value|mui:templateContent) ?stylesheet .
    OPTIONAL { ?shapeUri sh:class ?matchedClass }
    OPTIONAL { ?shapeUri sh:targetClass ?targetClass }
    OPTIONAL { ?shapeUri sh:or ?conditions . ?conditions (rdf:rest*/rdf:first) ?choice . ?choice sh:property/sh:path ?runtimePredicate }
    OPTIONAL { ?shapeUri mui:endpointDiscoveryQuery ?recipe . ?recipe rdf:value ?endpointDiscoveryQuery }
    OPTIONAL { ?provider rdfs:label ?label FILTER(LANG(?label) = "" || LANGMATCHES(LANG(?label), "en")) }
    OPTIONAL { ?provider mui:icon ?icon }
    OPTIONAL { ?provider mui:queryTemplate ?qTemplate . ?qTemplate (rdf:value|mui:templateContent) ?queryStylesheet }
    OPTIONAL { ?provider mui:resultTemplate ?rTemplate . ?rTemplate (rdf:value|mui:templateContent) ?resultStylesheet }
    OPTIONAL { ?provider mui:paletteTemplate ?pTemplate . ?pTemplate (rdf:value|mui:templateContent) ?paletteStylesheet }
    FILTER(CONTAINS(STR(?stylesheet), 'xsl:stylesheet') || CONTAINS(STR(?stylesheet), 'xsl:transform'))
  }
} ORDER BY ?provider ?template ?shapeUri LIMIT ${ribbonDiscoveryLimit("perspectives",limit)}`;
}

export type DiscoveredViewProvider = {uri: string; label: string; icon?: string; template: string; matchedClass: string; stylesheet: string;
  shapeUri?: string; queryStylesheet?: string; resultStylesheet?: string; paletteStylesheet?: string; endpointDiscoveryQueries?: string[]};
/** A Perspective is an effectively approved provider whose declared SHACL
 * input applies to the active FCT population (or whose contextual query shape
 * has already matched). SHACL shapes are not independent approval subjects.
 * The caller supplies actual population classes, not just syntactic FCT class
 * constraints, so a query of EntryPoint resources remains eligible without a
 * hand-authored <class> filter. */
export async function discoverViews(classes: string[], signal?: AbortSignal, queryProviders: string[] = [], queryXml?: string,limit:number=RIBBON_DISCOVERY_DEFAULTS.perspectives): Promise<DiscoveredViewProvider[]> {
  const requested = [...new Set(classes.filter(safeIri))].slice(0, 70);
  const contextual = [...new Set(queryProviders.filter(safeIri))].slice(0, 100);
  // Fetch the actual input declarations with their widget. Do not join a
  // VALUES-constrained projected variable across UNION/OPTIONAL on Virtuoso.
  // Each declaration is tested against the current population in the browser.
  const boundedLimit=ribbonDiscoveryLimit("perspectives",limit);
  const rows = await personalSelect(graphs=>buildViewDiscoverySparql(graphs,boundedLimit), signal);
  if (rows.length >= boundedLimit) throw new Error("Perspective discovery exceeded its bounded result size; eligibility is incomplete.");
  const byProvider = new Map<string, DiscoveredViewProvider>();
  for (const row of rows) {
    const uri = get(row, "provider"), template = get(row, "template"), stylesheet = get(row, "stylesheet");
    if (!safeIri(uri) || !safeIri(template) || !stylesheet || stylesheet.length > 250000) continue;
    const declaredClass = get(row, "matchedClass"), targetClass = get(row, "targetClass");
    // A sh:class constraint is not overridden by a different targetClass.
    const matchedClass = declaredClass || targetClass;
    const queryStylesheet = get(row, "queryStylesheet"), resultStylesheet = get(row, "resultStylesheet");
    // Reject rows whose claimed eligibility is not in the requested scope.
    if (!requested.includes(matchedClass) && !contextual.includes(uri) && !(queryStylesheet && resultStylesheet && get(row,"runtimePredicate"))) continue;
    const recipe = requested.includes(matchedClass) ? get(row, "endpointDiscoveryQuery") : "";
    const previous = byProvider.get(uri);
    // Ambiguous executable content for the same widget is a corrupt registry,
    // not a reason to choose an arbitrary row.
    if(previous?.template===template && previous.stylesheet!==stylesheet)throw new Error(`Conflicting Perspective stylesheet definitions for ${template}.`);
    if (!previous || (!requested.includes(previous.matchedClass) && requested.includes(matchedClass))) byProvider.set(uri, {
      uri, matchedClass, label: get(row, "label") || uri, icon: get(row, "icon") || undefined,
      template, stylesheet, shapeUri: get(row, "shapeUri"),
      queryStylesheet: get(row, "queryStylesheet"), resultStylesheet: get(row, "resultStylesheet"),
      paletteStylesheet: get(row, "paletteStylesheet"), endpointDiscoveryQueries: previous?.endpointDiscoveryQueries ?? [],
    });
    const recipes = byProvider.get(uri)!.endpointDiscoveryQueries!;
    if (recipe && recipe.length <= 10000 && recipes.length < 8 && !recipes.includes(recipe)) recipes.push(recipe);
  }
  if (!byProvider.size) return [];
  const { readClientPolicyApprovals } = await import("@/lib/client-policy-approvals");
  const decisions = await readClientPolicyApprovals([...byProvider.keys()], signal, "urn:maestro:component:view-discover");
  const approved = new Set(decisions.filter(decision => decision.status === "Approved").map(decision => decision.uri));
  const widgets = new Map<string, DiscoveredViewProvider>();
  const implementations = new Set<string>();
  for (const view of byProvider.values()) {
    signal?.throwIfAborted();
    if (!approved.has(view.uri)) continue;
    if (view.queryStylesheet && view.resultStylesheet) {
      // This is generic provider applicability, not a Map-specific rule.
      // Never expose a runtime solely because it declared a SHACL path.
      if (!queryXml || !view.shapeUri) continue;
      const { probeProviderPopulation } = await import("@/lib/provider-population-probe");
      if (!await probeProviderPopulation(queryXml, view.shapeUri, view.queryStylesheet, view.uri, signal)) continue;
    }
    const key = view.template;
    const implementation = JSON.stringify([view.stylesheet, view.queryStylesheet, view.resultStylesheet, view.paletteStylesheet]);
    if (!widgets.has(key) && !implementations.has(implementation)) {
      widgets.set(key, view);
      implementations.add(implementation);
    }
  }
  return [...widgets.values()];
}
