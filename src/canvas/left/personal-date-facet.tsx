"use client";
import { discoverClientFacetProviders } from "@/lib/client-facet-providers";
import { ErrorDetails } from "@/components/ui/error-details";
import { useProviderWidgetLifecycle } from "@/canvas/diagnostics/use-provider-widget-lifecycle";
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { snapshotFctQueryXml, type FctQueryNode } from "@/lib/fct-query-api";
import { readMaestroWidgetTimeouts } from "@/lib/maestro-query-timeouts";
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { buildFctTemporalDomainSparql } from "@/lib/fct-count-sparql";
import { parseFctQueryXml } from "@/canvas/utils/query-controller";
import { readFctResponse } from "@/canvas/utils/fct-response";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ButtonGroup } from "@/components/ui/button-group";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { temporalDayDomain, temporalPageOverlapsDomain } from "@/lib/temporal-domain-bounds";
import {
  createMaestroProviderDiscoveryController, selectProviderMatches, facetProviderApplicabilityKey,
  type DateProviderMatch, type NumericProviderMatch, type TagProviderMatch,
} from "@/lib/app-lifecycle/providers";

export type TemporalFacetProvider = { uri: string; property: string; label: string };
type Provider = TemporalFacetProvider;
type Resolution = "years" | "months" | "weeks" | "days";
type Props = {
  properties: string[];
  scopeNodes: FctQueryNode[];
  queryXml: string;
  onRangeChange: (property: string, start: string, end: string, selection?: { resolution: Resolution; cell: string }) => void;
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
  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(queryXml, "data"), "application/xml");
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
/** Preserve the live query's focus, removing only this facet's own range. */
function temporalDomainQuery(queryXml: string, property: string): { query: string; addr: string } | null {
  // A temporal domain is a domain of *facet values*, not the parent focus.
  // Move the view to the exact same date-property carrier as calendarQuery.
  // In particular, don't join the date predicate a second time to an already
  // bound date literal (a common source of empty MIN/MAX projections).
  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(queryXml, "data"), "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const view = Array.from(doc.getElementsByTagName("*")).find(el => el.localName === "view");
  if (!view?.parentElement) return null;
  const facet = Array.from(view.parentElement.children).find(el => el.localName === "property" && el.getAttribute("iri") === property);
  if (!facet) return null;
  Array.from(facet.children).filter(el => el.localName === "value" &&
    (el.hasAttribute("rangeStart") || el.hasAttribute("rangeEnd"))).forEach(el => el.remove());
  view.remove();
  facet.appendChild(view);
  const tree = parseFctQueryXml(new XMLSerializer().serializeToString(doc));
  if (!tree) return null;
  const query = buildFctTemporalDomainSparql(tree, property);
  return query ? { query, addr: tree.attributes.addr } : null;
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
  const [domain, setDomain] = useState<{ min: string; max: string } | null>(null);
  const [domainLoading, setDomainLoading] = useState(true);
  const [domainError, setDomainError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [error, setError] = useState("");
  const widgetPhase = useProviderWidgetLifecycle(`${provider.uri}|${provider.property}`, {
    loading: fetching || domainLoading, ready: Boolean(domain) || countsLoaded,
    error: error || domainError,
  });
  const existing = scopeNodes.find(node => node.name === "property" && node.attributes.iri === provider.property);
  const range = existing?.children.find(node => node.name === "value" &&
    (node.attributes.rangeStart !== undefined || node.attributes.rangeEnd !== undefined));
  const savedStart = range?.attributes.rangeStart ?? "";
  const savedEnd = range?.attributes.rangeEnd ?? "";
  const savedResolution = range?.attributes.uiResolution ?? "";
  const savedCell = range?.attributes.uiCell ?? "";
  // Committed selectors are hydrated only from the active FCT <value>. A
  // historical or shared query must never inherit the prior calendar's tab.
  useEffect(() => {
    setFrom(localDate(savedStart)); setTo(localDate(savedEnd));
    setSelectedCalendarCell(savedCell);
    setResolution(["years", "months", "weeks", "days"].includes(savedResolution)
      ? savedResolution as Resolution : "years");
    const focus = savedStart && Number.isFinite(Date.parse(savedStart)) ? new Date(savedStart) : null;
    if (focus) {
      setYear(focus.getUTCFullYear());
      setMonth(focus.getUTCMonth());
      setWeekStart(new Date(focus.getTime() - ((focus.getUTCDay() + 6) % 7) * DAY_MS));
    }
  }, [savedStart, savedEnd, savedResolution, savedCell]);
  const domainRequest = useMemo(() => temporalDomainQuery(queryXml, provider.property), [queryXml, provider.property]);
  useEffect(() => {
    const controller = new AbortController();
    setDomainLoading(true); setDomainError("");
    if (!domainRequest) { setDomain(null); setDomainError("Temporal domain query is unavailable."); setDomainLoading(false); return () => controller.abort(); }
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-Maestro-Query-Label": `TemporalFacet:domain:${provider.property}` },
          body: JSON.stringify({ facetValueCount: { ...domainRequest, sparql: domainRequest.query, temporalDomain: true } }),
        });
        const data = await response.json() as { error?: string; incomplete?: boolean; min?: string | null; max?: string | null };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (data.incomplete) throw new Error("Date domain query timed out before completing.");
        const min = temporalDayDomain(data.min, "min"), max = temporalDayDomain(data.max, "max");
        if (!min || !max || min > max)
          throw new Error("No valid date domain returned for this property.");
        if (!controller.signal.aborted) { setDomain({ min, max });
          const first = new Date(`${min}T00:00:00Z`);
          // Keep the visible page if it is in range; otherwise start at the
          // earliest available month, so navigation is never stranded.
          // Year/month form one logical calendar page. Updating them through
          // independent state setters previously mixed a *new* year with the
          // *old* month in the month updater, leaving the page out of range.
          const visibleMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
          if (visibleMonth < min.slice(0, 7) || visibleMonth > max.slice(0, 7)) {
            setYear(first.getUTCFullYear());
            setMonth(first.getUTCMonth());
          }
          setWeekStart(current => {
            const weekEnd = iso(new Date(current.getTime() + 6 * DAY_MS));
            if (iso(current) <= max && weekEnd >= min) return current;
            return new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS);
          }); }
      } catch (cause) {
        if (!controller.signal.aborted) { setDomainError(cause instanceof Error ? cause.message : "Date domain unavailable"); setDomain(null); }
      } finally { if (!controller.signal.aborted) setDomainLoading(false); }
    })();
    return () => controller.abort();
  }, [domainRequest, provider.property]);
  // Year zoom shows month counts; month zoom shows week counts; week and day
  // zoom show individual day counts. These are bucket views on one property.
  const bucketView: Resolution = "days";
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
  // The day buckets originate from the same date facet as the visible calendar.
  // A domain aggregate must not reject dates for which the facet returned data.
  // Conservative reconciliation also prevents mismatched zoom levels.
  const observedDates = Array.from(counts.entries()).filter(([key, n]) => n > 0 && /^\d{4}-\d{2}-\d{2}$/.test(key)).map(([key]) => key).sort();
  const observedMin = observedDates[0];
  const observedMax = observedDates[observedDates.length - 1];
  const effectiveDomain = domain ? {
    min: observedMin && observedMin < domain.min ? observedMin : domain.min,
    max: observedMax && observedMax > domain.max ? observedMax : domain.max,
  } : observedMin && observedMax ? { min: observedMin, max: observedMax } : null;
  // Apply only complete, ordered ranges. Individual picker edits are immediate;
  // no Apply button or blur event is necessary.
  const updateRange = (nextFrom: string, nextTo: string) => {
    // An explicit From/To edit tears down any prior calendar-cell selection.
    setSelectedCalendarCell("");
    setFrom(nextFrom); setTo(nextTo);
    const fits = (value: string) => !value || !effectiveDomain || (value.slice(0,10) >= effectiveDomain.min && value.slice(0,10) <= effectiveDomain.max);
    if (nextFrom && nextTo && nextFrom <= nextTo && fits(nextFrom) && fits(nextTo)) onRangeChange(provider.property, utcDate(nextFrom), utcDate(nextTo), { resolution, cell: "" });
  };
  const invalid = Boolean(from && to && from > to);
  const outside = (date: string) => Boolean(effectiveDomain && (date < effectiveDomain.min || date > effectiveDomain.max));
  const intersects = (start: Date, endExclusive: Date) => !effectiveDomain ||
    (iso(start) <= effectiveDomain.max && iso(new Date(endExclusive.getTime() - DAY_MS)) >= effectiveDomain.min);
  const clampStart = (start: Date) => effectiveDomain && iso(start) < effectiveDomain.min ? new Date(`${effectiveDomain.min}T00:00:00Z`) : start;
  const clampEnd = (end: Date) => effectiveDomain && iso(new Date(end.getTime()-DAY_MS)) > effectiveDomain.max ? new Date(Date.parse(`${effectiveDomain.max}T00:00:00Z`) + DAY_MS) : end;
  const choose = (start: Date, end: Date, cellKey: string) => {
    setSelectedCalendarCell(cellKey);
    if (!intersects(start, end)) return;
    const [a,b] = selectionBounds(clampStart(start),clampEnd(end));
    setFrom(localDate(a)); setTo(localDate(b));
    onRangeChange(provider.property,a,b, { resolution, cell: cellKey });
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
  const previousPage = resolution === "years" ? dateAt(year-1,0) : resolution === "weeks"
    ? new Date(weekStart.getTime()-7*DAY_MS) : dateAt(year,month-1);
  const nextPage = resolution === "years" ? dateAt(year+1,0) : resolution === "weeks"
    ? new Date(weekStart.getTime()+7*DAY_MS) : dateAt(year,month+1);
  const pageInterval = (start: Date): {start: string; end: string} => {
    if (resolution === "years") return { start: iso(dateAt(start.getUTCFullYear(), 0)), end: iso(dateAt(start.getUTCFullYear()+1, 0)) };
    if (resolution === "weeks") return { start: iso(start), end: iso(new Date(start.getTime() + 7*DAY_MS)) };
    return { start: iso(dateAt(start.getUTCFullYear(), start.getUTCMonth())), end: iso(dateAt(start.getUTCFullYear(), start.getUTCMonth()+1)) };
  };
  const previousDisabled = !temporalPageOverlapsDomain(pageInterval(previousPage), effectiveDomain);
  const nextDisabled = !temporalPageOverlapsDomain(pageInterval(nextPage), effectiveDomain);
  const weeks = Array.from({length:6}, (_,i)=> {
    const first = dateAt(year,month,1);
    return new Date(first.getTime() - ((first.getUTCDay()+6)%7)*DAY_MS + i*7*DAY_MS);
  }).filter(start => start < dateAt(year,month+1,1) && start.getTime()+7*DAY_MS > dateAt(year,month,1).getTime());
  const days = resolution === "weeks"
    ? Array.from({length:7},(_,i)=>new Date(weekStart.getTime()+i*DAY_MS))
    : Array.from({length:new Date(Date.UTC(year,month+1,0)).getUTCDate()},(_,i)=>dateAt(year,month,i+1));
  return <div data-provider-phase={widgetPhase} className="flex min-w-0 flex-col gap-2" aria-label={`${provider.label} calendar and range`}>
    <div className="flex flex-col gap-2">
      <DateTimePicker label={`From (min: ${effectiveDomain?.min ?? (domainLoading ? "loading…" : "unknown")})`} value={from} minDate={effectiveDomain?.min} maxDate={effectiveDomain?.max} onChange={next => updateRange(next, to)} />
      <DateTimePicker label={`To (max: ${effectiveDomain?.max ?? (domainLoading ? "loading…" : "unknown")})`} value={to} minDate={effectiveDomain?.min} maxDate={effectiveDomain?.max} onChange={next => updateRange(from, next)} />
      {domainError && !effectiveDomain && <ErrorDetails prefix="Date domain (calendar remains available)" error={domainError} />}
      {(from && outside(from.slice(0,10)) || to && outside(to.slice(0,10))) && <span className="text-xs text-destructive">Date selection is outside the available range.</span>}
      {invalid && <span className="text-xs text-destructive">From must not be after To.</span>}
      <div className="flex gap-2">
        {range && <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={()=>{setSelectedCalendarCell("");setFrom("");setTo("");onRangeChange(provider.property,"","");}}>Clear</button>}
      </div>
      <div className="mt-2 flex flex-col gap-2 border-t pt-2" aria-label="Temporal calendar">
        <ButtonGroup aria-label="Calendar resolution" className="w-full">
          <ToggleGroup type="single" value={resolution} onValueChange={value=>{ if(value) {
            setResolution(value as Resolution);
            if (savedStart && savedEnd) onRangeChange(provider.property, savedStart, savedEnd,
              { resolution: value as Resolution, cell: selectedCalendarCell });
          } }} className="w-full">
            {([ ["years","Year"],["months","Month"],["weeks","Week"],["days","Day"] ] as const).map(([value,label])=><ToggleGroupItem key={value} value={value} className="flex-1">{label}</ToggleGroupItem>)}
          </ToggleGroup>
        </ButtonGroup>
        <div className="flex items-center justify-between gap-2 text-xs">
          <button aria-label={`Previous ${resolution === "years" ? "year" : resolution === "weeks" ? "week" : "month"}`} type="button" disabled={previousDisabled} onClick={()=>shiftCalendar(-1)} className="rounded p-1 hover:bg-accent disabled:opacity-30"><ChevronLeft className="size-4"/></button>
          <span className="font-medium">{resolution === "years" ? year : resolution === "weeks" ? `Week of ${iso(weekStart)}` : `${monthLabel} ${year}`}</span>
          <button aria-label={`Next ${resolution === "years" ? "year" : resolution === "weeks" ? "week" : "month"}`} type="button" disabled={nextDisabled} onClick={()=>shiftCalendar(1)} className="rounded p-1 hover:bg-accent disabled:opacity-30"><ChevronRight className="size-4"/></button>
        </div>
        <div className={`grid gap-1 ${resolution === "days" || resolution === "weeks" ? "grid-cols-7" : "grid-cols-3"}`}>
          {resolution === "years" && Array.from({length:12},(_,i)=>i).map(m=>{
            const monthKey = `${year}-${String(m+1).padStart(2,"0")}`;
            const count = Array.from(counts, ([key, value]) => key.startsWith(`${monthKey}-`) ? value : 0).reduce((a,b) => a+b,0);
            return <button key={m} type="button" disabled={!intersects(dateAt(year,m),dateAt(year,m+1))} onClick={()=>{choose(dateAt(year,m),dateAt(year,m+1), `month:${year}-${m}`);setMonth(m);}} className={`flex flex-col items-center rounded border px-1 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-25 ${selectedCalendarCell === `month:${year}-${m}` ? selectedCalendarStyle(`month:${year}-${m}`) : mutedIfZero(count)}`}><span>{new Intl.DateTimeFormat(undefined,{month:"short",timeZone:"UTC"}).format(dateAt(year,m))}</span><span className="text-muted-foreground">{count}</span></button>;
          })}
          {resolution === "months" && weeks.map(start=>{
            const count = weekCount(start);
            return <button key={iso(start)} type="button" disabled={!intersects(start,new Date(start.getTime()+7*DAY_MS))} onClick={()=>{choose(start,new Date(start.getTime()+7*DAY_MS), `week:${iso(start)}`);setWeekStart(start);}} className={`flex flex-col items-center rounded border px-1 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-25 ${selectedCalendarCell === `week:${iso(start)}` ? selectedCalendarStyle(`week:${iso(start)}`) : mutedIfZero(count)}`}><span>{iso(start).slice(5)}</span><span className="text-muted-foreground">{count}</span></button>;
          })}
          {(resolution === "days" || resolution === "weeks") && days.map(day=>{
            const count = countFor(day);
            return <button key={iso(day)} type="button" disabled={outside(iso(day))} onClick={()=>choose(day,new Date(day.getTime()+DAY_MS), `day:${iso(day)}`)} className={`flex flex-col items-center rounded border px-1 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-25 ${selectedCalendarCell === `day:${iso(day)}` ? selectedCalendarStyle(`day:${iso(day)}`) : mutedIfZero(count)}`}><span>{resolution === "weeks" ? weekdayName(day) : day.getUTCDate()}</span><span className="text-muted-foreground">{count}</span></button>;
          })}
        </div>
        {fetching && <span className="text-xs text-muted-foreground">Fetching calendar counts…</span>}
        {error && <ErrorDetails prefix="Calendar" error={error} />}
      </div>
    </div>
  </div>;
}
export type TagCloudFacetProvider = TagProviderMatch;
export type NumericFacetProvider = NumericProviderMatch;
/** SHACL + approval are browser-orchestrated against the personal RDF graph. XState owns scope, invalidation,
 * lifecycle, and verified UI projection. A fresh login or approval revision
 * requires a new validation; there is no legacy provider cache. */
