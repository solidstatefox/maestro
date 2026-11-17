"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { Activity, ArrowLeftRight, Info } from "lucide-react";
import type { MindElixirData } from "mind-elixir";
import { MindMap, MindMapControls } from "@/components/ui/mindmap";
import { createOverviewConnectionsController } from "@/lib/app-lifecycle/overview-connections";
import { OVERVIEW_CONNECTION_MAX_HOPS, shortResourceLabel, type ConnectionPath } from "@/lib/overview-connection-path";
import type { OverviewPopulation } from "@/lib/overview-population";

type Props={population:OverviewPopulation[];endpoint:string;graph?:string;scopeKey:string;disabled?:boolean;predicates?:Array<{uri:string;label:string}>;onBrowseInputs?:(source:string,target:string)=>void;onBrowsePath?:(path:ConnectionPath)=>void};
function nodeTopic(uri:string,population:OverviewPopulation[]){
  return population.find(resource=>resource.uri===uri)?.label || shortResourceLabel(uri);
}
type PathMindNode={id:string;topic:string;children?:PathMindNode[]};
function treeForPaths(paths:ConnectionPath[],population:OverviewPopulation[],source:string):MindElixirData {
  return {nodeData:{id:"connections-root",topic:nodeTopic(source,population),children:paths.map((path,index)=>{
    const build=(position:number):PathMindNode=>{
      const current=path.nodes[position];
      const previous=path.nodes[position-1];
      const matches=path.edges.filter(edge=>edge.from===previous.uri && edge.to===current.uri);
      const relation=matches.length ? matches.map(edge=>`${edge.direction==="reverse"?"←":"→"} ${shortResourceLabel(edge.predicate)}`).join(" / ") : "— predicate unavailable —";
      return {id:`connection-${index}-${position}`,topic:`${relation} · ${nodeTopic(current.uri,population)}`, ...(position<path.nodes.length-1?{children:[build(position+1)]}:{})};
    };
    return {id:`connection-path-${index}`,topic:`Path ${index+1} · ${path.nodes.length-1} hop${path.nodes.length===2?"":"s"}`,children:path.nodes.length>1?[build(1)]:[]};
  })}};
}

