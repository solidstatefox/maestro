import { isFiniteNumber, isRecord } from "../guards";

/** A column of the data table. The first column holds each row's header (the category, date, node or group). */
export interface DescribedColumn {
  readonly label: string;
  /** Numbers: right-aligned, tabular. */
  readonly numeric?: boolean;
}

/** A row of the data table. */
export interface DescribedRow {
  /** The row's header cell: what the row is (a date, a category, a path in a hierarchy, a flow). */
  readonly header: string;
  /** One formatted cell per column after the first. */
  readonly cells: readonly string[];
  /** The datum the row was read from: a focused point is matched to its row by it (`announcement`). */
  readonly datum?: unknown;
}

/** A chart's data as a screen reader gets it. */
export interface ChartDescription {
  /** The kind of chart, as a sentence starts it: "Line chart", "Treemap", "Sankey diagram". */
  readonly kind: string;
  /** The table's columns, the row header's first. */
  readonly columns: readonly DescribedColumn[];
  readonly rows: readonly DescribedRow[];
  /** The summary sentence. */
  readonly summary: string;
  /** The row a focused mark's datum stands for (-1: none), where the chart's datum isn't the row's own (a pie's arc, a ring's track). */
  readonly rowOf?: (datum: unknown) => number;
}

/** What a family hands the surface: its description, read when the summary, the table or an announcement needs it. */
export type ChartDescriber = () => ChartDescription | null;

/** A cell's value formatter: the chart's own where it has one. */
export type ValueFormat = (value: number) => string;

const numberFormat = /* @__PURE__ */ new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** The default number format (en-US, at most two decimals), as the kit's tooltips write a value. */
export const formatNumber: ValueFormat = (value) => (isFiniteNumber(value) ? numberFormat.format(value) : "");

const monthDay = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthDayYear = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthYear = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const timeOfDay = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const timeWithSeconds = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const DAY_MS = 86_400_000;

