"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { ErrorDetails } from "@/components/ui/error-details";
import { createMaestroViewDiscoveryController } from "@/lib/app-lifecycle/view-discovery";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { readMaestroConcurrency } from "@/lib/maestro-concurrency";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { parseFctExecutionAddress } from "@/lib/fct-execution-address";
import { providerStorage } from "@/lib/maestro-storage";
import { serializeFctQuery } from "@/lib/fct-query-serialize";
import type { FctQueryTree } from "@/lib/fct-query";
import type { SparqlJsonResults } from "@/lib/fct-sparql-translator";
import { predicateSynsetAlgorithm, type PredicateSynsetAlgorithm } from "@/lib/fct-view-types";
import { SYNSET_VERSION_QUERY, probeRuleAlignCapability, type SynsetCapability } from "@/lib/predicate-synset";
import { buildSynsetQuery, synsetCarrier, synsetTreeForRankedProperty, SYNSET_STORAGE_URI, SYNSET_SETTINGS, validSynsetSetting, type SynsetSettings } from "@/lib/property-synset-query";
import { PredicateQueryTray } from "./predicate-query-inspector";
import { traceFromFct, analyticalFctError, type QueryTrace } from "@/lib/predicate-query-diagnostics";
import { parseFctResponse } from "@/canvas/utils/fct-response";
import { PREDICATE_CLUSTERS_ANALYSIS_URI } from "@/lib/predicate-clusters-provider";
import { toLabel } from "@/lib/uri-labels";