export function OverviewConnectionFinder({population,endpoint,graph,scopeKey,disabled,predicates=[],onBrowseInputs,onBrowsePath}:Props){
  const [controller]=useState(createOverviewConnectionsController);
  const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const listId=useId();
  const [source,setSource]=useState("");
  const [target,setTarget]=useState("");
  const [predicate,setPredicate]=useState("");
  const [hops,setHops]=useState(3);
  useEffect(()=>{controller.start();return ()=>controller.stop();},[controller]);
  // The selected pair and its result are scoped to the current FCT query and
  // endpoint. History, Back/Forward and graph switching cancel the invocation.
  useEffect(()=>{
    controller.reset();setSource(population[0]?.uri??"");setTarget(population[1]?.uri??"");
    setPredicate("");
  },[controller,scopeKey,endpoint,graph]);
  useEffect(()=>{
    if(!source && population[0])setSource(population[0].uri);
    if(!target && population[1])setTarget(population[1].uri);
  },[source,target,population]);
  const paths=snapshot.phase==="complete"?snapshot.paths:[];
  const mindMap=useMemo(()=>paths.length?treeForPaths(paths,population,source):null,[paths,population,source]);
  const validSource=population.some(item=>item.uri===source);
  const validTarget=population.some(item=>item.uri===target);
  const canFind=!disabled&&/^https?:\/\//i.test(endpoint)&&validSource&&validTarget&&source!==target;
  return <div className="space-y-3 rounded-lg border border-blue-200/70 bg-blue-50/20 p-3 dark:border-blue-900/70 dark:bg-blue-950/10">
    <div className="flex items-center gap-2"><ArrowLeftRight className="size-4 text-blue-600"/><h4 className="text-xs font-semibold">Find connections between resources</h4></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid min-w-0 gap-1 text-xs"><span className="text-muted-foreground">From · FCT population</span>
        <select className="w-full min-w-0 rounded-md border bg-background px-2 py-2" value={validSource?source:""} onChange={event=>{setSource(event.target.value);controller.reset();}}>
          {!validSource&&<option value="">Select resource</option>}
          {population.map(item=><option key={item.uri} value={item.uri}>{item.label||shortResourceLabel(item.uri)}</option>)}
        </select></label>
      <label className="grid min-w-0 gap-1 text-xs"><span className="text-muted-foreground">To · FCT population</span>
        <select className="w-full min-w-0 rounded-md border bg-background px-2 py-2" value={validTarget?target:""} onChange={event=>{setTarget(event.target.value);controller.reset();}}>
          {!validTarget&&<option value="">Select resource</option>}
          {population.map(item=><option key={item.uri} value={item.uri}>{item.label||shortResourceLabel(item.uri)}</option>)}
        </select></label>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Maximum hops</span>
        <select className="rounded-md border bg-background px-2 py-2" value={hops} onChange={event=>{setHops(Number(event.target.value));controller.reset();}}>
          {Array.from({length:OVERVIEW_CONNECTION_MAX_HOPS},(_,i)=>i+1).map(value=><option key={value} value={value}>{value}</option>)}
        </select></label>
      <label className="grid min-w-0 flex-1 gap-1 text-xs"><span className="text-muted-foreground">Relationship (optional)</span>
        <input list={listId} value={predicate} onChange={event=>{setPredicate(event.target.value);controller.reset();}} placeholder="Any predicate" className="w-full min-w-0 rounded-md border bg-background px-2 py-2" />
        <datalist id={listId}>{predicates.map(item=><option key={item.uri} value={item.uri} label={item.label}/>)}</datalist>
      </label>
      <button type="button" disabled={!canFind||snapshot.phase==="finding"} onClick={()=>controller.find({source,target,endpoint,graph,predicate:predicate.trim()||undefined,maxHops:hops})} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Activity className="size-3.5"/>{snapshot.phase==="finding"?"Searching…":"Find connections"}</button>
    </div>
    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0"/>Virtuoso verified paths, bounded to {hops} hops; non-type relationships are prioritized. The endpoints come from the first {population.length} URI matches in the active FCT query; intermediate nodes may be outside that population. Relationships follow the selected graph scope. Empty results do not imply the resources are unrelated across every graph.</p>
    {snapshot.phase==="failed"&&<p role="alert" className="text-xs text-amber-700 dark:text-amber-400">{snapshot.error}</p>}
    {snapshot.phase==="complete"&&!paths.length&&<p role="status" className="text-xs text-muted-foreground">No connection was found within the selected graph and hop limit.</p>}
    {!!paths.length&&mindMap&&<>
      <p className="text-xs text-blue-700 dark:text-sky-400">{paths.length} verified path{paths.length===1?"":"s"} discovered. Arrows indicate RDF statement direction, not traversal direction. An unavailable predicate is explicitly marked.</p>
      {onBrowseInputs && <button type="button" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-sky-300" onClick={()=>onBrowseInputs(source,target)}>Browse both input resources (FCT)</button>}
      <p className="text-xs text-blue-700 dark:text-sky-400">Select a first-degree Path node in the mindmap to ask which FCT query contains both resources through that shared relationship.</p>
      <div className="relative h-[450px] overflow-hidden rounded-lg border bg-card"><MindMap data={mindMap} readonly compact onSelectNodes={(selected)=>{
        const id=selected[0]?.id ?? "";
        const match=/^connection-path-(\d+)$/.exec(id);
        if(match && onBrowsePath) {const path=paths[Number(match[1])];if(path)onBrowsePath(path);}
      }}><MindMapControls/></MindMap></div>
    </>}
  </div>;
}
