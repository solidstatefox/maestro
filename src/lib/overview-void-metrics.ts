/** Optional published VoID metrics: graph-wide metadata, never a statistic about an FCT filter. */
const VOID = "http://rdfs.org/ns/void#";
export const VOID_METRIC_NAMES = ["triples", "entities", "distinctSubjects", "distinctObjects", "classes", "properties"] as const;
export type VoidMetricName = typeof VOID_METRIC_NAMES[number];
export type PublishedGraphStats = { graph: string; values: Partial<Record<VoidMetricName, number>> };
type SparqlBindings = { results?: { bindings?: Array<{ metric?: {value?: string}; amount?: {value?: string} }> } };
export function publishedGraphAddress(addr: string): { graph: string; endpoint: string } | null {
  const index = addr.indexOf("@");
  if (index < 0) return null;
  const graph = addr.slice(0,index).trim();
  const endpoint = addr.slice(index+1).trim();
  // Never enumerate graph metadata for Everywhere or an unspecified graph.
  if (!/^(https?:\/\/|urn:|gttps?:\/\/)/i.test(graph) || /[<>\s"{}]/.test(graph) ||
      !/^https?:\/\//i.test(endpoint) || /[<>\s"{}]/.test(endpoint)) return null;
  return {graph, endpoint};
}
export function readPublishedVoID(graph: string, response: SparqlBindings): PublishedGraphStats | null {
  const values: Partial<Record<VoidMetricName,number>> = {};
  for (const row of response.results?.bindings ?? []) {
    const uri = row.metric?.value ?? "";
    if (!uri.startsWith(VOID)) continue;
    const metric = uri.slice(VOID.length);
    if (!(VOID_METRIC_NAMES as readonly string[]).includes(metric)) continue;
    const amount = Number(row.amount?.value);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(amount)) continue;
    values[metric as VoidMetricName] = amount;
  }
  return Object.keys(values).length ? {graph,values} : null;
}
export async function fetchPublishedVoID(graph: string, endpoint: string, signal: AbortSignal): Promise<PublishedGraphStats | null> {
  const predicates = VOID_METRIC_NAMES.map(name => `<${VOID}${name}>`).join(" ");
  const query = `SELECT ?metric ?amount WHERE { <${graph}> ?metric ?amount . VALUES ?metric { ${predicates} } } LIMIT 12`;
  // Reuse the authenticated, bounded Maestro SPARQL transport; do not call Virtuoso SQL procedures or write stats.
  const response = await fetch("/proxy/api/sparql", {method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({addr:`@${endpoint}`,query}),signal});
  if (!response.ok) return null;
  return readPublishedVoID(graph, await response.json() as SparqlBindings);
}
export function publishedGraphRatios(stats: PublishedGraphStats): Array<{label:string;ratio:number;detail:string}> {
  const s=stats.values;
  const result: Array<{label:string;ratio:number;detail:string}> = [];
  if (s.triples !== undefined && s.distinctSubjects && s.distinctSubjects > 0) result.push({label:"Statements per subject",ratio:s.triples/s.distinctSubjects,detail:"Published VoID triples ÷ distinct subjects"});
  if (s.entities !== undefined && s.distinctSubjects && s.distinctSubjects > 0 && s.entities <= s.distinctSubjects) result.push({label:"Entity / subject share",ratio:s.entities/s.distinctSubjects*100,detail:"Published entities ÷ distinct subjects (%)"});
  if (s.distinctObjects !== undefined && s.distinctSubjects && s.distinctSubjects > 0) result.push({label:"Object / subject ratio",ratio:s.distinctObjects/s.distinctSubjects,detail:"Published distinct objects ÷ subjects"});
  if (s.properties !== undefined && s.classes && s.classes > 0) result.push({label:"Properties per class",ratio:s.properties/s.classes,detail:"Published distinct properties ÷ classes (not a per-class average)"});
  return result.filter(item => Number.isFinite(item.ratio));
}
