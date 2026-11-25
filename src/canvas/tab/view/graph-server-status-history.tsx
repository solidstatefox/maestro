"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createMaestroViewDiscoveryController } from "@/lib/app-lifecycle/view-discovery";
import { validGraphServerUrl } from "@/lib/graph-server-directory";
import { Activity, LoaderCircle } from "lucide-react";
import { StatusHeatmap, StatusHeatmapBlock, StatusHeatmapBody,
  StatusHeatmapFooter, StatusHeatmapLegend, StatusHeatmapStat } from "@/components/heatmap/status-heatmap";
import { GRAPH_SERVER_STATUS_SAVED, graphStatusDaily, graphStatusRangeFromFct, readGraphServerStatusHistories,
  type GraphServerStatusObservation } from "@/lib/client-graph-server-status-history";

/** Native status view over the private RDF observations. The XSLT remains the
 * domain owner of the graph-server card contents; the host owns history. */
type HistoryState = { rows: readonly GraphServerStatusObservation[]; loading: boolean; error: string };
const HistoryContext = createContext<HistoryState>({rows: [], loading: false, error: ""});
/** One account-scoped read for all cards, never one read per card. */
export function GraphServerHistoryScope({ active, account, queryXml, children }: {active:boolean;account:string;queryXml:string;children:ReactNode}) {
  const [controller] = useState(() => createMaestroViewDiscoveryController<GraphServerStatusObservation>());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [revision, setRevision] = useState(0);
  const range = useMemo(() => graphStatusRangeFromFct(queryXml), [queryXml]);
  const key = JSON.stringify([account, range.from ?? "", range.to ?? "", revision]);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saved = () => { clearTimeout(timer); timer = setTimeout(() => setRevision(r => r+1), 250); };
    window.addEventListener(GRAPH_SERVER_STATUS_SAVED,saved);
    return () => {clearTimeout(timer);window.removeEventListener(GRAPH_SERVER_STATUS_SAVED,saved);};
  },[active,account]);
  useEffect(() => {
    if (!active || !account) {controller.inactive();return;}
    controller.discover(key, signal => readGraphServerStatusHistories(range, signal));
  },[controller,active,account,key]);
  const matching = snapshot.context.key === key;
  const state = useMemo(() => ({rows: matching && snapshot.matches("ready") ? snapshot.context.items : [],
    loading: active && (!matching || snapshot.matches("loading")), error: matching ? snapshot.context.error : ""}),[snapshot,matching,active]);
  return <HistoryContext.Provider value={state}>{children}</HistoryContext.Provider>;
}
export function GraphServerStatusHistory({ endpoint, label, queryXml, canRead, compact = false }: {
  endpoint: string; label: string; queryXml: string; canRead: boolean; compact?: boolean;
}) {
  const history = useContext(HistoryContext);
  const normalized = validGraphServerUrl(endpoint);
  const range = useMemo(() => graphStatusRangeFromFct(queryXml), [queryXml]);
  const rows = useMemo(() => history.rows.filter(row => row.endpoint === normalized),[history.rows,normalized]);
  const {loading,error} = history;
  const data = useMemo(() => graphStatusDaily(rows), [rows]);
  const strip = useMemo(() => {
    const today = Date.parse((range.to ?? new Date().toISOString().slice(0,10))+"T00:00:00Z");
    const start = Math.max(today-29*86400000, range.from ? Date.parse(range.from+"T00:00:00Z") : -Infinity);
    const daily = new Map(data.map(day=>[day.date,day.value]));
    return Array.from({length:Math.max(0,Math.min(30,Math.floor((today-start)/86400000)+1))},(_,i)=>{
      const date=new Date(start+i*86400000).toISOString().slice(0,10);return {date,value:daily.get(date)??0};
    });
  },[data,range]);
  if (!endpoint) return null;
  return <section aria-label={`Status history for ${label}`} className={compact ? "mt-2 min-w-0 border-t pt-2" : "shrink-0 border-b bg-background px-4 py-3"}>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <Activity className="size-4 text-muted-foreground" aria-hidden="true"/>
      <strong className="max-w-full break-words">{label} · Status history</strong>
      <span className="ml-auto text-muted-foreground tabular-nums">{rows.length.toLocaleString()} observations · {data.length.toLocaleString()} observed days</span>
      {range.from || range.to ? <span className="text-muted-foreground">{range.from ?? "Beginning"} — {range.to ?? "Today"}</span> : <span className="text-muted-foreground">{compact ? "Last 30 days shown" : "All time"}</span>}
    </div>
    {!canRead ? <p className="text-xs text-muted-foreground">Sign in to read your private status history.</p>
      : loading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin"/>Loading status observations…</p>
      : error ? <p role="alert" className="text-xs text-destructive">{error}</p>
      : compact ? <div className="flex flex-wrap gap-1" aria-label={`${label} health history, up to 30 days`}>
          {strip.map(day => <span key={day.date} tabIndex={0} className={`size-2.5 rounded-[2px] ${day.value === 3 ? "bg-green-600" : day.value === 2 ? "bg-amber-500" : day.value === 1 ? "bg-red-600" : "bg-muted"}`} title={rows.filter(row => row.created.slice(0,10) === day.date).map(row => `${row.created} · ${row.state} · ${row.status === null ? "No HTTP response" : `HTTP ${row.status}`}`).join("\n") || `${day.date} · No observations`} aria-label={`${day.date}: ${day.value === 3 ? "Healthy" : day.value === 2 ? "Degraded" : day.value === 1 ? "Critical" : "Unknown"}`}/>)}
        </div> : !data.length ? <p className="text-xs text-muted-foreground">No observations recorded.</p> : <div className="max-w-full overflow-x-auto"><StatusHeatmap data={data} className="max-w-full p-0" labels={{ heatmapLabel: `${label} status history`, statuses: { noData: "No data", critical: "Critical", degraded: "Degraded", healthy: "Healthy" } }}>
          <StatusHeatmapBody labelInterval={30}>{({ activity, dayIndex }) => (
            <StatusHeatmapBlock activity={activity} dayIndex={dayIndex}/>
          )}</StatusHeatmapBody>
          <StatusHeatmapFooter><StatusHeatmapStat label="Healthy days: {{value}}"/><StatusHeatmapLegend/></StatusHeatmapFooter>
        </StatusHeatmap></div>}
  </section>;
}