type Row={uri:string;label:string;similarity:number};
type Setup={settings:SynsetSettings;capability:SynsetCapability};
type Props={tree:FctQueryTree;predicate:string;ready:boolean;cancelled:boolean;revision:number;accountScope:string;onTrace:(slot:"synset-capability"|"synset-search",entries:QueryTrace)=>void};
const headers=(component:string)=>({"Content-Type":"application/json",...proxyDebugHeaders("property-synset",component)});
async function setup(endpoint:string,accountScope:string,signal:AbortSignal,record:(entries:QueryTrace)=>void):Promise<Setup> {
  const storage=providerStorage(SYNSET_STORAGE_URI,accountScope);
  const settings={...SYNSET_SETTINGS};
  for(const key of Object.keys(settings) as (keyof SynsetSettings)[]) {
    signal.throwIfAborted();
    const saved=await storage.get(key);
    signal.throwIfAborted();
    if(saved===null) await storage.set(key,String(settings[key]));
    else {const value=saved.trim()?Number(saved):NaN;if(!validSynsetSetting(key,value)) throw new Error(`Invalid Sheet property synset setting: ${key}.`);settings[key]=value;}
  }
  const entries:QueryTrace=[];
  const capability=await probeRuleAlignCapability(async query=>{
    entries.push({label:query === SYNSET_VERSION_QUERY ? "Synset version probe" : "Synset SPARQL-BI probe",query,language:"sparql",endpoint});
    if(!signal.aborted)record([...entries]);
    const response=await maestroQueryFetch("/proxy/api/sparql",{method:"POST",cache:"no-store",headers:{...headers("PropertySynset:Capability"),"x-maestro-view-tab":"analyze","x-maestro-view-ribbon":PREDICATE_CLUSTERS_ANALYSIS_URI,"x-maestro-component-retry":"1"},signal,body:JSON.stringify({addr:`@${endpoint}`,query})});
    const raw=await response.text();
    signal.throwIfAborted();
    if(response.status!==200 || response.headers.get("X-Maestro-Incomplete")==="true") throw new Error(`SPARQL-BI capability probe returned HTTP ${response.status}.\n${raw}`);
    const data=JSON.parse(raw) as SparqlJsonResults & {incomplete?:boolean;error?:string};
    if(data.incomplete || data.error || !Array.isArray(data.results?.bindings)) throw new Error(`${data.error || "Incomplete SPARQL-BI probe response."}\n${raw}`);
    return data;
  },signal);
  return {settings,capability};
}
async function search(tree:FctQueryTree,algorithm:PredicateSynsetAlgorithm,settings:SynsetSettings,signal:AbortSignal,record:(entries:QueryTrace)=>void):Promise<Row[]> {
  const queryXml=buildSynsetQuery(tree,algorithm,settings);
  const fallback:QueryTrace=[{label:"Synset FCT (submitted)",query:queryXml,language:"xml"}];
  record(fallback);
  const response=await maestroQueryFetch("/proxy/api/fct",{method:"POST",cache:"no-store",headers:{...headers("PropertySynset:Search"),"x-maestro-view-tab":"analyze","x-maestro-view-ribbon":PREDICATE_CLUSTERS_ANALYSIS_URI,"x-maestro-concurrency":JSON.stringify(readMaestroConcurrency())},signal,body:JSON.stringify({queryXml})});
  const raw=await response.text();
  signal.throwIfAborted();
  record(traceFromFct(raw,fallback).map(entry=>({...entry,label:`Synset: ${entry.label}`})));
  if(response.status!==200) throw analyticalFctError(response.status,raw,"Property synset");
  const data=parseFctResponse(raw);
  if(data.incomplete || data.complete!=="yes" || data.viewType!=="properties-synset" || data.rows.length>settings.maxCandidates) throw analyticalFctError(response.status,raw,"Incomplete or invalid property synset response");
  const seen=new Set<string>();
  return data.rows.map(row=>{
    const p=row.find(c=>c.attributes.var==="c1");const score=row.find(c=>c.attributes.var==="similarity");
    const similarity=score?.value.trim()?Number(score.value):NaN;
    if(!p || p.termType!=="uri" || !p.value || p.value===synsetCarrier(tree)?.carrier.attributes.iri || seen.has(p.value) || !Number.isFinite(similarity) || similarity<=0 || similarity>1) throw new Error("Invalid property synset result.");
    seen.add(p.value);return {uri:p.value,label:p.label||toLabel(p.value),similarity};
  });
}
export function PropertySynsetButton(props:Props) {
  // Provider-owned dialog closes on query, selected predicate or account replacement.
  const source=useMemo(()=>{
    const tree=synsetTreeForRankedProperty(props.tree,props.predicate);
    if(!tree) return null;
    const carrier=synsetCarrier(tree);
    const endpoint=parseFctExecutionAddress(tree.attributes.addr??"")?.endpoint;
    return carrier&&endpoint?{tree,endpoint,iri:carrier.carrier.attributes.iri,xml:serializeFctQuery(tree)}:null;
  },[props.tree,props.predicate]);
  return source?<Launcher key={JSON.stringify([source.xml,props.accountScope,props.revision])} {...props} tree={source.tree} endpoint={source.endpoint} iri={source.iri}/>:<Button type="button" variant="outline" size="sm" disabled title="Select a ranked property in a supported FCT scope">Property synonyms</Button>;
}
function Launcher(props:Props&{endpoint:string;iri:string}) {
  const [open,setOpen]=useState(false);
  return <><Button type="button" variant="outline" size="sm" disabled={!props.ready||props.cancelled} onClick={()=>setOpen(true)}>Property synonyms</Button>{open&&<SynsetDialog {...props} close={()=>setOpen(false)}/>}</>;
}
function SynsetDialog({tree,endpoint,iri,ready,cancelled,accountScope,onTrace,close}:Props&{endpoint:string;iri:string;close:()=>void}) {
  const [algorithm,setAlgorithm]=useState<PredicateSynsetAlgorithm>("relation-agreement");
  const [page,setPage]=useState(0);
  const [capTrace,setCapTrace]=useState<QueryTrace>([]);
  const [searchTrace,setSearchTrace]=useState<QueryTrace>([]);
  const [capController]=useState(()=>createMaestroViewDiscoveryController<Setup>("maestro-property-synset-capability"));
  const [searchController]=useState(()=>createMaestroViewDiscoveryController<Row>("maestro-property-synset-search"));
  const cap=useSyncExternalStore(capController.subscribe,capController.getSnapshot,capController.getSnapshot);
  const result=useSyncExternalStore(searchController.subscribe,searchController.getSnapshot,searchController.getSnapshot);
  const attempt=useRef(0);
  useEffect(()=>{capController.start();searchController.start();return()=>{capController.stop();searchController.stop();};},[capController,searchController]);
  useEffect(()=>{
    if(cancelled||!ready){capController.cancel();searchController.cancel();return;}
    capController.discover(JSON.stringify([endpoint,accountScope]),async signal=>[await setup(endpoint,accountScope,signal,entries=>{if(!signal.aborted){setCapTrace(entries);onTrace("synset-capability",entries);}})]);
  },[capController,searchController,endpoint,accountScope,ready,cancelled]);
  const config=cap.matches("ready")?cap.context.items[0]:undefined;
  const rulealign=config?.capability.rulealign===true;
  const allowed=ready&&!cancelled&&!!config&&(algorithm!=="rulealign"||rulealign);
  const run=()=>{if(!allowed||!config)return;setPage(0);searchController.discover(String(++attempt.current),signal=>search(tree,algorithm,config.settings,signal,entries=>{if(!signal.aborted){setSearchTrace(entries);onTrace("synset-search",entries.map(entry=>({...entry,label:`${algorithm} (${iri}): ${entry.label}`})));}}));};
  const rows=result.matches("ready")?result.context.items:[];
  const pending=result.matches("loading");
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="max-w-xl">
    <DialogHeader className="group/header"><div className="flex items-center gap-2"><DialogTitle>Property synset</DialogTitle><PredicateQueryTray entries={[...capTrace,...searchTrace]} label="Inspect synset queries"/></div><DialogDescription className="break-all">{iri}</DialogDescription></DialogHeader>
    <InputGroup><InputGroupAddon><InputGroupText>Algorithm</InputGroupText></InputGroupAddon><Select value={algorithm} disabled={!config||pending||cancelled} onValueChange={value=>{setAlgorithm(predicateSynsetAlgorithm(value));searchController.inactive();setSearchTrace([]);onTrace("synset-search",[]);setPage(0);}}><SelectTrigger aria-label="Synset algorithm" className="min-w-0 flex-1 border-0 shadow-none"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="relation-agreement">Relation Agreement</SelectItem>{rulealign&&<SelectItem value="rulealign">RuleAlign</SelectItem>}</SelectContent></Select></InputGroup>
    {cap.matches("loading")&&<p role="status" className="text-sm text-muted-foreground">Checking graph server capabilities…</p>}
    {config&&!rulealign&&<div className="text-xs text-muted-foreground">RuleAlign unavailable on this server. <ErrorDetails prefix="RuleAlign capability" error={config.capability.reason}/></div>}
    {rulealign&&<p className="text-xs text-muted-foreground">Verified Virtuoso {config?.capability.version} SPARQL-BI. Rules are mined on the graph server.</p>}
    {cap.context.error&&<ErrorDetails prefix="Synset settings" error={cap.context.error}/>}
    {result.context.error&&<ErrorDetails prefix="Property synset" error={result.context.error}/>}
    {pending&&<p role="status" className="text-sm text-muted-foreground">Finding synonyms on the graph server…</p>}
    {result.matches("cancelled")&&<p className="text-xs text-muted-foreground">Cancelled. Find synonyms to retry, or close the dialog.</p>}
    {result.matches("ready")&&(rows.length===0?<p className="text-sm text-muted-foreground">No qualifying synonyms.</p>:<><div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left font-medium">Property</th><th className="text-right font-medium">Similarity</th></tr></thead><tbody>{rows.slice(page*30,page*30+30).map(row=><tr key={row.uri} className="border-b"><td className="break-all py-1.5 pr-2" title={row.uri}>{row.label}<span className="block text-xs text-muted-foreground">{row.uri}</span></td><td className="text-right tabular-nums">{row.similarity.toFixed(4)}</td></tr>)}</tbody></table></div><div className="flex items-center justify-between text-xs"><Button type="button" size="sm" variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</Button>{page*30+1}–{Math.min(rows.length,page*30+30)} of {rows.length}<Button type="button" size="sm" variant="outline" disabled={(page+1)*30>=rows.length} onClick={()=>setPage(p=>p+1)}>Next</Button></div></>)}
    <DialogFooter><Button type="button" variant="outline" onClick={close}>Close</Button>{pending?<Button type="button" variant="outline" onClick={()=>searchController.cancel()}>Cancel search</Button>:<Button type="button" disabled={!allowed} onClick={run}>Find synonyms</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
