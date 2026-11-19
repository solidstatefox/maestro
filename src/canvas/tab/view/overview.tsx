"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { MaestroEmptyResults } from "@/components/ui/maestro-empty-results";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, PolarAngleAxis, LabelList,
  RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buildOverviewReport, percentage, type OverviewPercent } from "@/lib/overview-metrics";
import { fetchPublishedVoID, publishedGraphAddress, publishedGraphRatios, type PublishedGraphStats } from "@/lib/overview-void-metrics";
import type { WorkspaceController } from "@/canvas/utils/workspace-controller";
import { readOverviewLabelCoverage, readOverviewTextMatchCoverage, type OverviewLabelCoverageResult } from "@/lib/overview-population";

/** The light, blue-first card/chart vocabulary of shadcn's Recharts gallery.
 * Scoped to the built-in Overview, never overrides a user's global theme. */
const blues = ["#2563eb", "#0ea5e9", "#38bdf8", "#60a5fa", "#1d4ed8", "#7dd3fc", "#93c5fd"];
const compact = new Intl.NumberFormat(undefined, {notation:"compact", maximumFractionDigits:1});
const decimal = new Intl.NumberFormat(undefined, {maximumFractionDigits:2});
const fmt = (value:number) => compact.format(value);
const pct = (value:number) => `${value.toFixed(value < 10 && value > 0 ? 1 : 0)}%`;
const number = (value:number) => decimal.format(value);
const tooltipStyle = {backgroundColor:"var(--card)",border:"1px solid var(--border)",borderRadius:"10px",fontSize:12,color:"var(--foreground)",boxShadow:"0 8px 24px rgba(15,23,42,.08)"};

function Section({title, detail, children, wide}: {title:string;detail?:string;children:ReactNode;wide?:boolean}) {
  return <section className={`min-w-0 rounded-xl border border-border/80 bg-card px-4 py-4 shadow-sm sm:p-5 ${wide ? "lg:col-span-2" : ""}`}>
    <div className="mb-4 space-y-1"><h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {detail && <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>}</div>
    {children}
  </section>;
}
/** Name/label predicates are the ONE multi-radial chart in Overview.
 * Matches shadcn's Radial Chart – Label: labels live inside the rings,
 * never in a side legend. Predicates come from the full root dropdown (checked
 * or unchecked); empty and zero-percent entries are not rendered. */
