"use client";
/** Build-time RDF archives are static files. At login the browser owns the
 * graph import sequence and talks to the graph server using SPARQL Update.
 * The Next.js host never reads graph/ at request time or seeds user accounts. */
import { GRAPH, resolveGraph, type GraphKey } from "@/lib/constants/graphs";
import { personalContext, selectPersonal, updatePersonal, type PersonalRows } from "@/lib/client-personal-sparql";
import { invalidateClientStatusMachines } from "@/lib/status-machine-client";
import { createBlankNodeLabelAllocator } from "@/lib/bnode";
import { MUI_NS } from "@/lib/personal-status-vocabulary";
import { graphForPrefix } from "@/lib/personal-auth";
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
  // Manifest is always authoritative. Individual compiled payloads have
  // content-addressed filenames and are safe to share across same-origin tabs.
  const immutable=/\/[a-f0-9]{64}\.json$/.test(url);
  const store=immutable && typeof caches!=="undefined" ? await caches.open("maestro-rdf-assets-v2").catch(()=>null) : null;
  signal?.throwIfAborted();
  const cached=await store?.match(url).catch(()=>undefined);
  if(cached){
    try { const result=await cached.json() as T; signal?.throwIfAborted(); return result; }
    catch { await store?.delete(url).catch(()=>false); signal?.throwIfAborted(); }
  }
  const response=await fetch(url,{cache:immutable?"force-cache":"no-store",signal});
  if(!response.ok)throw new Error(`Missing static graph-seed asset ${url} (HTTP ${response.status}). Run prebuild.`);
  const copy=store ? response.clone() : null;
  const result=await response.json() as T;
  signal?.throwIfAborted();
  if(copy)await store?.put(url,copy).catch(()=>{});
  return result;
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
    if(typeof caches!=="undefined")void caches.open("maestro-rdf-assets-v2").then(async cache=>{
      const live=new Set(entries.map(entry=>`${PREFIX}${entry.asset}`));
      for(const request of await cache.keys())if(!live.has(new URL(request.url).pathname))await cache.delete(request);
    }).catch(()=>{});
    return assets;
  })().catch(error=>{browserAssets=null;throw error;});
  return browserAssets;
}
/** May run before authentication: no personalContext, SPARQL or credentials. */
export async function initializeBrowserGraphAssets():Promise<void>{await browserGraphAssets();}

const seedPredicate=`${MUI_NS}seedDigest`;
type Document={entry:Entry;graph:string;triples:Triple[];digest:string};
export type SeedPlan={base:string;documents:Document[];desired:Map<string,string>;revision:string;query:string};
export type SeedResult={revision:string;changedGraphs:string[]};
const seedSource="GraphSeed:CheckDigests";
function resolvedValue(value:string,graph:string,base:string):string {
  return value.replace(/^urn:maestro:graph:([\s\S]*)$/,(_match,suffix:string)=>`${base}${suffix}`).replace(BASE_PLACEHOLDER,graph);
}
/** Include one result per destination even if no marker exists. A missing row
 * is incomplete evidence, not an empty graph. */
