import { maestroQueryFetch } from "./client-query-cache";
/** Virtual Record over the complete live FCT population.
 * Report (predicate, RDF value) pairs shared by every distinct focus member.
 * This never materializes a page of URIs and never writes synthetic RDF. */
import { cloneOverviewPopulationQuery } from "./overview-population";
import { compileFctXmlToSparql } from "./fct-sparql-translator";
import { splitCompiledSelect } from "./provider-fct-context";

export type CommonProperty = { predicate:string; value:string; termType:string; datatype?:string; lang?:string };
type Binding={type?:string;value?:string;datatype?:string;"xml:lang"?:string};
type SparqlResponse={results?:{bindings?:Array<Record<string,Binding>>};incomplete?:boolean;error?:string};
const isIri = (iri:string) => /^[A-Za-z][A-Za-z\d+.-]*:[^\s<>"{}|^`\\]+$/.test(iri);
export function buildOverviewCommonPropertiesQueries(liveXml:string):{endpoint:string;count:string;values:(total:number)=>string} {
  const compiled=compileFctXmlToSparql(cloneOverviewPopulationQuery(liveXml,1));
  const doc=new DOMParser().parseFromString(liveXml,"application/xml");
  const addr=doc.documentElement.getAttribute("addr")??"";
  const at=addr.indexOf("@");
  const graph=at>=0?addr.slice(0,at).trim():"";
  const endpoint=at>=0?addr.slice(at+1).trim():"";
  if(!/^https?:\/\//.test(endpoint) || !/^\?[A-Za-z][A-Za-z0-9_]*$/.test(compiled.target))throw new Error("Invalid FCT population for common Record properties.");
  const {prefix,where}=splitCompiledSelect(compiled.query);
  const focus=compiled.target;
  const population=`{ SELECT DISTINCT ${focus} WHERE { ${where} } }`;
  const relation=`${focus} ?predicate ?value .`;
  const scoped=graph && graph!=="$ALL$"&&isIri(graph)?`GRAPH <${graph}> { ${relation} }`:relation;
  return {endpoint,count:`${prefix} SELECT (COUNT(DISTINCT ${focus}) AS ?total) WHERE { ${population} }`,
    values:(total:number)=>`${prefix} SELECT ?predicate ?value (COUNT(DISTINCT ${focus}) AS ?members) WHERE { ${population} ${scoped} }
      GROUP BY ?predicate ?value HAVING (COUNT(DISTINCT ${focus}) = ${total})`};
}
async function aggregate(endpoint:string,query:string,signal:AbortSignal):Promise<SparqlResponse> {
  const res=await maestroQueryFetch("/proxy/api/sparql",{method:"POST",headers:{"Content-Type":"application/json"},signal,body:JSON.stringify({addr:`@${endpoint}`,query})});
  const json=await res.json().catch(()=>null) as SparqlResponse|null;
  if(!res.ok || json?.error)throw new Error(json?.error || `Common Record query failed HTTP ${res.status}`);
  if(!json || json.incomplete || !Array.isArray(json.results?.bindings))throw new Error("Common Record query did not complete; no partial intersections shown.");
  return json;
}
export async function readOverviewCommonProperties(liveXml:string,signal:AbortSignal):Promise<{population:number;properties:CommonProperty[]}> {
  const queries=buildOverviewCommonPropertiesQueries(liveXml);
  const total=Number((await aggregate(queries.endpoint,queries.count,signal)).results?.bindings?.[0]?.total?.value);
  if(!Number.isSafeInteger(total)||total<0)throw new Error("Invalid FCT population count for virtual Record.");
  if(total===0)return {population:0,properties:[]};
  const rows=(await aggregate(queries.endpoint,queries.values(total),signal)).results?.bindings??[];
  return {population:total,properties:rows.flatMap(row=>{
    const predicate=row.predicate?.value??"",value=row.value?.value??"";
    return isIri(predicate)&&value ? [{predicate,value,termType:row.value?.type??"literal",
      ...(row.value?.datatype?{datatype:row.value.datatype}:{}),
      ...(row.value?.["xml:lang"]?{lang:row.value["xml:lang"]}:{})}] : [];
  })};
}
