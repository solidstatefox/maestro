import type { SceneNode, SceneRect } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { binX } from "@tanstack/charts/transform/bin";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { propsFor } from "../carriers/table";
import type { DistributionPass, DistributionPassInput } from "../distribution/controller";
import { distributionCss, groupClass } from "../distribution/css";
import { bandFocus, finite, formatTooltipValue, gridOn, interactionOptions, plotMargin, seriesColor, valueAxis, valueLabelRoom } from "../distribution/frame";
import { distributionMark, px } from "../distribution/marks";
import { bell, seeded } from "../distribution/skeleton";
import { erase } from "../erased-types";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { HistogramAxisProps, HistogramChartProps, HistogramPoint, HistogramProps } from "../types/histogram";
import { describeHistogram } from "../distribution/describe";

/** The props a HistogramChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type HistogramControllerProps = Omit<HistogramChartProps<unknown, unknown>, "children" | "className" | "style">;

interface Series {
  readonly label: string;
  readonly color: string;
  readonly fillOpacity: number;
  readonly radius: number;
  readonly animate: boolean;
  readonly faded: number;
}

interface Bin {
  readonly x0: number;
  readonly x1: number;
  readonly counts: number[];
}

const DEFAULT_ENTER_MS = 1100;
/** The skeleton's bins without data. */
const SKELETON_BINS = 18;

/** The bins of every series on shared thresholds (binX's `by` keeps one threshold set for all groups). */
const binSeries = (values: readonly (readonly number[])[], thresholds: HistogramControllerProps["thresholds"], domain: HistogramControllerProps["domain"]): Bin[] => {
  const rows = values.flatMap((list, s) => list.map((v) => ({ s, v })));
  if (rows.length === 0) {
    return [];
  }
  const binned = binX(rows, {
    value: "v",
    by: "s",
    ...(thresholds === undefined ? {} : { thresholds: typeof thresholds === "number" ? thresholds : [...thresholds] }),
    ...(domain === undefined ? {} : { domain: [domain[0], domain[1]] as const }),
    outputs: { count: { reduce: "count" } },
  });
  const bins: Bin[] = [];
  const position = new Map<number, number>();
  for (const row of binned) {
    const at = position.get(row.s) ?? 0;
    position.set(row.s, at + 1);
    bins[at] ??= { x0: row.x1, x1: row.x2, counts: values.map(() => 0) };
    bins[at].counts[row.s] = row.count;
  }
  return bins;
};