export function seedDigestSelect(graphs:readonly string[]):string {
  return `SELECT ?graph ?digest WHERE { VALUES ?graph { ${graphs.map(iri).join(" ")} } OPTIONAL { GRAPH ?graph { ?graph ${iri(seedPredicate)} ?digest } } }`;
}
export function parseSeedDigests(rows:PersonalRows,graphs:readonly string[]):Map<string,string> {
  const expected=new Set(graphs), found=new Map<string,string>();
  for(const row of rows){
    const graph=row.graph?.value;
    if(!graph||!expected.has(graph)||found.has(graph)||row.graph.type!=="uri")throw new Error("Invalid or conflicting graph seed digest result.");
    const digest=row.digest?.value??"";
    if(row.digest && (!/^[a-f0-9]{64}$/.test(digest)||row.digest.type!=="literal"))throw new Error("Invalid graph seed digest marker.");
    found.set(graph,digest);
  }
  if(found.size!==expected.size)throw new Error("Incomplete graph seed digest result.");
  return found;
}
/** Static preparation can occur before the initial Digest challenge. */
export async function preparePersonalSeed(graphPrefix:string,signal?:AbortSignal):Promise<SeedPlan> {
  const base=graphForPrefix(graphPrefix);
  const entries=await browserGraphAssets();
  const documents:Array<Document>=[];
  const groups=new Map<string,Array<{file:string;digest:string}>>();
  for(const {entry,asset} of entries){
    signal?.throwIfAborted();
    const graph=target(base,entry.destination);
    // Only distributed graph definitions are writable by this synchronizer.
    if(![GRAPH.SHACL_POLICIES,GRAPH.ONTOLOGY_CACHE,GRAPH.STATE_MACHINES,GRAPH.OTC_TRANSCODERS,GRAPH.GRAPHS].some(key=>resolveGraph(key,base)===graph))throw new Error(`Unmanaged seed destination: ${graph}`);
    const triples=[...asset.triples];
    for(const resource of new Set(triples.filter(t=>t.predicate.value===RDF_TYPE&&t.object.value===MUI_PROVIDER&&t.subject.termType==="NamedNode").map(t=>t.subject.value)))
      triples.push({subject:{termType:"NamedNode",value:resource},predicate:{termType:"NamedNode",value:`${MUI_NS}implementationDigest`},object:{termType:"Literal",value:asset.digest}});
    if(triples.length)buildInsertData(graph,triples,base);
    documents.push({entry,graph,triples,digest:asset.digest});
    const current=groups.get(graph)??[];current.push({file:entry.file,digest:asset.digest});groups.set(graph,current);
  }
  const desired=new Map<string,string>();
  for(const [graph,items] of groups)desired.set(graph,await destinationSeedDigest(items,"managed-definition-slots-v1"));
  const revision=await destinationSeedDigest([...desired].map(([file,digest])=>({file,digest})));
  return {base,documents,desired,revision,query:seedDigestSelect([...desired.keys()])};
}
/** The distributed documents own their named subject/predicate slots. Do not
 * clear mixed graphs, or delete triples on user resources. Template content
 * is a single logical slot with two supported predicates. */
export function managedSeedDeletes(plan:SeedPlan,graph:string):string[] {
  const slots=new Set<string>();
  const rdfValue=RDF_TYPE.replace(/type$/,"value"), templateContent=`${MUI_NS}templateContent`;
  for(const doc of plan.documents.filter(doc=>doc.graph===graph))for(const triple of doc.triples){
    if(triple.subject.termType!=="NamedNode")continue;
    const subject=iri(resolvedValue(triple.subject.value,graph,plan.base));
    const predicate=resolvedValue(triple.predicate.value,graph,plan.base);
    slots.add(`(${subject} ${iri(predicate)})`);
    if((predicate===rdfValue||predicate===templateContent)&&triple.object.termType==="Literal"&&/xsl:(stylesheet|transform)/.test(triple.object.value)){
      slots.add(`(${subject} ${iri(rdfValue)})`);slots.add(`(${subject} ${iri(templateContent)})`);
    }
  }
  // The definition's declared rdf:type slot is authoritative, like its shape.
  const all=[...slots];const updates:string[]=[];
  for(let i=0;i<all.length;i+=120){
    const update=`DELETE { GRAPH ${iri(graph)} { ?s ?p ?o } } WHERE { VALUES (?s ?p) { ${all.slice(i,i+120).join(" ")} } GRAPH ${iri(graph)} { ?s ?p ?o } }`;
    if(update.length>100000)throw new Error("Managed graph deletion exceeds SPARQL limit.");
    updates.push(update);
  }
  return updates;
}
/** Initialization is already serialized by withSessionInitializationLock.
 * Never reuse another attempt's Promise: its AbortSignal belongs to a
 * different login/restore generation and may already be cancelled. */
