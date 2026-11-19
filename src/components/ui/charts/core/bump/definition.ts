import { defineChart, dot, lineY, text } from "@tanstack/charts";
import type { ChartPoint } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { focusNearestX } from "@tanstack/charts/focus";
import { scalePoint } from "@tanstack/charts/scales/point";
import { curveBumpX } from "d3-shape";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { decimalFormat } from "../error-bar/definition";
import { memoCell } from "../memo";
import { CHART_PALETTE } from "../palette";
import { scaleLinear } from "../scales";
import { bklitTheme, DEFAULT_MARGIN, parseAspectRatio, X_TICK_PADDING } from "../theme";
import type { BarXAxisProps, BarYAxisProps } from "../types/bar";
import type { BumpChartProps, BumpProps } from "../types/bump";
import type { GridGuideProps } from "../cartesian/grid-guides";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import { hoverDimCss, legendDimCss, PLOT_POP_KEYFRAMES, PLOT_WIPE_KEYFRAMES, popInCss, wipeInCss } from "../plot/css";
import { categoryDomain, focusCopy, itemKey, plotEnter, plotTooltip, scaleGrid, TICK_LABELS } from "../plot/definition";
import { skeletonBetween, skeletonSeed } from "../plot/loading";
import type { PlotSkeleton, SkeletonPoint, SkeletonShape } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { describeBump } from "../plot/describe";
import { seriesTextColor } from "../theme";

/** The props a BumpChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type BumpInput = Omit<BumpChartProps<unknown, unknown>, "className" | "style" | "children">;

/** One series at one period. */
interface Spot {
  readonly series: number;
  readonly period: number;
  readonly rank: number;
  readonly value: number;
}

interface Series {
  readonly index: number;
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly spots: readonly Spot[];
}

const numberOf = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

const DOTS = "bump-dots";

/** Each period's ranks: the series ordered by value (ties keep declaration order), or the values themselves when they are ranks. */
function rank(data: readonly PlotDatum[], series: readonly BumpProps[], rankBy: BumpInput["rankBy"]): Spot[][] {
  const out: Spot[][] = series.map(() => []);
  for (const [period, row] of data.entries()) {
    const values = series.map((s, i) => ({ i, value: numberOf(row[s.dataKey]) })).filter((v) => Number.isFinite(v.value));
    if (rankBy === "none") {
      for (const { i, value } of values) {
        out[i]?.push({ series: i, period, rank: value, value });
      }
      continue;
    }
    const ordered = values.toSorted((a, b) => (rankBy === "ascending" ? a.value - b.value : b.value - a.value));
    for (const [position, { i, value }] of ordered.entries()) {
      out[i]?.push({ series: i, period, rank: position + 1, value });
    }
  }
  return out;
}

/** Skeleton series and periods when the chart has none yet. */
const SKELETON_SERIES = 4;
const SKELETON_PERIODS = 6;
/** The x scale's outer padding, in steps (the chart's `scalePoint().padding(0.1)`). */
const POINT_PADDING = 0.1;

/** The loading skeleton: a line per series through seeded ranks (neighbours trading places from period to period) on the bump curve,
 * its dots, and a pill where its name goes when the margin has room for one. */
const bumpSkeleton = (series: number, periods: number, width: number, labelRoom: number): PlotSkeleton => {
  const k = series > 0 ? series : SKELETON_SERIES;
  const p = periods > 0 ? periods : SKELETON_PERIODS;
  // Each period's order: the last one's, with a seeded pair of neighbours swapped.
  const orders: number[][] = [Array.from({ length: k }, (_, s) => s)];
  for (let j = 1; j < p; j += 1) {
    const order = [...(orders[j - 1] ?? [])];
    // Every other neighbour pair, from a seeded start, may trade places.
    for (let a = Math.floor(skeletonSeed(j, 41) * 2); a + 1 < k; a += 2) {
      if (skeletonSeed(j * 13 + a, 43) < 0.42) {
        [order[a], order[a + 1]] = [order[a + 1] ?? a + 1, order[a] ?? a];
      }
    }
    orders.push(order);
  }
  // placesOf[s][j]: series s's place in period j.
  const placesOf = Array.from({ length: k }, (_, s) => orders.map((order) => order.indexOf(s)));
  return ({ width: w, height: h }) => {
    const step = w / Math.max(1, p - 1 + POINT_PADDING * 2);
    const x = (j: number): number => (p === 1 ? w / 2 : step * (POINT_PADDING + j));
    const y = (r: number): number => (h * (r + 0.5)) / k;
    const shapes: SkeletonShape[] = [];
    for (const [s, places] of placesOf.entries()) {
      const points = places.map((r, j): SkeletonPoint => [x(j), y(r)]);
      shapes.push({ kind: "line", points, width, curve: "bump", tone: 0.8 });
      for (const [px, py] of points) {
        shapes.push({ kind: "dot", x: px, y: py, r: width + 2.5 });
      }
      const end = points.at(-1);
      if (labelRoom >= 56 && end !== undefined) {
        shapes.push({ kind: "rect", x: end[0] + width + 12, y: end[1] - 4, width: Math.min(labelRoom - width - 24, skeletonBetween(s, 36, 72, 43)), height: 8, radius: 4, tone: 0.7 });
      }
    }
    return shapes;
  };
};

