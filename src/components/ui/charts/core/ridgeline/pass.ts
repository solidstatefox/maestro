import type { SceneNode } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { propsFor } from "../carriers/table";
import type { DistributionPass, DistributionPassInput } from "../distribution/controller";
import { categoriesOf } from "../distribution/category";
import { distributionCss, groupClass } from "../distribution/css";
import { densityProfiles, quantile, smoothPath, trimProfile } from "../distribution/density";
import { bandFocus, categoryLabelRoom, finite, formatTooltipValue, gridOn, interactionOptions, plotMargin, seriesColor, valueAxis } from "../distribution/frame";
import { distributionMark, px } from "../distribution/marks";
import type { MarkScales } from "../distribution/marks";
import { SKELETON_INK, SKELETON_TINT, seeded, skeletonProfile } from "../distribution/skeleton";
import { erase } from "../erased-types";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { RidgelineAxisProps, RidgelineChartProps, RidgelinePoint, RidgelineProps } from "../types/ridgeline";
import { describeSamples } from "../distribution/describe";

/** The props a RidgelineChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type RidgelineControllerProps = Omit<RidgelineChartProps<unknown, unknown>, "children" | "className" | "style">;

const DEFAULT_ENTER_MS = 1100;
/** The skeleton's rows without data. */
const SKELETON_ROWS = 5;

