/** Pure, rendering-library-independent FCT page -> Sankey projection.
 * One unit is one percentage point of a resource's in-scope predicate coverage.
 * The same flow is conserved from scope through resource, predicate and values.
 */
export const SANKEY_ANALYSIS_URI = "gttp://ggg.maestro.ecosys/analyze/sankey";
export const SANKEY_MAX_RESOURCES = 20;
export const SANKEY_MAX_PREDICATES = 10;
export const SANKEY_MAX_VALUES_PER_PREDICATE = 8;

export type SankeyPredicate = { iri: string; direction: "forward" | "reverse"; label: string; anchorId?: string };
export type SankeyTerm = { value: string; type?: string; datatype?: string; lang?: string };
export type SankeyResource = { uri: string; label: string; values: Array<{property: string; direction: "forward" | "reverse"; values: SankeyTerm[]; anchorId?: string}> };
export type SankeyCoverageNode = { name: string; kind: "scope" | "resource" | "predicate" | "value"; uri?: string; coverage?: number; tooltip?: string; axisKey?: string; term?: SankeyTerm };
export type SankeyCoverageLink = { source: number; target: number; value: number };
export type SankeyCoverageGraph = {
  nodes: SankeyCoverageNode[]; links: SankeyCoverageLink[];
  displayedResources: number; totalResources: number;
  displayedPredicates: number; totalPredicates: number;
  coverage: Array<{uri: string; label: string; percent: number}>;
  descendantsTruncated?: boolean;
};

