import type { SceneNode } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { propsFor } from "../carriers/table";
import type { DistributionPass, DistributionPassInput } from "../distribution/controller";
import { distributionCss, groupClass } from "../distribution/css";
import { bandFocus, finite, formatTooltipValue, gridOn, interactionOptions, plotMargin, seriesColor, valueAxis, valueLabelRoom } from "../distribution/frame";
import { distributionMark, px } from "../distribution/marks";
import { seededNormal } from "../distribution/skeleton";
import type { OverlayDotAt } from "../distribution/overlay";
import { erase } from "../erased-types";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { EcdfAxisProps, EcdfChartProps, EcdfPoint, EcdfProps } from "../types/ecdf";
import { describeSamples } from "../distribution/describe";

/** The props an EcdfChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type EcdfControllerProps = Omit<EcdfChartProps<unknown, unknown>, "children" | "className" | "style">;

const DEFAULT_ENTER_MS = 1100;
/** The skeleton's steps per staircase. */
const SKELETON_STEPS = 18;
const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

/** How many of ascending `sorted` are at or below `value`. */
const countAtOrBelow = (sorted: readonly number[], value: number): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};

export function ecdfPass({ props, table, uid, live, phase }: DistributionPassInput<EcdfControllerProps>): DistributionPass {
  const carriers = propsFor<EcdfProps>(table, "ecdf");
  const xAxis = propsFor<EcdfAxisProps>(table, "ecdfXAxis").at(0);
  const yAxisGiven = propsFor<EcdfAxisProps>(table, "ecdfYAxis").at(0);
  const yAxis: EcdfAxisProps | undefined = yAxisGiven === undefined ? undefined : { ...yAxisGiven, formatValue: yAxisGiven.formatValue ?? percent };
  const grid = propsFor<GridGuideProps>(table, "grid").at(0);
  const tooltipProps = propsFor<Readonly<Record<string, unknown>>>(table, "ecdfTooltip").at(0) ?? null;
  const series = carriers.map((c, n) => ({
    label: c.label ?? c.dataKey,
    color: seriesColor(c.stroke ?? c.fill, n),
    width: c.strokeWidth ?? 2,
    area: c.showArea === true,
    animate: c.animate !== false,
    faded: c.fadedOpacity ?? 0.3,
    values: props.data.map((row) => finite(row[c.dataKey])).filter((v): v is number => v !== null).toSorted((a, b) => a - b),
  }));
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    lo = Math.min(lo, s.values[0] ?? lo);
    hi = Math.max(hi, s.values.at(-1) ?? hi);
  }
  const x = scaleLinear().domain(props.domain === undefined ? (Number.isFinite(lo) ? [lo, hi] : [0, 1]) : [props.domain[0], props.domain[1]]);
  if (props.domain === undefined) {
    x.nice(xAxis?.numTicks ?? 5);
  }
  const xDomain = x.domain();
  // The probes: every distinct observed value inside the domain, ascending (the steps' corners).
  const probes = [...new Set(series.flatMap((s) => s.values))].filter((v) => v >= xDomain[0] && v <= xDomain[1]).toSorted((a, b) => a - b);
  const points: EcdfPoint[] = probes.map((value) => ({
    value,
    series: series.map((s) => {
      const count = countAtOrBelow(s.values, value);
      return { label: s.label, color: s.color, share: s.values.length === 0 ? 0 : count / s.values.length, count, total: s.values.length };
    }),
  }));
  const percentiles = (props.percentiles ?? []).filter((p) => p > 0 && p < 1);
  const margin = plotMargin(props.margin, { left: yAxis === undefined ? 16 : valueLabelRoom([0, 1], yAxis), bottom: xAxis === undefined ? 16 : 36 });
  const enterMs = props.animationDuration ?? DEFAULT_ENTER_MS;
  const format = formatTooltipValue(erase(tooltipProps?.formatValue), xAxis);
  // The overlay's dots for each probe, as the latest draw laid them out.
  let dotsAt: OverlayDotAt[][] = [];

  const mark = distributionMark<EcdfPoint>({
    id: "ecdf",
    live,
    phase,
    x: xDomain,
    y: [0, 1],
    layout: ({ x: xs, y: ys, chart }) => {
      const left = chart.x;
      const right = chart.x + chart.width;
      const base = ys.map(0);
      const nodes: SceneNode[] = percentiles.map((p, i): SceneNode => ({
        kind: "group",
        key: `ecdf:p${i}`,
        className: "bkm-d-guide",
        children: [
          { kind: "rule", key: "rule", x1: left, x2: right, y1: px(ys.map(p)), y2: px(ys.map(p)), style: { stroke: "var(--chart-crosshair)", strokeWidth: 1, strokeDasharray: "3 4" } },
          { kind: "label", key: "label", x: right - 2, y: px(ys.map(p)) - 6, text: `p${Math.round(p * 100)}`, anchor: "end", fontSize: 11, style: { fill: "var(--chart-label)", stroke: "var(--chart-background)", strokeWidth: 2.5, lineJoin: "round" } },
        ],
      }));
      for (const [n, s] of series.entries()) {
        if (s.values.length === 0) {
          continue;
        }
        // The step: flat from the plot's left edge at the share below the domain, up 1/n at each observation inside it, flat to the right
        // edge at the share of the last one (observations past a given domain end the line at the edge, as a clipped plot would).
        const n0 = countAtOrBelow(s.values, xDomain[0] - Number.EPSILON);
        let share = n0 / s.values.length;
        const step: [number, number][] = [[left, px(ys.map(share))]];
        for (let i = n0; i < s.values.length; i += 1) {
          const v = s.values[i] ?? 0;
          if (v > xDomain[1]) {
            break;
          }
          const at = px(xs.map(v));
          step.push([at, px(ys.map(share))]);
          // Ties step once, to the share past the last of them.
          if (s.values[i + 1] === v) {
            continue;
          }
          share = (i + 1) / s.values.length;
          step.push([at, px(ys.map(share))]);
        }
        step.push([right, px(ys.map(share))]);
        const children: SceneNode[] = [];
        if (s.area) {
          children.push({ kind: "area", key: "area", className: `bkm-d-s bkm-d-s${n}`, points: [...step, [right, base], [left, base]], style: { fill: s.color, fillOpacity: 0.1 } });
        }
        children.push({ kind: "polyline", key: "line", className: `bkm-d-s bkm-d-s${n}`, points: step, style: { stroke: s.color, strokeWidth: s.width, fill: "none", lineJoin: "round", lineCap: "round" } });
        nodes.push({ kind: "group", key: `ecdf:s${n}`, className: groupClass(null, null, s.animate ? "wipe" : null), children });
      }
      dotsAt = points.map((point) => point.series.map((s) => ({ x: xs.map(point.value), y: ys.map(s.share), color: s.color })));
      return {
        nodes,
        points: points.map((datum, i) => ({ key: `v${i}`, datum, index: i, x: xs.map(datum.value), y: chart.y, xValue: datum.value, yValue: datum.series[0]?.share ?? 0, color: series[0]?.color ?? "currentColor" })),
      };
    },
    // A staircase per series (up to three), each over seeded bell-shaped values a little right of the one before: the S an ECDF draws.
    skeleton: ({ chart }) => {
      const lines = Math.min(3, Math.max(1, series.length));
      const normal = seededNormal(lines * 7 + SKELETON_STEPS);
      const left = chart.x;
      const right = chart.x + chart.width;
      const yOf = (share: number): number => px(chart.y + chart.height * (1 - share));
      return {
        shapes: Array.from({ length: lines }, (_unused, k): SceneNode[] => {
          const values = Array.from({ length: SKELETON_STEPS }, () => Math.min(0.97, Math.max(0.03, 0.4 + k * 0.12 + normal() * 0.17))).toSorted((a, b) => a - b);
          const step: [number, number][] = [[left, yOf(0)]];
          for (const [i, v] of values.entries()) {
            const at = px(left + v * chart.width);
            step.push([at, yOf(i / SKELETON_STEPS)], [at, yOf((i + 1) / SKELETON_STEPS)]);
          }
          step.push([right, yOf(1)]);
          const line: SceneNode = { kind: "polyline", key: `s${k}`, points: step, style: { strokeWidth: Math.max(2.5, series[k]?.width ?? 2), lineJoin: "round", lineCap: "round" } };
          // A series with its soft area keeps it, as the chart draws it.
          return series[k]?.area === true ? [{ kind: "area", key: `s${k}:area`, points: [...step, [right, yOf(0)], [left, yOf(0)]], style: { fillOpacity: 0.16 } }, line] : [line];
        }).flat(),
      };
    },
  });

  const definition = defineChart(
    erase({
      chart: () => ({
        marks: [mark],
        scales: {
          x: { scale: x, grid: gridOn(grid, "columns"), axis: valueAxis(xAxis, "x") },
          y: { scale: scaleLinear().domain([0, 1]), grid: gridOn(grid, "rows"), axis: valueAxis(yAxis, "y") },
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
    describe: () => describeSamples("Cumulative distribution chart", props.data, carriers, undefined, format),
    ariaLabel: props.ariaLabel,
    ariaDescription: props.ariaDescription,
    css: `${distributionCss({ uid, items: series.length, faded: series.map((s) => s.faded), enterMs, staggerMs: 0, dimItems: false })}[data-bkm-d="${uid}"] .bkm-d-guide{pointer-events:none}`,
    hoverIndex: () => null,
    tooltip: (focused) => {
      const point = focused.at(0);
      const datum: EcdfPoint | undefined = point?.datum;
      if (point === undefined || datum === undefined) {
        return undefined;
      }
      return { title: `≤ ${format(datum.value)}`, rows: datum.series.map((s) => ({ color: s.color, label: s.label, value: percent(s.share) })), point: datum, index: point.datumIndex };
    },
    tooltipProps,
    overlay: { crosshair: true, dots: (point) => dotsAt[point.datumIndex] ?? [] },
  };
}
