import { area, curveBasis, curveLinear, curveMonotoneX, curveNatural, stack, stackOffsetExpand, stackOffsetNone, stackOffsetSilhouette, stackOffsetWiggle, stackOrderAscending, stackOrderDescending, stackOrderInsideOut, stackOrderNone } from "d3-shape";
import type { Series } from "d3-shape";
import type { ChartTooltipContent, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { intFmt } from "../format";
import { fractions, gridRule, readGuides, tickLabel } from "../mark-chart/guides";
import type { MarkGuides } from "../mark-chart/guides";
import { paletteColor, tint } from "../mark-chart/paint";
import { boneBand, boneLabel, boneShare } from "../mark-chart/skeleton";
import type { MarkChartBuild, MarkChartFamily, MarkDatum, MarkEnter, MarkFrame, MarkLayout } from "../mark-chart/types";
import { memoCell } from "../memo";
import { REVEAL_CSS_EASE } from "../motion/easing";
import { parseAspectRatio } from "../theme";
import type { StreamChartProps, StreamLabelsProps, StreamPoint, StreamProps } from "../types/stream";
import { describeRowsChart } from "../a11y/rows";
import { contrastingText } from "../theme";

export const STREAM_ROLES = { labels: "streamLabels", stream: "stream" } as const;

type Row = Readonly<Record<string, unknown>>;

const Y_AXIS_WIDTH = 48;
const X_AXIS_HEIGHT = 28;
const REVEAL_MS = 1100;
const LAYER_STAGGER_MS = 60;
const X_TICKS = 6;

interface Layer {
  readonly dataKey: string;
  readonly label: string;
  readonly color: string;
}

interface Resolved {
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly layers: readonly Layer[];
  readonly guides: MarkGuides;
  readonly labels: StreamLabelsProps | null;
  readonly offset: NonNullable<StreamChartProps["offset"]>;
  readonly order: NonNullable<StreamChartProps["order"]>;
  readonly stacked: readonly Series<Row, string>[];
  readonly format: (value: number) => string;
  readonly formatX: (value: unknown) => string;
  readonly tickX: (value: unknown) => string;
  readonly curve: NonNullable<StreamChartProps["curve"]>;
}

const valueOf = (row: Row, key: string): number => Math.max(0, Number(row[key]) || 0);

const OFFSETS = { expand: stackOffsetExpand, none: stackOffsetNone, silhouette: stackOffsetSilhouette, wiggle: stackOffsetWiggle } as const;
const ORDERS = { ascending: stackOrderAscending, descending: stackOrderDescending, "inside-out": stackOrderInsideOut, none: stackOrderNone } as const;
const CURVES = { basis: curveBasis, linear: curveLinear, monotone: curveMonotoneX, natural: curveNatural } as const;

const monthFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short" });
const monthYearFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const dayFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
const DAY_MS = 86_400_000;

/** Whether the rows are a month or more apart. */
const isMonthly = (data: readonly Row[], xDataKey: string): boolean => {
  const first = data[0]?.[xDataKey];
  const second = data[1]?.[xDataKey];
  return first instanceof Date && second instanceof Date && Math.abs(second.getTime() - first.getTime()) >= 27 * DAY_MS;
};

/** The default x tick: a monthly date by its month (January with its year), a daily one by its day, anything else as text. */
const defaultTickX = (monthly: boolean) => (value: unknown): string => {
  if (!(value instanceof Date)) { return String(value ?? ""); }
  if (!monthly) { return dayFmt.format(value); }
  return (value.getMonth() === 0 ? monthYearFmt : monthFmt).format(value);
};

/** The default tooltip title: a monthly date with its year. */
const defaultTitleX = (monthly: boolean) => (value: unknown): string => {
  if (!(value instanceof Date)) { return String(value ?? ""); }
  return (monthly ? monthYearFmt : dayFmt).format(value);
};

const xNumber = (value: unknown, index: number): number => {
  if (value instanceof Date) { return value.getTime(); }
  const number = Number(value);
  return Number.isFinite(number) ? number : index;
};

/** Round tick values over [min, max]: steps of 1, 2 or 5 times a power of ten. */
const niceTicks = (min: number, max: number, count: number): number[] => {
  const span = max - min;
  if (!(span > 0)) { return [min]; }
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) { ticks.push(value); }
  return ticks;
};

