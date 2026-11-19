import type { SceneNode } from "@tanstack/charts";
import { boxRows } from "@tanstack/charts/box";
import { defineChart } from "@tanstack/charts/scene";
import { propsFor } from "../carriers/table";
import type { DistributionPass, DistributionPassInput } from "../distribution/controller";
import { categoriesOf, categoryFrame } from "../distribution/category";
import { distributionCss, groupClass } from "../distribution/css";
import { bandFocus, formatTooltipValue, interactionOptions, seriesColor } from "../distribution/frame";
import { bandOf, distributionMark, oriented } from "../distribution/marks";
import { seeded, skeletonBands } from "../distribution/skeleton";
import { erase } from "../erased-types";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { BoxPlotChartProps, BoxPlotPoint, BoxPlotProps, BoxPlotSummary } from "../types/box-plot";
import type { TooltipRow } from "../types/tooltip";
import { describeSamples } from "../distribution/describe";

/** The props a BoxPlotChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type BoxPlotControllerProps = Omit<BoxPlotChartProps<unknown, unknown>, "children" | "className" | "style">;

interface Series {
  readonly label: string;
  readonly color: string;
  readonly radius: number;
  readonly boxWidth: number;
  readonly outliers: boolean;
  readonly animate: boolean;
  readonly faded: number;
}

const DEFAULT_ENTER_MS = 1100;
const MAX_BOX_PX = 88;
/** The skeleton's categories without data. */
const SKELETON_CATEGORIES = 4;

/** Every series' summary per category (`boxRows` per series: summaries, then outliers). */
const summarize = (props: BoxPlotControllerProps, carriers: readonly BoxPlotProps[], series: readonly Series[], categories: readonly string[]): BoxPlotPoint[] => {
  const byCategory = new Map(categories.map((category) => [category, [] as BoxPlotSummary[]]));
  for (const [n, carrier] of carriers.entries()) {
    const s = series[n];
    const rows = boxRows(props.data, {
      category: (datum: Readonly<Record<string, unknown>>) => {
        const value = datum[props.categoryKey];
        return value === null || value === undefined || value === "" ? null : String(value);
      },
      value: (datum: Readonly<Record<string, unknown>>) => {
        const value = datum[carrier.dataKey];
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      },
    });
    const outliers = new Map<string, number[]>();
    for (const row of rows) {
      if (row.kind === "outlier") {
        const list = outliers.get(String(row.category)) ?? [];
        list.push(row.value);
        outliers.set(String(row.category), list);
      }
    }
    for (const row of rows) {
      if (row.kind === "summary" && s !== undefined) {
        byCategory.get(String(row.category))?.push({
          label: s.label,
          color: s.color,
          count: row.count,
          low: row.whiskerLow,
          q1: row.q1,
          median: row.median,
          q3: row.q3,
          high: row.whiskerHigh,
          outliers: (outliers.get(String(row.category)) ?? []).toSorted((a, b) => a - b),
        });
      }
    }
  }
  return categories.map((category) => ({ category, series: byCategory.get(category) ?? [] }));
};

