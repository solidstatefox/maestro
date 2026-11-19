"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { useEffect, useMemo, useRef, useState } from "react";
import { MaestroEmptyResults } from "@/components/ui/maestro-empty-results";
import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { spiderAxisKey, validateSpiderQuery, type SpiderAxis, type SpiderRow } from "@/lib/spider-numeric-policy";
import { validateSpiderCore } from "@/lib/client-spider-shacl";
import { ValidationNotice } from "@/components/ui/validation-notice";
import type { ShaclValidationReport } from "@/lib/shacl-validation-report";
import type { ScopeValue } from "@/canvas/utils/fct-response";
import type { WorkspaceController } from "@/canvas/utils/workspace-controller";
const blues=["#2563eb","#0284c7","#7c3aed","#0d9488","#e11d48","#d97706","#0891b2","#4f46e5"];
export function AnalyzeSpider({workspace}: {workspace:WorkspaceController}) {
  const axes:SpiderAxis[]=useMemo(()=>[...new Map(workspace.analyzeTableHeaderNodes.map(node=>{
    const axis={uri:node.uri,direction:node.name==="property-of"?"reverse" as const:"forward" as const,
      label:(node.uri.split(/[/#]/).pop() ?? node.uri) + (node.name==="property-of"?" of":"")};
    return [spiderAxisKey(axis),axis] as const;
  })).values()], [workspace.analyzeTableHeaderNodes]);
  const projection=workspace.readyAnalysisValues as Map<string,ScopeValue[]>|null;
  const results=workspace.visibleResultsPage;
  const rows:SpiderRow[]=useMemo(()=>results.map(result=>{
    const values:SpiderRow["values"]={};
    for(const scope of projection?.get(result.uri)??[]) values[spiderAxisKey({uri:scope.property,direction:scope.direction})]=scope.values;
    return {uri:result.uri,label:result.title,values};
  }),[projection,results]);
  const validated=useMemo(()=>projection?validateSpiderQuery(axes,rows):null,[projection,axes,rows]);
  const validationKey=useMemo(()=>projection?JSON.stringify([axes,rows]):"",[projection,axes,rows]);
  const [core,setCore]=useState<{key:string;report:ShaclValidationReport|null;error:string}>({key:"",report:null,error:""});
  const [dismissed,setDismissed]=useState("");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const coreReport=core.key===validationKey?core.report:null;
  const coreError=core.key===validationKey?core.error:"";
  const corePending=Boolean(validationKey)&&core.key!==validationKey;
  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      setChartWidth(previous => Math.abs(previous - width) < 1 ? previous : width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [validated?.ok, coreReport?.conforms]);
  useEffect(()=>{
    if(!validationKey){return;}
    const controller=new AbortController();
    void validateSpiderCore(axes,rows,controller.signal)
      .then(report=>{if(!controller.signal.aborted)setCore({key:validationKey,report,error:""});})
      .catch(error=>{if(!controller.signal.aborted)setCore({key:validationKey,report:null,error:error instanceof Error?error.message:String(error)});});
    return ()=>controller.abort();
  },[validationKey,axes,rows]);
  if (projection && rows.length === 0) return <MaestroEmptyResults title="No Spider results" description="No results were returned for the current query. Try the default Browse perspective." onBrowse={() => workspace.setWorkspaceTab("browse")}/>;
  return <section className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-label="Spider numeric analysis">
    <div className="w-full min-w-0 space-y-4">
      <header className="border-b pb-3"><h2 className="text-lg font-semibold">Spider</h2>
        <p className="text-xs text-muted-foreground">Every result on the current FCT page is a polygon. Axes are the view's Properties and Roles; all cells must pass the numeric query-validator policy.</p>
      </header>
      {workspace.analysisValuesError && <ErrorDetails prefix="Spider projection" error={workspace.analysisValuesError} />}
      {!projection && !workspace.analysisValuesError && <p role="status" className="text-sm text-muted-foreground">Projecting the page with the existing FCT list-values view…</p>}
      {corePending && <p role="status" className="text-sm text-muted-foreground">Validating Spider axes with the provider's SHACL Core shape…</p>}
      {coreError && <ErrorDetails prefix="Spider SHACL validation" error={coreError} />}
      {coreReport && dismissed!==validationKey && <ValidationNotice report={coreReport} onDismiss={()=>setDismissed(validationKey)} />}
      {validated && !validated.ok && !corePending && !coreError && !coreReport && <p role="alert" className="rounded-md border p-4 text-sm text-muted-foreground">Numeric query validation: {validated.reason}</p>}
      {validated?.ok && coreReport?.complete && coreReport.conforms && <div className="rounded-xl border bg-card p-3 sm:p-5">
        <div ref={chartContainerRef} className="relative h-[min(65vh,620px)] min-h-[350px] w-full" role="img" aria-label={`Spider chart of ${validated.members.length} result resources across ${axes.length} numeric axes`}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={validated.chart} outerRadius="75%" margin={{top:18,right:65,bottom:12,left:65}}>
              <PolarGrid stroke="var(--border)"/><PolarAngleAxis dataKey="axis" tick={{fontSize:11,fill:"var(--foreground)"}}/>
              <PolarRadiusAxis domain={[0, 100]} tick={false} tickLine={false} axisLine={false} />
              <Tooltip position={{ x: Math.max(8, chartWidth - 272), y: 12 }}
                wrapperStyle={{pointerEvents:"none",zIndex:10,maxWidth:"min(256px, calc(100% - 16px))"}}
                formatter={(value, name, item) => {
                const raw = (item.payload as Record<string, unknown>)[`raw_${String(item.dataKey)}`];
                return [String(raw ?? value), name];
              }} contentStyle={{backgroundColor:"var(--card)",color:"var(--foreground)",border:"1px solid var(--border)",borderRadius:8}}/>
              {validated.members.map((member,index)=><Radar key={member.key} name={member.label} dataKey={member.key}
                stroke={blues[index%blues.length]} fill={blues[index%blues.length]} fillOpacity={0.09} strokeWidth={1.5} dot={false}/>)}
              {validated.members.length<=12&&<Legend wrapperStyle={{fontSize:11}}/>}
            </RadarChart>
          </ResponsiveContainer>
        </div>
        {validated.members.length>12 && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Plotted resources">{validated.members.map((member,index)=><span key={member.key} className="inline-flex max-w-64 items-center gap-1 truncate"><span aria-hidden style={{backgroundColor:blues[index%blues.length]}} className="size-2.5 shrink-0 rounded-full"/>{member.label}</span>)}</div>}
        <p className="mt-3 text-xs text-muted-foreground">Each axis is normalized independently to 0–100% across the displayed results; tooltips preserve actual numeric values. Constant nonzero axes use the midpoint (50%). Missing, multi-valued, or nonnumeric cells invalidate this analysis instead of being silently converted to zero.</p>
      </div>}
    </div>
  </section>;
}
