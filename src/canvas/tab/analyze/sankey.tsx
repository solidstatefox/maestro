"use client";
import { retryMaestroComponent } from "@/lib/maestro-component-retry";
import { ErrorDetails } from "@/components/ui/error-details";

import { useEffect, useMemo, useState } from "react";
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip, type SankeyNodeProps } from "recharts";
import { MaestroEmptyResults } from "@/components/ui/maestro-empty-results";
import { D3SankeyDiagram } from "@/canvas/tab/analyze/d3-sankey";
import { toLabel } from "@/lib/uri-labels";
import { projectSankeyCoverage, type SankeyCoverageNode, type SankeyPredicate, type SankeyResource, type SankeyTerm,
  SANKEY_MAX_PREDICATES, SANKEY_MAX_RESOURCES, SANKEY_MAX_VALUES_PER_PREDICATE } from "@/lib/sankey-coverage";
import { mergeValuesQueryClone, parseListValuesXml, type ScopeValue } from "@/canvas/utils/fct-response";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { LIST_VALUES_MAX_RESOURCES } from "@/lib/list-values-transport";
import { findQueryNode } from "@/canvas/utils/query-controller";
import { sankeyBranchesAtFocus, allSankeyBranches, sankeyInitialTerms, extendSankeyThroughQueryTree,
  sankeyTermKey, SANKEY_MAX_TERMS_PER_BRANCH, SANKEY_MAX_DESCENDANT_REQUESTS,
  type SankeyTreeEdge, type SankeyQueryBranch } from "@/lib/sankey-query-tree";
import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

const colors:Record<SankeyCoverageNode["kind"],string> = {
  scope:"#64748b",resource:"#2563eb",predicate:"#0d9488",value:"#a78bfa",
};

/** The chart is an adapter only; the graph is a pure FCT projection suitable
 * for a later switch from Recharts to D3 without changing provider semantics. */