export function histogramPass({ props, table, uid, live, phase }: DistributionPassInput<HistogramControllerProps>): DistributionPass {
  const carriers = propsFor<HistogramProps>(table, "histogram");
  const xAxis = propsFor<HistogramAxisProps>(table, "histogramXAxis").at(0);
  const yAxis = propsFor<HistogramAxisProps>(table, "histogramYAxis").at(0);
  const grid = propsFor<GridGuideProps>(table, "grid").at(0);
  const tooltipProps = propsFor<Readonly<Record<string, unknown>>>(table, "histogramTooltip").at(0) ?? null;
  const stacked = props.stacked === true;
  const overlap = !stacked && carriers.length > 1;
  const series: Series[] = carriers.map((c, n) => ({
    label: c.label ?? c.dataKey,
    color: seriesColor(c.fill, n),
    fillOpacity: c.fillOpacity ?? (overlap ? 0.55 : 1),
    radius: c.radius ?? 4,
    animate: c.animate !== false,
    faded: c.fadedOpacity ?? 0.3,
  }));
  const values = carriers.map((c) => props.data.map((row) => finite(row[c.dataKey])).filter((v): v is number => v !== null));
  const bins = binSeries(values, props.thresholds, props.domain);
  const tops = bins.map((bin) => (stacked ? bin.counts.reduce((a, b) => a + b, 0) : Math.max(0, ...bin.counts)));
  const yMax = Math.max(1, ...tops);
  const yScale = scaleLinear().domain([0, yMax]).nice(yAxis?.numTicks ?? 5);
  const yDomain = yScale.domain();
  const xDomain: [number, number] = bins.length === 0 ? [0, 1] : [bins[0].x0, bins.at(-1)?.x1 ?? bins[0].x1];
  const margin = plotMargin(props.margin, { left: yAxis === undefined ? 16 : valueLabelRoom(yDomain, yAxis), bottom: xAxis === undefined ? 16 : 36 });
  const enterMs = props.animationDuration ?? DEFAULT_ENTER_MS;
  const staggerMs = bins.length > 1 ? Math.min(28, (enterMs * 0.4) / bins.length) : 0;
  const format = formatTooltipValue(erase(tooltipProps?.formatValue), xAxis);

  const points: HistogramPoint[] = bins.map((bin) => ({
    x0: bin.x0,
    x1: bin.x1,
    total: bin.counts.reduce((a, b) => a + b, 0),
    series: series.map((s, n) => ({ label: s.label, color: s.color, count: bin.counts[n] ?? 0 })),
  }));

  const mark = distributionMark<HistogramPoint>({
    id: "histogram",
    live,
    phase,
    x: xDomain,
    y: yDomain,
    layout: ({ x, y }) => {
      const nodes: SceneNode[] = [];
      const base = y.map(0);
      for (const [i, bin] of bins.entries()) {
        const left = x.map(bin.x0);
        const right = x.map(bin.x1);
        const width = right - left;
        const gap = width > 8 ? 1 : width > 3 ? 0.5 : 0;
        const children: SceneRect[] = [];
        let floor = 0;
        const topSeries = stacked ? bin.counts.findLastIndex((c) => c > 0) : -1;
        for (const [n, s] of series.entries()) {
          const count = bin.counts[n] ?? 0;
          if (count <= 0) {
            continue;
          }
          const lo = stacked ? floor : 0;
          const hi = lo + count;
          floor = hi;
          const top = y.map(hi);
          const bottom = y.map(lo);
          const radius = !stacked || n === topSeries ? Math.min(s.radius, (width - gap * 2) / 2, bottom - top) : 0;
          children.push({
            kind: "rect",
            key: `s${n}`,
            className: `bkm-d-s bkm-d-s${n}`,
            x: px(left + gap),
            y: px(top),
            width: px(Math.max(0, width - gap * 2)),
            height: px(Math.max(0, bottom - top)),
            cornerRadii: [radius, radius, 0, 0],
            style: { fill: s.fillOpacity === 1 ? s.color : `color-mix(in srgb, ${s.color} ${Math.round(s.fillOpacity * 100)}%, transparent)` },
          });
        }
        if (children.length > 0) {
          const animate = series.some((s) => s.animate);
          nodes.push({ kind: "group", key: `bin${i}`, className: groupClass(i, null, animate ? "grow" : null), children });
        }
      }
      return {
        nodes,
        points: points.map((datum, i) => {
          const bin = bins[i];
          const center = (x.map(bin.x0) + x.map(bin.x1)) / 2;
          return { key: `bin${i}`, datum, index: i, x: center, y: Math.min(base, y.map(tops[i] ?? 0)), xValue: (bin.x0 + bin.x1) / 2, yValue: tops[i] ?? 0, color: series[0]?.color ?? "currentColor" };
        }),
      };
    },
    // As many bins as the chart's (else 18) across the plot, on a hump with a long right tail, each a little off the curve.
    skeleton: ({ chart }) => {
      const count = bins.length > 0 ? bins.length : SKELETON_BINS;
      const width = chart.width / count;
      const gap = width > 8 ? 1 : width > 3 ? 0.5 : 0;
      const base = chart.y + chart.height;
      const jitter = seeded(count);
      return {
        shapes: Array.from({ length: count }, (_unused, i): SceneRect => {
          const t = (i + 0.5) / count;
          const share = Math.min(0.92, 0.06 + 0.8 * (bell(t, 0.32, 0.15) * 0.85 + bell(t, 0.62, 0.2) * 0.3) * (0.86 + jitter() * 0.28));
          const height = Math.max(2, share * chart.height);
          const w = Math.max(0, width - gap * 2);
          const radius = Math.min(4, w / 2, height);
          return { kind: "rect", key: `b${i}`, x: px(chart.x + i * width + gap), y: px(base - height), width: px(w), height: px(height), cornerRadii: [radius, radius, 0, 0] };
        }),
      };
    },
  });

  const definition = defineChart(
    erase({
      chart: () => ({
        marks: [mark],
        scales: {
          x: { scale: scaleLinear().domain(xDomain), grid: gridOn(grid, "columns"), axis: valueAxis(xAxis, "x") },
          y: { scale: yScale, grid: gridOn(grid, "rows"), axis: valueAxis(yAxis, "y") },
        },
        margin,
        theme: bklitTheme,
      }),
      ...interactionOptions(bandFocus("x", live), tooltipProps !== null),
    }),
  );

  return {
    definition,
    aspectRatio: parseAspectRatio(props.aspectRatio),
    margin,
    describe: () => describeHistogram(points, series.map((s) => s.label), format),
    ariaLabel: props.ariaLabel,
    ariaDescription: props.ariaDescription,
    css: distributionCss({ uid, items: bins.length, faded: series.map((s) => s.faded), enterMs, staggerMs, dimItems: "index" }),
    hoverIndex: (point) => point.datumIndex,
    tooltip: (focusedPoints) => {
      const point = focusedPoints.at(0);
      const datum: HistogramPoint | undefined = point?.datum;
      if (point === undefined || datum === undefined) {
        return undefined;
      }
      return {
        title: `${format(datum.x0)} – ${format(datum.x1)}`,
        rows: datum.series.map((s) => ({ color: s.color, label: s.label, value: s.count })),
        point: datum,
        index: point.datumIndex,
      };
    },
    tooltipProps,
    overlay: null,
  };
}
