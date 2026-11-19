"use client";

import { loadPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";
import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";

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

export type DiscoveredViewProvider = {uri: string; label: string; icon?: string; template: string; matchedClass: string; stylesheet: string};
/** A Perspective is an effectively approved provider whose declared SHACL
 * input applies to the active FCT population (or whose contextual query shape
 * has already matched). SHACL shapes are not independent approval subjects.
 * The caller supplies actual population classes, not just syntactic FCT class
 * constraints, so a query of EntryPoint resources remains eligible without a
 * hand-authored <class> filter. */
export async function discoverViews(classes: string[], signal?: AbortSignal, queryProviders: string[] = []): Promise<DiscoveredViewProvider[]> {
  const requested = [...new Set(classes.filter(safeIri))].slice(0, 70);
  const contextual = [...new Set(queryProviders.filter(safeIri))].slice(0, 100);
  if (!requested.length && !contextual.length) return [];
  const classBranch = requested.length ? `{
      VALUES ?matchedClass { ${requested.map(iri => `<${iri}>`).join(" ")} }
      ?inputShape (sh:class|sh:targetClass) ?matchedClass .
    }` : "";
  // Contextual providers are identifiers already accepted by the current
  // query's validated SHACL History context. They still require approval.
  const contextualBranch = contextual.length ? `{
      VALUES ?provider { ${contextual.map(iri => `<${iri}>`).join(" ")} }
    }` : "";
  const branches = [classBranch, contextualBranch].filter(Boolean).join(" UNION ");
  const rows = await personalSelect(({ shapes }) => `PREFIX sh: <${SH}> PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
SELECT DISTINCT ?provider ?matchedClass ?label ?template ?stylesheet WHERE {
  GRAPH <${shapes}> {
    ?provider a mui:Provider ; mui:widget ?template ; mui:accepts ?inputShape .
    ?template a mui:PerspectiveWidget ; (rdf:value|mui:templateContent) ?stylesheet .
    OPTIONAL { ?provider rdfs:label ?label }
    ${branches}
    FILTER(CONTAINS(STR(?stylesheet), 'xsl:stylesheet') || CONTAINS(STR(?stylesheet), 'xsl:transform'))
  }
} LIMIT 100`, signal);
  const byProvider = new Map<string, DiscoveredViewProvider>();
  for (const row of rows) {
    const uri = get(row, "provider"), template = get(row, "template"), stylesheet = get(row, "stylesheet");
    if (!safeIri(uri) || !safeIri(template) || !stylesheet || stylesheet.length > 250000) continue;
    if (!byProvider.has(uri)) byProvider.set(uri, {
      uri, matchedClass: get(row, "matchedClass"), label: get(row, "label") || uri,
      template, stylesheet,
    });
  }
  if (!byProvider.size) return [];
  const { readClientPolicyApprovals } = await import("@/lib/client-policy-approvals");
  const decisions = await readClientPolicyApprovals([...byProvider.keys()], signal);
  const approved = new Set(decisions.filter(decision => decision.status === "Approved").map(decision => decision.uri));
  return [...byProvider.values()].filter(view => approved.has(view.uri));
}