function LabeledRings({items}: {items:OverviewPercent[]}) {
  const chartData = items.filter(item=>item.denominator>0 && item.count>0 && item.percentage>0)
    .sort((a,b)=>b.percentage-a.percentage || a.name.localeCompare(b.name))
    .map((item,index)=>({ ...item, predicate: item.name, fill: blues[index%blues.length] }));
  if (!chartData.length) return null;
  // The shadcn Radial Chart - Label composition: one fixed 250px square,
  // RadialBar, and LabelList insideStart; never hand-position SVG <text>.
  return <div className="mx-auto aspect-square max-h-[250px] w-full max-w-[250px] min-w-0" role="img"
    aria-label={chartData.map(item=>`${item.name}: ${pct(item.percentage)}`).join(", ")}>
    <ResponsiveContainer width="100%" height="100%">
      <RadialBarChart data={chartData} startAngle={-90} endAngle={270} innerRadius={30} outerRadius={110}>
        <PolarAngleAxis type="number" domain={[0,100]} tick={false} axisLine={false}/>
        <Tooltip cursor={false} contentStyle={tooltipStyle} formatter={(value,name,entry)=>[`${pct(Number(value))} · ${compact.format((entry?.payload as {count?:number})?.count??0)} of ${compact.format((entry?.payload as {denominator?:number})?.denominator??0)}`,(entry?.payload as {name?:string})?.name??"Coverage"]}/>
        <RadialBar dataKey="percentage" background={{fill:"var(--muted)"}} isAnimationActive={false}>
          <LabelList position="insideStart" dataKey="predicate" className="fill-white capitalize mix-blend-luminosity" fontSize={11}/>
        </RadialBar>
      </RadialBarChart>
    </ResponsiveContainer>
  </div>;
}
function RankedPercent({items,onClick,limit=7}: {items:OverviewPercent[];onClick?:(uri:string)=>void;limit?:number}) {
  return <div className="space-y-3">
    {items.slice(0,limit).map((item,i)=><div key={`${item.uri ?? item.name}:${i}`} className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        {onClick && item.uri ? <button type="button" className="min-w-0 truncate text-left font-medium hover:text-blue-600 hover:underline dark:hover:text-sky-400" onClick={()=>onClick(item.uri!)} title={item.uri}>{item.name}<ArrowUpRight className="ml-1 inline size-3"/></button> : <span className="min-w-0 truncate font-medium" title={item.name}>{item.name}</span>}
        <span className="shrink-0 font-semibold tabular-nums text-blue-600 dark:text-sky-400" title={`${item.count} of ${item.denominator}`}>{pct(item.percentage)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-blue-50 dark:bg-blue-950/60" role="img" aria-label={`${item.name}, ${pct(item.percentage)} of ${item.denominator} counted`}>
        <div className="h-full rounded-full" style={{width:`${item.percentage}%`, backgroundColor:blues[i%blues.length]}}/>
      </div>
    </div>)}
  </div>;
}
function ShareDonut({items}: {items:OverviewPercent[]}) {
  const chartData = items.map((item,i)=>({name:item.name,value:item.count,fill:blues[i%blues.length]}));
  // Recharts normalizes Pie segments to the sum of displayed slices. The
  // top-N ranking is truncated, so add the unshown remainder to preserve the
  // denominator used by every percentage label in this card.
  const rest = Math.max(0,(items[0]?.denominator ?? 0)-items.reduce((sum,item)=>sum+item.count,0));
  if (rest>0) chartData.push({name:"Other returned",value:rest,fill:"#cbd5e1"});
  return <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
    <div className="relative h-44 min-w-0" role="img" aria-label={items.map(item=>`${item.name}: ${pct(item.percentage)}`).join(", ")}>
      <ResponsiveContainer width="100%" height="100%"><PieChart>
        <Pie data={chartData} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="91%" paddingAngle={1} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
          {chartData.map((item,i)=><Cell fill={item.fill} key={i}/>)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(value)=>[`${fmt(Number(value))} observed values`,"Count"]}/>
      </PieChart></ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-semibold text-blue-600 dark:text-sky-400">{pct(items[0]?.percentage ?? 0)}</span><span className="text-[10px] text-muted-foreground">leading share</span></div>
    </div>
    <RankedPercent items={items} limit={6}/>
  </div>;
}
function Timeline({items}: {items:OverviewPercent[]}) {
  return <div role="img" aria-label={items.map(item=>`${item.name}: ${pct(item.percentage)}`).join(", ")} className="h-60 w-full min-w-0">
    <ResponsiveContainer width="100%" height="100%"><AreaChart data={items} margin={{top:12,right:12,left:-21,bottom:0}} accessibilityLayer>
      <defs><linearGradient id="maestroOverviewBlueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.38}/><stop offset="96%" stopColor="#38bdf8" stopOpacity={0.025}/></linearGradient></defs>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3"/>
      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{fontSize:11,fill:"var(--muted-foreground)"}}/>
      <YAxis tickFormatter={(value:number)=>`${value}%`} domain={[0,100]} tickLine={false} axisLine={false} tick={{fontSize:10,fill:"var(--muted-foreground)"}}/>
      <Tooltip contentStyle={tooltipStyle} formatter={(value)=>[pct(Number(value)),"Share of dated values"]}/>
      <Area dataKey="percentage" name="Share" type="monotone" stroke="#2563eb" strokeWidth={2.5} fill="url(#maestroOverviewBlueArea)" dot={{r:3,fill:"#2563eb",stroke:"var(--card)",strokeWidth:1}} activeDot={{r:5}}/>
    </AreaChart></ResponsiveContainer>
  </div>;
}
function Coverage({label,value,total}: {label:string;value:number;total:number}) {
  const share = percentage(value,total);
  return <div className="space-y-1.5"><div className="flex justify-between gap-2 text-xs"><span className="font-medium">{label}</span><span className="tabular-nums font-semibold text-blue-600 dark:text-sky-400">{pct(share)}</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-blue-50 dark:bg-blue-950/60"><div className="h-full rounded-full bg-blue-500" style={{width:`${share}%`}}/></div>
  </div>;
}
function NumericProfile({item}: {item:{label:string;n:number;min:number;max:number;median:number;q1:number;q3:number}}) {
  const ratio=(n:number)=>item.max > item.min ? percentage(n-item.min,item.max-item.min) : 50;
  return <div className="min-w-0 rounded-lg border border-border/60 bg-muted/10 p-3">
    <div className="flex items-start justify-between gap-2"><h4 className="truncate text-xs font-medium" title={item.label}>{item.label}</h4><span className="shrink-0 text-[11px] text-muted-foreground">{fmt(item.n)} values</span></div>
    <div className="my-3 text-xl font-semibold tabular-nums text-blue-600 dark:text-sky-400">{number(item.median)} <span className="text-xs font-normal text-muted-foreground">median</span></div>
    <div className="relative h-3 rounded-full bg-blue-50 dark:bg-blue-950/60">
      <div className="absolute inset-y-0 rounded-full bg-blue-300 dark:bg-sky-700" style={{left:`${ratio(item.q1)}%`,width:`${Math.max(1,ratio(item.q3)-ratio(item.q1))}%`}}/>
      <div className="absolute top-[-3px] h-[18px] w-0.5 rounded bg-blue-700" style={{left:`${ratio(item.median)}%`}}/>
    </div>
    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{number(item.min)} min</span><span>{number(item.max)} max</span></div>
    <p className="mt-2 text-[11px] text-muted-foreground">Shaded band: middle 50% (Q1–Q3), from projected values.</p>
  </div>;
}
function PublishedStats({stats}: {stats:PublishedGraphStats}) {
  const ratios=publishedGraphRatios(stats);
  if (!ratios.length) return null;
  return <Section title="Published graph statistics" detail="VoID statistics exposed by this graph server for the selected named graph. Graph-wide, not filtered by the FCT query." wide>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{ratios.map(row=><div key={row.label} className="rounded-lg border border-blue-100/80 bg-blue-50/40 px-3 py-3 dark:border-blue-900 dark:bg-blue-950/20"><div className="text-2xl font-semibold tabular-nums text-blue-700 dark:text-sky-400">{row.label.includes("share") ? pct(row.ratio) : number(row.ratio)}</div><p className="mt-1 text-xs font-medium">{row.label}</p><p className="mt-1 text-[11px] text-muted-foreground">{row.detail}</p></div>)}</div>
    <p className="mt-3 truncate text-[11px] text-muted-foreground" title={stats.graph}>Named graph: {stats.graph} · Published metadata may be approximate or out of date.</p>
  </Section>;
}

