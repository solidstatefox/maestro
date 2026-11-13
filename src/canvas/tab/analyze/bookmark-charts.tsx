"use client";
import { ErrorDetails } from "@/components/ui/error-details";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const BOOKMARK_ACTIVITY_URI = "gttp://ggg.maestro.ecosys/analyze/bookmark-activity";
export const BOOKMARK_TAGS_URI = "gttp://ggg.maestro.ecosys/analyze/bookmark-tags";
export const isBookmarkAnalysis = (uri: string) => uri === BOOKMARK_ACTIVITY_URI || uri === BOOKMARK_TAGS_URI;

type Row = { label: string; weekday: string; hour: string; count: number };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PERIODS = ["Morning", "Afternoon", "Evening", "Twilight"];
const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** The four periods are disjoint; "twilight" spans early dawn and dusk. */
const periodFor = (hour: number) => hour >= 5 && hour < 7 || hour >= 18 && hour < 20
  ? "Twilight" : hour >= 7 && hour < 12 ? "Morning" : hour >= 12 && hour < 18
  ? "Afternoon" : "Evening";

export function BookmarkCharts({ queryXml, providerUri }: { queryXml: string; providerUri: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const kind = providerUri === BOOKMARK_ACTIVITY_URI ? "activity" : "tags";
  useEffect(() => {
    const controller = new AbortController();
    setRows([]); setError(""); setLoading(true);
    void (async () => {
      try {
        const response = await fetch("/proxy/api/service?service=maestro&operationId=bookmark-analysis", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, queryXml }),
        });
        const payload = await response.json() as { rows?: Row[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Bookmark analysis returned HTTP ${response.status}`);
        if (!controller.signal.aborted) setRows(payload.rows ?? []);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Bookmark analysis failed.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [kind, queryXml]);
  const days = useMemo(() => DAYS.map(day => ({
    label: day.slice(0, 3), count: rows.filter(r => r.weekday.toLowerCase() === day.toLowerCase()).reduce((a,r)=>a+r.count,0),
  })), [rows]);
  const periods = useMemo(() => PERIODS.map(period => ({
    label: period,
    count: rows.filter(r => Number.isInteger(Number(r.hour)) && periodFor(Number(r.hour)) === period).reduce((a,r)=>a+r.count,0),
  })), [rows]);
  const tags = useMemo(() => rows.filter(r=>r.label).sort((a,b)=>b.count-a.count).slice(0,100).map(r=>({label:r.label,count:r.count})),[rows]);
  if (loading) return <p className="p-4 text-sm text-muted-foreground">Analyzing bookmarks…</p>;
  if (error) return <ErrorDetails prefix="Bookmark analysis" error={error} className="m-4" />;
  if (!rows.length) return <p className="p-4 text-sm text-muted-foreground">No matching bookmark data for this analysis.</p>;
  if (kind === "tags") return <section className="min-h-0 w-full p-4" aria-label="Bookmark tags pie chart">
    <h2 className="mb-2 text-sm font-medium">Bookmark tags</h2>
    <p className="mb-4 text-xs text-muted-foreground">Distinct matching bookmarks per tag. A bookmark with several tags contributes to each tag.</p>
    <div className="h-[min(65vh,560px)] min-h-64 w-full" role="img" aria-label={tags.map(t=>`${t.label}: ${t.count}`).join(", ")}>
      <ResponsiveContainer width="100%" height="100%"><PieChart>
        <Pie data={tags} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius="20%" outerRadius="76%" label={({name,percent})=>`${name ?? ""} ${Math.round((percent ?? 0)*100)}%`}>
          {tags.map((item,i)=><Cell key={`${item.label}:${i}`} fill={chartColors[i%chartColors.length]}/>)}
        </Pie><Tooltip formatter={(value)=>[value,"Bookmarks"]}/><Legend/>
      </PieChart></ResponsiveContainer>
    </div>
  </section>;
  return <section className="flex min-h-0 w-full flex-col gap-4 p-4" aria-label="Bookmark activity histogram">
    <h2 className="text-sm font-medium">Bookmarking activity</h2>
    <p className="text-xs text-muted-foreground">Distinct bookmarks in the current faceted query. Time periods: Morning 07–11, Afternoon 12–17, Twilight 05–06 and 18–19, Evening 20–04 (timestamp hour).</p>
    {([{label:"By day of week",data:days},{label:"By time of day",data:periods}] as const).map(chart=><div key={chart.label} className="min-h-64 w-full" style={{height:280}}>
      <h3 className="mb-2 text-xs font-semibold">{chart.label}</h3>
      <ResponsiveContainer width="100%" height="90%"><BarChart data={chart.data} margin={{top:10,right:14,bottom:12,left:4}}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)"/>
        <XAxis dataKey="label" tick={{fontSize:11}}/><YAxis allowDecimals={false} tick={{fontSize:11}}/>
        <Tooltip formatter={(value)=>[value,"Bookmarks"]}/><Bar dataKey="count" fill="var(--chart-1)" maxBarSize={64} radius={[4,4,0,0]}/>
      </BarChart></ResponsiveContainer>
    </div>)}
  </section>;
}
