/** Version-gated, read-only node scoring for members returned by a fresh FCT
 * population projection. Newer bif: graph analytics are NOT synonymous with
 * the older Virtuoso SPARQL-BI language extensions. */
export type NodeMetric = "degree" | "degree_native" | "pagerank" | "betweenness" | "closeness" | "eigenvector" | "wcc" | "scc" | "community";
export type EdgeDirection = "property" | "role";
export type AnalyticsCapabilities = {product: string;version: string; bi: boolean; native: boolean; reason: string};
const validUri = (value:string)=>/^[A-Za-z][A-Za-z\d+.-]*:[^\s<>"{}|^`\\]+$/.test(value);

/** Virtuoso st_dbms_ver commonly reports 07.20.build (7.2 release line). This
 * is NOT the same notation as 7.2.18, so never assume build 3243 = v7.2.3243. */
export function virtuosoAnalyticsCapabilities(product:string, version:string): AnalyticsCapabilities {
  const unknown = {product,version,bi:false,native:false,reason:"The graph server has not verified a supported Virtuoso SPARQL-BI version."};
  if (!/virtuoso/i.test(product)) return {...unknown,reason:"The selected graph server is not identified as Virtuoso."};
  const oldStyle = /^0?(\d+)\.([0-9]{2})\.(\d+)(?:\D|$)/.exec(version.trim());
  const normal = /^v?(\d+)\.(\d+)\.(\d+)(?:\D|$)/i.exec(version.trim());
  if (!oldStyle && !normal) return {...unknown,reason:"The Virtuoso version is unavailable or unrecognized; graph analytics is disabled."};
  const major=Number((oldStyle??normal)![1]);
  const minor=oldStyle && /^0\d/.test(version.trim()) ? Number(oldStyle[2])/10 : Number((normal??oldStyle)![2]);
  const patch=oldStyle && /^0\d/.test(version.trim()) ? 0 : Number((normal??oldStyle)![3]);
  const bi = major > 7 || (major === 7 && minor >= 0);
  // Native bif:pagerank/betweenness/closeness/community examples appear in
  // OpenLink's newer 2026 engine documentation, not older SPARQL-BI releases.
  // A release threshold is only a conservative candidate: runtime failures
  // still revoke the native capability for this selected server.
  const native = bi && (major > 7 || (major === 7 && (minor > 2 || (minor === 2 && patch >= 18))));
  return {product,version,bi,native,reason:!bi?"This version is not in the supported Virtuoso SPARQL-BI release range.":native?"Native centrality is eligible but must still succeed at runtime.":"SPARQL-BI available; newer native bif: centrality is not established for this version."};
}

export function makeNodeAnalyticsQuery(input:{uris:string[];predicate:string;metric:NodeMetric;graph?:string;direction:EdgeDirection;nativeEnabled:boolean}):string|null {
  const uris=[...new Set(input.uris.filter(validUri))].slice(0,120);
  if(!uris.length || !validUri(input.predicate) || (input.graph && !validUri(input.graph))) return null;
  if(input.metric !== "degree" && !input.nativeEnabled) return null;
  const values=uris.map(uri=>`<${uri}>`).join(" ");
  const edge=input.direction === "property" ? `?node <${input.predicate}> ?other .` : `?other <${input.predicate}> ?node .`;
  const scoped=input.graph ? `GRAPH <${input.graph}> { ${edge} }` : edge;
  const connection=`${scoped} FILTER(isIRI(?other))`;
  // Degree uses portable SPARQL aggregation, with a named-graph pattern when
  // the user selected one. The verified server's BI range gates execution.
  // Preserve members with no matching links: a zero is an informative result,
  // unlike the old inner join which silently returned no rows.
  if(input.metric==="degree") return `SELECT ?node (COUNT(DISTINCT ?other) AS ?score) WHERE { VALUES ?node { ${values} } OPTIONAL { ${connection} } } GROUP BY ?node ORDER BY DESC(?score) LIMIT 30`;
  const fn={degree_native:"degree_centrality",pagerank:"pagerank",betweenness:"betweenness",closeness:"closeness",eigenvector:"eigenvector",wcc:"wcc",scc:"scc",community:"community_id"}[input.metric];
  const option=input.metric==="betweenness"?", normalized 1":input.metric==="degree_native"?`, direction "${input.direction==="property"?"out":"in"}"`:"";
  // Native functions use the dataset default graph for their graph context;
  // FROM selects the named graph when one is explicitly selected. This matches
  // OpenLink's published examples of bif: centrality with OPTION(edges(...)).
  // The VALUES clause restricts returned scores to sampled FCT members.
  const dataset=input.graph?`FROM <${input.graph}> `:"";
  const nativeConnection=`${edge} FILTER(isIRI(?other))`;
  return `PREFIX bif: <http://www.openlinksw.com/schemas/bif#> SELECT DISTINCT ?node ?score ${dataset}WHERE { VALUES ?node { ${values} } ${nativeConnection} ?node bif:${fn} ?score OPTION (edges (${input.direction === "property"?"?node, ?other":"?other, ?node"})${option}) . } ORDER BY DESC(?score) LIMIT ${input.metric === "wcc" || input.metric === "scc" || input.metric === "community" ? 120 : 30}`;
}

type Binding={node?:{value?:string};score?:{value?:string}};
export function readNodeAnalytics(json:{results?:{bindings?:Binding[]}}, limit=30):Array<{uri:string;label:string;score:number}> {
  return (json.results?.bindings??[]).flatMap(row=>{
    const uri=row.node?.value??"",rawScore=row.score?.value??"",score=Number(rawScore);
    if(!validUri(uri)||!rawScore.trim()||!Number.isFinite(score))return [];
    let label=uri.split(/[#/]/).pop()||uri;
    try{label=decodeURIComponent(label);}catch{}
    return [{uri,label,score}];
  }).sort((a,b)=>b.score-a.score).slice(0,Math.min(120,Math.max(1,limit)));
}