export async function seedPersonalGraphs(signal?:AbortSignal,prepared?:SeedPlan,initialRows?:PersonalRows):Promise<SeedResult> {
  signal?.throwIfAborted();
  const ctx=await personalContext();
  signal?.throwIfAborted();
  const plan=prepared??await preparePersonalSeed(ctx.session.graphPrefix,signal);
  if(plan.base!==ctx.base)throw new Error("Seed plan belongs to another personal graph.");
  const graphs=[...plan.desired.keys()];
  const rows=initialRows??await selectPersonal(plan.query,ctx,signal,seedSource);
  const existing=parseSeedDigests(rows,graphs);
  const changed=new Set(graphs.filter(graph=>existing.get(graph)!==plan.desired.get(graph)));
  const operations=[...changed].map(graph=>({graph,deletes:managedSeedDeletes(plan,graph),inserts:plan.documents.filter(doc=>doc.graph===graph&&doc.triples.length).map(doc=>buildInsertData(graph,doc.triples,ctx.base))}));
  // Validate provider declarations and literal template content from the actual
  // graph, not merely the marker written by this client. No downloads of
  // unrelated personal resources, and no count-only acceptance of XSLT.
  const verifyProviderDefinitions=async(graph:string)=>{
    if(graph!==resolveGraph(GRAPH.SHACL_POLICIES,plan.base))return;
    const predicates=new Set([`${MUI_NS}accepts`,`${MUI_NS}widget`,`${MUI_NS}endpointDiscoveryQuery`,`${MUI_NS}templateContent`,RDF_TYPE.replace(/type$/,"value"),"http://www.w3.org/ns/shacl#class","http://www.w3.org/ns/shacl#targetClass"]);
    const slots=new Map<string,{s:string;p:string;values:Set<string>}>();
    const rdfValue=RDF_TYPE.replace(/type$/,"value"), templateContent=`${MUI_NS}templateContent`;
    const key=(s:string,p:string)=>JSON.stringify([s,p]);
    const slot=(s:string,p:string)=>{const k=key(s,p);let result=slots.get(k);if(!result){result={s,p,values:new Set()};slots.set(k,result);}return result;};
    for(const doc of plan.documents.filter(doc=>doc.graph===graph))for(const t of doc.triples){
      if(t.subject.termType!=="NamedNode"||!predicates.has(t.predicate.value)||t.object.termType==="BlankNode")continue;
      const s=resolvedValue(t.subject.value,graph,plan.base),p=t.predicate.value;
      if((p===rdfValue||p===templateContent)&&t.object.termType==="Literal"&&/xsl:(stylesheet|transform)/.test(t.object.value)){slot(s,rdfValue);slot(s,templateContent);}
      slot(s,p).values.add(resolvedValue(t.object.value,graph,plan.base));
    }
    // Skip slots containing blank nodes: their graph-local identifiers are
    // not portable. Their original RDF structures are inserted as a unit.
    for(const doc of plan.documents.filter(doc=>doc.graph===graph))for(const t of doc.triples)
      if(t.subject.termType==="NamedNode"&&t.object.termType==="BlankNode")slots.delete(key(resolvedValue(t.subject.value,graph,plan.base),t.predicate.value));
    const items=[...slots.values()];
    for(let i=0;i<items.length;i+=30){
      const batch=items.slice(i,i+30);
      const rows=await selectPersonal(`SELECT ?s ?p ?o WHERE { VALUES (?s ?p) { ${batch.map(t=>`(${iri(t.s)} ${iri(t.p)})`).join(" ")} } GRAPH ${iri(graph)} { ?s ?p ?o } }`,ctx,signal,"GraphSeed:VerifyDefinitions");
      const actual=new Map<string,Set<string>>();
      for(const row of rows){const k=key(row.s?.value??"",row.p?.value??"");const values=actual.get(k)??new Set<string>();if(typeof row.o?.value!=="string")throw new Error("Invalid seeded definition response.");values.add(row.o.value);actual.set(k,values);}
      for(const t of batch){const values=actual.get(key(t.s,t.p))??new Set<string>();if(values.size!==t.values.size||[...t.values].some(value=>!values.has(value)))throw new Error(`Seeded provider definition verification failed: ${t.s} ${t.p}`);}
    }
  };
  const write=(update:string)=>updatePersonal(update,signal,undefined,"GraphSeed:Synchronize",ctx.session);
  for(const {graph,deletes,inserts} of operations){
    signal?.throwIfAborted();
    // Remove the old completion marker first. Failed partial writes cannot
    // be mistaken for a completed import on the next initialization.
    await write(`DELETE WHERE { GRAPH ${iri(graph)} { ${iri(graph)} ${iri(seedPredicate)} ?digest } }`);
    for(const update of deletes)await write(update);
    for(const update of inserts)await write(update);
    await verifyProviderDefinitions(graph);
    await write(`INSERT DATA { GRAPH ${iri(graph)} { ${iri(graph)} ${iri(seedPredicate)} "${plan.desired.get(graph)}" . } }`);
  }
  if(changed.size){
    const verified=parseSeedDigests(await selectPersonal(plan.query,ctx,signal,"GraphSeed:VerifyDigests"),graphs);
    if(graphs.some(graph=>verified.get(graph)!==plan.desired.get(graph)))throw new Error("Graph seed digest verification failed.");
    invalidateClientStatusMachines();
  }
  signal?.throwIfAborted();
  return {revision:plan.revision,changedGraphs:[...changed]};
}
