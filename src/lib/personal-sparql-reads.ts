"use client";

import { loadPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";

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
  const graphs = { shapes: `${base}/shacl/policies`, ontology: `${base}/ontology-cache`, status: `${base}/status` };
  const query = makeQuery(graphs);
  if (query.length > 100000) throw new Error("Provider discovery query is too long.");
  const response = await fetch("/proxy/api/sparql", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addr: `${graphs.shapes}@${session.graphStore}`, query }) });
  // The retired separate discovery routes returned JSON.
  // Their replacement is a W3C SPARQL Results SELECT through /proxy/api/sparql.
  // Never silently treat a Next.js HTML error page as zero discovered providers.
  const contentType = response.headers.get("content-type") ?? "unknown content type";
  const body = await response.text();
  let result: { error?: string; results?: { bindings?: Row[] } };
  try {
    result = JSON.parse(body) as typeof result;
  } catch {
    const kind = /\bhtml\b/i.test(contentType) || /^\s*<!doctype\s+html/i.test(body)
      ? "an HTML error page" : "non-JSON content";
    throw new Error(`Personal provider discovery received ${kind} from /proxy/api/sparql (HTTP ${response.status}, ${contentType}).`);
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

export type DiscoveredViewProvider = {uri: string; label: string; icon?: string; template: string; matchedClass: string; stylesheet: string};
/** Preserve the existing SHACL class-join and dual Approved requirement. */
export async function discoverViews(classes: string[], signal?: AbortSignal, queryProviders: string[] = []): Promise<DiscoveredViewProvider[]> {
  const requested = [...new Set(classes.filter(safeIri))].slice(0, 50);
  const extra = [...new Set(queryProviders.filter(safeIri))].slice(0,100);
  if (!requested.length && !extra.length) return [];
  const rows = requested.length ? await personalSelect(({shapes, status}) => `PREFIX sh: <${SH}>
PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
SELECT DISTINCT ?policy ?class ?label ?template ?stylesheet WHERE {
  GRAPH <${shapes}> {
    VALUES ?class { ${requested.map(iri => `<${iri}>`).join(" ")} }
    ?policy sh:targetClass ?class ; mui:widget ?widgetClass .
    ?provider a mui:Provider ; mui:widget ?template ; mui:accepts ?inputShape .
    ?inputShape a mui:InputShape ; sh:class ?class .
    ?template rdf:type/rdfs:subClassOf* ?widgetClass .
    OPTIONAL { ?policy rdfs:label ?label }
    ?template (rdf:value|mui:templateContent) ?stylesheet .
    FILTER(CONTAINS(STR(?stylesheet), 'xsl:stylesheet') || CONTAINS(STR(?stylesheet), 'xsl:transform'))
  }
  GRAPH <${status}> { ?policy mui:status mui:Approved }
  GRAPH <${shapes}> { ?curator a mui:CurationProvider ; mui:widget/rdf:rest*/rdf:first ?provider .
    ?provider mui:implementationDigest ?version }
  GRAPH <${status}> { ?curator mui:status mui:Approved ; mui:approvedDigest ?grant .
    ?grant mui:forProvider ?provider ; mui:implementationDigest ?version }

} ORDER BY ?label LIMIT 50`, signal) : [];
  const resultViews = rows.map(row => ({uri:get(row,"policy"),matchedClass:get(row,"class"),
    label:get(row,"label") || get(row,"policy") || "View",template:get(row,"template"),
    stylesheet:get(row,"stylesheet")}))
    .filter(row => row.uri && row.template && row.stylesheet && row.stylesheet.length <= 250000);
  if (!extra.length) return resultViews;
  const queryViews = await personalSelect(({shapes}) => `PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
SELECT DISTINCT ?provider ?label ?template ?stylesheet WHERE { GRAPH <${shapes}> {
  VALUES ?provider { ${extra.map(uri=>`<${uri}>`).join(" ")} }
  ?provider a mui:Provider ; mui:widget ?template .
  ?template a mui:PerspectiveWidget ; (rdf:value|mui:templateContent) ?stylesheet .
  OPTIONAL { ?provider rdfs:label ?label }
} } LIMIT 100`, signal);
  // Query-target providers have already passed SHACL Core. Effective approval
  // is still checked independently against the user's RDF approval status.
  const { readClientPolicyApprovals } = await import("@/lib/client-policy-approvals");
  const decisions=await readClientPolicyApprovals(queryViews.map(row=>get(row,"provider")),signal);
  const approved=new Set(decisions.filter(d=>d.status==="Approved").map(d=>d.uri));
  const extraViews=queryViews.filter(row=>approved.has(get(row,"provider"))).map(row=>({
    uri:get(row,"provider"),matchedClass:"",label:get(row,"label")||get(row,"provider"),
    template:get(row,"template"),stylesheet:get(row,"stylesheet")
  })).filter(row=>row.uri&&row.template&&row.stylesheet&&row.stylesheet.length<=250000);
  return [...new Map([...resultViews,...extraViews].map(view=>[view.uri,view])).values()];
}