function layoutStream(r: Resolved, frame: MarkFrame): MarkLayout {
  const { data, guides, stacked, layers } = r;
  const showY = guides.yAxis !== null && (r.offset === "none" || r.offset === "expand");
  const left = showY ? Y_AXIS_WIDTH : 0;
  const bottom = guides.xAxis === null ? 0 : X_AXIS_HEIGHT;
  const px = frame.x + left;
  const py = frame.y + 6;
  const pw = Math.max(0, frame.width - left - 2);
  const ph = Math.max(0, frame.height - bottom - 6);
  const xs0 = data.map((row, index) => xNumber(row[r.xDataKey], index));
  const xMin = Math.min(...xs0);
  const xMax = Math.max(...xs0);
  const xs = xs0.map((value) => (xMax > xMin ? px + ((value - xMin) / (xMax - xMin)) * pw : px + pw / 2));
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const series of stacked) {
    for (const [y0, y1] of series) { yMin = Math.min(yMin, y0, y1); yMax = Math.max(yMax, y0, y1); }
  }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
  if (r.offset === "none") { yMin = Math.min(0, yMin); }
  const ySpan = yMax - yMin || 1;
  const y = (value: number): number => py + ph - ((value - yMin) / ySpan) * ph;
  const nodes: SceneNode[] = [];
  // As many x ticks as fit: the widest label plus a gap apart, at most X_TICKS.
  const widest = Math.max(1, ...data.map((row) => frame.measure(r.tickX(row[r.xDataKey]), 12, 400)));
  const fit = Math.max(2, Math.min(X_TICKS, Math.floor(pw / (widest + 24))));
  const step = Math.max(1, Math.ceil(data.length / fit));
  const tickIndexes = data.map((_, index) => index).filter((index) => index % step === 0);
  // Guides.
  if (guides.grid !== null) {
    if (guides.grid.vertical === true) {
      for (const index of tickIndexes) { nodes.push(gridRule(`st:gx:${index}`, guides.grid, xs[index] ?? px, py, xs[index] ?? px, py + ph)); }
    }
    if (guides.grid.horizontal !== false && (r.offset === "none" || r.offset === "expand")) {
      const values = r.offset === "expand" ? fractions(4) : niceTicks(yMin, yMax, 4);
      for (const value of values) { nodes.push(gridRule(`st:gy:${value}`, guides.grid, px, y(value), px + pw, y(value))); }
    }
  }
  if (showY) {
    const values = r.offset === "expand" ? fractions(4) : niceTicks(yMin, yMax, 4);
    for (const value of values) {
      nodes.push(tickLabel(`st:y:${value}`, r.offset === "expand" ? `${Math.round(value * 100)}%` : r.format(value), px - 10, y(value), "end"));
    }
  }
  if (guides.xAxis !== null) {
    for (const index of tickIndexes) {
      const at = xs[index] ?? px;
      const anchor = index === 0 && at - px < 24 ? "start" : "middle";
      nodes.push(tickLabel(`st:x:${index}`, r.tickX(data[index]?.[r.xDataKey]), at, py + ph + 16, anchor));
    }
  }
  // The crosshair, one rule per x (only the hovered one shows).
  data.forEach((_, index) => {
    nodes.push({ className: "bkm-st-rule", key: `st:rule:${index}`, kind: "rule", style: { stroke: "var(--chart-crosshair)", strokeWidth: 1 }, x1: xs[index] ?? px, x2: xs[index] ?? px, y1: py, y2: py + ph });
  });
  const curve = CURVES[r.curve];
  const path = area<[number, number]>().x((_, index) => xs[index] ?? px).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(curve);
  const points: MarkDatum[] = [];
  const minThickness = r.labels?.minThickness ?? 18;
  const layerNodes: SceneNode[] = [];
  for (const series of stacked) {
    const layerIndex = series.index;
    const layer = layers[layerIndex] as Layer;
    const key = `st:${layerIndex}`;
    const top = series.map((d, index): [number, number] => [xs[index] ?? px, y(d[1])]);
    const base = series.map((d, index): [number, number] => [xs[index] ?? px, y(d[0])]);
    const children: SceneNode[] = [{
      className: "bkm-st-layer", key: `${key}:area`, kind: "area", path: path(series.map((d): [number, number] => [d[0], d[1]])) ?? "", points: [...top, ...[...base].reverse()],
      style: { fill: tint(layer.color, 78), stroke: "var(--chart-background)", strokeWidth: 1 },
    }];
    if (r.labels !== null) {
      let best = -1;
      let thickest = 0;
      series.forEach((d, index) => {
        const thickness = y(d[0]) - y(d[1]);
        if (thickness > thickest) { thickest = thickness; best = index; }
      });
      const width = frame.measure(layer.label, 12, 600);
      if (best >= 0 && thickest >= minThickness && width + 16 < pw) {
        const d = series[best] as [number, number];
        const at = Math.min(Math.max(xs[best] ?? px, px + width / 2 + 8), px + pw - width / 2 - 8);
        children.push({ anchor: "middle", baseline: "middle", className: "bkm-st-label", fontSize: 12, fontWeight: 600, key: `${key}:label`, kind: "label", style: { fill: contrastingText(tint(layer.color, 78)) }, text: layer.label, x: at, y: (y(d[0]) + y(d[1])) / 2 + 1 });
      }
    }
    layerNodes.push({ children, className: "bkm-mc-item bkm-st-group", key, kind: "group" });
    series.forEach((d, index) => {
      const x = xs[index] ?? px;
      const lx = index === 0 ? x : ((xs[index - 1] ?? x) + x) / 2;
      const rx = index === data.length - 1 ? x : ((xs[index + 1] ?? x) + x) / 2;
      const prev = series[index - 1] ?? d;
      const next = series[index + 1] ?? d;
      const mid = (a: number, b: number): number => (a + b) / 2;
      const band: (readonly [number, number])[] = [
        [lx, y(index === 0 ? d[1] : mid(prev[1], d[1]))], [x, y(d[1])], [rx, y(index === data.length - 1 ? d[1] : mid(d[1], next[1]))],
        [rx, y(index === data.length - 1 ? d[0] : mid(d[0], next[0]))], [x, y(d[0])], [lx, y(index === 0 ? d[0] : mid(prev[0], d[0]))],
      ];
      const row = data[index] as Row;
      const total = layers.reduce((sum, other) => sum + valueOf(row, other.dataKey), 0);
      const value = valueOf(row, layer.dataKey);
      const point: StreamPoint = { color: layer.color, dataKey: layer.dataKey, row, series: layer.label, share: total > 0 ? value / total : 0, total, value, x: row[r.xDataKey] };
      points.push({ color: layer.color, hit: { kind: "band", points: band }, index, item: key, label: `${layer.label}, ${r.formatX(row[r.xDataKey])}`, related: [`st:rule:${index}`], row: point, series: layerIndex, x, y: y((d[0] + d[1]) / 2) });
    });
  }
  // The layers over the guides; keyboard order: by x, then by layer.
  nodes.push({ children: layerNodes, className: "bkm-st-layers", key: "st:layers", kind: "group" });
  points.sort((a, b) => a.index - b.index || (a.series ?? 0) - (b.series ?? 0));
  return { nodes, points };
}

