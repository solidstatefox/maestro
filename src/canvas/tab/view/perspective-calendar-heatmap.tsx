"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Activity } from "@/components/heatmap/calendar-heatmap";
import { CalendarHeatmap, CalendarHeatmapBlock, CalendarHeatmapBody,
  CalendarHeatmapFooter, CalendarHeatmapLegend, CalendarHeatmapStat } from "@/components/heatmap/calendar-heatmap";
import type { WeekdayHourlyActivity } from "@/components/heatmap/weekday-heatmap";
import { WeekdayHeatmap, WeekdayHeatmapBlock, WeekdayHeatmapBody,
  WeekdayHeatmapFooter, WeekdayHeatmapLegend, WeekdayHeatmapStat } from "@/components/heatmap/weekday-heatmap";
import type { DateHourlyActivity } from "@/components/heatmap/date-heatmap";
import { DateHeatmap, DateHeatmapBlock, DateHeatmapBody,
  DateHeatmapFooter, DateHeatmapLegend, DateHeatmapStat } from "@/components/heatmap/date-heatmap";

/** Both saved-entry perspectives use their COMPLETE collected activity, not the
 * currently visible page. Missing cells are truly zero; no sample data. */
export type PerspectiveActivity = { created: string };
export type CalendarLevel = "year" | "month" | "week" | "day";
type Layout = "calendar" | "weekday" | "date";
const dateAndHour = (text: string): { date: string; hour: number; weekday: number } | null => {
  const value = /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text)
    ? new Date(text.length === 10 ? `${text}T12:00:00Z` : text) : null;
  if (!value || !Number.isFinite(value.getTime())) return null;
  return { date: value.toISOString().slice(0, 10), hour: value.getUTCHours(), weekday: value.getUTCDay() };
};
const dayShift = (date: string, delta: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
};
const validDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) &&
  !Number.isNaN(Date.parse(`${text}T12:00:00Z`));
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const sumByHour = (rows: readonly { hour: number; value: number }[]) => {
  const result = Array<number>(24).fill(0);
  rows.forEach(row => { if (row.hour >= 0 && row.hour < 24) result[row.hour] += row.value; });
  return result;
};
const sumByWeekday = (rows: readonly WeekdayHourlyActivity[]) => {
  const result = Array<number>(7).fill(0);
  rows.forEach(row => { if (row.weekday >= 0 && row.weekday < 7) result[row.weekday] += row.value; });
  return result;
};
const sumByDate = (rows: readonly DateHourlyActivity[], dates: string[]) => {
  const byDate = new Map<string, number>();
  rows.forEach(row => byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.value));
  return dates.map(date => byDate.get(date) ?? 0);
};