export function OverviewPerspective({workspace}: {workspace: WorkspaceController}) {
  const data = useMemo(()=>buildOverviewReport({
    classes:workspace.classFacets,properties:workspace.propertyFacets,roles:workspace.roleFacets,
    graphs:workspace.graphFacets,records:workspace.visibleResultsPage,total:workspace.effectiveResultsTotalCount,
  }),[workspace.classFacets,workspace.propertyFacets,workspace.roleFacets,workspace.graphFacets,workspace.visibleResultsPage,workspace.effectiveResultsTotalCount]);
  const updating = workspace.isSearching || !workspace.endpointReadyForQuery;
  const [labelState,setLabelState]=useState<{key:string;result:OverviewLabelCoverageResult|null;error:string}|null>(null);
  const [textMatchState,setTextMatchState]=useState<{key:string;result:OverviewLabelCoverageResult|null;error:string}|null>(null);
  const populationKey=workspace.queryXml;
  const nameProperties=workspace.overviewNameProperties;
  const nameKey=nameProperties.map(property=>property.uri).join("\u0000");
  // Match provenance is meaningful only for a root-view text search.
  const rootTextSearch=workspace.queryTree.children.some(node=>node.name==="text" && Boolean(node.text?.trim()));
  const rootView=workspace.queryTree.children.some(node=>node.name==="view");
  const showTextMatch=rootTextSearch && rootView;
  useEffect(()=>{
    if(updating || !nameKey) return;
    const controller=new AbortController();
    void readOverviewLabelCoverage(populationKey,nameProperties,controller.signal)
      .then(result=>{if(!controller.signal.aborted)setLabelState({key:`${populationKey}\u0000${nameKey}`,result,error:""});})
      .catch(error=>{if(!controller.signal.aborted)setLabelState({key:`${populationKey}\u0000${nameKey}`,result:null,error:error instanceof Error?error.message:"Label coverage unavailable."});});
    return ()=>controller.abort();
  },[populationKey,nameKey,updating]);
  const currentLabels=labelState?.key===`${populationKey}\u0000${nameKey}`?labelState:null;
  const labelCoverage: OverviewPercent[]=currentLabels?.result?.items??[];
  // The existing FCT text pattern supplies ?txtp1. This is matching-predicate
  // provenance, not the independent graph-wide name/label usage statistic.
  const textMatchKey=`${populationKey}\u0000${nameKey}`;
  useEffect(()=>{
    if(updating || !nameKey || !showTextMatch) return;
    const controller=new AbortController();
    void readOverviewTextMatchCoverage(populationKey,nameProperties,controller.signal)
      .then(result=>{if(!controller.signal.aborted)setTextMatchState({key:textMatchKey,result,error:""});})
      .catch(error=>{if(!controller.signal.aborted)setTextMatchState({key:textMatchKey,result:null,error:error instanceof Error?error.message:"Text-match coverage unavailable."});});
    return ()=>controller.abort();
  },[populationKey,nameKey,updating,textMatchKey,showTextMatch]);
  const currentTextMatches=textMatchState?.key===textMatchKey?textMatchState:null;
  const textMatchCoverage: OverviewPercent[]=showTextMatch ? (currentTextMatches?.result?.items??[]) : [];

  const publishedAddress = publishedGraphAddress(workspace.queryTree.attributes.addr ?? "");
  const publishedKey = publishedAddress ? `${publishedAddress.graph}\n${publishedAddress.endpoint}` : "";
  const [published, setPublished] = useState<{key:string; stats:PublishedGraphStats|null}|null>(null);
  // Optional and cancelled on graph/endpoint changes. No separate API or privileged SQL procedure.
  useEffect(()=>{
    if (!publishedAddress || updating) return;
    const controller=new AbortController();
    void fetchPublishedVoID(publishedAddress.graph,publishedAddress.endpoint,controller.signal)
      .then(stats=>{if(!controller.signal.aborted)setPublished({key:publishedKey,stats});})
      .catch(()=>{if(!controller.signal.aborted)setPublished({key:publishedKey,stats:null});});
    return ()=>controller.abort();
  },[publishedKey, updating]);
  const graphStats = !updating && published?.key===publishedKey ? published.stats : null;
  const hasReport = data.topClasses.length || data.topProperties.length || data.topRoles.length || data.topGraphs.length ||
    data.sampleSize || labelCoverage.length>0 || textMatchCoverage.length>0 || (data.numericProperties.length > 0) || (data.topNamespaces.length > 0) || !!graphStats;
  const navigate=(uri:string,direction:"forward"|"reverse")=>{workspace.navigateIntoRelationship(uri,direction);workspace.setWorkspaceTab("browse");};
  const classRatios = data.classCoverage.length ? data.classCoverage : data.classShares;
  const coverageEvidence = [
    {name:"Titles different from URI",v:data.termsWithLabels},
    {name:"Description/definition projected",v:data.sampleWithDescriptions},
    {name:"Outgoing properties projected",v:data.sampleWithOutgoing},
    {name:"URI links projected",v:data.linkedSampleResources},
  ].filter(row=>row.v>0);

  return <main aria-label="Overview executive summary" className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6">
    <div className="w-full min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
        <div className="space-y-1"><h2 className="text-2xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">Relationships, composition and evidence for the active FCT result set</p></div>
        <div className="flex items-center gap-2"><Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-sky-300">FCT scope</Badge>
          {updating && <Badge variant="secondary">Updating</Badge>}
          {publishedAddress && !updating && <Badge variant="outline" title="VoID metadata describes a named graph, not the filtered FCT result set.">{published?.key===publishedKey ? (graphStats ? "Graph statistics available" : "VoID not published") : "Checking graph metadata"}</Badge>}</div>
      </header>
      {updating ? <p className="py-8 text-sm text-muted-foreground" role="status">Waiting for the current graph-server result and facet projections.</p> :
      !hasReport ? <MaestroEmptyResults title="No summary available" description="No summary data is available for this query. Try the default Browse perspective or select another graph server." onBrowse={() => workspace.setWorkspaceTab("browse")}/> : <>
        <div className="space-y-1"><h3 className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-sky-400">At a glance</h3>
          <p className="max-w-4xl text-sm leading-relaxed text-foreground/85">{data.summary}</p></div>

        {(labelCoverage.some(item=>item.percentage>0) || textMatchCoverage.some(item=>item.percentage>0)) && <Section title="Name and label evidence" detail="Each ring is the percentage of distinct FCT matches. Predicates may overlap; only positive percentages are drawn." wide>
          <div className="grid items-start gap-4 md:grid-cols-2">
            {labelCoverage.some(item=>item.percentage>0) && <div className="min-w-0"><h4 className="mb-1 text-center text-xs font-semibold">Name and label coverage</h4><p className="mb-2 text-center text-[11px] text-muted-foreground">Available label predicates, including unchecked choices</p><LabeledRings items={labelCoverage}/></div>}
            {textMatchCoverage.some(item=>item.percentage>0) && <div className="min-w-0"><h4 className="mb-1 text-center text-xs font-semibold">Text-match predicates</h4><p className="mb-2 text-center text-[11px] text-muted-foreground">Predicates that actually matched the root search</p><LabeledRings items={textMatchCoverage}/></div>}
          </div>
        </Section>}
        {showTextMatch && currentTextMatches?.error && <ErrorDetails prefix="Text-match provenance" error={currentTextMatches.error} />}

        <div className="grid gap-4 lg:grid-cols-2">
          {classRatios.length>0 && <Section title="Class coverage" detail={data.classCoverage.length ? "Share of all FCT matches belonging to each class. Classes overlap; totals need not add to 100%." : "Share of returned class-facet frequencies. The exact match total was unavailable; this is not resource coverage."}>
            <RankedPercent items={classRatios} onClick={uri=>{workspace.toggleClass(uri,!workspace.selectedClasses.has(uri));workspace.setWorkspaceTab("browse");}}/>
          </Section>}
          {data.propertyShares.length>0 && <Section title="Property mix" detail="Relative share of counted outgoing predicate frequencies in returned FCT facets, not resource coverage.">
            <RankedPercent items={data.propertyShares} onClick={uri=>navigate(uri,"forward")}/>
          </Section>}
          {data.roleShares.length>0 && <Section title="Roles mix" detail="Relative share of counted incoming predicate frequencies in returned FCT facets.">
            <RankedPercent items={data.roleShares} onClick={uri=>navigate(uri,"reverse")}/>
          </Section>}
          {data.graphShares.length>0 && <Section title="Graph contribution" detail="Proportion of returned graph-facet frequencies (not a partition of the whole server). Select a graph to browse it.">
            <ShareDonut items={data.graphShares}/>
            <div className="mt-2 flex flex-wrap gap-1.5">{data.graphShares.slice(0,4).filter(item=>item.uri).map(item=><button key={item.uri} title={item.uri} className="rounded-md border px-2 py-1 text-[11px] hover:border-blue-300 hover:text-blue-600" onClick={()=>{workspace.bindGraph(item.uri!);workspace.setWorkspaceTab("browse");}}>{item.name} <ArrowUpRight className="inline size-3"/></button>)}</div>
          </Section>}
        </div>

        {(data.decadeShares.length>1 || data.languageShares.length>0) && <div className="grid gap-4 lg:grid-cols-2">
          {data.decadeShares.length>1 && <Section title="Temporal concentration" detail="Percentage of recognized dated values in each decade, using projected values on the loaded page only."><Timeline items={data.decadeShares}/></Section>}
          {data.languageShares.length>0 && <Section title="Language distribution" detail="Share of language-tagged literal values projected on the loaded page. Untagged literals are not classified."><ShareDonut items={data.languageShares}/></Section>}
        </div>}

        {(data.projectedValueCount>0 || data.sampleSize>0 && coverageEvidence.length>0 || data.topConnected.length>0) &&
          <div className="grid gap-4 lg:grid-cols-2">
            {data.projectedValueCount>0 && <Section title="RDF relationship profile" detail="Observed among values projected on the loaded page; this is not server-wide graph centrality.">
              <div className="space-y-4">
                {data.projectedUriValues>0 && <Coverage label="URI and blank-node links among projected values" value={data.projectedUriValues} total={data.projectedValueCount}/>}
                {data.outgoingUriLinks + data.incomingUriLinks>0 && <><div className="space-y-2"><p className="text-xs font-medium">Link direction</p><div className="flex h-3 overflow-hidden rounded-full bg-blue-50 dark:bg-blue-950/60">
                  <div className="bg-blue-600" style={{width:`${percentage(data.outgoingUriLinks,data.projectedUriValues)}%`}}/>
                  <div className="bg-sky-300" style={{width:`${percentage(data.incomingUriLinks,data.projectedUriValues)}%`}}/>
                </div><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>Outgoing {pct(percentage(data.outgoingUriLinks,data.projectedUriValues))}</span><span>Roles {pct(percentage(data.incomingUriLinks,data.projectedUriValues))}</span></div></div>
                  <div className="rounded-lg bg-blue-50/70 px-3 py-2 text-sm dark:bg-blue-950/30"><span className="font-semibold text-blue-700 dark:text-sky-400">{number(data.averageUriLinks)}</span> projected URI links per loaded result</div></>}
                {data.invalidTypedNumbers>0 && <p className="text-xs text-amber-700 dark:text-amber-400">{pct(percentage(data.invalidTypedNumbers,data.typedNumberCount))} of typed numeric values in this page could not be parsed.</p>}
              </div>
            </Section>}
            {data.sampleSize>0 && coverageEvidence.length>0 && <Section title="Observed descriptive coverage" detail="Only attributes actually projected with the loaded results. Unprojected RDF is unknown, not missing.">
              <div className="space-y-4">{coverageEvidence.map(row=><Coverage key={row.name} label={row.name} value={row.v} total={data.sampleSize}/>)}</div>
            </Section>}
            {data.connectedShares.length>0 && <Section title="Highly linked examples" detail="Share of URI-link projections by loaded resource; this is not a global degree ranking."><RankedPercent items={data.connectedShares}/></Section>}
          </div>}

        {(data.valueShares.length || data.namespaceShares.length || data.combinationShares.length || data.classPropertyShares.length) && <div className="grid gap-4 lg:grid-cols-2">
          {<Section title="Common observed values" detail="Share among short, non-URI values projected on the loaded page.">{data.valueShares.length > 0
            ? <RankedPercent items={data.valueShares}/>
            : <p className="text-sm text-muted-foreground">No common values were returned. Try narrowing the query by applying additional filters.</p>}</Section>}
          {data.namespaceShares.length>0 && <Section title="Vocabulary mix" detail="Namespace share of distinct class, property and role facets returned for this scope."><RankedPercent items={data.namespaceShares}/></Section>}
          {data.combinationShares.length>0 && <Section title="Common property combinations" detail="Share of loaded records with each pair of projected outgoing properties. Pairs overlap."><RankedPercent items={data.combinationShares}/></Section>}
          {data.classPropertyShares.length>0 && <Section title="Class-to-property patterns" detail="Observed rdf:type and outgoing property combinations on the loaded page only."><RankedPercent items={data.classPropertyShares}/></Section>}
        </div>}

        {(data.numericProperties.length>0 || data.geo) && <div className="grid gap-4 lg:grid-cols-2">
          {data.numericProperties.length>0 && <Section title="Numeric distributions" detail="Medians and interquartile ranges for typed numbers in projected values only."><div className="grid gap-3 sm:grid-cols-2">{data.numericProperties.map(item=><NumericProfile key={item.label} item={item}/>)}</div></Section>}
          {data.geo && <Section title="Geographic spread" detail="Bounds of matched latitude/longitude pairs in the loaded-page projections; not a map of the full result set.">
            <div className="space-y-4"><Coverage label="Resources with coordinate pairs" value={data.geo.count} total={data.geo.sample}/>
              <div className="grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-blue-50/60 p-3 dark:bg-blue-950/20"><p className="font-medium">Latitude range</p><p className="mt-1 tabular-nums text-blue-700 dark:text-sky-400">{number(data.geo.latitude[0])}° to {number(data.geo.latitude[1])}°</p></div>
                <div className="rounded-lg bg-blue-50/60 p-3 dark:bg-blue-950/20"><p className="font-medium">Longitude range</p><p className="mt-1 tabular-nums text-blue-700 dark:text-sky-400">{number(data.geo.longitude[0])}° to {number(data.geo.longitude[1])}°</p></div></div>
            </div></Section>}
        </div>}

        {graphStats && <div className="grid gap-4 lg:grid-cols-2"><PublishedStats stats={graphStats}/></div>}

        {data.exampleRecords.length>0 && <Section title="Example resources" detail="Actual result items on the loaded page, not an inferred global importance ranking.">
          <div className="grid gap-2 sm:grid-cols-2">{data.exampleRecords.map((item,i)=><button key={`${item.uri}:${i}`} type="button" className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-3 text-left text-sm hover:border-blue-300 hover:bg-blue-50/60 dark:hover:bg-blue-950/30" onClick={()=>{workspace.setSelectedUri(item.uri);workspace.setWorkspaceTab("browse");}}><span className="truncate" title={item.uri}>{item.title}</span><ArrowUpRight className="size-4 shrink-0 text-blue-600 dark:text-sky-400"/></button>)}</div>
        </Section>}
        <footer className="flex flex-wrap gap-2 border-t border-border/70 pt-4 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-blue-600"/>
          <span>FCT facet ratios are based on the returned facet frequencies and may be truncated. Class memberships overlap. Temporal, language, relationship, value, quality and resource observations use only the loaded page. Name/label and text-match rings use the compiled FCT scope and distinct-resource denominators, not a sampled population. The name/label chart includes unchecked predicates; at root the text-match chart shows which indexed predicates actually satisfied the search. Node analytics lives in Analyze and is version-gated. VoID, when available, is published named-graph metadata, not filtered query statistics. No missing evidence is estimated or invented.</span>
        </footer>
      </>}
    </div>
  </main>;
}