/** A date formatter fitted to a run of dates: times within a day, month and day within a year, the year across years, months on monthly data. */
export const dateFormatFor = (dates: readonly Date[]): ((date: Date) => string) => {
  const times = dates.map((d) => d.getTime()).filter(Number.isFinite);
  if (times.length === 0) {
    return (d) => monthDayYear.format(d);
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (max - min < DAY_MS) {
    return (d) => (max - min < 120_000 ? timeWithSeconds : timeOfDay).format(d);
  }
  const sameYear = new Date(min).getFullYear() === new Date(max).getFullYear();
  const monthly = times.length > 1 && times.every((t) => new Date(t).getDate() === 1) && (max - min) / (times.length - 1) > 27 * DAY_MS;
  if (monthly) {
    return (d) => monthYear.format(d);
  }
  return (d) => (sameYear ? monthDay : monthDayYear).format(d);
};

/** A cell for any raw value: numbers in the default format, dates as dates, the rest as text. */
export const formatCell = (value: unknown): string => {
  if (value instanceof Date) {
    return monthDayYear.format(value);
  }
  if (isFiniteNumber(value)) {
    return formatNumber(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

/** A dataKey as a column label when the chart names it nowhere: `pageViews` and `page_views` read "Page views". */
export const humanize = (key: string): string => {
  const words = key
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim();
  return words.length === 0 ? key : words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

/** A row's field. */
export const field = (row: unknown, key: string): unknown => (isRecord(row) ? row[key] : undefined);

/** A number read from a row's field, else null. */
export const numberField = (row: unknown, key: string): number | null => {
  const value = field(row, key);
  if (isFiniteNumber(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const plural = (count: number, one: string, many = `${one}s`): string => `${formatNumber(count)} ${count === 1 ? one : many}`;

/** "A, B and C" (at most `max` names, then "and N more"). */
export const listOf = (items: readonly string[], max = 3): string => {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) {
    return `${shown.join(", ")} and ${plural(rest, "more", "more")}`;
  }
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
};

const extent = (values: readonly number[]): [number, number] | null => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  return min <= max ? [min, max] : null;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Builders, one per shape of data
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** A value series over the rows (a line, a bar series, a stack layer): its label, its value per row and how a value reads. */
export interface SeriesSpec<Row> {
  readonly label: string;
  readonly value: (row: Row, index: number) => number | null;
  readonly format?: ValueFormat;
  /** A cell other than the plain value (a range "10–20", an OHLC quote): the summary still reads `value`. */
  readonly cell?: (row: Row, index: number) => string;
}

export interface SeriesDescriptionInput<Row> {
  readonly kind: string;
  /** What a row is, plural: "points", "bars", "months". */
  readonly unit: string;
  readonly rows: readonly Row[];
  /** The first column's header: "Date", "Month", "Category". */
  readonly headerLabel: string;
  readonly header: (row: Row, index: number) => string;
  readonly series: readonly SeriesSpec<Row>[];
  /** The summary reads each series first to last (a trend over an ordered axis, the default) or lowest to highest. */
  readonly order?: "sequence" | "categories";
}

/** One row per datum, one column per series: line, area, bar, composed, candlestick, live line, stream, the plot families. */
export const describeSeries = <Row>(input: SeriesDescriptionInput<Row>): ChartDescription => {
  const { kind, unit, rows, series } = input;
  const columns: DescribedColumn[] = [{ label: input.headerLabel }, ...series.map((s) => ({ label: s.label, numeric: s.cell === undefined }))];
  const described = rows.map((row, index) => ({
    header: input.header(row, index),
    cells: series.map((s) => {
      if (s.cell !== undefined) {
        return s.cell(row, index);
      }
      const v = s.value(row, index);
      return v === null ? "" : (s.format ?? formatNumber)(v);
    }),
    datum: row,
  }));
  const parts: string[] = [`${kind}, ${plural(rows.length, unit.replace(/s$/, ""), unit)}`];
  if (described.length > 1) {
    parts[0] += ` from ${described[0].header} to ${described.at(-1)?.header ?? ""}`;
  }
  const clauses = series.slice(0, 3).map((s) => {
    const values = rows.map((r, i) => s.value(r, i));
    const fmt = s.format ?? formatNumber;
    if (input.order === "categories") {
      const range = extent(values.filter(isFiniteNumber));
      if (range === null) {
        return null;
      }
      const hi = values.indexOf(range[1]);
      const lo = values.indexOf(range[0]);
      return `${s.label} highest ${fmt(range[1])} (${described[hi]?.header ?? ""}), lowest ${fmt(range[0])} (${described[lo]?.header ?? ""})`;
    }
    const present = values.filter(isFiniteNumber);
    if (present.length === 0) {
      return null;
    }
    return present.length === 1 ? `${s.label} ${fmt(present[0])}` : `${s.label} from ${fmt(present[0])} to ${fmt(present.at(-1) ?? 0)}`;
  });
  for (const c of clauses) {
    if (c !== null) {
      parts.push(c);
    }
  }
  if (series.length > 3) {
    parts.push(`and ${plural(series.length - 3, "more series", "more series")}`);
  }
  return { kind, columns, rows: described, summary: `${parts.join(", ")}.` };
};

export interface PartsDescriptionInput<Item> {
  readonly kind: string;
  /** What an item is, plural: "slices", "stages", "regions". */
  readonly unit: string;
  readonly items: readonly Item[];
  readonly headerLabel: string;
  readonly label: (item: Item, index: number) => string;
  readonly value: (item: Item, index: number) => number | null;
  readonly valueLabel?: string;
  readonly format?: ValueFormat;
  /** A share-of-total column ("Share"), for parts of a whole (pie, ring, waffle). */
  readonly share?: boolean;
  /** Extra columns after the value. */
  readonly extra?: readonly { readonly label: string; readonly numeric?: boolean; readonly cell: (item: Item, index: number) => string }[];
  /** The summary's order of mention: "largest" (parts of a whole, the default) or "sequence" (a funnel's stages first to last). */
  readonly order?: "largest" | "sequence";
  /** The word the summary leads its top items with. Default: "Largest". */
  readonly lead?: string;
}

const percent = /* @__PURE__ */ new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** One row per part with its value (and share): pie, ring, funnel, waffle, gauge zones, a choropleth's regions. */
export const describeParts = <Item>(input: PartsDescriptionInput<Item>): ChartDescription => {
  const { kind, unit, items } = input;
  const fmt = input.format ?? formatNumber;
  const values = items.map((item, i) => input.value(item, i));
  const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const columns: DescribedColumn[] = [
    { label: input.headerLabel },
    { label: input.valueLabel ?? "Value", numeric: true },
    ...(input.share ? [{ label: "Share", numeric: true }] : []),
    ...(input.extra ?? []).map((e) => ({ label: e.label, numeric: e.numeric })),
  ];
  const rows = items.map((item, i) => {
    const v = values[i];
    return {
      header: input.label(item, i),
      cells: [v === null ? "" : fmt(v), ...(input.share ? [v === null || total === 0 ? "" : percent.format(v / total)] : []), ...(input.extra ?? []).map((e) => e.cell(item, i))],
      datum: item,
    };
  });
  const mention = (i: number): string => {
    const v = values[i] ?? 0;
    return `${rows[i].header} ${fmt(v)}${input.share && total > 0 ? ` (${percent.format(v / total)})` : ""}`;
  };
  const head = `${kind}, ${plural(items.length, unit.replace(/s$/, ""), unit)}${input.share && total > 0 ? ` totalling ${fmt(total)}` : ""}`;
  if (items.length === 0) {
    return { kind, columns, rows, summary: `${head}.` };
  }
  if (input.order === "sequence") {
    const last = items.length - 1;
    return { kind, columns, rows, summary: `${head}, from ${mention(0)} to ${mention(last)}.` };
  }
  const ranked = values.map((v, i) => [v ?? Number.NEGATIVE_INFINITY, i] as const).toSorted((a, b) => b[0] - a[0]);
  const top = ranked.slice(0, 3).map(([, i]) => mention(i));
  return { kind, columns, rows, summary: `${head}. ${input.lead ?? "Largest"}: ${listOf(top)}.` };
};

/** A node of a hierarchy, as `describeHierarchy` walks it. */
export interface HierarchySpec<Node> {
  readonly kind: string;
  readonly root: Node;
  readonly name: (node: Node) => string;
  readonly children: (node: Node) => readonly Node[] | undefined;
  /** The node's value; a parent without one sums its children. */
  readonly value?: (node: Node) => number | null;
  readonly valueLabel?: string;
  readonly format?: ValueFormat;
  /** List the root as a row too (a tree's root is a node; a treemap's is the frame). */
  readonly includeRoot?: boolean;
}

/** One row per node, depth first, its path as the header ("Revenue › Products › Pro"), its level and its value: treemap, sunburst, tree. */
export const describeHierarchy = <Node>(spec: HierarchySpec<Node>): ChartDescription => {
  const fmt = spec.format ?? formatNumber;
  const rows: DescribedRow[] = [];
  const sum = (node: Node): number => {
    const own = spec.value?.(node) ?? null;
    const kids = spec.children(node) ?? [];
    if (kids.length === 0 || own !== null) {
      return own ?? 0;
    }
    return kids.reduce((s, k) => s + sum(k), 0);
  };
  let leaves = 0;
  let depthMax = 0;
  const walk = (node: Node, path: readonly string[], depth: number): void => {
    const name = spec.name(node);
    const here = [...path, name];
    const kids = spec.children(node) ?? [];
    if (depth > 0 || spec.includeRoot) {
      rows.push({ header: here.slice(spec.includeRoot ? 0 : 1).join(" › "), cells: [String(depth + (spec.includeRoot ? 1 : 0)), fmt(sum(node))], datum: node });
      depthMax = Math.max(depthMax, depth + (spec.includeRoot ? 1 : 0));
    }
    if (kids.length === 0) {
      leaves += 1;
    }
    for (const k of kids) {
      walk(k, here, depth + 1);
    }
  };
  walk(spec.root, [], 0);
  const top = (spec.children(spec.root) ?? []).map((k) => [spec.name(k), sum(k)] as const).toSorted((a, b) => b[1] - a[1]);
  const columns: DescribedColumn[] = [{ label: "Path" }, { label: "Level", numeric: true }, { label: spec.valueLabel ?? "Value", numeric: true }];
  const summary = `${spec.kind} of ${spec.name(spec.root)}, ${plural(rows.length, "item")} in ${plural(depthMax, "level")}${
    top.length > 0 ? `. Largest at the top level: ${listOf(top.slice(0, 3).map(([n, v]) => `${n} ${fmt(v)}`))}` : ""
  }${leaves > 0 && spec.value !== undefined ? `, total ${fmt(sum(spec.root))}` : ""}.`;
  return { kind: spec.kind, columns, rows, summary };
};

export interface FlowSpec<Link> {
  readonly kind: string;
  readonly links: readonly Link[];
  readonly source: (link: Link) => string;
  readonly target: (link: Link) => string;
  readonly value?: (link: Link) => number | null;
  readonly valueLabel?: string;
  readonly format?: ValueFormat;
  /** How many nodes the graph has (the summary says so). */
  readonly nodeCount: number;
  /** "flows" (a sankey) or "links" (a network). */
  readonly unit?: string;
  /** What a node is: "node" (the default), "place". */
  readonly nodeUnit?: string;
}

/** One row per link, "Source → Target" and its value: sankey, network, route map. */
export const describeFlows = <Link>(spec: FlowSpec<Link>): ChartDescription => {
  const fmt = spec.format ?? formatNumber;
  const unit = spec.unit ?? "flows";
  const columns: DescribedColumn[] = [{ label: "From" }, { label: "To" }, ...(spec.value === undefined ? [] : [{ label: spec.valueLabel ?? "Value", numeric: true }])];
  const rows = spec.links.map((link) => {
    const v = spec.value?.(link) ?? null;
    return { header: spec.source(link), cells: [spec.target(link), ...(spec.value === undefined ? [] : [v === null ? "" : fmt(v)])], datum: link };
  });
  let summary = `${spec.kind}, ${plural(spec.nodeCount, spec.nodeUnit ?? "node")} and ${plural(spec.links.length, unit.replace(/s$/, ""), unit)}`;
  if (spec.value !== undefined && spec.links.length > 0) {
    const values = spec.links.map((l) => spec.value?.(l) ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    const big = values.indexOf(Math.max(...values));
    summary += ` totalling ${fmt(total)}. Largest: ${spec.source(spec.links[big])} to ${spec.target(spec.links[big])}, ${fmt(values[big])}`;
  }
  return { kind: spec.kind, columns, rows, summary: `${summary}.` };
};

/** Five-number summary of a sample, plus its size and mean. */
export interface SampleStats {
  readonly n: number;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
  readonly mean: number;
}

const quantileSorted = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};

export const sampleStats = (values: readonly number[]): SampleStats => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    min: sorted[0] ?? Number.NaN,
    q1: quantileSorted(sorted, 0.25),
    median: quantileSorted(sorted, 0.5),
    q3: quantileSorted(sorted, 0.75),
    max: sorted.at(-1) ?? Number.NaN,
    mean: n === 0 ? Number.NaN : sorted.reduce((a, b) => a + b, 0) / n,
  };
};

export interface DistributionSpec {
  readonly kind: string;
  /** Each group's name and sample (one group with an empty name for an ungrouped chart). */
  readonly groups: readonly { readonly name: string; readonly values: readonly number[] }[];
  readonly groupLabel?: string;
  readonly format?: ValueFormat;
}

/** One row per group with its size and five-number summary: box plot, violin, beeswarm, ECDF, ridgeline, density. */
export const describeDistribution = (spec: DistributionSpec): ChartDescription => {
  const fmt = spec.format ?? formatNumber;
  const columns: DescribedColumn[] = [
    { label: spec.groupLabel ?? "Group" },
    ...["Count", "Minimum", "First quartile", "Median", "Third quartile", "Maximum", "Mean"].map((label) => ({ label, numeric: true })),
  ];
  const stats = spec.groups.map((g) => sampleStats(g.values));
  const rows = spec.groups.map((g, i) => {
    const s = stats[i];
    return { header: g.name === "" ? "All" : g.name, cells: [formatNumber(s.n), fmt(s.min), fmt(s.q1), fmt(s.median), fmt(s.q3), fmt(s.max), fmt(s.mean)], datum: g };
  });
  const total = stats.reduce((a, s) => a + s.n, 0);
  let summary: string;
  if (spec.groups.length <= 1) {
    const s = stats[0] ?? sampleStats([]);
    summary = `${spec.kind} of ${plural(total, "value")}, from ${fmt(s.min)} to ${fmt(s.max)}, median ${fmt(s.median)}`;
  } else {
    const medians = stats.map((s) => s.median);
    const hi = medians.indexOf(Math.max(...medians));
    const lo = medians.indexOf(Math.min(...medians));
    summary = `${spec.kind} of ${plural(total, "value")} in ${plural(spec.groups.length, "group")}; highest median ${rows[hi].header} ${fmt(medians[hi])}, lowest ${rows[lo].header} ${fmt(medians[lo])}`;
  }
  return { kind: spec.kind, columns, rows, summary: `${summary}.` };
};

/** The summary when a chart is loading: no data to describe yet. */
export const loadingDescription = (kind: string): ChartDescription => ({ kind, columns: [], rows: [], summary: `${kind}, loading.` });

/** The text read for a focused row: "Oct 3: Users 1,350, Pageviews 4,800". */
export const rowText = (description: ChartDescription, row: DescribedRow): string => {
  const cells = row.cells
    .map((cell, i) => (cell === "" ? null : `${description.columns[i + 1]?.label ?? ""} ${cell}`.trim()))
    .filter((c): c is string => c !== null);
  return cells.length === 0 ? row.header : `${row.header}: ${cells.join(", ")}`;
};

/** The extent of a field over rows, formatted ("from a to b"), for summaries of point clouds. */
export const rangeText = (values: readonly number[], fmt: ValueFormat = formatNumber): string => {
  const range = extent(values);
  return range === null ? "" : `from ${fmt(range[0])} to ${fmt(range[1])}`;
};

/** How a run of x values reads as row headers: the chart's own formatter, else dates fitted to their span (strings and epoch-ms dates
 * included when `dates`), numbers in the default format, the rest as text. */
export const headersFor = (values: readonly unknown[], format?: (value: never) => string, dates = false): ((value: unknown) => string) => {
  if (format !== undefined) {
    // SAFETY: the chart's formatter takes the values the chart's data holds under that key.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    const own = format as (value: unknown) => string;
    return (value) => {
      try {
        return own(dates && !(value instanceof Date) ? new Date(value as string | number) : value);
      } catch {
        return formatCell(value);
      }
    };
  }
  const asDates = values.length > 0 && (dates || values.every((v) => v instanceof Date));
  if (asDates) {
    const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string | number));
    const fmt = dateFormatFor(values.map(toDate));
    return (v) => {
      const d = toDate(v);
      return Number.isNaN(d.getTime()) ? formatCell(v) : fmt(d);
    };
  }
  return formatCell;
};

/** A finite number, or a numeric string. */
export const isNumberLike = (value: unknown): boolean =>
  isFiniteNumber(value) || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