/** The skeleton's points across, without data. */
const SKELETON_POINTS = 12;

/** The loading skeleton: as many bands as the chart has layers (else 4), each a seeded swell, stacked on the chart's offset and order and
 * drawn on its curve, in the plot the guides leave (the grid drawn, the tick labels as stubs). */
const streamSkeleton = (r: Resolved, frame: MarkFrame): SceneNode[] => {
  const { guides } = r;
  const showY = guides.yAxis !== null && (r.offset === "none" || r.offset === "expand");
  const left = showY ? Y_AXIS_WIDTH : 0;
  const bottom = guides.xAxis === null ? 0 : X_AXIS_HEIGHT;
  const px = frame.x + left;
  const py = frame.y + 6;
  const pw = Math.max(0, frame.width - left - 2);
  const ph = Math.max(0, frame.height - bottom - 6);
  const count = r.layers.length > 0 ? Math.min(8, r.layers.length) : 4;
  const across = r.data.length >= 2 ? Math.min(40, r.data.length) : SKELETON_POINTS;
  const keys = Array.from({ length: count }, (_, index) => String(index));
  const rows = Array.from({ length: across }, (_, i): Row => Object.fromEntries(keys.map((key, layer) => {
    const phase = boneShare(layer, 5) * Math.PI * 2;
    return [key, 1 + 0.55 * Math.sin(i * 0.62 + phase) + 0.35 * boneShare(layer * 31 + i, 9)];
  })));
  const stacked = stack<Row, string>().keys(keys).value((row, key) => Number(row[key])).order(ORDERS[r.order]).offset(OFFSETS[r.offset])(rows);
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const series of stacked) {
    for (const [y0, y1] of series) { yMin = Math.min(yMin, y0, y1); yMax = Math.max(yMax, y0, y1); }
  }
  if (r.offset === "none") { yMin = Math.min(0, yMin); }
  const ySpan = yMax - yMin || 1;
  const x = (index: number): number => px + (across > 1 ? (index / (across - 1)) * pw : pw / 2);
  const y = (value: number): number => py + ph - ((value - yMin) / ySpan) * ph;
  const nodes: SceneNode[] = [];
  const ticks = Math.max(2, Math.min(X_TICKS, Math.floor(pw / 80)));
  const tickAt = (tick: number): number => px + (tick / (ticks - 1)) * pw;
  if (guides.grid !== null) {
    if (guides.grid.vertical === true) {
      for (let tick = 0; tick < ticks; tick += 1) { nodes.push(gridRule(`st:gx:${tick}`, guides.grid, tickAt(tick), py, tickAt(tick), py + ph)); }
    }
    if (guides.grid.horizontal !== false && (r.offset === "none" || r.offset === "expand")) {
      for (const f of fractions(4)) { nodes.push(gridRule(`st:gy:${f}`, guides.grid, px, py + ph * (1 - f), px + pw, py + ph * (1 - f))); }
    }
  }
  if (showY) {
    for (const f of fractions(4)) { nodes.push(boneLabel(`st:y:${f}`, px - 10, py + ph * (1 - f), 24, "end")); }
  }
  if (guides.xAxis !== null) {
    for (let tick = 0; tick < ticks; tick += 1) {
      nodes.push(boneLabel(`st:x:${tick}`, tickAt(tick), py + ph + 16, 28, tick === 0 ? "start" : tick === ticks - 1 ? "end" : "middle"));
    }
  }
  const path = area<[number, number]>().x((_, index) => x(index)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(CURVES[r.curve]);
  for (const series of stacked) {
    const top = series.map((d, index): [number, number] => [x(index), y(d[1])]);
    const base = series.map((d, index): [number, number] => [x(index), y(d[0])]);
    nodes.push(boneBand(`st:${series.index}`, path(series.map((d): [number, number] => [d[0], d[1]])) ?? "", [...top, ...[...base].reverse()]));
  }
  return nodes;
};