function createBumpBuilder(): PlotFamily<BumpInput>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<BumpInput>): PlotBuild => {
    const bumps = propsFor<BumpProps>(table, "bump");
    const grid = propsFor<GridGuideProps>(table, "grid").at(0);
    const xAxis = propsFor<BarXAxisProps>(table, "barXAxis").at(0);
    const yAxis = propsFor<BarYAxisProps>(table, "barYAxis").at(0);
    const tooltip = propsFor<TooltipBoxMotionProps>(table, "tooltip").at(0);
    return cell([props, bumps, grid, xAxis, yAxis, tooltip], () => {
      const xKey = props.xDataKey ?? "period";
      const periods = props.data.map((row) => String(row[xKey] ?? ""));
      const ranks = rank(props.data, bumps, props.rankBy ?? "descending");
      const series: Series[] = bumps.map((b, index) => ({
        index,
        key: b.dataKey,
        label: b.label ?? b.dataKey,
        color: b.color ?? CHART_PALETTE[index % CHART_PALETTE.length] ?? "var(--chart-1)",
        spots: ranks[index] ?? [],
      }));
      const maxRank = Math.max(1, ...series.flatMap((s) => s.spots.map((p) => p.rank)));
      const showLabels = props.showLabels !== false;
      const longest = Math.max(0, ...series.map((s) => s.label.length));
      const margin = {
        ...DEFAULT_MARGIN,
        left: yAxis === undefined ? 24 : DEFAULT_MARGIN.left,
        right: showLabels ? Math.min(160, 24 + longest * 7) : 24,
        ...props.margin,
      };
      const enter = plotEnter(props);
      const curve = d3Curve(curveBumpX);
      const x = (p: Spot): string => String(p.period);
      const marks: object[] = [];
      const copies: object[] = [];
      const groups: string[][] = [];
      const popDelays: [string, number[]][] = [];
      for (const s of series) {
        const width = bumps[s.index]?.strokeWidth ?? 3;
        const line = (id: string, opacity: number) =>
          lineY(s.spots, { id, x, y: (p) => p.rank, z: () => s.key, key: () => itemKey(s.index), stroke: s.color, strokeOpacity: opacity, strokeWidth: width, curve, motion: false });
        const dots = (id: string) =>
          dot(s.spots, { id, x, y: (p) => p.rank, z: () => s.key, key: (p) => `${itemKey(s.index)}p${p.period}`, r: width + 2.5, fill: s.color, stroke: "var(--chart-background)", strokeWidth: 2, motion: false });
        const lineId = `bump-line-${s.index}`;
        const dotsId = `${DOTS}-${s.index}`;
        marks.push(line(lineId, 1), dots(dotsId));
        copies.push(focusCopy(line(`${lineId}-hover`, 1), "series"), focusCopy(dots(`${dotsId}-hover`), "series"));
        const ids = [lineId, dotsId];
        const last = s.spots.at(-1);
        if (showLabels && last !== undefined) {
          const labelId = `bump-label-${s.index}`;
          const label = (id: string, weight: number) =>
            text([last], { id, x, y: (p) => p.rank, z: () => s.key, text: () => s.label, key: () => itemKey(s.index), fill: seriesTextColor(s.color), fontSize: 12, fontWeight: weight, anchor: "start", dx: width + 12, motion: false });
          marks.push(label(labelId, 500));
          copies.push(focusCopy(label(`${labelId}-hover`, 600), "series"));
          ids.push(labelId);
        }
        groups.push(ids);
        popDelays.push([dotsId, s.spots.map((p) => (periods.length <= 1 ? 0 : (p.period / (periods.length - 1)) * enter.durationMs * 0.85))]);
      }
      // A hover takes the nearest dot of any series and lights its series.
      const isDot = (p: ChartPoint): boolean => p.markId.startsWith(`${DOTS}-`) && !p.markId.endsWith("-hover");
      const focus = {
        ...focusNearestX,
        resolve: (points: readonly ChartPoint[], context: { readonly x: number; readonly y: number }): ChartPoint[] => {
          let best: ChartPoint | undefined;
          let distance = Number.POSITIVE_INFINITY;
          for (const p of points) {
            if (isDot(p)) {
              const d = Math.hypot(p.x - context.x, (p.y - context.y) * 1.4);
              if (d < distance) {
                distance = d;
                best = p;
              }
            }
          }
          // Anywhere in the plot (the margins with the names included): the focus never drops between lines, so a sweep keeps the dim.
          const { width, height } = size.get();
          const outside = width > 0 && (context.x < margin.left - 12 || context.x > width - 4 || context.y < margin.top - 12 || context.y > height - margin.bottom + 12);
          return best === undefined || outside ? [] : [best];
        },
        group: (_points: readonly ChartPoint[], context: { readonly point: ChartPoint }): ChartPoint[] => [context.point],
        navigation: (points: readonly ChartPoint[]): ChartPoint[] => points.filter(isDot).toSorted((a, b) => a.x - b.x || a.y - b.y),
      };
      const rankFormat = (value: number): string => `#${value}`;
      const definition = defineChart(erase({
        chart: ({ width, height }: { readonly width: number; readonly height: number }) => {
          size.set(width, height);
          return {
            marks: [...marks, ...copies],
            scales: {
              x: {
                scale: scalePoint<string>().domain(categoryDomain(periods.length)).padding(0.1),
                grid: scaleGrid(grid === undefined ? undefined : { ...grid, vertical: grid.vertical ?? true }, "x"),
                axis: xAxis === undefined ? false : { line: false, ticks: { size: 0, padding: X_TICK_PADDING, format: (v: string): string => periods[Number(v)] ?? v }, tickLabels: TICK_LABELS },
              },
              y: {
                scale: scaleLinear().domain([0.5, maxRank + 0.5]),
                reverse: true,
                grid: false,
                axis: yAxis === undefined ? false : { line: false, ticks: { values: Array.from({ length: maxRank }, (_, i) => i + 1), size: 0, padding: 12, format: yAxis.formatValue ?? rankFormat }, tickLabels: TICK_LABELS },
              },
            },
            margin,
            theme: bklitTheme,
          };
        },
        focus,
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(tooltip, "point", {}),
      }));
      const items: PlotItem[] = series.map((s) => {
        const format = bumps[s.index]?.formatValue ?? decimalFormat;
        const valued = props.rankBy !== "none";
        return {
          datum: { series: s.label, ranks: s.spots.map((p) => p.rank) },
          index: s.index,
          title: s.label,
          rows: s.spots.map((p, i) => ({ color: i === s.spots.length - 1 ? s.color : "transparent", label: periods[p.period] ?? "", value: valued ? `#${p.rank} · ${format(p.value)}` : `#${p.rank}` })),
        };
      });
      const spotSeries = new Map<unknown, number>(series.flatMap((s) => s.spots.map((p) => [p, s.index] as const)));
      const css = [
        // A series' line can be flat (one rank throughout): it dims by its stroke (a group opacity over empty bounds paints garbage).
        hoverDimCss(scope, groups.flat().map((id) => (id.startsWith("bump-line-") ? { id, dim: 0.18, lines: {} } : { id, dim: 0.18 }))),
        legendDimCss(scope, groups),
        enter.animate
          ? `${PLOT_WIPE_KEYFRAMES}${PLOT_POP_KEYFRAMES}${wipeInCss(scope, enter.durationMs)}${popDelays.map(([id, delays]) => popInCss(scope, id, "circle", delays)).join("")}`
          : "",
      ].join("");
      return {
        definition,
        items,
        itemOf: (datum) => spotSeries.get(datum) ?? -1,
        margin,
        box: { aspectRatio: parseAspectRatio(props.aspectRatio ?? "2 / 1") },
        describe: () => describeBump(props.data, xKey, table),
        ariaLabel: props.ariaLabel ?? "Bump chart",
        ariaDescription: props.ariaDescription,
        css,
        chrome: null,
        skeleton: bumpSkeleton(bumps.length, periods.length, bumps[0]?.strokeWidth ?? 3, showLabels ? margin.right : 0),
      };
    });
  };
}

/** The bump family on the shared plot controller (core/plot/controller.ts). */
export const bumpFamily = (): PlotFamily<BumpInput> => ({ chart: "bump", build: createBumpBuilder() });
