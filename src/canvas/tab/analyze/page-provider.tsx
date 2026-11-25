"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { ErrorDetails } from "@/components/ui/error-details";
import { ValidationNotice } from "@/components/ui/validation-notice";
import { createMaestroProviderValidationController, selectProviderValidation } from "@/lib/app-lifecycle/provider-validation";
import { loadProviderPolicy, validateProviderPage } from "@/lib/client-provider-validation";
import { parseProviderPageProgram, type ProviderRadar } from "@/lib/provider-page-program";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import type { WorkspaceController } from "@/canvas/utils/workspace-controller";
import type { AnalysisDefinition } from "./analysis-utils";
const NS="gttp://ggg.maestro.ecosys/ns/xslt/context#";
const colors=["#2563eb","#0284c7","#7c3aed","#0d9488","#e11d48","#d97706","#0891b2","#4f46e5"];
function pageXml(workspace:WorkspaceController){
 const doc=document.implementation.createDocument(NS,"m:context",null);const root=doc.documentElement;
 const add=(parent:Element,name:string,attrs:Record<string,string>={})=>{const el=doc.createElementNS(NS,`m:${name}`);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);parent.appendChild(el);return el;};
 const query=new DOMParser().parseFromString(workspace.queryXml,"application/xml");if(query.getElementsByTagName("parsererror").length)throw new Error("Invalid live query.");
 add(root,"query").appendChild(doc.importNode(query.documentElement,true));
 const headers=add(root,"breadcrumbs");
 for(const node of workspace.analyzeTableHeaderNodes){const direction=node.name==="a"?(node.hops?.[0]?.direction??"forward"):node.name==="property-of"?"reverse":"forward";add(headers,"breadcrumb",{id:node.id,iri:node.uri,label:node.label,direction,"anchor-id":node.name==="a"?node.id:""});}
 const results=add(root,"results");
 for(const item of workspace.visibleResultsPage){const row=add(results,"result",{uri:item.uri,label:item.title||item.uri});for(const scope of workspace.readyAnalysisValues?.get(item.uri)??[]){for(const value of scope.values){if(value.value==="-")continue;add(row,"value",{property:scope.property,direction:scope.direction,"node-id":scope.id||"",type:value.type||"literal",datatype:value.datatype||"",lang:value.lang||""}).textContent=value.value;}}}
 return new XMLSerializer().serializeToString(doc);
}
function RadarPresentation({chart}:{chart:ProviderRadar}){
 const ref=useRef<HTMLDivElement>(null);const [chartWidth,setChartWidth]=useState(0);
 useEffect(()=>{const node=ref.current;if(!node)return;const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width??0;setChartWidth(previous=>Math.abs(previous-width)<1?previous:width);});observer.observe(node);return()=>observer.disconnect();},[]);
 return <div className="rounded-xl border bg-card p-3 sm:p-5"><div ref={ref} className="relative h-[min(65vh,620px)] min-h-[350px] w-full" role="img" aria-label={`Radar chart: ${chart.members.length} series across ${chart.chart.length} axes`}><ResponsiveContainer width="100%" height="100%"><RadarChart data={chart.chart} outerRadius="75%" margin={{top:18,right:65,bottom:12,left:65}}><PolarGrid stroke="var(--border)"/><PolarAngleAxis dataKey="axis" tick={{fontSize:11,fill:"var(--foreground)"}}/><PolarRadiusAxis domain={[0, 100]} tick={false} tickLine={false} axisLine={false}/><Tooltip position={{ x: Math.max(8, chartWidth - 272), y: 12 }} wrapperStyle={{pointerEvents:"none",zIndex:10,maxWidth:"min(256px, calc(100% - 16px))"}} formatter={(value,name,item)=>[String((item.payload as Record<string,unknown>)[`raw_${String(item.dataKey)}`]??value),name]} contentStyle={{backgroundColor:"var(--card)",color:"var(--foreground)",border:"1px solid var(--border)",borderRadius:8}}/>{chart.members.map((member,index)=><Radar key={member.key} name={member.label} dataKey={member.key} stroke={colors[index%colors.length]} fill={colors[index%colors.length]} fillOpacity={0.09} strokeWidth={1.5} dot={false}/>)}{chart.members.length<=12&&<Legend wrapperStyle={{fontSize:11}}/>}</RadarChart></ResponsiveContainer></div>{chart.members.length>12&&<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{chart.members.map((member,index)=><span key={member.key} className="inline-flex max-w-64 items-center gap-1 truncate"><span aria-hidden style={{backgroundColor:colors[index%colors.length]}} className="size-2.5 shrink-0 rounded-full"/>{member.label}</span>)}</div>}<p className="mt-3 text-xs text-muted-foreground">{chart.description}</p></div>;
}
export function AnalyzePageProvider({workspace,definition}:{workspace:WorkspaceController;definition:AnalysisDefinition}){
 const [controller]=useState(createMaestroProviderValidationController);const [retry,setRetry]=useState(0);const [dismissed,setDismissed]=useState("");
 const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const eligible=Boolean(definition.pageValidationShape&&workspace.perspectivePageReady&&workspace.accessCapabilities.canUsePersonalStore&&!workspace.queryExecutionCancelled&&!workspace.analysisValuesError);
 const noProjectionNeeded=!workspace.visibleResultsPage.length||!workspace.analyzeTableHeaderNodes.length;
 const source=eligible&&(workspace.readyAnalysisValues||noProjectionNeeded)?pageXml(workspace):"";
 const key=source?JSON.stringify([definition.uri,definition.stylesheet,definition.pageValidationShape,workspace.authSession?.graphStore,workspace.authSession?.graphPrefix,workspace.authSession?.userName??workspace.authSession?.username,workspace.policyApprovalRevision,workspace.queryRefreshRevision,source,retry]):"";
 const state=selectProviderValidation(snapshot,key);
 useEffect(()=>{controller.start();return()=>controller.stop();},[controller]);
 useEffect(()=>{if(!key){controller.cancel();return;}const shape=definition.pageValidationShape!;controller.validate(key,{prepare:async signal=>parseProviderPageProgram(await transformWithMaestroSaxon(definition.stylesheet,source,{signal,outputLimit:1000000})),load:signal=>loadProviderPolicy(shape,workspace.policyApprovalRevision,signal),validate:(program,policy,signal)=>validateProviderPage(shape,policy,program.data,signal)});return()=>controller.cancel();},[controller,key]);
 return <section className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-label={definition.label}><div className="w-full min-w-0 space-y-4"><header className="border-b pb-3"><h2 className="text-lg font-semibold">{definition.label}</h2><p className="text-xs text-muted-foreground">{state.program?.description}</p></header>{workspace.analysisValuesError&&<ErrorDetails prefix="Analysis projection" error={workspace.analysisValuesError}/>} {eligible&&!source&&<p role="status" className="text-sm text-muted-foreground">Projecting the page with the FCT merge-values view…</p>}{state.phase==="preparing"&&<p role="status">Preparing provider page…</p>}{state.phase==="loadingPolicy"&&<p role="status">Retrieving provider SHACL policy…</p>}{state.phase==="validating"&&<p role="status">Validating provider data with SHACL Core…</p>}{state.error&&<div className="flex items-center gap-2"><ErrorDetails prefix="Provider validation" error={state.error}/><button type="button" className="underline text-sm" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}{state.report&&dismissed!==key&&<ValidationNotice report={state.report} onDismiss={()=>setDismissed(key)}/>} {state.program?.message&&(state.phase==="empty"||state.phase==="ready")&&<p className="text-sm text-muted-foreground">{state.program.message}</p>}{state.phase==="ready"&&state.program?.radar&&<RadarPresentation chart={state.program.radar}/>}</div></section>;
}