/** Only explicit date constraints change the initial period. */
export function dateFromFctRange(queryXml: string): string | null {
  if (!queryXml || typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(queryXml, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  for (const node of Array.from(doc.getElementsByTagName("*"))) {
    if (node.localName !== "value") continue;
    if (!/(created|date|timestamp|time)/i.test(node.parentElement?.getAttribute("iri") ?? "")) continue;
    for (const candidate of [node.getAttribute("rangeStart"), node.textContent?.trim(), node.getAttribute("rangeEnd")]) {
      const parsed = candidate ? dateAndHour(candidate) : null;
      if (parsed) return parsed.date;
    }
  }
  return null;
}

export function PerspectiveCalendarHeatmap({ rows, queryXml, onDayFilter }: {
  rows: readonly PerspectiveActivity[]; queryXml: string; onDayFilter: (date: string | null) => void;
}) {
  const activity = useMemo(() => rows.map(row => dateAndHour(row.created)).filter((v): v is NonNullable<typeof v> => v !== null), [rows]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    activity.forEach(row => result.set(row.date, (result.get(row.date) ?? 0) + 1));
    return result;
  }, [activity]);
  const latest = useMemo(() => [...counts.keys()].sort().at(-1) ?? new Date().toISOString().slice(0, 10), [counts]);
  const queryDate = useMemo(() => dateFromFctRange(queryXml), [queryXml]);
  const [period, setPeriod] = useState(queryDate ?? latest);
  const [layout, setLayout] = useState<Layout>("calendar");
  const [activeDay, setActiveDay] = useState<string | null>(null);
  // A remote collection refresh must not erase an intentional calendar choice.
  useEffect(() => { setPeriod(queryDate ?? latest); setActiveDay(null); onDayFilter(null); }, [queryXml, onDayFilter]);
  const year = period.slice(0, 4);
  const calendar = useMemo<Activity[]>(() => {
    const start = `${year}-01-01`;
    const length = (Date.parse(`${Number(year) + 1}-01-01T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
    return Array.from({ length }, (_, offset) => {
      const date = dayShift(start, offset);
      return { date, value: counts.get(date) ?? 0 };
    });
  }, [year, counts]);
  const weekday = useMemo<WeekdayHourlyActivity[]>(() => {
    const result = new Map<string, number>();
    for (const row of activity) {
      if (!row.date.startsWith(year)) continue;
      const key = `${row.weekday}:${row.hour}`;
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return Array.from({ length: 7 * 24 }, (_, i) => {
      const weekday = Math.floor(i / 24), hour = i % 24;
      return { weekday, hour, value: result.get(`${weekday}:${hour}`) ?? 0 };
    });
  }, [activity, year]);
  const dateStart = dayShift(period, -27);
  const dates = useMemo(() => Array.from({ length: 28 }, (_, i) => dayShift(dateStart, i)), [dateStart]);
  const hourly = useMemo<DateHourlyActivity[]>(() => {
    const result = new Map<string, number>();
    for (const row of activity) {
      if (row.date < dateStart || row.date > period) continue;
      const key = `${row.date}:${row.hour}`;
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return dates.flatMap(date => Array.from({ length: 24 }, (_, hour) =>
      ({ date, hour, value: result.get(`${date}:${hour}`) ?? 0 })));
  }, [activity, dates, dateStart, period]);
  const shownCount = layout === "calendar" ? calendar.reduce((sum, row) => sum + row.value, 0)
    : layout === "weekday" ? weekday.reduce((sum, row) => sum + row.value, 0)
    : hourly.reduce((sum, row) => sum + row.value, 0);
  const move = (delta: number) => {
    if (layout === "date") setPeriod(dayShift(period, delta * 28));
    else setPeriod(`${Number(year) + delta}-01-01`);
    setActiveDay(null); onDayFilter(null);
  };
  const filterDay = (date: string) => {
    if (!validDate(date)) return;
    const next = activeDay === date ? null : date;
    setActiveDay(next); onDayFilter(next);
  };
  const tooltip = (title: string, value: number) => <><p className="font-medium">{title}</p><p className="text-muted-foreground">{value.toLocaleString()} saved entr{value === 1 ? "y" : "ies"}</p></>;
  return <section className="mb-2 rounded-lg border bg-card px-3 py-2" aria-label="Saved query activity heatmaps">
    <header className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true"/>
      <ButtonGroup aria-label="Activity heatmap format">
        {(["calendar", "weekday", "date"] as const).map(name => <Button key={name} size="xs"
          variant={layout === name ? "secondary" : "outline"} aria-pressed={layout === name}
          onClick={() => setLayout(name)}>{name === "calendar" ? "Calendar" : name === "weekday" ? "Weekday" : "Date"}</Button>)}
      </ButtonGroup>
      <strong>{layout === "date" ? `${format(parseISO(dateStart), "MMM d")} – ${format(parseISO(period), "MMM d, yyyy")}` : year}</strong>
      <div className="ml-auto flex items-center gap-1">
        {activeDay && <Button size="xs" variant="ghost" onClick={() => filterDay(activeDay)}>Clear selected day</Button>}
        <Button variant="outline" size="icon-xs" aria-label="Previous heatmap period" onClick={() => move(-1)}><ChevronLeft className="size-3.5"/></Button>
        <Button variant="outline" size="icon-xs" aria-label="Next heatmap period" onClick={() => move(1)}><ChevronRight className="size-3.5"/></Button>
      </div>
    </header>
    <div className="max-w-full overflow-x-auto">
      {layout === "calendar" ? <CalendarHeatmap data={calendar} blockSize={9} blockMargin={2} blockRadius={1}
        colors={{ scale: "oklch(0.55 0.15 145)" }}>
        <CalendarHeatmapBody yearClassName="text-base font-semibold">{({ activity: cell, dayIndex, weekIndex }) => <Tooltip>
          <TooltipTrigger tabIndex={0} render={<CalendarHeatmapBlock activity={cell} dayIndex={dayIndex} weekIndex={weekIndex}
            onCellClick={() => filterDay(cell.date)} />}/>
          <TooltipContent side="top" sideOffset={6} className="pointer-events-none text-xs">
            {tooltip(format(parseISO(cell.date), "PPP"), cell.value)}
          </TooltipContent>
        </Tooltip>}</CalendarHeatmapBody>
        <CalendarHeatmapFooter><CalendarHeatmapStat/><CalendarHeatmapLegend/></CalendarHeatmapFooter>
      </CalendarHeatmap> : layout === "weekday" ? <WeekdayHeatmap data={weekday}
        labels={{ cellLabel: "{{weekday}} {{hour}}: {{value}} saved entries" }} isNormalized
        colors={{ scale: "oklch(0.65 0.18 45)" }}
        extraRow={{ label: "Total", compute: sumByHour }}
        extraColumn={{ label: "Total", compute: sumByWeekday }}>
        <WeekdayHeatmapBody
          renderExtraRow={({ activity: cell }) => <Tooltip><TooltipTrigger tabIndex={0} render={<WeekdayHeatmapBlock activity={cell} extra="row"/>}/>
            <TooltipContent>{tooltip(`Total ${String(cell.hour).padStart(2, "0")}:00`, cell.value)}</TooltipContent></Tooltip>}
          renderExtraColumn={({ activity: cell }) => <Tooltip><TooltipTrigger tabIndex={0} render={<WeekdayHeatmapBlock activity={cell} extra="column"/>}/>
            <TooltipContent>{tooltip(`${WEEKDAY_NAMES[cell.weekday]} total`, cell.value)}</TooltipContent></Tooltip>}
          >{({ activity: cell }) => <Tooltip><TooltipTrigger tabIndex={0} render={<WeekdayHeatmapBlock activity={cell}/>}/>
            <TooltipContent>{tooltip(`${WEEKDAY_NAMES[cell.weekday]} ${String(cell.hour).padStart(2, "0")}:00 UTC`, cell.value)}</TooltipContent></Tooltip>}
        </WeekdayHeatmapBody>
        <WeekdayHeatmapFooter><WeekdayHeatmapStat>{() => <div className="text-muted-foreground tabular-nums">Total saved entries: {shownCount.toLocaleString()}</div>}</WeekdayHeatmapStat>
          <WeekdayHeatmapLegend labels={{ less: "Fewer", more: "More" }}/></WeekdayHeatmapFooter>
      </WeekdayHeatmap> : <DateHeatmap data={hourly}
        labels={{ cellLabel: "{{date}} {{hour}}: {{value}} saved entries" }} colors={{ scale: "oklch(0.56 0.19 255)" }}
        extraRow={{ label: "Total", compute: sumByHour }}
        extraColumn={{ label: "Total", compute: sumByDate }}>
        <DateHeatmapBody
          renderExtraRow={({ activity: cell, dateIndex }) => <Tooltip><TooltipTrigger tabIndex={0} render={<DateHeatmapBlock activity={cell} dateIndex={dateIndex} extra="row"/>}/>
            <TooltipContent>{tooltip(`Total ${String(cell.hour).padStart(2, "0")}:00 UTC`, cell.value)}</TooltipContent></Tooltip>}
          renderExtraColumn={({ activity: cell, dateIndex }) => <Tooltip><TooltipTrigger tabIndex={0} render={<DateHeatmapBlock activity={cell} dateIndex={dateIndex} extra="column"/>}/>
            <TooltipContent>{tooltip(`${format(parseISO(cell.date), "PPP")} total`, cell.value)}</TooltipContent></Tooltip>}
          >{({ activity: cell, dateIndex }) => <Tooltip><TooltipTrigger tabIndex={0} render={<DateHeatmapBlock activity={cell} dateIndex={dateIndex} />}/>
            <TooltipContent>{tooltip(`${format(parseISO(cell.date), "PPP")} ${String(cell.hour).padStart(2, "0")}:00 UTC`, cell.value)}</TooltipContent></Tooltip>}
        </DateHeatmapBody>
        <DateHeatmapFooter><DateHeatmapStat>{() => <div className="text-muted-foreground tabular-nums">Total saved entries: {shownCount.toLocaleString()}</div>}</DateHeatmapStat>
          <DateHeatmapLegend labels={{ less: "Fewer", more: "More" }}/></DateHeatmapFooter>
      </DateHeatmap>}
    </div>
    <p className="mt-1 text-[11px] text-muted-foreground">Counts from the complete saved-entry collection. Hours are UTC.</p>
  </section>;
}