export function usePersonalFacetProviders(
  properties: string[], queryXml = "", datatypeEvidence: Record<string, string[]> = {},
  options: { enabled?: boolean; approvalRevision?: number; sessionKey?: string } = {},
): { temporal: Map<string, TemporalFacetProvider>; numeric: NumericFacetProvider[]; tags: Map<string, TagCloudFacetProvider>; phase: string; error: string } {
  const key = [...new Set(properties)].sort().join("\n");
  const evidenceKey = JSON.stringify(datatypeEvidence);
  const enabled = options.enabled !== false && Boolean(options.sessionKey ?? "local");
  const applicabilityKey = enabled && key
    ? JSON.stringify([options.sessionKey ?? "", options.approvalRevision ?? 0, key, facetProviderApplicabilityKey(queryXml, key.split("\n"))]) : "";
  const scope = enabled && key
    ? JSON.stringify([applicabilityKey, queryXml, evidenceKey]) : "";
  const [registry] = useState(createMaestroProviderDiscoveryController);
  const snapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  useLayoutEffect(() => { registry.start(); return () => registry.stop(); }, [registry]);
  useEffect(() => {
    if (!scope) { registry.send({ type: "DISCOVERY_INACTIVE" }); return; }
    const controller = new AbortController();
    registry.send({ type: "DISCOVERY_STARTED", requestKey: scope, applicabilityKey, evidenceKey });
    void discoverClientFacetProviders({properties:key.split("\n"),queryXml,datatypeEvidence:JSON.parse(evidenceKey)},controller.signal,
      (tags) => {
        if (!controller.signal.aborted) registry.send({ type: "DISCOVERY_TAGS_RESOLVED", requestKey: scope, tags });
      })
      .then(matches => {
        if(!controller.signal.aborted)registry.send({type:"DISCOVERY_RESOLVED",requestKey:scope,matches,evidenceKey});
      }).catch(cause=>{
        if(!controller.signal.aborted)registry.send({type:"DISCOVERY_FAILED",requestKey:scope,
          error:cause instanceof Error?cause.message:"Provider discovery failed"});
      });
    return () => controller.abort();
  }, [registry, scope, applicabilityKey, key, queryXml, evidenceKey]);
  const selected = selectProviderMatches(snapshot, scope, applicabilityKey, evidenceKey);
  // Preserve the precedence of explicit path-bound Calendar policies over
  // generic inferred-datatype matches for the same property. Provider discovery
  // returns the explicit matches first; Map retains the first approved one.
  const temporal = useMemo(() => {
    const byProperty = new Map<string, TemporalFacetProvider>();
    for (const item of selected.temporal) if (!byProperty.has(item.property)) byProperty.set(item.property, item);
    return byProperty;
  }, [selected.temporal]);
  const tags = useMemo(() => new Map(selected.tags.map(item => [item.property, item])), [selected.tags]);
  return { temporal, numeric: selected.numeric, tags, phase: selected.phase, error: selected.error };
}
