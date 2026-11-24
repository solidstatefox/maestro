
import { attributedSparqlFetch } from "@/lib/sparql-request-attribution";
/** A separately bounded FCT projection of the ACTIVE <view> focus, never the
 * currently displayed results page. All filters, path bindings and graph
 * address are retained by changing only the view's projection/pagination. */
import { fctRead } from "@/lib/fct-client";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { splitCompiledSelect } from "@/lib/provider-fct-context";

export const OVERVIEW_POPULATION_LIMIT = 120;
export type OverviewPopulation = { uri: string; label: string };
const validUri = (value: string) => /^[A-Za-z][A-Za-z\d+.-]*:[^\s<>"{}|^`\\]+$/.test(value);

export function cloneOverviewPopulationQuery(queryXml: string, limit = OVERVIEW_POPULATION_LIMIT): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") throw new Error("FCT projection requires a browser XML parser.");
  const xml = new DOMParser().parseFromString(queryXml, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Invalid live FCT query XML.");
  const root = xml.documentElement;
  if (root.localName !== "query") throw new Error("Expected an FCT query root.");
  const views = Array.from(root.getElementsByTagName("*")).filter(node => node.localName === "view");
  if (views.length !== 1) throw new Error("Exactly one active FCT view is required.");
  const view = views[0];
  view.setAttribute("type", "list");
  view.setAttribute("limit", String(Math.min(OVERVIEW_POPULATION_LIMIT, Math.max(1, Math.floor(limit)))));
  view.setAttribute("offset", "0");
  // Presentation-only index/page state must not limit the population.
  view.removeAttribute("index");
  view.removeAttribute("indexLabels");
  view.removeAttribute("indexLang");
  return new XMLSerializer().serializeToString(xml);
}

export async function readOverviewPopulation(queryXml: string, signal: AbortSignal): Promise<OverviewPopulation[]> {
  const response = await fctRead(cloneOverviewPopulationQuery(queryXml), signal);
  return [...new Map(response.results.filter(row => validUri(row.uri) && row.termType !== "literal" && row.termType !== "bnode")
    .map(row => [row.uri, {uri: row.uri, label: row.title || row.uri}] as const)).values()];
}

/** Full-result-set label coverage using the authoritative FCT -> SPARQL compiler.
 * No visible-results page, URI sampling, or N+1 per-predicate requests.
 * We compile a derived *unpaged* view and reuse its focus ?target and WHERE.
 * Only the aggregate projections are added outside the compiled FCT scope. */
export type OverviewLabelCoverageResult = {
  items: Array<{name:string;uri:string;count:number;denominator:number;percentage:number}>;
  unionCount: number;
  denominator: number;
};

type SparqlBinding = { value?: string };
type SparqlResult = { results?: { bindings?: Array<Record<string, SparqlBinding>> }; error?: string };
const safeCount = (binding: SparqlBinding | undefined): number => {
  const value = Number(binding?.value);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("SPARQL returned an invalid label-coverage count.");
  return value;
};

export function buildOverviewLabelCoverageQueries(
  liveXml: string,
  predicates: ReadonlyArray<{uri:string;label:string}>,
): { endpoint: string; denominatorQuery: string; groupedQuery: string; unionQuery: string } {
  const compiled = compileFctXmlToSparql(cloneOverviewPopulationQuery(liveXml, 1));
  if (!/^\?[A-Za-z][A-Za-z0-9_]*$/.test(compiled.target))
    throw new Error("The FCT view must focus a bound resource for label coverage.");
  const xml = new DOMParser().parseFromString(liveXml, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Invalid live FCT query XML.");
  const addr = xml.documentElement.getAttribute("addr") ?? "";
  const split = addr.indexOf("@");
  const graph = split < 0 ? "" : addr.slice(0, split).trim();
  const endpoint = split < 0 ? "" : addr.slice(split+1).trim();
  if (!/^https?:\/\//i.test(endpoint) || /[<>\s"{}]/.test(endpoint))
    throw new Error("The FCT query has no valid graph-server endpoint.");
  const { prefix, where } = splitCompiledSelect(compiled.query);
  const focus = compiled.target;
  const scope = `{ SELECT DISTINCT ${focus} WHERE { ${where} } }`;
  const denominatorQuery = `${prefix} SELECT (COUNT(DISTINCT ${focus}) AS ?total) WHERE { ${scope} }`;
  const values = [...new Set(predicates.map(item=>item.uri).filter(validUri))].map(uri=>`<${uri}>`).join(" ");
  if (!values) throw new Error("No valid name/label predicates to profile.");
  // "Everywhere" has no named graph restriction. When addr names a graph,
  // match labels in that same graph rather than on an unrelated server graph.
  const namedGraph = graph && graph !== "$ALL$" && validUri(graph) ? graph : "";
  const labelTriple = `${focus} ?labelPredicate ?labelValue .`;
  const labels = namedGraph ? `GRAPH <${namedGraph}> { ${labelTriple} }` : labelTriple;
  const groupedQuery = `${prefix} SELECT ?labelPredicate (COUNT(DISTINCT ${focus}) AS ?matches)
    WHERE { ${scope} VALUES ?labelPredicate { ${values} } ${labels} }
    GROUP BY ?labelPredicate`;
  const unionQuery = `${prefix} SELECT (COUNT(DISTINCT ${focus}) AS ?any) WHERE { ${scope} VALUES ?labelPredicate { ${values} } ${labels} }`;
  return { endpoint, denominatorQuery, groupedQuery, unionQuery };
}

async function readOverviewAggregate(endpoint: string, query: string, signal: AbortSignal): Promise<SparqlResult> {
  const response = await attributedSparqlFetch("/proxy/api/sparql", {
    method: "POST", headers: {"x-maestro-debug-source":"urn:maestro:component:Overview:Population","x-maestro-debug-component":"Overview:Population","Content-Type":"application/json"},
    body: JSON.stringify({ addr:`@${endpoint}`, query }), signal,
  });
  if (!response.ok) throw new Error(`SPARQL label coverage failed (HTTP ${response.status}).`);
  const result = await response.json() as SparqlResult;
  if (result.error || !Array.isArray(result.results?.bindings))
    throw new Error(result.error || "The graph server returned no SPARQL label-coverage bindings.");
  return result;
}

export async function readOverviewLabelCoverage(
  liveXml: string,
  predicates: ReadonlyArray<{uri:string;label:string}>,
  signal: AbortSignal,
): Promise<OverviewLabelCoverageResult> {
  const unique = [...new Map(predicates.filter(item=>validUri(item.uri)).map(item=>[item.uri,item])).values()];
  if (!unique.length) return {items:[],unionCount:0,denominator:0};
  const {endpoint,denominatorQuery,groupedQuery,unionQuery} = buildOverviewLabelCoverageQueries(liveXml,unique);
  const totalResult = await readOverviewAggregate(endpoint,denominatorQuery,signal);
  const denominator = safeCount(totalResult.results?.bindings?.[0]?.total);
  // Zero-coverage predicates still get labeled tracks, even if no matches.
  const matches = new Map<string,number>();
  let unionCount=0;
  if (denominator > 0) {
    const [grouped, union] = await Promise.all([
      readOverviewAggregate(endpoint,groupedQuery,signal),
      readOverviewAggregate(endpoint,unionQuery,signal),
    ]);
    unionCount=safeCount(union.results?.bindings?.[0]?.any);
    for (const row of grouped.results?.bindings ?? []) {
      const uri = row.labelPredicate?.value ?? "";
      if (unique.some(item=>item.uri===uri)) matches.set(uri,safeCount(row.matches));
    }
  }
  const items=unique.map(item=>{
    const count=matches.get(item.uri)??0;
    return {name:item.label,uri:item.uri,count,denominator,percentage:denominator?Math.min(100,count*100/denominator):0};
  });
  // Union is counted separately: resources may match several name predicates.
  return {items,unionCount,denominator};
}

/** Which root <text> indexed predicates actually matched resources in the
 * active FCT view population. Unlike label usage, this examines the existing
 * full-text triple (?s1 ?txtp1 ?txt1) in the compiled FCT WHERE clause.
 * The percentage denominator is ALL DISTINCT matching view resources; a
 * resource may match through multiple predicates, so percentages can overlap.
 * This deliberately does not sample results or issue per-resource requests. */
export function buildOverviewTextMatchCoverageQueries(
  liveXml: string,
  predicates: ReadonlyArray<{uri:string;label:string}>,
): {endpoint:string;denominatorQuery:string;groupedQuery:string} | null {
  const document = new DOMParser().parseFromString(liveXml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid live FCT query XML.");
  const root = document.documentElement;
  const rootText = Array.from(root.children).find(element => element.localName === "text");
  if (!rootText?.textContent?.trim()) return null;
  const uniquePredicates = [...new Set(predicates.map(item=>item.uri).filter(validUri))];
  if (!uniquePredicates.length) return null;
  const compiled = compileFctXmlToSparql(cloneOverviewPopulationQuery(liveXml, 1));
  if (!/^\?[A-Za-z][A-Za-z0-9_]*$/.test(compiled.target))
    throw new Error("The FCT view must focus a bound resource for text match coverage.");
  const {prefix,where} = splitCompiledSelect(compiled.query);
  // txtp1 is generated by the authoritative FCT full-text translator.
  // Do not put it inside the DISTINCT-focus subquery: that loses the binding.
  if (!/\?txtp1\b/.test(where))
    throw new Error("The compiled FCT scope does not expose a text-match predicate.");
  const addr = root.getAttribute("addr") ?? "";
  const split = addr.indexOf("@");
  const endpoint = split < 0 ? "" : addr.slice(split+1).trim();
  if (!/^https?:\/\//i.test(endpoint) || /[<>\s"{}]/.test(endpoint))
    throw new Error("The FCT query has no valid graph-server endpoint.");
  const focus = compiled.target;
  const denominatorQuery = `${prefix} SELECT (COUNT(DISTINCT ${focus}) AS ?total) WHERE { ${where} }`;
  const values = uniquePredicates.map(uri => `<${uri}>`).join(" ");
  const groupedQuery = `${prefix} SELECT ?matchedPredicate (COUNT(DISTINCT ${focus}) AS ?matches)
    WHERE { ${where} VALUES ?matchedPredicate { ${values} } FILTER(?txtp1 = ?matchedPredicate) }
    GROUP BY ?matchedPredicate`;
  return {endpoint,denominatorQuery,groupedQuery};
}

export async function readOverviewTextMatchCoverage(
  liveXml: string,
  predicates: ReadonlyArray<{uri:string;label:string}>,
  signal: AbortSignal,
): Promise<OverviewLabelCoverageResult | null> {
  const unique = [...new Map(predicates.filter(item=>validUri(item.uri)).map(item=>[item.uri,item])).values()];
  const queries = buildOverviewTextMatchCoverageQueries(liveXml, unique);
  if (!queries) return null; // No active root <text> search.
  const total = await readOverviewAggregate(queries.endpoint,queries.denominatorQuery,signal);
  const denominator = safeCount(total.results?.bindings?.[0]?.total);
  const matches = new Map<string,number>();
  if (denominator > 0) {
    const grouped = await readOverviewAggregate(queries.endpoint,queries.groupedQuery,signal);
    const allowed = new Set(unique.map(item=>item.uri));
    for (const row of grouped.results?.bindings ?? []) {
      const uri = row.matchedPredicate?.value ?? "";
      if (allowed.has(uri)) matches.set(uri,safeCount(row.matches));
    }
  }
  return {
    denominator,
    unionCount:0, // No union statistic is requested for this independent chart.
    items:unique.map(item=>{
      const count=matches.get(item.uri)??0;
      return {name:item.label,uri:item.uri,count,denominator,
        percentage:denominator?Math.min(100,count*100/denominator):0};
    }),
  };
}