const predicateKey = (direction: string, iri: string, anchorId?: string) => anchorId ? `alias:${anchorId}` : `${direction}|${iri}`;
const termKey = (term: SankeyTerm) => JSON.stringify([term.type ?? "literal", term.value, term.datatype ?? "", term.lang ?? ""]);
const concise = (text: string, max = 44) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const termLabel = (term: SankeyTerm) => {
  if (term.type === "uri") {
    const end = term.value.split(/[#/]/).filter(Boolean).pop();
    return concise(decodeURIComponentSafe(end || term.value));
  }
  return concise(term.value);
};
const decodeURIComponentSafe = (value: string) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

/** The denominator is the full set of currently in-scope query predicates,
 * even when a safety limit displays only some of their individual columns. */
export function projectSankeyCoverage(predicates: readonly SankeyPredicate[], resources: readonly SankeyResource[], focusPath = "Everything"): SankeyCoverageGraph {
  const axes = [...new Map(predicates.filter(p => p.iri).map(p => [predicateKey(p.direction, p.iri, p.anchorId), p])).values()];
  const displayedAxes = axes.slice(0, SANKEY_MAX_PREDICATES);
  const displayedResources = resources.slice(0, SANKEY_MAX_RESOURCES);
  const graph: SankeyCoverageGraph = {nodes:[],links:[],displayedResources:displayedResources.length,totalResources:resources.length,
    displayedPredicates:displayedAxes.length,totalPredicates:axes.length,coverage:[]};
  if (!axes.length || !displayedResources.length) return graph;

  const node = (data:SankeyCoverageNode) => graph.nodes.push(data) - 1;
  const rootIndex = node({name:focusPath.trim() || "Everything",kind:"scope",tooltip:`Focus path: ${focusPath.trim() || "Everything"}. Flows represent predicate coverage, not triple counts`});
  const predicateIndices = new Map<string,number>();
  const popularTerms = new Map<string,Set<string>>();
  // Value buckets are per predicate and RDF term, not merely their display label.
  for (const axis of displayedAxes) {
    const key = predicateKey(axis.direction,axis.iri,axis.anchorId);
    const hits = new Map<string,number>();
    for (const resource of displayedResources) {
      const matching = resource.values.filter(s => predicateKey(s.direction,s.property,s.anchorId)===key);
      const unique = new Map(matching.flatMap(s => s.values).filter(t => t.value !== "-").map(t => [termKey(t),t]));
      for (const [term] of unique) {hits.set(term,(hits.get(term)??0)+1);}
    }
    popularTerms.set(key,new Set([...hits].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
      .slice(0,SANKEY_MAX_VALUES_PER_PREDICATE).map(([term])=>term)));
    predicateIndices.set(key,node({name:concise(axis.label),kind:"predicate",uri:axis.iri,
      tooltip:`${axis.direction === "reverse" ? "Incoming role" : "Outgoing property"}: ${axis.iri}`}));
  }
  const valueNodes = new Map<string,number>();
  const valueWeights = new Map<string,number>();
  let rootWeight = 0;
  for (const resource of displayedResources) {
    const present = axes.filter(axis => resource.values.some(s => predicateKey(s.direction,s.property,s.anchorId)===predicateKey(axis.direction,axis.iri,axis.anchorId)
      && s.values.some(t=>t.value !== "-")));
    const percent = (100*present.length)/axes.length;
    graph.coverage.push({uri:resource.uri,label:resource.label,percent});
    // Zero-coverage resources are represented in the table below, not as zero-width Sankey nodes.
    if (!present.length) continue;
    const matchingDisplayed = displayedAxes.filter(axis => present.some(p=>predicateKey(p.direction,p.iri,p.anchorId)===predicateKey(axis.direction,axis.iri,axis.anchorId)));
    if (!matchingDisplayed.length) continue;
    const shownWeight = 100 * matchingDisplayed.length / axes.length;
    const resourceIndex=node({name:concise(`${resource.label} · ${percent.toFixed(0)}%`),kind:"resource",uri:resource.uri,
      coverage:percent,tooltip:`${resource.label}: ${present.length}/${axes.length} predicates (${percent.toFixed(1)}%)`});
    graph.links.push({source:rootIndex,target:resourceIndex,value:shownWeight});rootWeight+=shownWeight;
    for (const axis of matchingDisplayed) {
      const key=predicateKey(axis.direction,axis.iri,axis.anchorId);
      const predicateIndex=predicateIndices.get(key)!;
      const weight=100/axes.length;
      graph.links.push({source:resourceIndex,target:predicateIndex,value:weight});
      const terms = new Map(resource.values.filter(s=>predicateKey(s.direction,s.property,s.anchorId)===key)
        .flatMap(s=>s.values).filter(t=>t.value!=="-").map(t=>[termKey(t),t]));
      const eachWeight=weight/terms.size;
      for(const [id,term] of terms) {
        const bucket=popularTerms.get(key)!.has(id)? id : "__other__";
        const valueKey=`${key}|${bucket}`;
        if(!valueNodes.has(valueKey)) valueNodes.set(valueKey,node({name:bucket==="__other__"?"Other values":termLabel(term),kind:"value",
          uri:bucket==="__other__"?undefined:term.type==="uri"?term.value:undefined,
          axisKey:key, ...(bucket==="__other__"?{}:{term}),
          tooltip:bucket==="__other__"?`Additional values for ${axis.label}`:`${axis.label}: ${term.value}`}));
        valueWeights.set(valueKey,(valueWeights.get(valueKey)??0)+eachWeight);
      }
    }
  }
  // The aggregate outgoing predicate flow must equal its links to value buckets.
  for(const [key,value] of valueWeights) {
    // Predicates are keyed by direction|IRI, so the bucket key is recovered via
    // the known predicate prefixes rather than splitting potentially arbitrary IRIs.
    const prefix=[...predicateIndices.keys()].find(p=>key.startsWith(`${p}|`));
    if(prefix) graph.links.push({source:predicateIndices.get(prefix)!,target:valueNodes.get(key)!,value});
  }
  if(rootWeight<=0)return {...graph,nodes:[],links:[]};
  // Recharts expects nodes with at least one incident link. Remove unused
  // predicate nodes and remap indices, maintaining the four acyclic stages.
  const live=new Set(graph.links.flatMap(l=>[l.source,l.target]));
  const remap=new Map<number,number>();
  const compact=graph.nodes.flatMap((n,i)=>live.has(i)?(remap.set(i,remap.size),[n]):[]);
  return {...graph,nodes:compact,links:graph.links.map(l=>({source:remap.get(l.source)!,target:remap.get(l.target)!,value:l.value}))};
}
