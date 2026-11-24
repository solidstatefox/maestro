
import { attributedSparqlFetch } from "@/lib/sparql-request-attribution";
/** Read-only, bounded Virtuoso TRANSITIVE connection discovery.
 * The endpoints may be members of the current FCT scope; intermediate nodes
 * are intentionally not assumed to be part of that scope. This service does
 * not write to the graph and never invents a link/predicate in its result. */
export const OVERVIEW_CONNECTION_MAX_HOPS = 10;
export const OVERVIEW_CONNECTION_MAX_PATHS = 10;
const validUri = (uri: string) => /^[A-Za-z][A-Za-z\d+.-]*:[^\s<>"{}|^`\\]+$/.test(uri);
const iri = (uri: string) => `<${uri}>`;
export type ConnectionStep = {uri: string; label: string};
export type ConnectionEdge = {from: string; to: string; predicate: string; direction: "forward" | "reverse"};
export type ConnectionPath = {id:string; nodes:ConnectionStep[]; edges:ConnectionEdge[]};
export type ConnectionInput = {source:string;target:string;endpoint:string;graph?:string;predicate?:string;maxHops:number};
type SparqlBinding = {value?:string};
type SparqlResponse = {results?:{bindings?: Array<Record<string,SparqlBinding>>}};

export function makeOverviewConnectionQuery(input: ConnectionInput, preferNonType = false): string | null {
  if (!validUri(input.source) || !validUri(input.target) || !/^https?:\/\//i.test(input.endpoint) ||
      (input.graph && !validUri(input.graph)) || (input.predicate && !validUri(input.predicate)) || input.source === input.target) return null;
  const max = Math.min(OVERVIEW_CONNECTION_MAX_HOPS, Math.max(1, Math.floor(input.maxHops || 1)));
  // This is Virtuoso's documented shortest-path TRANSITIVE subquery, not a
  // custom SPARQL 1.1 property path. The predicate can vary at each hop.
  const generic = ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type", "http://dbpedia.org/property/entityType", "http://dbpedia.org/ontology/type"].map(iri).join(", ");
  const nonType = preferNonType && !input.predicate ? `FILTER(?p NOT IN (${generic}))` : "";
  const triple = `?s ?p ?o . FILTER(isIRI(?s) && isIRI(?o)) ${input.predicate ? `FILTER(?p = ${iri(input.predicate)})` : ""} ${nonType}`;
  const graph = input.graph;
  const scoped = graph ? (pattern: string) => `GRAPH ${iri(graph)} { ${pattern} }` : (pattern: string) => pattern;
  const graphScope = `{ ${scoped(triple)} } UNION { ${scoped(`?o ?p ?s . FILTER(isIRI(?s) && isIRI(?o)) ${input.predicate ? `FILTER(?p = ${iri(input.predicate)})` : ""} ${nonType}`)} }`;
  return `SELECT ?link ?path ?step WHERE {
    { SELECT ?s ?o WHERE { ${graphScope} } }
    OPTION (TRANSITIVE, T_DISTINCT, T_IN(?s), T_OUT(?o), T_NO_CYCLES,
      T_SHORTEST_ONLY, T_MIN(1), T_MAX(${max}), T_DIRECTION 3,
      T_STEP(?s) AS ?link, T_STEP('path_id') AS ?path,
      T_STEP('step_no') AS ?step) .
    FILTER(?s = ${iri(input.source)} && ?o = ${iri(input.target)})
  } ORDER BY ?path ?step LIMIT 200`;
}

/** Group path-id/step-no rows. Order is structural, not ranking or a score. */
export function readOverviewConnectionPaths(json:SparqlResponse, source:string, target:string):ConnectionPath[] {
  if (!validUri(source) || !validUri(target)) return [];
  const groups = new Map<string, Array<{uri:string;step:number}>>();
  for (const row of json.results?.bindings ?? []) {
    const uri = row.link?.value ?? "";
    const path = row.path?.value ?? "";
    const step = Number(row.step?.value);
    if (!validUri(uri) || !path || !Number.isSafeInteger(step) || step < 0 || step > OVERVIEW_CONNECTION_MAX_HOPS) continue;
    const entries = groups.get(path) ?? [];
    entries.push({uri,step}); groups.set(path,entries);
  }
  return [...groups.entries()].slice(0,OVERVIEW_CONNECTION_MAX_PATHS).flatMap(([id,entries])=>{
    entries.sort((a,b)=>a.step-b.step);
    const pathNodes = entries.filter((entry,index)=>index===0 || entry.uri!==entries[index-1].uri).map(entry=>entry.uri);
    if (!pathNodes.length) return [];
    // Never infer an unreported link. A valid server path explicitly includes both endpoints.
    if (pathNodes[0]!==source || pathNodes[pathNodes.length-1]!==target) return [];
    if (pathNodes.length<2 || pathNodes.length>OVERVIEW_CONNECTION_MAX_HOPS+1) return [];
    if (new Set(pathNodes).size!==pathNodes.length) return [];
    return [{id,nodes:pathNodes.map(uri=>({uri,label:shortResourceLabel(uri)})),edges:[]}];
  });
}

/** Bound endpoint search, evaluated before any transitive expansion.
 * Two-hop paths use a shared neighbor with either RDF edge orientation.
 * Each returned predicate identifies an actual statement; no second projection. */
export function makeOverviewBoundedConnectionQuery(input: ConnectionInput): string | null {
  if (!validUri(input.source) || !validUri(input.target) || (input.graph && !validUri(input.graph)) ||
      (input.predicate && !validUri(input.predicate)) || input.source === input.target) return null;
  const left = iri(input.source), right = iri(input.target);
  const scoped = (pattern: string) => input.graph ? `GRAPH ${iri(input.graph)} { ${pattern} }` : pattern;
  const constrain = (name: string) => input.predicate ? `FILTER(${name} = ${iri(input.predicate)})` : "";
  const variants = [
    `{ ${scoped(`${left} ?p1 ${right} .`)} ${constrain("?p1")} BIND(1 AS ?hops) BIND("forward" AS ?d1) }`,
    `{ ${scoped(`${right} ?p1 ${left} .`)} ${constrain("?p1")} BIND(1 AS ?hops) BIND("reverse" AS ?d1) }`,
  ];
  if (input.maxHops >= 2) {
    for (const [a,d1] of [[`${left} ?p1 ?via .`,"forward"],[`?via ?p1 ${left} .`,"reverse"]]) {
      for (const [b,d2] of [[`?via ?p2 ${right} .`,"forward"],[`${right} ?p2 ?via .`,"reverse"]]) {
        variants.push(`{ ${scoped(a)} ${scoped(b)} ${constrain("?p1")} ${constrain("?p2")} FILTER(isIRI(?via) && ?via != ${left} && ?via != ${right}) BIND(2 AS ?hops) BIND("${d1}" AS ?d1) BIND("${d2}" AS ?d2) }`);
      }
    }
  }
  const generic = ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type", "http://dbpedia.org/property/entityType", "http://dbpedia.org/ontology/type"].map(iri).join(", ");
  // Prioritize genuinely informative predicates before ubiquitous rdf:type;
  // never exclude valid class links. Bound joins are still tried first.
  return `SELECT DISTINCT ?via ?p1 ?p2 ?d1 ?d2 ?hops ?generic WHERE {
    ${variants.join(" UNION ")}
    BIND(IF(?p1 IN (${generic}), 1, 0) + IF(BOUND(?p2), IF(?p2 IN (${generic}), 1, 0), 0) AS ?generic)
  } ORDER BY ?hops ?generic LIMIT 250`;
}

export function readOverviewBoundedConnectionPaths(json: SparqlResponse, source: string, target: string): ConnectionPath[] {
  const results: ConnectionPath[] = [];
  const seen = new Set<string>();
  for (const row of json.results?.bindings ?? []) {
    const hops = Number(row.hops?.value);
    if (hops !== 1 && hops !== 2) continue;
    const via = row.via?.value ?? "";
    const p1 = row.p1?.value ?? "";
    const p2 = row.p2?.value ?? "";
    const d1 = row.d1?.value;
    const d2 = row.d2?.value;
    if (!validUri(p1) || (d1 !== "forward" && d1 !== "reverse") ||
        (hops === 2 && (!validUri(via) || !validUri(p2) || via === source || via === target || (d2 !== "forward" && d2 !== "reverse")))) continue;
    const nodes = hops === 1 ? [source,target] : [source,via,target];
    const edges: ConnectionEdge[] = [{from:source,to:nodes[1],predicate:p1,direction:d1}];
    if (hops === 2) edges.push({from:via,to:target,predicate:p2,direction:d2 as "forward" | "reverse"});
    const key = nodes.join("\0") + edges.map(edge=>`${edge.predicate}:${edge.direction}`).join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({id:`bounded-${results.length}`,nodes:nodes.map(uri=>({uri,label:shortResourceLabel(uri)})),edges});
    if (results.length >= OVERVIEW_CONNECTION_MAX_PATHS) break;
  }
  // If a direct edge is present the two-hop alternatives aren't shortest.
  const shortest = results.some(path=>path.edges.length===1) ? 1 : 2;
  return results.filter(path=>path.edges.length===shortest);
}

export function makeOverviewConnectionEdgesQuery(paths: ConnectionPath[], graph?:string):string|null {
  if (graph && !validUri(graph)) return null;
  const pairs = [...new Map(paths.flatMap(path=>path.nodes.slice(0,-1).map((node,index)=>{
    const next=path.nodes[index+1];return [`${node.uri}\u0000${next.uri}`,[node.uri,next.uri] as const] as const;
  })).filter(([,pair])=>pair.every(validUri))).values()];
  if (!pairs.length) return null;
  const values=pairs.map(([from,to])=>`(${iri(from)} ${iri(to)})`).join(" ");
  const forward=graph ? `GRAPH ${iri(graph)} { ?left ?predicate ?right . }` : `?left ?predicate ?right .`;
  const backward=graph ? `GRAPH ${iri(graph)} { ?right ?predicate ?left . }` : `?right ?predicate ?left .`;
  return `SELECT DISTINCT ?left ?right ?predicate ?direction WHERE { VALUES (?left ?right) { ${values} }
    { ${forward} BIND("forward" AS ?direction) }
    UNION { ${backward} BIND("reverse" AS ?direction) }
  } LIMIT 400`;
}

export function attachOverviewConnectionEdges(paths:ConnectionPath[], json:SparqlResponse):ConnectionPath[] {
  const byPair=new Map<string,ConnectionEdge[]>();
  for(const row of json.results?.bindings??[]) {
    const from=row.left?.value??"",to=row.right?.value??"",predicate=row.predicate?.value??"";
    const direction=row.direction?.value;
    if(!validUri(from)||!validUri(to)||!validUri(predicate)||(direction!=="forward"&&direction!=="reverse")) continue;
    const key=`${from}\u0000${to}`;
    const current=byPair.get(key)??[];current.push({from,to,predicate,direction});byPair.set(key,current);
  }
  return paths.map(path=>({ ...path, edges:path.nodes.slice(0,-1).flatMap((node,index)=>{
    const next=path.nodes[index+1];return (byPair.get(`${node.uri}\u0000${next.uri}`)??[]).slice(0,2);
  })}));
}

export function shortResourceLabel(uri:string):string {
  let tail=uri.split(/[\/#]/).filter(Boolean).pop()??uri;
  try {tail=decodeURIComponent(tail);} catch { /* invalid percent escaping is nonfatal */ }
  return tail.length>48 ? `${tail.slice(0,45)}…` : tail;
}

async function readSparql(endpoint:string,query:string,signal:AbortSignal):Promise<SparqlResponse> {
  const response=await attributedSparqlFetch("/proxy/api/sparql", {method:"POST",headers:{"x-maestro-debug-source":"urn:maestro:component:Overview:ConnectionPath","x-maestro-debug-component":"Overview:ConnectionPath","Content-Type":"application/json"},body:JSON.stringify({addr:`@${endpoint}`,query}),signal});
  const json = await response.json().catch(() => null) as (SparqlResponse & {incomplete?:boolean;error?:string;details?:string}) | null;
  if (!response.ok) throw new Error(json?.error || json?.details || `Virtuoso connection query failed (HTTP ${response.status}).`);
  if (json?.incomplete || response.headers.get("X-Maestro-Incomplete") === "true")
    throw new Error("Virtuoso returned an incomplete connection search; a partial result cannot establish that no path exists.");
  if (!json?.results?.bindings) throw new Error("Virtuoso connection query returned no valid SPARQL result bindings.");
  return json;
}


const GENERIC_RELATIONS = new Set([
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  "http://dbpedia.org/property/entityType", "http://dbpedia.org/ontology/type",
]);
export function rankOverviewConnectionPaths(paths: ConnectionPath[]): ConnectionPath[] {
  // Short paths first, then paths with fewer classification links. Equal-depth
  // non-type relationships such as manufacturer outrank rdf:type. Distinct
  // predicate/neighbor signatures avoid a list of duplicated class paths.
  const seen=new Set<string>();
  const score=(path:ConnectionPath)=>path.nodes.length-1+4*path.edges.filter(e=>GENERIC_RELATIONS.has(e.predicate)).length;
  return [...paths].sort((a,b)=>score(a)-score(b) || a.nodes.length-b.nodes.length).filter(path=>{
    const key=path.nodes.map(n=>n.uri).join("|")+path.edges.map(e=>`${e.predicate}:${e.direction}`).join("|");
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).slice(0,OVERVIEW_CONNECTION_MAX_PATHS);
}

export async function findOverviewConnections(input:ConnectionInput,signal:AbortSignal):Promise<ConnectionPath[]> {
  const query=makeOverviewConnectionQuery(input);
  if(!query) throw new Error("Choose two distinct resource URIs and a valid graph server.");
  const boundedQuery = makeOverviewBoundedConnectionQuery(input);
  if (!boundedQuery) throw new Error("Choose two valid resource IRIs.");
  const shortPaths = rankOverviewConnectionPaths(readOverviewBoundedConnectionPaths(
    await readSparql(input.endpoint,boundedQuery,signal),input.source,input.target));
  if (shortPaths.some(path=>path.edges.length===1) || input.maxHops <= 2 ||
      (shortPaths.length >= OVERVIEW_CONNECTION_MAX_PATHS && shortPaths.some(path=>path.edges.some(e=>!GENERIC_RELATIONS.has(e.predicate))))) return shortPaths;
  // Shortest generic class paths often dominate DBpedia. When the user asks
  // for deeper links, seek a shortest path that does NOT traverse rdf:type;
  // this is an additional valid path, never a replacement for real class edges.
  const wantNonType = !input.predicate && shortPaths.length>0 && shortPaths.every(path=>path.edges.every(e=>GENERIC_RELATIONS.has(e.predicate)));
  const deepQuery = wantNonType ? makeOverviewConnectionQuery(input,true) : query;
  if (!deepQuery) return shortPaths;
  let paths:ConnectionPath[];
  try { paths=readOverviewConnectionPaths(await readSparql(input.endpoint,deepQuery,signal),input.source,input.target); }
  catch (error) { if (signal.aborted || !shortPaths.length) throw error; return shortPaths; }
  if(!paths.length) return shortPaths;
  const edgesQuery=makeOverviewConnectionEdgesQuery(paths,input.graph);
  if(!edgesQuery) return shortPaths;
  let completed:ConnectionPath[];
  try { completed=attachOverviewConnectionEdges(paths,await readSparql(input.endpoint,edgesQuery,signal)); }
  catch(error) { if(signal.aborted || !shortPaths.length) throw error; return shortPaths; }
  // Only verified edges, and a bounded maximum of ten resulting paths.
  const verified=completed.filter(path=>path.nodes.length-1 === new Set(path.edges.map(edge=>`${edge.from}\0${edge.to}`)).size);
  return rankOverviewConnectionPaths([...shortPaths,...verified]);
}