export function ridgelinePass({ props, table, uid, live, phase }: DistributionPassInput<RidgelineControllerProps>): DistributionPass {
  const carrier = propsFor<RidgelineProps>(table, "ridgeline").at(0);
  const xAxis = propsFor<RidgelineAxisProps>(table, "ridgelineXAxis").at(0);
  const yAxis = propsFor<RidgelineAxisProps>(table, "ridgelineYAxis").at(0);
  const grid = propsFor<GridGuideProps>(table, "grid").at(0);
  const tooltipProps = propsFor<Readonly<Record<string, unknown>>>(table, "ridgelineTooltip").at(0) ?? null;
  const categories = categoriesOf(props.data, props.categoryKey);
  const index = new Map(categories.map((category, i) => [category, i]));
  const values = categories.map((): number[] => []);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  if (carrier !== undefined) {
    for (const row of props.data) {
      const c = index.get(String(row[props.categoryKey]));
      const v = finite(row[carrier.dataKey]);
      if (c !== undefined && v !== null) {
        values[c]?.push(v);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  for (const list of values) {
    list.sort((a, b) => a - b);
  }
  const extent: [number, number] = Number.isFinite(lo) ? [lo, hi] : [0, 1];
  const x = scaleLinear().domain(props.domain === undefined ? extent : [props.domain[0], props.domain[1]]);
  if (props.domain === undefined) {
    x.nice(xAxis?.numTicks ?? 5);
  }
  const xDomain = x.domain();
  const profiles = densityProfiles(values, extent[0], extent[1], props.bins ?? 32);
  const overlap = Math.max(0.2, props.overlap ?? 1.6);
  const colorOf = (c: number): string => (carrier?.fill === undefined ? seriesColor(undefined, c) : carrier.fill);
  const points: RidgelinePoint[] = categories.map((category, c) => {
    const list = values[c] ?? [];
    return { category, color: colorOf(c), count: list.length, min: list[0] ?? 0, q1: quantile(list, 0.25), median: quantile(list, 0.5), q3: quantile(list, 0.75), max: list.at(-1) ?? 0 };
  });
  const margin = plotMargin(props.margin, { left: yAxis === undefined ? 16 : categoryLabelRoom(categories), bottom: xAxis === undefined ? 16 : 36 });
  const enterMs = props.animationDuration ?? DEFAULT_ENTER_MS;
  const staggerMs = categories.length > 1 ? Math.min(110, (enterMs * 0.45) / categories.length) : 0;
  const format = formatTooltipValue(erase(tooltipProps?.formatValue), xAxis);
  const strokeWidth = carrier?.strokeWidth ?? 1.5;
  const animate = carrier?.animate !== false;

  // Rows top to bottom: the last baseline sits on the plot's bottom, the first leaves room for its peak.
  const rowsOf = (chart: MarkScales["chart"], rows: number): { readonly step: number; readonly peak: number; readonly baseline: (c: number) => number } => {
    const step = (chart.height - 2) / Math.max(1, rows - 1 + overlap);
    const peak = overlap * step;
    return { step, peak, baseline: (c: number): number => chart.y + peak + c * step };
  };
  // Behind the ridges: each row's label at its baseline (the category axis), when there is one.
  const labels = (chart: MarkScales["chart"], baseline: (c: number) => number): SceneNode[] =>
    yAxis === undefined || categories.length === 0
      ? []
      : [{
          kind: "group",
          key: "labels",
          className: "bkm-d-labels",
          children: categories.map((category, c) => ({ kind: "label", key: `l${c}`, x: chart.x - 10, y: px(baseline(c)), text: category, anchor: "end", baseline: "middle", fontSize: 12, style: { fill: "var(--chart-label)" } })),
        }];

  const mark = distributionMark<RidgelinePoint>({
    id: "ridgeline",
    live,
    phase,
    x: xDomain,
    y: [0, 1],
    layout: ({ x: xs, chart }) => {
      const { step, peak, baseline } = rowsOf(chart, categories.length);
      const nodes: SceneNode[] = labels(chart, baseline);
      for (const [c, profile] of profiles.entries()) {
        const point = points[c];
        if (point === undefined || profile.at.length === 0) {
          continue;
        }
        const y0 = baseline(c);
        const keep = trimProfile(profile, xDomain[0], xDomain[1]);
        const top = keep.map((p): [number, number] => [xs.map(p.at), y0 - p.h * peak]);
        const first = top[0];
        const last = top.at(-1);
        if (first === undefined || last === undefined) {
          continue;
        }
        const outline = smoothPath(top, false);
        const fill = `${outline}L${px(last[0])},${px(y0)}L${px(first[0])},${px(y0)}Z`;
        nodes.push({
          kind: "group",
          key: `r${c}`,
          className: groupClass(c, null, animate ? "grow" : null),
          children: [
            { kind: "area", key: "fill", className: "bkm-d-s bkm-d-s0", points: [...top, [last[0], y0], [first[0], y0]], path: fill, style: { fill: `color-mix(in oklab, ${point.color} 28%, var(--chart-background))` } },
            { kind: "polyline", key: "line", className: "bkm-d-s bkm-d-s0", points: top, path: outline, style: { stroke: point.color, strokeWidth, fill: "none", lineJoin: "round", lineCap: "round" } },
          ],
        });
      }
      return {
        nodes,
        points: points.map((datum, c) => ({ key: `r${c}`, datum, index: c, x: xs.map(datum.max), y: baseline(c) - step / 2, xValue: datum.median, yValue: datum.category, color: datum.color, label: datum.category })),
      };
    },
    // A seeded ridge per row, back to front as the chart draws them: an opaque tint under an outline, so each hides the ones behind.
    skeleton: ({ chart }) => {
      const rows = categories.length > 0 ? categories.length : SKELETON_ROWS;
      const { peak, baseline } = rowsOf(chart, rows);
      const random = seeded(rows * 23);
      const shapes = Array.from({ length: rows }, (_unused, c): SceneNode => {
        const y0 = baseline(c);
        const top = skeletonProfile(random, 32).map((p): [number, number] => [chart.x + p.t * chart.width, y0 - p.h * peak]);
        const first = top[0] ?? [chart.x, y0];
        const last = top.at(-1) ?? [chart.x + chart.width, y0];
        const outline = smoothPath(top, false);
        return {
          kind: "group",
          key: `r${c}`,
          children: [
            { kind: "area", key: "fill", points: [...top, [last[0], y0], [first[0], y0]], path: `${outline}L${px(last[0])},${px(y0)}L${px(first[0])},${px(y0)}Z`, style: { fill: SKELETON_TINT } },
            { kind: "polyline", key: "line", points: top, path: outline, style: { stroke: SKELETON_INK, strokeWidth, fill: "none", lineJoin: "round", lineCap: "round" } },
          ],
        };
      });
      return { shapes, chrome: labels(chart, baseline) };
    },
  });

  const definition = defineChart(
    erase({
      chart: () => ({
        marks: [mark],
        scales: {
          x: { scale: x, grid: gridOn(grid, "columns"), axis: valueAxis(xAxis, "x") },
          y: { scale: scaleLinear().domain([0, 1]), grid: false, axis: false },
        },
        margin,
        theme: bklitTheme,
      }),
      ...interactionOptions(bandFocus("y", live), tooltipProps !== null, "point"),
    }),
  );

  return {
    definition,
    aspectRatio: parseAspectRatio(props.aspectRatio),
    margin,
    describe: () => describeSamples("Ridgeline chart", props.data, carrier === undefined ? [] : [carrier], props.categoryKey, format),
    ariaLabel: props.ariaLabel,
    ariaDescription: props.ariaDescription,
    css: distributionCss({ uid, items: categories.length, faded: [carrier?.fadedOpacity ?? 0.3], enterMs, staggerMs, dimItems: "index" }),
    hoverIndex: (point) => point.datumIndex,
    tooltip: (focused) => {
      const point = focused.at(0);
      const datum: RidgelinePoint | undefined = point?.datum;
      if (point === undefined || datum === undefined) {
        return undefined;
      }
      return {
        title: datum.category,
        rows: [
          { color: datum.color, label: "Median", value: format(datum.median) },
          { color: datum.color, label: "Middle half", value: `${format(datum.q1)} – ${format(datum.q3)}` },
          { color: datum.color, label: "Observations", value: datum.count },
        ],
        point: datum,
        index: point.datumIndex,
      };
    },
    tooltipProps,
    overlay: null,
  };
}
