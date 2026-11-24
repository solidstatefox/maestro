"use client";
/** Build-time RDF archives are static files. At login the browser owns the
 * graph import transaction and talks to the graph server using SPARQL Update.
 * The Next.js host never reads graph/ at request time or seeds user accounts. */
import { GRAPH, resolveGraph, type GraphKey } from "@/lib/constants/graphs";
import { personalContext, selectPersonal, updatePersonal } from "@/lib/client-personal-sparql";
import { invalidateClientStatusMachines } from "@/lib/status-machine-client";
import { createBlankNodeLabelAllocator } from "@/lib/bnode";
import { MUI_NS } from "@/lib/personal-status-vocabulary";
import { destinationSeedDigest } from "@/lib/graph-seed-content-digest";

type Term = {termType: "NamedNode" | "BlankNode" | "Literal"; value: string; language?: string; datatype?: {value:string}};
type Triple = {subject:Term; predicate:Term; object:Term};
type Asset = {file:string; destination:string; digest:string; triples:Triple[]};
type Entry = {file:string;asset:string;destination:string};
const PREFIX="/maestro-seed/";
const BASE_PLACEHOLDER="https://seed.maestro.invalid/base";
const MUI_PROVIDER=`${MUI_NS}Provider`;
const RDF_TYPE="http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const enc=(value:string)=>value.replace(/[\u0000-\u0020<>"{}|^`\\]/g,char=>`\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4,"0")}`);
const iri=(value:string)=>`<${enc(value)}>`;
function literal(term:Term):string {
  const value=term.value.replace(/[\\"\n\r\t\u0000-\u001f\u007f]/g,char=>{
    switch(char){case "\\":return "\\\\";case '"':return '\\"';case "\n":return "\\n";case "\r":return "\\r";case "\t":return "\\t";
      default:return `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4,"0")}`;}
  });
  if(term.language)return `"${value}"@${term.language}`;
  const datatype=term.datatype?.value;
  if(datatype&&datatype!=="http://www.w3.org/2001/XMLSchema#string"&&datatype!==`${RDF_TYPE.slice(0,RDF_TYPE.lastIndexOf('#')+1)}langString`)
    return `"${value}"^^${iri(datatype)}`;
  return `"${value}"`;
}
function buildInsertData(graph:string,triples:Triple[],base:string):string {
  const bnodeId=createBlankNodeLabelAllocator("m");
  const term=(entry:Term):string=>{
    const value=entry.value.replace(/^urn:maestro:graph:([\s\S]*)$/,(_match,suffix:string)=>`${base}${suffix}`)
      .replace(BASE_PLACEHOLDER,graph);
    switch(entry.termType){
      case "NamedNode":return iri(value);
      case "BlankNode":return `_:${bnodeId(value)}`;
      case "Literal":return literal({...entry,value});
    }
  };
  const lines=triples.map(t=>`${term(t.subject)} ${term(t.predicate)} ${term(t.object)} .`);
  const update=`INSERT DATA { GRAPH ${iri(graph)} {\n${lines.join("\n")}\n} }`;
  if(new TextEncoder().encode(update).byteLength>900_000)throw new Error("RDF archive exceeds one atomic SPARQL Update; cannot split blank-node identities.");
  return update;
}
async function staticJson<T>(url:string,signal?:AbortSignal):Promise<T> {
  const response=await fetch(url,{cache:"no-store",signal});
  if(!response.ok)throw new Error(`Missing static graph-seed asset ${url} (HTTP ${response.status}). Run prebuild.`);
  return response.json() as Promise<T>;
}
function target(base:string,destination:string):string {
  // Asset destinations are stable graph registry keys; an absolute IRI is
  // accepted only for externally authored immutable seed destinations.
  if(/^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(destination))return destination;
  if(!Object.values(GRAPH).includes(destination as GraphKey))throw new Error(`Unknown graph registry key: ${destination}`);
  return resolveGraph(destination as GraphKey,base);
}

/** Static RDF is a browser resource, not an authenticated graph write.
 * Hydrate it once on page load, independently of the personal session. A
 * failed fetch is retriable and never blocks public browsing or login. */
let browserAssets:Promise<Array<{entry:Entry;asset:Asset}>>|null=null;
function browserGraphAssets():Promise<Array<{entry:Entry;asset:Asset}>> {
  if(browserAssets)return browserAssets;
  browserAssets=(async()=>{
    const manifest=await staticJson<Entry[]>(`${PREFIX}manifest.json`,AbortSignal.timeout(30_000));
    if(!Array.isArray(manifest)||!manifest.length)throw new Error("No static graph-seed manifest entries.");
    const entries=manifest.filter(entry=>!["dataserver-seed.ttl","eu-data/endpoints.ttl"].includes(entry.file));
    const assets:Array<{entry:Entry;asset:Asset}>=new Array(entries.length);
    let cursor=0;
    const worker=async()=>{
      for(;;){
        const index=cursor++;
        if(index>=entries.length)return;
        const entry=entries[index];
        if(!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(entry.file)||
          !/^[a-f0-9]{64}\.json$/.test(entry.asset))throw new Error("Unsafe static graph-seed entry.");
        const asset=await staticJson<Asset>(`${PREFIX}${entry.asset}`,AbortSignal.timeout(30_000));
        if(asset.file!==entry.file||asset.destination!==entry.destination||
          !/^sha256:[0-9a-f]{64}$/.test(asset.digest)||!Array.isArray(asset.triples))
          throw new Error(`Invalid graph-seed asset for ${entry.file}.`);
        assets[index]={entry,asset};
      }
    };
    await Promise.all(Array.from({length:Math.min(4,entries.length)},()=>worker()));
    return assets;
  })().catch(error=>{browserAssets=null;throw error;});
  return browserAssets;
}
/** May run before authentication: no personalContext, SPARQL or credentials. */
export async function initializeBrowserGraphAssets():Promise<void>{await browserGraphAssets();}

const seedInFlight=new Map<string,Promise<Array<{file:string;graph:string}>>>();
export async function seedPersonalGraphs(signal?:AbortSignal):Promise<Array<{file:string;graph:string}>> {
  const ctx=await personalContext(),key=ctx.addr+"|"+ctx.base;
  const pending=seedInFlight.get(key);
  if(pending)return pending;
  const task=(async()=>{
    // The graph-server courtesy list is NOT a personal RDF seed graph.
    // It lives in the browser's grouped directory and is digest-checked against
    // the proxy's static flat files. Never CLEAR the user's Shared group.
    // Static assets are already available from the independent browser boot
    // when possible. Awaiting them here never starts an authenticated fetch.
    const entries=await browserGraphAssets();
    if(signal?.aborted)throw signal.reason;
    // Preflight *every* compiled /graph document before clearing a single
    // personal graph. An unavailable or stale asset must not erase the user's
    // existing provider definitions, registry, ontology or Status machines.
    const documents:Array<{entry:Entry;graph:string;triples:Triple[];digest:string}>=[];
    for(const {entry,asset} of entries){
      if(signal?.aborted)throw signal.reason;
      const graph=target(ctx.base,entry.destination);
      const triples=[...asset.triples];
      for(const resource of new Set(triples.filter(t=>t.predicate.value===RDF_TYPE&&t.object.value===MUI_PROVIDER&&t.subject.termType==="NamedNode").map(t=>t.subject.value)))
        triples.push({subject:{termType:"NamedNode",value:resource},predicate:{termType:"NamedNode",value:`${MUI_NS}implementationDigest`},object:{termType:"Literal",value:asset.digest}});
      // Verify the complete SPARQL serialization before making any changes.
      if(triples.length)buildInsertData(graph,triples,ctx.base);
      documents.push({entry,graph,triples,digest:asset.digest});
    }
    // Reuse the build-time content SHA-256 fingerprints already installed as
    // mui:implementationDigest for curator approval. The graph's seedDigest is
    // an aggregate of those same fingerprints, not of stable asset filenames.
    const groups=new Map<string,Array<{file:string;digest:string}>>();
    for(const {entry,graph,digest} of documents){
      const current=groups.get(graph)??[];
      current.push({file:entry.file,digest});
      groups.set(graph,current);
    }
    const desired=new Map<string,string>();
    for(const [graph,items] of groups)desired.set(graph,await destinationSeedDigest(
      items,
    ));
    const seedPredicate=`${MUI_NS}seedDigest`;
    const existing=new Map<string,string>();
    // One batched read, not one ASK per graph. A missing marker means this
    // graph came from a pre-digest version of Maestro and must be reseeded.
    const rows=await selectPersonal(`SELECT ?graph ?digest WHERE {
      VALUES ?graph { ${[...groups.keys()].map(iri).join(" ")} }
      GRAPH ?graph { ?graph ${iri(seedPredicate)} ?digest }
    }`,ctx,signal,"GraphSeed:CheckDigests");
    for(const row of rows){const graph=row.graph?.value,digest=row.digest?.value;
      if(graph&&digest)existing.set(graph,digest);
    }
    const changed=new Set([...groups.keys()].filter(graph=>existing.get(graph)!==desired.get(graph)));
    const cleared=new Set<string>(),loaded:Array<{file:string;graph:string}>=[];
    for(const {entry,graph,triples} of documents){
      if(!changed.has(graph)){loaded.push({file:entry.file,graph});continue;}
      if(!cleared.has(graph)){await updatePersonal(`CLEAR SILENT GRAPH ${iri(graph)}`,signal,undefined,"client-graph-seed:seedPersonalGraphs");cleared.add(graph);}
      // The browser sends RDF triples to the existing SPARQL Update transport.
      // The remote graph server never dereferences Maestro's localhost URL.
      if(triples.length)await updatePersonal(buildInsertData(graph,triples,ctx.base),signal,undefined,"client-graph-seed:seedPersonalGraphs");
      loaded.push({file:entry.file,graph});
    }
    // A marker is written only after all assets for that destination have
    // succeeded. A partial import therefore self-heals on the next login.
    for(const graph of changed)await updatePersonal(`INSERT DATA { GRAPH ${iri(graph)} {
      ${iri(graph)} ${iri(seedPredicate)} "${desired.get(graph)}" . } }`,signal,undefined,"client-graph-seed:seedPersonalGraphs");
    invalidateClientStatusMachines();
    return loaded;
  })();
  seedInFlight.set(key,task);
  try{return await task;}finally{if(seedInFlight.get(key)===task)seedInFlight.delete(key);}
}