export function boxPlotPass({ props, table, uid, live, phase }: DistributionPassInput<BoxPlotControllerProps>): DistributionPass {
  const carriers = propsFor<BoxPlotProps>(table, "boxPlot");
  const tooltipProps = propsFor<Readonly<Record<string, unknown>>>(table, "boxPlotTooltip").at(0) ?? null;
  const series: Series[] = carriers.map((c, n) => ({
    label: c.label ?? c.dataKey,
    color: seriesColor(c.fill, n),
    radius: c.radius ?? 6,
    boxWidth: Math.min(1, Math.max(0.05, c.boxWidth ?? 0.62)),
    outliers: c.showOutliers !== false,
    animate: c.animate !== false,
    faded: c.fadedOpacity ?? 0.3,
  }));
  const categories = categoriesOf(props.data, props.categoryKey);
  const points = summarize(props, carriers, series, categories);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    for (const s of point.series) {
      lo = Math.min(lo, s.low, ...s.outliers);
      hi = Math.max(hi, s.high, ...s.outliers);
    }
  }
  const extent: [number, number] = Number.isFinite(lo) ? [lo, hi] : [0, 1];
  const frame = categoryFrame({ categories, orientation: props.orientation, table, xRole: "boxPlotXAxis", yRole: "boxPlotYAxis", extent, domain: props.domain, margin: props.margin });
  const { horizontal } = frame;
  const shape = oriented(horizontal);
  const enterMs = props.animationDuration ?? DEFAULT_ENTER_MS;
  const staggerMs = categories.length > 1 ? Math.min(90, (enterMs * 0.4) / categories.length) : 0;
  const format = formatTooltipValue(erase(tooltipProps?.formatValue), frame.valueAxisProps);

  const mark = distributionMark<BoxPlotPoint>({
    id: "box-plot",
    live,
    phase,
    x: horizontal ? frame.valueDomain : categories,
    y: horizontal ? categories : frame.valueDomain,
    layout: ({ x, y }) => {
      const band = horizontal ? y : x;
      const value = horizontal ? x : y;
      const nodes: SceneNode[] = [];
      const placed = points.map((point, i) => {
        const { start, width } = bandOf(band, point.category);
        const slot = width / Math.max(1, series.length);
        const children: SceneNode[] = [];
        let anchorValue = value.map(point.series[0]?.median ?? 0);
        let anchorHigh = value.map(point.series[0]?.high ?? 0);
        for (const summary of point.series) {
          const n = series.findIndex((s) => s.label === summary.label && s.color === summary.color);
          const s = series[n];
          if (s === undefined) {
            continue;
          }
          const center = start + slot * (n + 0.5);
          const half = Math.min(slot * s.boxWidth, MAX_BOX_PX) / 2;
          const cap = half * 0.5;
          const cls = `bkm-d-s bkm-d-s${n}`;
          const q1 = value.map(summary.q1);
          const q3 = value.map(summary.q3);
          const median = value.map(summary.median);
          const low = value.map(summary.low);
          const high = value.map(summary.high);
          const whisker = { stroke: s.color, strokeWidth: 1.5, lineCap: "round" as const };
          children.push(
            { kind: "rule", key: `s${n}:wl`, className: cls, ...shape.along(center, low, q1), style: whisker },
            { kind: "rule", key: `s${n}:wh`, className: cls, ...shape.along(center, q3, high), style: whisker },
            { kind: "rule", key: `s${n}:cl`, className: cls, ...shape.across(center - cap, center + cap, low), style: { ...whisker, strokeWidth: 2 } },
            { kind: "rule", key: `s${n}:ch`, className: cls, ...shape.across(center - cap, center + cap, high), style: { ...whisker, strokeWidth: 2 } },
            { kind: "rect", key: `s${n}:box`, className: cls, ...shape.rect(center - half, center + half, q1, q3), radius: Math.min(s.radius, half, Math.abs(q1 - q3) / 2), style: { fill: s.color } },
            { kind: "rule", key: `s${n}:med`, className: cls, ...shape.across(center - half + 3, center + half - 3, median), style: { stroke: "var(--chart-background)", strokeWidth: 2, lineCap: "round" } },
          );
          if (s.outliers) {
            for (const [o, outlier] of summary.outliers.entries()) {
              const at = shape.at(center, value.map(outlier));
              children.push({ kind: "dot", key: `s${n}:o${o}`, className: cls, x: at.x, y: at.y, radius: 3, style: { fill: `color-mix(in srgb, ${s.color} 55%, transparent)` } });
            }
          }
          if (n === 0) {
            anchorValue = median;
            anchorHigh = high;
          }
        }
        if (children.length > 0) {
          nodes.push({ kind: "group", key: `c${i}`, className: groupClass(i, null, series.some((s) => s.animate) ? (horizontal ? "unfoldx" : "unfoldy") : null), children });
        }
        const at = horizontal ? shape.at(start + width / 2, anchorHigh) : shape.at(start + width / 2, anchorValue);
        return { key: `c${i}`, datum: point, index: i, x: at.x, y: at.y, xValue: horizontal ? (point.series[0]?.median ?? 0) : point.category, yValue: horizontal ? point.category : (point.series[0]?.median ?? 0), color: point.series[0]?.color ?? "currentColor", label: point.category };
      });
      return { nodes, points: placed };
    },
    // A box per category and series, seeded quartiles climbing a little from one category to the next, in the boxes' own proportions.
    skeleton: ({ x, y, chart }) => {
      const band = horizontal ? y : x;
      const span: [number, number] = horizontal ? [chart.y, chart.y + chart.height] : [chart.x, chart.x + chart.width];
      const bands = skeletonBands(band, categories, span, SKELETON_CATEGORIES, 0.3, 0.2);
      const groups = Math.max(1, series.length);
      const random = seeded(bands.length * 31 + groups);
      // A share of the value axis to its pixel.
      const along = (t: number): number => (horizontal ? chart.x + t * chart.width : chart.y + chart.height - t * chart.height);
      const shapes: SceneNode[] = [];
      for (const [b, { start, width }] of bands.entries()) {
        const slot = width / groups;
        for (let n = 0; n < groups; n += 1) {
          const center = start + slot * (n + 0.5);
          const half = Math.min(slot * (series[n]?.boxWidth ?? 0.62), MAX_BOX_PX) / 2;
          const cap = half * 0.5;
          const median = 0.26 + (b / Math.max(1, bands.length - 1)) * 0.14 + random() * 0.14;
          const q1 = median - 0.05 - random() * 0.06;
          const q3 = median + 0.06 + random() * 0.1;
          const low = Math.max(0.03, q1 - 0.07 - random() * 0.1);
          const high = Math.min(0.97, q3 + 0.1 + random() * 0.16);
          const [vq1, vq3, vmed, vlow, vhigh] = [q1, q3, median, low, high].map(along);
          const key = `c${b}s${n}`;
          const whisker = { strokeWidth: 1.5, lineCap: "round" as const };
          shapes.push(
            { kind: "rule", key: `${key}:wl`, ...shape.along(center, vlow, vq1), style: whisker },
            { kind: "rule", key: `${key}:wh`, ...shape.along(center, vq3, vhigh), style: whisker },
            { kind: "rule", key: `${key}:cl`, ...shape.across(center - cap, center + cap, vlow), style: { ...whisker, strokeWidth: 2 } },
            { kind: "rule", key: `${key}:ch`, ...shape.across(center - cap, center + cap, vhigh), style: { ...whisker, strokeWidth: 2 } },
            { kind: "rect", key: `${key}:box`, ...shape.rect(center - half, center + half, vq1, vq3), radius: Math.min(series[n]?.radius ?? 6, half, Math.abs(vq1 - vq3) / 2) },
            { kind: "rule", key: `${key}:med`, ...shape.across(center - half + 3, center + half - 3, vmed), style: { stroke: "var(--chart-background)", strokeWidth: 2, lineCap: "round" } },
          );
        }
      }
      return { shapes };
    },
  });

  const definition = defineChart(
    erase({
      chart: ({ width }: { readonly width: number }) => ({ marks: [mark], scales: frame.scalesAt(width), margin: frame.margin, theme: bklitTheme }),
      ...interactionOptions(bandFocus(horizontal ? "y" : "x", live), tooltipProps !== null, horizontal ? "point" : "top"),
    }),
  );

  return {
    definition,
    aspectRatio: parseAspectRatio(props.aspectRatio),
    margin: frame.margin,
    describe: () => describeSamples("Box plot", props.data, carriers, props.categoryKey, format),
    ariaLabel: props.ariaLabel,
    ariaDescription: props.ariaDescription,
    css: distributionCss({ uid, items: categories.length, faded: series.map((s) => s.faded), enterMs, staggerMs, dimItems: "index" }),
    hoverIndex: (point) => point.datumIndex,
    tooltip: (focused) => {
      const point = focused.at(0);
      const datum: BoxPlotPoint | undefined = point?.datum;
      if (point === undefined || datum === undefined) {
        return undefined;
      }
      const rows: TooltipRow[] = datum.series.length === 1
        ? ((s: BoxPlotSummary): TooltipRow[] => [
            { color: s.color, label: "High", value: format(s.high) },
            { color: s.color, label: "Q3", value: format(s.q3) },
            { color: s.color, label: "Median", value: format(s.median) },
            { color: s.color, label: "Q1", value: format(s.q1) },
            { color: s.color, label: "Low", value: format(s.low) },
            ...(s.outliers.length > 0 ? [{ color: "var(--chart-foreground-muted)", label: "Outliers", value: s.outliers.length }] : []),
          ])(datum.series[0])
        : datum.series.map((s) => ({ color: s.color, label: `${s.label} median`, value: format(s.median) }));
      return { title: datum.category, rows, point: datum, index: point.datumIndex };
    },
    tooltipProps,
    overlay: null,
  };
}
