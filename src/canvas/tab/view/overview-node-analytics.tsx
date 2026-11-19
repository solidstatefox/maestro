"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { overviewInputResourcesQuery } from "@/lib/overview-resource-query";
import { overviewPathQuestion } from "@/lib/overview-path-query";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Activity, Info, Network } from "lucide-react";
import { OverviewConnectionFinder } from "@/canvas/tab/view/overview-connection-finder";
import { MindMap, MindMapControls } from "@/components/ui/mindmap";
import type { MindElixirData } from "mind-elixir";
import { createOverviewAnalyticsCapabilityController } from "@/lib/app-lifecycle/overview-analytics";
import { type EdgeDirection, type NodeMetric } from "@/lib/overview-node-metrics";
import { createOverviewMetricController } from "@/lib/app-lifecycle/overview-metric-request";
import { publishedGraphAddress } from "@/lib/overview-void-metrics";
import { uniqueOverviewPredicateOptions } from "@/lib/overview-predicate-options";
import type { WorkspaceController } from "@/canvas/utils/workspace-controller";
import type { OverviewPopulation } from "@/lib/overview-population";

const compact = new Intl.NumberFormat(undefined, {maximumFractionDigits:3});

export function OverviewNodeAnalytics({workspace,population,populationLoading}: {workspace:WorkspaceController;population:OverviewPopulation[];populationLoading:boolean}) {
  const [actor] = useState(createOverviewAnalyticsCapabilityController);
  useEffect(()=>{actor.start();return ()=>actor.stop();},[actor]);
  const capability=useSyncExternalStore(actor.subscribe,actor.getSnapshot,actor.getSnapshot);
  const [direction,setDirection] = useState<EdgeDirection>(()=>workspace.propertyFacets.some(f=>f.count>0)?"property":"role");
  const [predicate,setPredicate] = useState("");
  const [metric,setMetric] = useState<NodeMetric>("degree");
  const [mode,setMode] = useState<"connections" | "metrics">("connections");
  const [metricsController] = useState(createOverviewMetricController);
  useEffect(()=>{metricsController.start();return ()=>metricsController.stop();},[metricsController]);
  const metricSnapshot=useSyncExternalStore(metricsController.subscribe,metricsController.getSnapshot,metricsController.getSnapshot);
  const result=metricSnapshot.phase==="complete"?metricSnapshot.result:[];
  const error=metricSnapshot.phase==="failed"?metricSnapshot.error:"";
  const loading=metricSnapshot.phase==="running";
  const requested=metricSnapshot.phase==="complete"||metricSnapshot.phase==="failed";
  const address=workspace.queryTree.attributes.addr??"";
  const separator=address.indexOf("@");
  const endpoint=separator>=0?address.slice(separator+1).trim():"";
  const namedGraph=publishedGraphAddress(address)?.graph;
  const serverKey=endpoint;
  const scopeKey=workspace.queryXml;
  const predicates = direction === "property" ? workspace.propertyFacets : workspace.roleFacets;
  const choices=useMemo(()=>uniqueOverviewPredicateOptions(predicates.filter(f=>f.uri && f.count>0)).slice(0,30),[predicates]);
  const connectionPredicates=useMemo(()=>uniqueOverviewPredicateOptions(
    [...workspace.propertyFacets,...workspace.roleFacets].map(facet=>({uri:facet.uri,label:facet.label})),
  ),[workspace.propertyFacets,workspace.roleFacets]);
  const selectedPredicate=choices.some(f=>f.uri===predicate)?predicate:(choices[0]?.uri??"");
  const confirmed=capability.matches("available") && capability.context.endpoint===serverKey;
  const native = confirmed && !!capability.context.capabilities?.native;
  const activeMetric = !native && metric!=="degree" ? "degree" : metric;
  const canAnalyze = confirmed && !!selectedPredicate && population.length>0 && !populationLoading;

  useEffect(()=>{
    actor.send({type:"RESET"});
    if(/^https?:\/\//i.test(serverKey))actor.send({type:"CHECK",endpoint:serverKey});
    return ()=>actor.send({type:"RESET"});
  },[actor,serverKey]);
  // All query, relationship and mode transitions cancel the existing
  // invoked XState metric actor. Stale responses cannot reach newer scopes.
  useEffect(()=>{metricsController.reset();},[metricsController,scopeKey,serverKey,selectedPredicate,direction,activeMetric,mode]);
  useEffect(()=>{
    if(metricSnapshot.phase==="failed"&&activeMetric!=="degree")actor.send({type:"NATIVE_UNSUPPORTED",endpoint:serverKey});
  },[metricSnapshot.phase,activeMetric,actor,serverKey]);

  const clustered = activeMetric === "wcc" || activeMetric === "scc" || activeMetric === "community";
  const clusters=useMemo(()=>{
    const groups=new Map<number,typeof result>();
    for(const item of result){const group=groups.get(item.score)??[];group.push(item);groups.set(item.score,group);}
    return [...groups.entries()].sort((a,b)=>b[1].length-a[1].length);
  },[result]);
  const mindmap=useMemo<MindElixirData>(()=>({nodeData:{
    id:"overview-analytics-root",
    topic:clustered?(activeMetric==="wcc"?"Weak components":activeMetric==="scc"?"Strong components":"Louvain communities"):`${activeMetric === "degree" ? "Link degree" : activeMetric === "degree_native" ? "Native degree" : activeMetric === "pagerank" ? "PageRank" : activeMetric === "betweenness" ? "Betweenness" : activeMetric === "eigenvector" ? "Eigenvector" : "Closeness"} · ${direction === "role" ? "Roles" : "Properties"}`,
    children:clustered?clusters.slice(0,15).map(([id,members],index)=>({id:`cluster-${index}`,topic:`${activeMetric==="community"?"Community":"Component"} ${id} · ${(members.length/result.length*100).toFixed(0)}%`,children:members.slice(0,20).map((item,i)=>({id:`cluster-${index}-member-${i}`,topic:item.label}))})):
      result.slice(0,25).map((item,index)=>({id:`analytics-node-${index}`,topic:`${item.label}  ·  ${compact.format(item.score)}`})),
  }}),[result,activeMetric,direction,clustered,clusters]);
  return <section className="space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5" aria-label="Virtuoso node analytics">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Network className="size-4 text-blue-600"/><h3 className="text-sm font-semibold">Node analytics</h3></div>
      <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-sky-300">{capability.matches("checking")?"Checking server…":confirmed?"Virtuoso SPARQL-BI":"Unavailable"}</span></div>
    {confirmed ? <>
      <div className="inline-flex rounded-md border border-blue-200 bg-background p-0.5 text-xs dark:border-blue-900" role="group" aria-label="Node analytics mode">
        <button type="button" aria-pressed={mode==="connections"} className={`rounded px-3 py-1.5 ${mode==="connections"?"bg-blue-600 text-white":"text-muted-foreground hover:text-foreground"}`} onClick={()=>setMode("connections")}>Find connections</button>
        <button type="button" aria-pressed={mode==="metrics"} className={`rounded px-3 py-1.5 ${mode==="metrics"?"bg-blue-600 text-white":"text-muted-foreground hover:text-foreground"}`} onClick={()=>setMode("metrics")}>Node metrics</button>
      </div>
      {mode === "connections" ? <OverviewConnectionFinder key={`${serverKey}|${scopeKey}`} endpoint={endpoint} graph={namedGraph} population={population} scopeKey={scopeKey} disabled={populationLoading} predicates={connectionPredicates} onBrowseInputs={(source,target)=>{const query=overviewInputResourcesQuery(workspace.queryTree,[source,target]);if(query){workspace.replaceQueryTree(query);workspace.setWorkspaceTab("browse");}}} onBrowsePath={(path)=>{const question=overviewPathQuestion(workspace.queryTree,path);if(question){workspace.replaceQueryTree(question.tree);workspace.setWorkspaceTab("browse");}}}/> : <>
      <p className="text-xs text-muted-foreground">{capability.context.capabilities?.product} {capability.context.capabilities?.version} · {native ? "native centrality eligible" : "portable degree only"}. {capability.context.capabilities?.reason}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Direction</span><select className="rounded-md border bg-background px-2 py-1.5" value={direction} onChange={event=>{setDirection(event.target.value as EdgeDirection);setPredicate("");}}><option value="property">Properties</option><option value="role">Roles</option></select></label>
        <label className="grid max-w-56 gap-1 text-xs"><span className="text-muted-foreground">Relationship</span><select className="max-w-full rounded-md border bg-background px-2 py-1.5" value={selectedPredicate} onChange={event=>setPredicate(event.target.value)}>{choices.map(item=><option value={item.uri} key={item.uri}>{item.label}</option>)}</select></label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Metric</span><select className="rounded-md border bg-background px-2 py-1.5" value={activeMetric} onChange={event=>setMetric(event.target.value as NodeMetric)}><option value="degree">Degree</option>{native && <><option value="degree_native">Native degree</option><option value="pagerank">PageRank</option><option value="betweenness">Betweenness</option><option value="closeness">Closeness</option><option value="eigenvector">Eigenvector</option><option value="wcc">Weak components</option><option value="scc">Strong components</option><option value="community">Louvain communities</option></>}</select></label>
        <button className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!canAnalyze || loading} onClick={()=>metricsController.run({endpoint,uris:population.map(item=>item.uri),predicate:selectedPredicate,metric:activeMetric,graph:namedGraph,direction,nativeEnabled:native})}><Activity className="size-3.5"/>{loading?"Analyzing…":"Run analytics"}</button>
      </div>
      {populationLoading && <p className="text-xs text-muted-foreground" role="status">Reading active FCT population…</p>}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0"/>Analysis is restricted to up to {population.length} URI members independently fetched from the active FCT query (first 120, not the current results page). Scores or communities describe the selected relationship in the queried graph, not the entire FCT population. The mind map lists ranked nodes; its branches are not RDF edges.</p>
      {error && <ErrorDetails prefix="Overview node analytics" error={error} />}
      {clustered && result.length>0 && <p className="text-xs text-blue-700 dark:text-sky-400">{clusters.length} {activeMetric==="wcc"?"weak components":activeMetric==="scc"?"strong components":"communities"} · largest group {Math.round(clusters[0][1].length/result.length*100)}% of scored sampled members</p>}
      {result.length>0 && result.every(item=>item.score===0) && <p className="text-xs text-muted-foreground">The sampled resources returned no matching URI relationships for this predicate and direction. Try another predicate or use Find connections.</p>}
      {result.some(item=>item.score>0) && <div className="relative h-[440px] overflow-hidden rounded-lg border"><MindMap data={mindmap} readonly compact><MindMapControls/></MindMap></div>}
      {requested && !loading && !error && !result.length && <p className="text-xs text-muted-foreground">No scored members were returned for this relationship.</p>}
      </>}
    </> : capability.matches("checking") ? <p className="text-xs text-muted-foreground">Reading the selected server version using Maestro&apos;s existing Graph Server metadata query.</p> :
    <p className="text-xs text-muted-foreground">{capability.context.capabilities?.reason || capability.context.error || "Only confirmed Virtuoso graph servers with SPARQL-BI are eligible."}</p>}
  </section>;
}
