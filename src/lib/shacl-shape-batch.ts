/** Bounded shape graph reads. A shape is evaluated only against a complete,
 * response-local closure. No blank-node labels are joined across responses. */
export type ShapeBinding = {type?:string;value?:string;datatype?:string;"xml:lang"?:string};
export type ShapeRow = Record<string,ShapeBinding>;
export type ShapeRead = {rows:ShapeRow[];error?:never}|{rows?:never;error:Error};
const SH="http://www.w3.org/ns/shacl#", RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const valid=(iri:string)=>iri.length<4096&&/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri);
const safe=(iri:string)=>{if(!valid(iri))throw new Error("Invalid SHACL graph or shape IRI.");return `<${iri}>`;};
const path="sh:property|sh:in|sh:or|sh:and|sh:xone|sh:not|sh:node|sh:qualifiedValueShape|sh:path|sh:alternativePath|sh:inversePath|sh:zeroOrMorePath|sh:oneOrMorePath|sh:zeroOrOnePath|rdf:first|rdf:rest";
export const SHAPE_BATCH_SIZE=8;
export function buildShapeBatchQuery(graph:string,shapes:readonly string[],limit:number):string {
  if(!shapes.length||shapes.length>SHAPE_BATCH_SIZE||!Number.isSafeInteger(limit)||limit<2||limit>5001)throw new Error("Invalid SHACL shape batch bounds.");
  // A separate bounded subselect per shape prevents one large closure from
  // starving other shapes. The outer tag is a named IRI, not a blank label.
  const branches=shapes.map(shape=>`{ { SELECT DISTINCT ?s ?p ?o WHERE { GRAPH ${safe(graph)} { ${safe(shape)} (${path})* ?s . ?s ?p ?o . } } LIMIT ${limit} } BIND(${safe(shape)} AS ?shape) }`);
  return `PREFIX sh: <${SH}> PREFIX rdf: <${RDF}>\nSELECT ?shape ?s ?p ?o WHERE { ${branches.join(" UNION ")} } LIMIT ${shapes.length*limit+1}`;
}
export async function readShapeBatches(graph:string,shapes:readonly string[],limit:number,read:(query:string,signal:AbortSignal)=>Promise<ShapeRow[]>,signal:AbortSignal):Promise<Map<string,ShapeRead>> {
  const output=new Map<string,ShapeRead>();
  async function batch(ids:string[]):Promise<void>{
    signal.throwIfAborted();
    try {
      const rows=await read(buildShapeBatchQuery(graph,ids,limit),signal);
      signal.throwIfAborted();
      if(rows.length>ids.length*limit)throw new Error("SHACL batch exceeds its complete-response bound.");
      const grouped=new Map(ids.map(id=>[id,[] as ShapeRow[]]));
      for(const row of rows){
        const id=row.shape?.value;
        if(!id||row.shape.type!=="uri"||!grouped.has(id))throw new Error("SHACL batch returned an unexpected shape identity.");
        const {shape: _shape,...triple}=row;
        if(!["uri","bnode"].includes(triple.s?.type??"")||triple.p?.type!=="uri"||typeof triple.s?.value!=="string"||typeof triple.p?.value!=="string"||typeof triple.o?.value!=="string"||!["uri","bnode","literal","typed-literal"].includes(triple.o.type??""))throw new Error("Incomplete RDF triple in SHACL batch.");
        grouped.get(id)!.push(triple);
      }
      for(const [id,items] of grouped)output.set(id,items.length===0?{error:new Error(`SHACL shape ${id} is missing from the personal graph.`)}:items.length>=limit?{error:new Error(`SHACL shape ${id} exceeds the safe size; validation incomplete.`)}:{rows:items});
    }catch(error){
      signal.throwIfAborted();
      // Do not multiply an upstream outage into one request per shape.
      // The affected batch fails closed; independent batches can still finish.
      for(const id of ids)output.set(id,{error:error instanceof Error?error:new Error(String(error))});
    }
  }
  const ids=[...new Set(shapes)];
  for(let start=0;start<ids.length;start+=SHAPE_BATCH_SIZE)await batch(ids.slice(start,start+SHAPE_BATCH_SIZE));
  return output;
}
