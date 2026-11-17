"use client";
/** Linked Data ontology imports are browser-controlled RDF-to-SPARQL workflows.
 * The host is only a bounded CORS transport; no ingest or graph state there. */
import { personalContext, updatePersonal } from "@/lib/client-personal-sparql";
import { forwardHttp } from "@/lib/client-http-forward";
import { clientRdfInsert, parseClientRdf, type ClientRdfTriple } from "@/lib/client-rdf-ingest";

const RDFS_IS_DEFINED_BY="http://www.w3.org/2000/01/rdf-schema#isDefinedBy";
const OWL_IMPORTS="http://www.w3.org/2002/07/owl#imports";
const RDF_TYPE="http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PROV="http://www.w3.org/ns/prov#",XSD="http://www.w3.org/2001/XMLSchema#dateTime";
const MAX_DOCUMENTS=12,MAX_DEPTH=2,MAX_BYTES=750_000,MAX_TRIPLES=3500,RETRY_AFTER=6*60*60*1000;
const attempts=new Map<string,number>();
const safe=(u:string)=>u.length<=4096&&/^https?:\/\/[^\s<>"{}|^`\\]+$/i.test(u);
const iri=(value:string)=>({termType:"NamedNode" as const,value});
const lit=(value:string)=>({termType:"Literal" as const,value,datatype:{value:XSD}});
async function hash(value:string):Promise<string>{
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function extension(contentType:string):string|null{
  const mime=contentType.split(";",1)[0].trim().toLowerCase();
  if(["text/turtle","application/x-turtle","application/turtle","application/n3"].includes(mime))return ".ttl";
  if(["application/rdf+xml","application/owl+xml"].includes(mime))return ".rdf";
  if(mime==="application/n-triples")return ".nt";
  if(mime==="application/n-quads")return ".nq";
  if(mime==="application/ld+json")return ".jsonld";
  return null;
}
async function fetchRdf(start:string,signal?:AbortSignal):Promise<{text:string;ext:string;document:string}|null>{
  let target=start;
  for(let hop=0;hop<5;hop++){
    if(!safe(target))return null;
    const url=new URL(target);url.hash="";
    const response=await forwardHttp({url:url.toString(),method:"GET",headers:{
      Accept:"text/turtle, application/rdf+xml;q=0.95, application/n-triples;q=0.8, application/ld+json;q=0.5",
    }},signal);
    if(response.status>=300&&response.status<400){
      const location=response.headers.get("location");if(!location)return null;
      target=new URL(location,url).toString();continue;
    }
    if(!response.ok)return null;
    const ext=extension(response.headers.get("content-type")??"");if(!ext)return null;
    if(Number(response.headers.get("content-length")??"0")>MAX_BYTES)return null;
    const reader=response.body?.getReader();if(!reader)return null;
    const chunks:Uint8Array[]=[];let total=0;
    try{while(true){if(signal?.aborted)throw signal.reason;
      const {done,value}=await reader.read();if(done)break;
      total+=value.length;if(total>MAX_BYTES){await reader.cancel();return null;}
      chunks.push(value);
    }}finally{reader.releaseLock();}
    const bytes=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {text:new TextDecoder().decode(bytes),ext,document:url.toString()};
  }
  return null;
}
const namespaceOf=(uri:string)=>uri.includes("#")?uri.slice(0,uri.lastIndexOf("#")):uri.slice(0,uri.lastIndexOf("/")+1);
export type ClientOntologySummary={fetched:number;imported:number;failures:string[]};
export async function ingestClientOntologies(classes:string[],signal?:AbortSignal):Promise<ClientOntologySummary>{
  const requested=[...new Set(classes.filter(safe))].slice(0,100),ctx=await personalContext();
  const graph=`${ctx.base}/ontology`;
  const namespaces=new Map<string,string>();
  for(const uri of requested){const ns=namespaceOf(uri);if(ns&&!namespaces.has(ns))namespaces.set(ns,uri);}
  const queue=[...namespaces].slice(0,MAX_DOCUMENTS).map(([uri,representative])=>({uri,representative,depth:0}));
  const seen=new Set<string>(),summary:ClientOntologySummary={fetched:0,imported:0,failures:[]};
  while(queue.length&&seen.size<MAX_DOCUMENTS){
    if(signal?.aborted)throw signal.reason;
    const current=queue.shift()!;if(seen.has(current.uri))continue;
    seen.add(current.uri);
    const key=`${graph}|${current.uri}`,prior=attempts.get(key);
    if(prior&&Date.now()-prior<RETRY_AFTER)continue;
    attempts.set(key,Date.now());if(attempts.size>1024)attempts.delete(attempts.keys().next().value!);
    try{
      const response=await fetchRdf(current.uri,signal)??(current.representative!==current.uri?
        await fetchRdf(current.representative,signal):null);
      if(!response){
        // A publisher without Access-Control-Allow-Origin cannot be retrieved
        // by the SPA. Ask Virtuoso to load that public RDF URL into the user's
        // ontology graph instead; this is native SPARQL Update, not /service.
        const from=current.uri;
        if(safe(from)){
          try{await updatePersonal(`LOAD <${from}> INTO GRAPH <${graph}>`,signal);
            summary.fetched++;summary.imported++;continue;
          }catch(error){
            if(summary.failures.length<12)summary.failures.push(`${from}: ${error instanceof Error?error.message:String(error)}`);
          }
        }
        continue;
      }
      summary.fetched++;
      let triples=await parseClientRdf(response.text,response.ext,response.document);
      if(!triples.length||triples.length>MAX_TRIPLES)continue;
      const skolem=new Map<string,string>();
      const replace=async(term:ClientRdfTriple["subject"]):Promise<ClientRdfTriple["subject"]>=>{
        if(term.termType!=="BlankNode")return term;
        let value=skolem.get(term.value);
        if(!value){value=`urn:maestro:lod:blank:${await hash(response.document+"\0"+term.value)}`;skolem.set(term.value,value);}
        return iri(value);
      };
      const normalized:ClientRdfTriple[]=[];
      for(const t of triples)normalized.push({subject:await replace(t.subject),predicate:t.predicate,object:await replace(t.object)});
      triples=normalized;
      if(current.depth<MAX_DEPTH){
        for(const t of triples){if(t.object.termType!=="NamedNode"||t.predicate.termType!=="NamedNode")continue;
          if((t.predicate.value===RDFS_IS_DEFINED_BY||t.predicate.value===OWL_IMPORTS)&&safe(t.object.value)&&
            !seen.has(t.object.value)&&!queue.some(q=>q.uri===t.object.value))
            queue.push({uri:t.object.value,representative:t.object.value,depth:current.depth+1});
        }
      }
      const now=new Date().toISOString();const activity=iri(`urn:maestro:lod:retrieval:${await hash(response.document+"\0"+now)}`);
      const provenance:ClientRdfTriple[]=[
        {subject:activity,predicate:iri(RDF_TYPE),object:iri(`${PROV}Activity`)},
        {subject:activity,predicate:iri(`${PROV}used`),object:iri(response.document)},
        {subject:activity,predicate:iri(`${PROV}endedAtTime`),object:lit(now)},
        {subject:iri(graph),predicate:iri(`${PROV}wasDerivedFrom`),object:iri(response.document)},
      ];
      // Each skolemized RDF source is independent of other imports, so a
      // bounded batch can be inserted without losing blank-node identity.
      const writes=[...triples,...provenance];
      for(let offset=0;offset<writes.length;offset+=400)
        await updatePersonal(clientRdfInsert(graph,writes.slice(offset,offset+400)),signal);
      summary.imported++;
    }catch(error){if(signal?.aborted)throw error;
      if(summary.failures.length<12)summary.failures.push(`${current.uri}: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  return summary;
}