export function AnalyzeSankey({workspace,renderer="recharts"}:{workspace:WorkspaceController;renderer?:"recharts"|"d3"}) {
  const axes=useMemo(():SankeyPredicate[]=>[...new Map(workspace.analyzeTableHeaderNodes.map(header=>{
    const direction=header.name==="a"?(header.hops?.[0]?.direction ?? "forward")
      :header.name==="property-of"?"reverse" as const:"forward" as const;
    const predicate={iri:header.uri,direction,label:header.label,
      ...(header.name==="a"?{anchorId:header.id}:{})};
    return [header.name==="a"?`alias:${header.id}`:`${direction}|${header.uri}`,predicate] as const;
  })).values()],[workspace.analyzeTableHeaderNodes]);
  const focusPath=useMemo(() => ["Everything", ...workspace.analyzeBreadcrumbTrail.slice(0, workspace.activeBreadcrumbIndex + 1)
    .map(crumb => `${toLabel(crumb.uri, "Property")}${crumb.name === "property-of" ? " of" : ""}`)].join(" › "),
    [workspace.analyzeBreadcrumbTrail, workspace.activeBreadcrumbIndex]);
  // A chart page holds up to 20 focus resources. Once exhausted, the same
  // controls advance Maestro's ordinary FCT Results pagination (and thus the
  // authoritative /fct query); no parallel result-set fetch is invented.
  const results=workspace.visibleResultsPage;
  const eligibleResults=results.filter(item=>item.termType!=="bnode");
  const fctPageKey=JSON.stringify([workspace.queryXml,workspace.resultsUiPage,workspace.resultsPageSize]);
  const [chartPage,setChartPage]=useState(0);
  useEffect(()=>setChartPage(0),[fctPageKey]);
  const chartPages=Math.max(1,Math.ceil(eligibleResults.length/SANKEY_MAX_RESOURCES));
  const selectedPage=Math.min(chartPage,chartPages-1);
  const chartResults=eligibleResults.slice(selectedPage*SANKEY_MAX_RESOURCES,(selectedPage+1)*SANKEY_MAX_RESOURCES);
  const projection=workspace.readyAnalysisValues as Map<string,ScopeValue[]>|null;
  const resources=useMemo(():SankeyResource[]=>chartResults.map(item=>({
    uri:item.uri,label:item.title||item.uri,
    values:(projection?.get(item.uri)??[]).map(value=>({property:value.property,direction:value.direction,values:value.values,
      ...(workspace.analyzeTableHeaderNodes.some(header=>header.name==="a"&&header.id===value.id)?{anchorId:value.id}:{})})),
  })),[chartResults,projection,workspace.analyzeTableHeaderNodes]);
  const focusId=workspace.activeBreadcrumbIndex>=0
    ? workspace.analyzeBreadcrumbTrail[workspace.activeBreadcrumbIndex]?.id ?? "" : "";
  const branches=useMemo(():SankeyQueryBranch[]=>{
    const focus=focusId?findQueryNode(workspace.queryTree.children,focusId):workspace.queryTree;
    return sankeyBranchesAtFocus(focus?.children??[],(iri,direction)=>
      toLabel(iri,"Property")+(direction==="reverse"?" of":""));
  },[workspace.queryXml,focusId]);
  const base=useMemo(()=>projection?projectSankeyCoverage(axes,resources,focusPath):null,
    [axes,resources,projection,focusPath]);
  // Query-tree branches are followed FORWARD from the current focus. No
  // breadcrumb ancestry lookup is performed (unlike the rejected patch).
  const projectionKey=JSON.stringify([fctPageKey,selectedPage,focusId,branches,
    base?.nodes.filter(node=>node.kind==="value" && node.term).map(node=>[node.axisKey,node.term])]);
  const [forward,setForward]=useState<{key:string;edges:SankeyTreeEdge[];truncated:boolean;error:string}|null>(null);
  useEffect(()=>{
    if(!base || !branches.some(branch=>allSankeyBranches([branch]).some(item=>item.children.length))){
      setForward({key:projectionKey,edges:[],truncated:false,error:""});return;
    }
    const initial=sankeyInitialTerms(base,branches);
    if(!initial.size){setForward({key:projectionKey,edges:[],truncated:false,error:""});return;}
    const controller=new AbortController();
    setForward(null);
    void (async()=>{
      const edges:SankeyTreeEdge[]=[];
      let truncated=false;
      let requests=0;
      try{
        const known=new Map(allSankeyBranches(branches).map(branch=>[branch.id,branch]));
        let frontier=[...initial].flatMap(([id,terms])=>{
          const branch=known.get(id);
          return branch?[{branch,terms}]:[];
        });
        // BFS visits every descendant FCT property/role in the query tree.
        // The bounded transport returns observed typed RDF values, never
        // hypothetical relationships and never changes the live FCT query.
        while(frontier.length && !controller.signal.aborted){
          const next=new Map<string,Map<string,SankeyTerm>>();
          for(const {branch,terms} of frontier){
            if(!branch.children.length)continue;
            const unique=[...new Map(terms.map(term=>[sankeyTermKey(term),term])).values()];
            if(unique.length>SANKEY_MAX_TERMS_PER_BRANCH)truncated=true;
            const selected=unique.slice(0,SANKEY_MAX_TERMS_PER_BRANCH);
            for(let offset=0;offset<branch.children.length;offset+=24){
              const columns=branch.children.slice(offset,offset+24);
              for(let start=0;start<selected.length;start+=LIST_VALUES_MAX_RESOURCES){
                if(controller.signal.aborted)return;
                if(requests>=SANKEY_MAX_DESCENDANT_REQUESTS){truncated=true;break;}
                const batch=selected.slice(start,start+LIST_VALUES_MAX_RESOURCES);
                requests++;
                const projectionQueryXml=mergeValuesQueryClone(workspace.queryXml,
                  columns.map(item=>({property:item.iri,direction:item.direction})),
                  batch.map(term=>({value:term.value,type:term.type==="literal"?"literal" as const:"uri" as const,
                    ...(term.datatype?{datatype:term.datatype}:{}),...(term.lang?{lang:term.lang}:{})})));
                const response=await cachedFetchFct("/proxy/api/fct",{
                  method:"POST",cache:"no-store",signal:controller.signal,
                  headers:{"Content-Type":"text/xml; charset=utf-8", "x-maestro-view-tab":"analyze", "x-maestro-view-ribbon":workspace.selectedAnalysisUri},
                  body:projectionQueryXml,
                });
                const xml=await response.text();
                if(!response.ok)throw new Error(`FCT descendant projection returned HTTP ${response.status}`);
                const rows=parseListValuesXml(xml);
                for(const parent of batch){
                  const values=rows.get(parent.value)??[];
                  for(const childBranch of columns){
                    // An outgoing RDF edge cannot have a literal as subject.
                    if(parent.type!=="uri" && childBranch.direction==="forward")continue;
                    const related=values.filter(row=>row.property===childBranch.iri&&row.direction===childBranch.direction)
                      .flatMap(row=>row.values).filter(term=>term.value!=="-" && (term.type==="uri"||term.type==="literal"));
                    const seen=new Set<string>();
                    for(const term of related){
                      const child:SankeyTerm={value:term.value,type:term.type,
                        ...(term.datatype?{datatype:term.datatype}:{}),...(term.lang?{lang:term.lang}:{})};
                      const id=sankeyTermKey(child);
                      if(seen.has(id))continue;
                      seen.add(id);
                      edges.push({branchId:childBranch.id,parent,child});
                      const children=next.get(childBranch.id)??new Map<string,SankeyTerm>();
                      children.set(id,child);
                      next.set(childBranch.id,children);
                    }
                  }
                }
              }
              if(requests>=SANKEY_MAX_DESCENDANT_REQUESTS)break;
            }
            if(requests>=SANKEY_MAX_DESCENDANT_REQUESTS)break;
          }
          if(requests>=SANKEY_MAX_DESCENDANT_REQUESTS)break;
          frontier=[...next].flatMap(([id,terms])=>{
            const branch=known.get(id);
            return branch?[{branch,terms:[...terms.values()]}]:[];
          });
        }
        if(!controller.signal.aborted)setForward({key:projectionKey,edges,truncated,error:""});
      }catch(error){
        if(!controller.signal.aborted)setForward({key:projectionKey,edges,truncated,
          error:error instanceof Error?error.message:"Could not load downstream relationships."});
      }
    })();
    return ()=>controller.abort();
  },[projectionKey]);
  const currentForward=forward?.key===projectionKey?forward:null;
  const data=useMemo(()=>base && currentForward
    ? extendSankeyThroughQueryTree(base,branches,currentForward.edges):base,
    [base,branches,currentForward]);
  const maxTreeDepth=useMemo(()=>{
    const depth=(items:readonly SankeyQueryBranch[]):number=>items.length?1+Math.max(...items.map(item=>depth(item.children))):0;
    return depth(branches);
  },[branches]);
  const resourceUriByIndex=useMemo(()=>data?.nodes.map(node=>node.kind==="resource"?node.uri:undefined)??[],[data]);
  const renderNode=(props:SankeyNodeProps)=>{
    const item=data?.nodes[props.index];
    if(!item)return <g/>;
    const uri=resourceUriByIndex[props.index];
    const interactive=Boolean(uri);
    const label=item.name.length>34?`${item.name.slice(0,33)}…`:item.name;
    return <Layer key={`sankey-node-${props.index}`}>
      <g role={interactive?"button":undefined} tabIndex={interactive?0:undefined}
        aria-label={interactive?`Open ${item.name} in Record`:undefined}
        className={interactive?"cursor-pointer outline-none focus-visible:opacity-70":undefined}
        onClick={interactive?()=>workspace.setSelectedUri(uri!):undefined}
        onKeyDown={interactive?(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();workspace.setSelectedUri(uri!);}}:undefined}>
        <title>{item.tooltip??item.name}</title>
        <Rectangle x={props.x} y={props.y} width={props.width} height={Math.max(props.height,1)}
          fill={colors[item.kind]} fillOpacity={0.85} radius={2}/>
        <text x={props.x+props.width+5} y={props.y+Math.max(props.height,9)/2}
          fontSize={10} fill="var(--foreground)" dominantBaseline="middle" pointerEvents="none">
          {label}
        </text>
      </g>
    </Layer>;
  };
  if (!results.length && !workspace.analysisValuesError) return <MaestroEmptyResults title="No Sankey results"
    description="The current FCT page has no resources to analyze." onBrowse={()=>workspace.setWorkspaceTab("browse")}/>;
  return <section className="min-h-0 flex-1 overflow-auto p-4 sm:p-6" aria-label="Sankey relationship coverage analysis">
    <div className="w-full min-w-0 space-y-4">
      <header className="border-b pb-3"><h2 className="text-lg font-semibold">{renderer==="d3"?"Sankey (D3)":"Sankey"}</h2>
        <p className="text-xs text-muted-foreground">Relationship coverage from the current FCT focus: resources → in-scope Properties/Roles → RDF values, continuing through all descendant relationship branches in the query tree. Flow width measures predicate-coverage percentage points, not triple frequency.</p>
      </header>
      <nav className="flex flex-wrap items-center gap-2 border-b pb-3 text-xs" aria-label="Sankey page controls">
        <button type="button" className="rounded border px-3 py-1.5 disabled:opacity-40" aria-label="Previous Sankey page"
          disabled={workspace.isSearching||(selectedPage===0&&workspace.resultsUiPage===0)}
          onClick={()=>{if(selectedPage>0)setChartPage(selectedPage-1);else workspace.changeResultsPage(-1);}}>Previous</button>
        <span className="tabular-nums text-muted-foreground">Sankey page {selectedPage+1} of {chartPages} · FCT results page {workspace.resultsUiPage+1}{workspace.effectiveResultsTotalCount===null?"":` of ${Math.max(1,Math.ceil(workspace.effectiveResultsTotalCount/workspace.resultsPageSize))}`}</span>
        <button type="button" className="rounded border px-3 py-1.5 disabled:opacity-40" aria-label="Next Sankey page"
          disabled={workspace.isSearching||(selectedPage+1>=chartPages && (workspace.effectiveResultsTotalCount===null
            ? workspace.results.length<=(workspace.resultsUiPage+1)*workspace.resultsPageSize &&
              (workspace.resultsPageComplete || workspace.resultsBatchRequestPending.current)
            : workspace.resultsUiPage+1>=Math.ceil(workspace.effectiveResultsTotalCount/workspace.resultsPageSize)))}
          onClick={()=>{if(selectedPage+1<chartPages)setChartPage(selectedPage+1);else workspace.changeResultsPage(1);}}>Next</button>
        <span className="text-muted-foreground">{resources.length} focus resources on this chart page</span>
      </nav>
      {!axes.length && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">Add a Property or Role to the current FCT view to analyze its relationships.</p>}
      {base && !currentForward && branches.some(branch=>branch.children.length>0) &&
        <p role="status" className="text-xs text-muted-foreground">Loading deeper FCT query-tree relationships…</p>}
      {(currentForward?.truncated || data?.descendantsTruncated) && <p role="status" className="text-xs text-muted-foreground">The relationship projection reached a safety limit; only observed links are shown.</p>}
      {base?.nodes.some(node=>node.kind==="value" && node.name==="Other values") &&
        branches.some(branch=>branch.children.length>0) && <p className="text-xs text-muted-foreground">Aggregated “Other values” buckets remain terminal; individual RDF terms are not invented for deeper traversal.</p>}
      {currentForward?.error && <ErrorDetails prefix="Sankey descendant projection" error={`${currentForward.error}. The verified first-degree chart remains available.`} />}
      {workspace.analysisValuesError && <div className="flex items-center gap-2"><ErrorDetails prefix="Sankey projection" error={workspace.analysisValuesError}/><button type="button" className="underline text-sm" onClick={()=>retryMaestroComponent("analyze-values")}>Retry</button></div>}
      {axes.length>0 && !projection && !workspace.analysisValuesError && <p role="status" className="text-sm text-muted-foreground">Loading the current page's batched FCT relationship projection…</p>}
      {data && data.nodes.length===0 && <p className="rounded-md border p-3 text-sm text-muted-foreground">None of the displayed resources possesses a value for the selected in-scope relationships.</p>}
      {data && data.nodes.length>0 && <>
        <p className="text-xs text-muted-foreground">Showing {data.displayedResources} of {data.totalResources} page resources, {data.displayedPredicates} of {data.totalPredicates} predicates and up to {SANKEY_MAX_VALUES_PER_PREDICATE} distinct first-degree values per predicate, with other values aggregated. Descendants follow the {maxTreeDepth}-degree FCT relationship tree. Limits: {SANKEY_MAX_RESOURCES} resources and {SANKEY_MAX_PREDICATES} predicate columns. The coverage denominator always includes all {data.totalPredicates} in-scope predicates.</p>
        <div className="overflow-x-auto rounded-lg border bg-card p-3">
          {renderer==="d3" ? <D3SankeyDiagram data={data} onOpenResource={workspace.setSelectedUri} minWidth={Math.max(1000,(maxTreeDepth+4)*220)}/> : <div className="h-[min(75vh,900px)] min-h-[490px] min-w-[1000px]" style={{minWidth:Math.max(1000,(maxTreeDepth+4)*220)}} role="img" aria-label="Sankey of current result resources through their in-scope RDF properties and values">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey data={{nodes:data.nodes,links:data.links}} node={renderNode} nodeWidth={14} nodePadding={10}
                link={{stroke:"var(--muted-foreground)",strokeOpacity:0.2}} margin={{top:20,bottom:20,left:14,right:172}}
                iterations={24}>
                <Tooltip formatter={(value)=>[`${Number(value).toFixed(2)} percentage points`,"Predicate coverage"]}
                  contentStyle={{backgroundColor:"var(--card)",color:"var(--foreground)",border:"1px solid var(--border)",borderRadius:8}}/>
              </Sankey>
            </ResponsiveContainer>
          </div>}
        </div>
        <div className="rounded-lg border bg-card p-3"><h3 className="mb-2 text-sm font-semibold">Resource coverage</h3>
          <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.coverage.map((resource,index)=><button type="button" key={`${index}:${resource.uri}`}
              className="flex min-w-0 items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
              title={resource.uri} onClick={()=>workspace.setSelectedUri(resource.uri)}>
              <span className="truncate">{resource.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{resource.percent.toFixed(1)}%</span>
            </button>)}
          </div>
        </div>
      </>}
      <p className="text-xs text-muted-foreground">Coverage counts the fraction of eligible relationships present on each resource. Multi-valued predicates split their weight among distinct RDF terms; unshown value terms are combined into “Other values.” Descendant nodes follow every relationship branch of the current FCT focus, using observed RDF terms only. The first-degree coverage calculation is unchanged. {renderer==="recharts"?"D3 layout is available in the separate Sankey (D3) provider. ":"Layout controls are temporary and independent of the Recharts Sankey provider. "}No RDF is changed.</p>
    </div>
  </section>;
}
