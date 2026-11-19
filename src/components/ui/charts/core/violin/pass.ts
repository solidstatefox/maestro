import type { SceneNode } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import { propsFor } from "../carriers/table";
import type { DistributionPass, DistributionPassInput } from "../distribution/controller";
import { categoriesOf, categoryFrame } from "../distribution/category";
import { distributionCss, groupClass } from "../distribution/css";
import { densityProfiles, quantile, smoothPath, trimProfile } from "../distribution/density";
import { bandFocus, finite, formatTooltipValue, interactionOptions, seriesColor } from "../distribution/frame";
import { bandOf, distributionMark, oriented } from "../distribution/marks";
import { seeded, skeletonBands, skeletonProfile } from "../distribution/skeleton";
import { erase } from "../erased-types";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { TooltipRow } from "../types/tooltip";
import type { ViolinChartProps, ViolinPoint, ViolinProps, ViolinSummary } from "../types/violin";
import { describeSamples } from "../distribution/describe";

/** The props a ViolinChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type ViolinControllerProps = Omit<ViolinChartProps<unknown, unknown>, "children" | "className" | "style">;

interface Series {
  readonly label: string;
  readonly color: string;
  readonly width: number;
  readonly box: boolean;
  readonly animate: boolean;
  readonly faded: number;
}

const DEFAULT_ENTER_MS = 1100;
const MAX_VIOLIN_PX = 140;
/** The skeleton's categories without data. */
const SKELETON_CATEGORIES = 4;

