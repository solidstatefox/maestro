"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FctQueryNode } from "@/lib/fct-query-api";
import { readMaestroWidgetTimeouts } from "@/lib/maestro-query-timeouts";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { readFctResponse } from "@/canvas/utils/fct-response";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ButtonGroup } from "@/components/ui/button-group";
import { DateTimePicker } from "@/components/ui/date-time-picker";

export type TemporalFacetProvider = { uri: string; property: string; label: string };
type Provider = TemporalFacetProvider;
type Resolution = "years" | "months" | "weeks" | "days";
type Props = {
  properties: string[];
  scopeNodes: FctQueryNode[];
  queryXml: string;
  onRangeChange: (property: string, start: string, end: string) => void;
};
const DAY_MS = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
function localDate(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
function utcDate(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : "";
}
function normalizedBucket(value: string, resolution: Resolution) {
  if (resolution === "years") return /^\d{4}/.exec(value)?.[0] ?? "";
  if (resolution === "months") return /^\d{4}-\d{2}/.exec(value)?.[0] ?? "";
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? "";
}
/** Clone the live query, remove only this facet's date range, and move its view
 * to the matching Personal property, retaining graph scope and other filters. */
function calendarQuery(queryXml: string, property: string, resolution: Resolution): string | null {
  const doc = new DOMParser().parseFromString(queryXml, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const view = Array.from(doc.getElementsByTagName("*")).find(el => el.localName === "view");
  if (!view?.parentElement) return null;
  const scope = view.parentElement;
  const facet = Array.from(scope.children).find(el => el.localName === "property" && el.getAttribute("iri") === property);
  if (!facet) return null;
  Array.from(facet.children).filter(el => el.localName === "value").forEach(el => el.remove());
  // The view-bearing date property is bound by ordinary FCT traversal.
  view.remove();
  facet.appendChild(view);
  view.setAttribute("type", resolution);
  view.setAttribute("limit", "500");
  view.setAttribute("offset", "0");
  return new XMLSerializer().serializeToString(doc);
}
function selectionBounds(start: Date, endExclusive: Date): [string, string] {
  return [start.toISOString().replace(/\.\d{3}Z$/, "Z"), new Date(endExclusive.getTime() - 1000).toISOString().replace(/\.\d{3}Z$/, "Z")];
}
function dateAt(year: number, month: number, day = 1) { return new Date(Date.UTC(year, month, day)); }

export function TemporalFacetContent({ provider, scopeNodes, queryXml, onRangeChange }: {
  provider: Provider; scopeNodes: FctQueryNode[]; queryXml: string; onRangeChange: Props["onRangeChange"];
}) {
  const [selectedCalendarCell, setSelectedCalendarCell] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [resolution, setResolution] = useState<Resolution>("years");
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [month, setMonth] = useState(() => new Date().getUTCMonth());
  const [weekStart, setWeekStart] = useState(() => dateAt(new Date().getUTCFullYear(),new Date().getUTCMonth(),1));
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [fetching, setFetching] = useState(false);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [error, setError] = useState("");
  const existing = scopeNodes.find(node => node.name === "property" && node.attributes.iri === provider.property);
  const range = existing?.children.find(node => node.name === "value" &&
    (node.attributes.rangeStart !== undefined || node.attributes.rangeEnd !== undefined));
  const savedStart = range?.attributes.rangeStart ?? "";
  const savedEnd = range?.attributes.rangeEnd ?? "";
  useEffect(() => { setFrom(localDate(savedStart)); setTo(localDate(savedEnd)); }, [savedStart, savedEnd]);
  // Year zoom shows month counts; month zoom shows week counts; week and day
  // zoom show individual day counts. These are bucket views on one property.
  const bucketView: Resolution = resolution === "years" ? "months" : "days";
  const query = useMemo(() => calendarQuery(queryXml, provider.property, bucketView), [queryXml, provider.property, bucketView]);
  useEffect(() => {
    const controller = new AbortController();
    if (!query) { setCounts(new Map()); setFetching(false); setCountsLoaded(false); return () => controller.abort(); }
    setFetching(true); setCountsLoaded(false); setError("");
    void (async () => {
      try {
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "text/xml; charset=utf-8", "X-Maestro-Query-Label": `TemporalFacet:${provider.property}` }, body: query,
        });
        if (!response.ok) throw new Error(`Calendar query returned HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);
        const data = await readFctResponse(response);
        if (data.error) throw new Error(String(data.error));
        if (controller.signal.aborted) return;
        const totals = new Map<string, number>();
        for (const columns of data.rows) {
          const key = normalizedBucket(columns[0]?.value ?? "", bucketView);
          const number = Number(columns[1]?.value ?? 0);
          if (key && Number.isFinite(number) && number >= 0) totals.set(key, (totals.get(key) ?? 0) + number);
        }
        setCounts(totals);
        setCountsLoaded(true);
      } catch (cause) {
        if (!controller.signal.aborted) { setCounts(new Map()); setCountsLoaded(false); setError(cause instanceof Error ? cause.message : "Calendar counts unavailable"); }
      } finally { if (!controller.signal.aborted) setFetching(false); }
    })();
    return () => controller.abort();
  }, [query, bucketView, provider.property]);
  // Apply only complete, ordered ranges. Individual picker edits are immediate;
  // no Apply button or blur event is necessary.
  const updateRange = (nextFrom: string, nextTo: string) => {
    // An explicit From/To edit tears down any prior calendar-cell selection.
    setSelectedCalendarCell("");
    setFrom(nextFrom); setTo(nextTo);
    if (nextFrom && nextTo && nextFrom <= nextTo) onRangeChange(provider.property, utcDate(nextFrom), utcDate(nextTo));
  };
  const invalid = Boolean(from && to && from > to);
  const choose = (start: Date, end: Date, cellKey: string) => {
    setSelectedCalendarCell(cellKey);
    const [a,b] = selectionBounds(start,end);
    setFrom(localDate(a)); setTo(localDate(b));
    onRangeChange(provider.property,a,b);
  };
  const monthLabel = new Intl.DateTimeFormat(undefined,{month:"long",timeZone:"UTC"}).format(dateAt(year,month));
  const countFor = (date: Date) => counts.get(normalizedBucket(iso(date), bucketView)) ?? 0;
  const selectedCalendarStyle = (key: string) => selectedCalendarCell === key
    ? "border-border bg-muted/70 text-foreground ring-1 ring-border/60 dark:border-border dark:bg-muted/50 dark:text-foreground"
    : "";
  const mutedIfZero = (count: number) => countsLoaded && !fetching && !error && count === 0
    ? "bg-muted/30 text-muted-foreground/50 opacity-50"
    : "hover:bg-accent";
  const weekdayName = (date: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  const weekCount = (start: Date) => Array.from({length:7},(_,i)=> new Date(start.getTime()+i*DAY_MS))
    .filter(day => day.getUTCFullYear() === year && day.getUTCMonth() === month)
    .reduce((sum,day)=>sum+countFor(day),0);
  const shiftCalendar = (direction: number) => {
    if (resolution === "years") { setYear(value=>value+direction); return; }
    if (resolution === "weeks") {
      const next = new Date(weekStart.getTime()+direction*7*DAY_MS);
      setWeekStart(next); setYear(next.getUTCFullYear()); setMonth(next.getUTCMonth()); return;
    }
    const next = dateAt(year, month+direction);
    setYear(next.getUTCFullYear()); setMonth(next.getUTCMonth());
  };
  const weeks = Array.from({length:6}, (_,i)=> {
    const first = dateAt(year,month,1);
    return new Date(first.getTime() - ((first.getUTCDay()+6)%7)*DAY_MS + i*7*DAY_MS);
  }).filter(start => start < dateAt(year,month+1,1) && start.getTime()+7*DAY_MS > dateAt(year,month,1).getTime());
  const days = resolution === "weeks"
    ? Array.from({length:7},(_,i)=>new Date(weekStart.getTime()+i*DAY_MS))
    : Array.from({length:new Date(Date.UTC(year,month+1,0)).getUTCDate()},(_,i)=>dateAt(year,month,i+1));
  return <div className="flex min-w-0 flex-col gap-2" aria-label={`${provider.label} calendar and range`}>
    <div className="flex flex-col gap-2">
      <DateTimePicker label="From" value={from} onChange={next => updateRange(next, to)} />
      <DateTimePicker label="To" value={to} onChange={next => updateRange(from, next)} />
      {invalid && <span className="text-xs text-destructive">From must not be after To.</span>}
      <div className="flex gap-2">
        {range && <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={()=>{setSelectedCalendarCell("");setFrom("");setTo("");onRangeChange(provider.property,"","");}}>Clear</button>}
      </div>
      <div className="mt-2 flex flex-col gap-2 border-t pt-2" aria-label="Temporal calendar">
        <ButtonGroup aria-label="Calendar resolution" className="w-full">
          <ToggleGroup type="single" value={resolution} onValueChange={value=>{ if(value) setResolution(value as Resolution); }} className="w-full">
            {([ ["years","Year"],["months","Month"],["weeks","Week"],["days","Day"] ] as const).map(([value,label])=><ToggleGroupItem key={value} value={value} className="flex-1">{label}</ToggleGroupItem>)}
          </ToggleGroup>
        </ButtonGroup>
        <div className="flex items-center justify-between gap-2 text-xs">
          <button aria-label={`Previous ${resolution === "years" ? "year" : resolution === "weeks" ? "week" : "month"}`} type="button" onClick={()=>shiftCalendar(-1)} className="rounded p-1 hover:bg-accent"><ChevronLeft className="size-4"/></button>
          <span className="font-medium">{resolution === "years" ? year : resolution === "weeks" ? `Week of ${iso(weekStart)}` : `${monthLabel} ${year}`}</span>
          <button aria-label={`Next ${resolution === "years" ? "year" : resolution === "weeks" ? "week" : "month"}`} type="button" onClick={()=>shiftCalendar(1)} className="rounded p-1 hover:bg-accent"><ChevronRight className="size-4"/></button>
        </div>
        <div className={`grid gap-1 ${resolution === "days" || resolution === "weeks" ? "grid-cols-7" : "grid-cols-3"}`}>
          {resolution === "years" && Array.from({length:12},(_,i)=>i).map(m=>{
            const count = counts.get(`${year}-${String(m+1).padStart(2,"0")}`) ?? 0;
            return <button key={m} type="button" onClick={()=>{choose(dateAt(year,m),dateAt(year,m+1), `month:${year}-${m}`);setMonth(m);}} className={`flex flex-col items-center rounded border px-1 py-2 text-xs ${selectedCalendarCell === `month:${year}-${m}` ? selectedCalendarStyle(`month:${year}-${m}`) : mutedIfZero(count)}`}><span>{new Intl.DateTimeFormat(undefined,{month:"short",timeZone:"UTC"}).format(dateAt(year,m))}</span><span className="text-muted-foreground">{count}</span></button>;
          })}
          {resolution === "months" && weeks.map(start=>{
            const count = weekCount(start);
            return <button key={iso(start)} type="button" onClick={()=>{choose(start,new Date(start.getTime()+7*DAY_MS), `week:${iso(start)}`);setWeekStart(start);}} className={`flex flex-col items-center rounded border px-1 py-2 text-xs ${selectedCalendarCell === `week:${iso(start)}` ? selectedCalendarStyle(`week:${iso(start)}`) : mutedIfZero(count)}`}><span>{iso(start).slice(5)}</span><span className="text-muted-foreground">{count}</span></button>;
          })}
          {(resolution === "days" || resolution === "weeks") && days.map(day=>{
            const count = countFor(day);
            return <button key={iso(day)} type="button" onClick={()=>choose(day,new Date(day.getTime()+DAY_MS), `day:${iso(day)}`)} className={`flex flex-col items-center rounded border px-1 py-1 text-xs ${selectedCalendarCell === `day:${iso(day)}` ? selectedCalendarStyle(`day:${iso(day)}`) : mutedIfZero(count)}`}><span>{resolution === "weeks" ? weekdayName(day) : day.getUTCDate()}</span><span className="text-muted-foreground">{count}</span></button>;
          })}
        </div>
        {fetching && <span className="text-xs text-muted-foreground">Fetching calendar counts…</span>}
        {error && <ErrorDetails prefix="Calendar" error={error} />}
      </div>
    </div>
  </div>;
}
export type NumericFacetProvider = { uri: string; projections: Array<{ aggregate: "MIN" | "MAX" | "AVG" | "SUM"; expression: "xsd:decimal(?facetValue)" | "?facetNumber"; alias: string }> };
export function usePersonalFacetProviders(properties: string[], queryXml = "", datatypeEvidence: Record<string, string[]> = {}): { temporal: Map<string, TemporalFacetProvider>; numeric: NumericFacetProvider[] } {
  const [providers,setProviders] = useState<Provider[]>([]);
  const [numeric,setNumeric] = useState<NumericFacetProvider[]>([]);
  const key = useMemo(()=>[...new Set(properties)].sort().join("\n"),[properties]);
  const evidenceKey = JSON.stringify(datatypeEvidence);
  useEffect(()=>{
    const controller=new AbortController();setProviders([]);setNumeric([]);
    if(!key) return ()=>controller.abort();
    void fetch("/proxy/api/service?service=maestro&operationId=personal-facet-providers",{method:"POST",cache:"no-store",signal:controller.signal,
      headers:{"Content-Type":"application/json"},body:JSON.stringify({properties:key.split("\n"),queryXml,datatypeEvidence:JSON.parse(evidenceKey),timeoutMs:readMaestroWidgetTimeouts().personal*1000})})
      .then(async response=>{if(!response.ok)return;const data=await response.json() as {providers?:Provider[];numericProviders?:NumericFacetProvider[]};if(!controller.signal.aborted){setProviders(data.providers??[]);setNumeric(data.numericProviders??[]);}})
      .catch(()=>{});
    return ()=>controller.abort();
  },[key,queryXml,evidenceKey]);
  const temporal = useMemo(() => new Map(providers.map(provider => [provider.property, provider])), [providers]);
  return { temporal, numeric };
}
