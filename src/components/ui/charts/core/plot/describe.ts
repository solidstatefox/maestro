import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { formatNumber, headersFor, humanize, listOf, numberField } from "../a11y/describe";
import type { ChartDescription } from "../a11y/describe";
import { describeRowsChart } from "../a11y/rows";
import type { RowSeries } from "../a11y/rows";
import type { BumpProps } from "../types/bump";
import type { DumbbellProps } from "../types/dumbbell";
import type { GanttTask, GanttXAxisProps } from "../types/gantt";
import type { LollipopProps } from "../types/lollipop";
import type { SlopeProps } from "../types/slope";
import type { ErrorBarProps, RibbonLineProps, RibbonProps } from "../types/uncertainty";
import type { WaterfallProps } from "../types/waterfall";

type Rows = readonly Readonly<Record<string, unknown>>[];

/** A lollipop's stems: one column per Lollipop series. */
export const describeLollipop = (data: Rows, xKey: string, table: ChildTable): ChartDescription =>
  describeRowsChart({
    kind: "Lollipop chart",
    unit: "categories",
    data,
    xKey,
    series: propsFor<LollipopProps>(table, "lollipop").map((s) => ({ key: s.dataKey, label: s.label, format: s.formatValue })),
  });

/** A bump chart's ranks: a row per period, a column per entity (its rank). */
export const describeBump = (data: Rows, xKey: string, table: ChildTable): ChartDescription => {
  const series = propsFor<BumpProps>(table, "bump").map((s) => ({ key: s.dataKey, label: s.label, format: s.formatValue }));
  const out = describeRowsChart({ kind: "Bump chart", unit: "periods", data, xKey, series });
  if (data.length === 0 || series.length === 0) {
    return out;
  }
  // The summary says who leads at the start and at the end (rank 1 is the lowest value).
  const leader = (row: Readonly<Record<string, unknown>>): string => {
    let best: RowSeries | undefined;
    let rank = Number.POSITIVE_INFINITY;
    for (const s of series) {
      const v = numberField(row, s.key);
      if (v !== null && v < rank) {
        rank = v;
        best = s;
      }
    }
    return best === undefined ? "" : (best.label ?? humanize(best.key));
  };
  const first = out.rows[0]?.header ?? "";
  const last = out.rows.at(-1)?.header ?? "";
  return { ...out, summary: `Bump chart, ${series.length} ranked series over ${formatNumber(data.length)} periods from ${first} to ${last}; ${leader(data[0])} leads first, ${leader(data[data.length - 1])} leads last.` };
};

/** A dumbbell's two values per row, and the change between them. */
export const describeDumbbell = (data: Rows, xKey: string, table: ChildTable): ChartDescription => {
  const d = propsFor<DumbbellProps>(table, "dumbbell")[0];
  if (d === undefined) {
    return describeRowsChart({ kind: "Dumbbell chart", unit: "rows", data, xKey, series: [] });
  }
  const fmt = d.formatValue ?? formatNumber;
  const out = describeRowsChart({
    kind: "Dumbbell chart",
    unit: "rows",
    data,
    xKey,
    series: [
      { key: d.from, label: d.fromLabel, format: d.formatValue },
      { key: d.to, label: d.toLabel, format: d.formatValue },
      { key: "\0change", label: "Change", cell: (row) => change(numberField(row, d.from), numberField(row, d.to), fmt) },
    ],
  });
  const rises = data.filter((row) => (numberField(row, d.to) ?? 0) > (numberField(row, d.from) ?? 0)).length;
  return { ...out, summary: `Dumbbell chart, ${formatNumber(data.length)} rows from ${d.fromLabel ?? humanize(d.from)} to ${d.toLabel ?? humanize(d.to)}: ${rises === 0 ? "all fall or hold" : `${formatNumber(rises)} rise, ${formatNumber(data.length - rises)} fall or hold`}.` };
};