export function violinPass({ props, table, uid, live, phase }: DistributionPassInput<ViolinControllerProps>): DistributionPass {
  const carriers = propsFor<ViolinProps>(table, "violin");
  const tooltipProps = propsFor<Readonly<Record<string, unknown>>>(table, "violinTooltip").at(0) ?? null;
  const series: Series[] = carriers.map((c, n) => ({
    label: c.label ?? c.dataKey,
    color: seriesColor(c.fill, n),
    width: Math.min(1, Math.max(0.1, c.violinWidth ?? 0.9)),
    box: c.showBox !== false,
    animate: c.animate !== false,
    faded: c.fadedOpacity ?? 0.3,
  }));
  const categories = categoriesOf(props.data, props.categoryKey);
  const index = new Map(categories.map((category, i) => [category, i]));
  // values[series][category]: ascending observations.
  const values = carriers.map(() => categories.map((): number[] => []));
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const row of props.data) {
    const c = index.get(String(row[props.categoryKey]));
    if (c === undefined) {
      continue;
    }
    for (const [n, carrier] of carriers.entries()) {
      const v = finite(row[carrier.dataKey]);
      if (v !== null) {
        values[n]?.[c]?.push(v);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  for (const list of values.flat()) {
    list.sort((a, b) => a - b);
  }
  const extent: [number, number] = Number.isFinite(lo) ? [lo, hi] : [0, 1];
  const frame = categoryFrame({ categories, orientation: props.orientation, table, xRole: "violinXAxis", yRole: "violinYAxis", extent, domain: props.domain, margin: props.margin, paddingInner: 0.12, paddingOuter: 0.06, pad: 0.1 });
  const { horizontal } = frame;
  const shape = oriented(horizontal);
  // One profile per (series, category), on bins shared by all of them.
  const flat = values.flat();
  const profiles = densityProfiles(flat, extent[0], extent[1], props.bins ?? 28);
  const profileOf = (n: number, c: number) => profiles[n * categories.length + c];
  const points: ViolinPoint[] = categories.map((category, c) => ({
    category,
    series: series.flatMap((s, n): ViolinSummary[] => {
      const list = values[n]?.[c] ?? [];
      return list.length === 0
        ? []
        : [{ label: s.label, color: s.color, count: list.length, min: list[0] ?? 0, q1: quantile(list, 0.25), median: quantile(list, 0.5), q3: quantile(list, 0.75), max: list.at(-1) ?? 0 }];
    }),
  }));
  const enterMs = props.animationDuration ?? DEFAULT_ENTER_MS;
  const staggerMs = categories.length > 1 ? Math.min(90, (enterMs * 0.4) / categories.length) : 0;
  const format = formatTooltipValue(erase(tooltipProps?.formatValue), frame.valueAxisProps);

  const mark = distributionMark<ViolinPoint>({
    id: "violin",
    live,
    phase,
    x: horizontal ? frame.valueDomain : categories,
    y: horizontal ? categories : frame.valueDomain,
    layout: ({ x, y }) => {
      const band = horizontal ? y : x;
      const value = horizontal ? x : y;
      const nodes: SceneNode[] = [];
      const placed = points.map((point, c) => {
        const { start, width } = bandOf(band, point.category);
        const slot = width / Math.max(1, series.length);
        const children: SceneNode[] = [];
        for (const [n, s] of series.entries()) {
          const summary = point.series.find((candidate) => candidate.label === s.label && candidate.color === s.color);
          const profile = profileOf(n, c);
          if (summary === undefined || profile === undefined || profile.at.length === 0) {
            continue;
          }
          const center = start + slot * (n + 0.5);
          const half = Math.min(slot * s.width, MAX_VIOLIN_PX) / 2;
          const cls = `bkm-d-s bkm-d-s${n}`;
          // Cut to where the profile has height, closing on the centre line at both ends.
          const keep = trimProfile(profile, frame.valueDomain[0], frame.valueDomain[1]);
          const right = keep.map((p): [number, number] => { const at = shape.at(center + p.h * half, value.map(p.at)); return [at.x, at.y]; });
          const left = keep.toReversed().map((p): [number, number] => { const at = shape.at(center - p.h * half, value.map(p.at)); return [at.x, at.y]; });
          const outline = [...right, ...left];
          children.push({ kind: "area", key: `s${n}:body`, className: cls, points: outline, path: smoothPath(outline, true), style: { fill: s.color } });
          if (s.box) {
            const bar = Math.max(3, Math.min(10, half * 0.16));
            const ink = "var(--chart-background)";
            const q1 = value.map(summary.q1);
            const q3 = value.map(summary.q3);
            const median = shape.at(center, value.map(summary.median));
            children.push(
              { kind: "rule", key: `s${n}:range`, className: cls, ...shape.along(center, value.map(summary.min), value.map(summary.max)), style: { stroke: ink, strokeWidth: 1, strokeOpacity: 0.7, lineCap: "round" } },
              { kind: "rect", key: `s${n}:iqr`, className: cls, ...shape.rect(center - bar / 2, center + bar / 2, q1, q3), radius: bar / 2, style: { fill: ink } },
              { kind: "dot", key: `s${n}:median`, className: cls, x: median.x, y: median.y, radius: Math.max(2, bar / 2 - 1), style: { fill: s.color } },
            );
          }
        }
        if (children.length > 0) {
          nodes.push({ kind: "group", key: `c${c}`, className: groupClass(c, null, series.some((s) => s.animate) ? (horizontal ? "unfoldy" : "unfoldx") : null), children });
        }
        const first = point.series[0];
        // A horizontal violin's tooltip sits past its right tip, a vertical one's beside its band.
        const at = shape.at(start + width / 2, value.map((horizontal ? first?.max : first?.median) ?? 0));
        return { key: `c${c}`, datum: point, index: c, x: at.x, y: at.y, xValue: horizontal ? (first?.median ?? 0) : point.category, yValue: horizontal ? point.category : (first?.median ?? 0), color: first?.color ?? "currentColor", label: point.category };
      });
      return { nodes, points: placed };
    },
    // A seeded body per category and series, mirrored about its centre line as the chart's are, with its middle half cut in.
    skeleton: ({ x, y, chart }) => {
      const band = horizontal ? y : x;
      const span: [number, number] = horizontal ? [chart.y, chart.y + chart.height] : [chart.x, chart.x + chart.width];
      const bands = skeletonBands(band, categories, span, SKELETON_CATEGORIES, 0.12, 0.06);
      const groups = Math.max(1, series.length);
      const random = seeded(bands.length * 17 + groups);
      const along = (t: number): number => (horizontal ? chart.x + t * chart.width : chart.y + chart.height - t * chart.height);
      const shapes: SceneNode[] = [];
      for (const [b, { start, width }] of bands.entries()) {
        const slot = width / groups;
        for (let n = 0; n < groups; n += 1) {
          const center = start + slot * (n + 0.5);
          const half = Math.min(slot * (series[n]?.width ?? 0.9), MAX_VIOLIN_PX) / 2;
          const profile = skeletonProfile(random);
          const right = profile.map((p): [number, number] => { const at = shape.at(center + p.h * half, along(p.t)); return [at.x, at.y]; });
          const left = profile.toReversed().map((p): [number, number] => { const at = shape.at(center - p.h * half, along(p.t)); return [at.x, at.y]; });
          const outline = [...right, ...left];
          const bar = Math.max(3, Math.min(10, half * 0.16));
          const lo = profile[0]?.t ?? 0;
          const hi = profile.at(-1)?.t ?? 1;
          const q1 = along(lo + (hi - lo) * 0.3);
          const q3 = along(lo + (hi - lo) * 0.6);
          shapes.push(
            { kind: "area", key: `c${b}s${n}:body`, points: outline, path: smoothPath(outline, true) },
            { kind: "rect", key: `c${b}s${n}:iqr`, ...shape.rect(center - bar / 2, center + bar / 2, q1, q3), radius: bar / 2, style: { fill: "var(--chart-background)" } },
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
    describe: () => describeSamples("Violin plot", props.data, carriers, props.categoryKey, format),
    ariaLabel: props.ariaLabel,
    ariaDescription: props.ariaDescription,
    css: distributionCss({ uid, items: categories.length, faded: series.map((s) => s.faded), enterMs, staggerMs, dimItems: "index" }),
    hoverIndex: (point) => point.datumIndex,
    tooltip: (focused) => {
      const point = focused.at(0);
      const datum: ViolinPoint | undefined = point?.datum;
      if (point === undefined || datum === undefined) {
        return undefined;
      }
      const rows: TooltipRow[] = datum.series.length === 1
        ? ((s: ViolinSummary): TooltipRow[] => [
            { color: s.color, label: "Median", value: format(s.median) },
            { color: s.color, label: "Middle half", value: `${format(s.q1)} – ${format(s.q3)}` },
            { color: s.color, label: "Range", value: `${format(s.min)} – ${format(s.max)}` },
            { color: s.color, label: "Observations", value: s.count },
          ])(datum.series[0])
        : datum.series.map((s) => ({ color: s.color, label: `${s.label} median`, value: format(s.median) }));
      return { title: datum.category, rows, point: datum, index: point.datumIndex };
    },
    tooltipProps,
    overlay: null,
  };
}
