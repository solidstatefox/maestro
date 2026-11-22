"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, LoaderCircle } from "lucide-react";
import { StatusHeatmap, StatusHeatmapBlock, StatusHeatmapBody,
  StatusHeatmapFooter, StatusHeatmapLegend, StatusHeatmapStat } from "@/components/heatmap/status-heatmap";
import { graphStatusDaily, graphStatusRangeFromFct, readGraphServerStatusHistory,
  type GraphServerStatusObservation } from "@/lib/client-graph-server-status-history";

/** Native status view over the private RDF observations. The XSLT remains the
 * domain owner of the graph-server card contents; the host owns history. */
export function GraphServerStatusHistory({ endpoint, label, queryXml, canRead, compact = false }: {
  endpoint: string; label: string; queryXml: string; canRead: boolean; compact?: boolean;
}) {
  const [result, setResult] = useState<{ key: string; rows: GraphServerStatusObservation[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const range = useMemo(() => graphStatusRangeFromFct(queryXml), [queryXml]);
  const key = JSON.stringify([endpoint, range.from ?? "", range.to ?? ""]);
  useEffect(() => {
    const controller = new AbortController();
    if (!endpoint || !canRead) { setResult(null); setLoading(false); setError(""); return () => controller.abort(); }
    setLoading(true); setError("");
    void readGraphServerStatusHistory(endpoint, range, controller.signal)
      .then(rows => { if (!controller.signal.aborted) setResult({ key, rows }); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Cannot read status history"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, canRead, key]);
  const rows = result?.key === key ? result.rows : [];
  const data = useMemo(() => graphStatusDaily(rows), [rows]);
  if (!endpoint) return null;
  return <section aria-label={`Status history for ${label}`} className={compact ? "mt-2 min-w-0 border-t pt-2" : "shrink-0 border-b bg-background px-4 py-3"}>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <Activity className="size-4 text-muted-foreground" aria-hidden="true"/>
      <strong className="max-w-full break-words">{label} · Status history</strong>
      <span className="ml-auto text-muted-foreground tabular-nums">{rows.length.toLocaleString()} observations · {data.length.toLocaleString()} observed days</span>
      {range.from || range.to ? <span className="text-muted-foreground">{range.from ?? "Beginning"} — {range.to ?? "Today"}</span> : <span className="text-muted-foreground">All time</span>}
    </div>
    {!canRead ? <p className="text-xs text-muted-foreground">Sign in to read your private status history.</p>
      : loading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin"/>Loading status observations…</p>
      : error ? <p role="alert" className="text-xs text-destructive">{error}</p>
      : !data.length ? <p className="text-xs text-muted-foreground">No status observations have been recorded for this server and period. Unsampled days are not assumed healthy.</p>
      : <div className="max-w-full overflow-x-auto"><StatusHeatmap data={data} className="max-w-full p-0" labels={{ heatmapLabel: `${label} status history`, statuses: { noData: "No data", critical: "Critical", degraded: "Degraded", healthy: "Healthy" } }}>
          <StatusHeatmapBody labelInterval={30}>{({ activity, dayIndex }) => (
            <StatusHeatmapBlock activity={activity} dayIndex={dayIndex}/>
          )}</StatusHeatmapBody>
          <StatusHeatmapFooter><StatusHeatmapStat label="Healthy days: {{value}}"/><StatusHeatmapLegend/></StatusHeatmapFooter>
        </StatusHeatmap></div>}
  </section>;
}