const change = (from: number | null, to: number | null, fmt: (value: number) => string): string => {
  if (from === null || to === null) {
    return "";
  }
  const delta = to - from;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${fmt(Math.abs(delta))}`;
};

/** A slope chart's two columns per label, and the change. */
export const describeSlope = (data: Rows, labelKey: string, table: ChildTable): ChartDescription => {
  const s = propsFor<SlopeProps>(table, "slope")[0];
  if (s === undefined) {
    return describeRowsChart({ kind: "Slope chart", unit: "rows", data, xKey: labelKey, series: [] });
  }
  const fmt = s.formatValue ?? formatNumber;
  const out = describeRowsChart({
    kind: "Slope chart",
    unit: "rows",
    data,
    xKey: labelKey,
    series: [
      { key: s.from, label: s.fromLabel, format: s.formatValue },
      { key: s.to, label: s.toLabel, format: s.formatValue },
      { key: "\0change", label: "Change", cell: (row) => change(numberField(row, s.from), numberField(row, s.to), fmt) },
    ],
  });
  const rising = data.filter((row) => (numberField(row, s.to) ?? 0) > (numberField(row, s.from) ?? 0)).map((row) => String(row[labelKey]));
  return { ...out, summary: `Slope chart, ${formatNumber(data.length)} rows from ${s.fromLabel ?? humanize(s.from)} to ${s.toLabel ?? humanize(s.to)}; ${rising.length === 0 ? "none rise" : `${listOf(rising)} rise`}.` };
};

/** A waterfall's signed steps and the running total after each. */
export const describeWaterfall = (data: Rows, xKey: string, table: ChildTable): ChartDescription => {
  const w = propsFor<WaterfallProps>(table, "waterfall")[0];
  if (w === undefined) {
    return describeRowsChart({ kind: "Waterfall chart", unit: "steps", data, xKey, series: [] });
  }
  const fmt = w.formatValue ?? formatNumber;
  const totalKey = w.totalKey ?? "total";
  const running: number[] = [];
  let total = 0;
  for (const row of data) {
    const v = numberField(row, w.dataKey);
    // A total row (`totalKey` true) with a value of its own sets the running total; without one it shows it.
    total = row[totalKey] === true ? (v ?? total) : total + (v ?? 0);
    running.push(total);
  }
  const out = describeRowsChart({
    kind: "Waterfall chart",
    unit: "steps",
    data,
    xKey,
    series: [
      { key: w.dataKey, label: w.label ?? "Change", cell: (row) => (row[totalKey] === true ? "" : change(0, numberField(row, w.dataKey), fmt)) },
      { key: "\0total", label: "Running total", cell: (row) => fmt(running[data.indexOf(row)] ?? 0) },
    ],
  });
  const first = out.rows[0]?.header ?? "";
  return { ...out, summary: `Waterfall chart, ${formatNumber(data.length)} steps from ${first}, ending at ${fmt(running.at(-1) ?? 0)}.` };
};

/** Error bars: each series' estimate and its interval. */
export const describeErrorBars = (data: Rows, xKey: string, table: ChildTable): ChartDescription => {
  const bars = propsFor<ErrorBarProps>(table, "errorBar");
  const series = bars.flatMap((b) => {
    const fmt = b.formatValue ?? formatNumber;
    return [
      { key: b.dataKey, label: b.label, format: b.formatValue },
      { key: `\0${b.lowKey}`, label: b.intervalLabel ?? `${b.label ?? humanize(b.dataKey)} interval`, cell: (row: Readonly<Record<string, unknown>>) => interval(numberField(row, b.lowKey), numberField(row, b.highKey), fmt) },
    ];
  });
  return describeRowsChart({ kind: "Error bar chart", unit: "estimates", data, xKey, series });
};

const interval = (low: number | null, high: number | null, fmt: (value: number) => string): string => (low === null || high === null ? "" : `${fmt(low)} to ${fmt(high)}`);

/** A ribbon chart: its bands' ranges and its lines' values over x. */
export const describeRibbons = (data: Rows, xKey: string, table: ChildTable): ChartDescription => {
  const lines = propsFor<RibbonLineProps>(table, "ribbonLine");
  const fmt = lines.find((l) => l.formatValue !== undefined)?.formatValue ?? formatNumber;
  const series: RowSeries[] = [
    ...lines.map((l) => ({ key: l.dataKey, label: l.label, format: l.formatValue })),
    ...propsFor<RibbonProps>(table, "ribbon").map((r) => ({ key: `\0${r.lowKey}`, label: r.label ?? "Range", cell: (row: Readonly<Record<string, unknown>>) => interval(numberField(row, r.lowKey), numberField(row, r.highKey), fmt) })),
  ];
  return describeRowsChart({ kind: "Ribbon chart", unit: "points", data, xKey, series });
};

/** A Gantt chart: a row per task, its start, end (or milestone), group, progress and dependencies. */
export const describeGantt = (data: readonly GanttTask[], table: ChildTable): ChartDescription => {
  const axis = propsFor<GanttXAxisProps>(table, "ganttXAxis")[0];
  const dates = data.flatMap((t) => [t.start, t.end ?? t.start]).map((d) => (d instanceof Date ? d : new Date(d)));
  const header = headersFor(dates, axis?.formatValue, true);
  const name = new Map(data.map((t) => [t.id, t.name]));
  const hasGroups = data.some((t) => t.group !== undefined);
  const hasProgress = data.some((t) => t.progress !== undefined);
  const hasDeps = data.some((t) => (t.dependsOn ?? []).length > 0);
  const columns = [
    { label: "Task" },
    { label: "Start" },
    { label: "End" },
    ...(hasGroups ? [{ label: "Group" }] : []),
    ...(hasProgress ? [{ label: "Progress", numeric: true }] : []),
    ...(hasDeps ? [{ label: "Depends on" }] : []),
  ];
  const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
  const rows = data.map((t) => ({
    header: t.milestone ? `${t.name} (milestone)` : t.name,
    cells: [
      header(t.start),
      t.milestone || t.end === undefined ? "" : header(t.end),
      ...(hasGroups ? [t.group ?? ""] : []),
      ...(hasProgress ? [t.progress === undefined ? "" : percent.format(t.progress > 1 ? t.progress / 100 : t.progress)] : []),
      ...(hasDeps ? [(t.dependsOn ?? []).map((id) => name.get(id) ?? id).join(", ")] : []),
    ],
    datum: t,
  }));
  const times = dates.map((d) => d.getTime()).filter(Number.isFinite);
  const span = times.length === 0 ? "" : ` from ${header(new Date(Math.min(...times)))} to ${header(new Date(Math.max(...times)))}`;
  const milestones = data.filter((t) => t.milestone === true).length;
  return { kind: "Gantt chart", columns, rows, summary: `Gantt chart, ${formatNumber(data.length - milestones)} tasks${milestones > 0 ? ` and ${formatNumber(milestones)} ${milestones === 1 ? "milestone" : "milestones"}` : ""}${span}.` };
};