/** The stream family: one builder per chart. */
export const STREAM_FAMILY: MarkChartFamily<StreamChartProps> = {
  chart: "stream",
  props: {
    booleans: ["animate"],
    names: ["data", "status", "loadingLabel", "xDataKey", "offset", "order", "curve", "formatValue", "formatX", "onHoverChange", "aspectRatio", "height", "animate", "ariaLabel", "ariaDescription"],
  },
  placeholder: { data: [], xDataKey: "" },
  createBuilder: () => {
    const layersCell = memoCell<readonly Layer[]>();
    const guidesCell = memoCell<MarkGuides>();
    const buildCell = memoCell<MarkChartBuild>();
    return ({ props, table }) => {
      const streams = propsFor<StreamProps>(table, STREAM_ROLES.stream);
      const layers = layersCell(streams.flatMap((s) => [s.dataKey, s.label, s.fill]), () =>
        streams.map((s, index) => ({ color: s.fill ?? paletteColor(undefined, index), dataKey: s.dataKey, label: s.label ?? s.dataKey })));
      const fresh = readGuides(table);
      const guides = guidesCell([fresh.grid, fresh.xAxis, fresh.yAxis], () => fresh);
      const labels = propsFor<StreamLabelsProps>(table, STREAM_ROLES.labels).at(-1) ?? null;
      const animate = props.animate !== false;
      return buildCell([props.data, props.xDataKey, layers, guides, labels, props.offset, props.order, props.curve, props.formatValue, props.formatX, props.onHoverChange, props.aspectRatio, props.height, animate, props.ariaLabel, props.ariaDescription], () => {
        const offset = props.offset ?? "wiggle";
        const stacked = stack<Row, string>()
          .keys(layers.map((layer) => layer.dataKey))
          .value((row, key) => valueOf(row, key))
          .order(ORDERS[props.order ?? "inside-out"])
          .offset(OFFSETS[offset])(props.data as Row[]);
        const format = props.formatValue ?? intFmt;
        const monthly = isMonthly(props.data, props.xDataKey);
        const formatX = props.formatX ?? defaultTitleX(monthly);
        const tickX = props.formatX ?? defaultTickX(monthly);
        const resolved: Resolved = { curve: props.curve ?? "basis", data: props.data, format, formatX, tickX, guides, labels, layers, offset, order: props.order ?? "inside-out", stacked, xDataKey: props.xDataKey };
        const enter = (key: string): MarkEnter | undefined => {
          const match = /^st:(\d+)$/u.exec(key);
          if (match === null) { return undefined; }
          return { delay: Number(match[1]) * LAYER_STAGGER_MS, duration: REVEAL_MS, easing: REVEAL_CSS_EASE, keyframes: [{ clipPath: "inset(-2px 100% -2px 0)" }, { clipPath: "inset(-2px 0 -2px 0)" }] };
        };
        const tooltip = (datum: MarkDatum): ChartTooltipContent => {
          const point = datum.row as StreamPoint;
          return {
            rows: layers.map((layer, index) => ({ active: index === datum.series, color: layer.color, label: layer.label, value: format(valueOf(point.row, layer.dataKey)) })),
            title: formatX(point.x),
          };
        };
        return {
          ariaDescription: props.ariaDescription,
          describe: () => describeRowsChart({ kind: "Stream chart", unit: "points", data: props.data, xKey: props.xDataKey, xFormat: formatX, series: layers.map((l) => ({ key: l.dataKey, label: l.label, format })) }),
          ariaLabel: props.ariaLabel ?? "Stream chart",
          ...(props.height === undefined ? { aspectRatio: parseAspectRatio(props.aspectRatio ?? "2 / 1") } : { height: props.height }),
          ...(animate ? { enter } : {}),
          ...(props.onHoverChange === undefined ? {} : { hover: (datum: MarkDatum | null) => props.onHoverChange?.(datum?.series ?? null) }),
          layout: (frame) => layoutStream(resolved, frame),
          seriesItems: (series) => [`st:${series}`],
          skeleton: (frame) => streamSkeleton(resolved, frame),
          tooltip,
        };
      });
    };
  },
};
