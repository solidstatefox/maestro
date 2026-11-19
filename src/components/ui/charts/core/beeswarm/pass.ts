import type { SceneNode } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import { propsFor } from "../carriers/table";
import type { DistributionPass, DistributionPassInput } from "../distribution/controller";
import { categoriesOf, categoryFrame } from "../distribution/category";
import { distributionCss, staggerClass } from "../distribution/css";
import { dodgeOffsets } from "../distribution/dodge";
import { finite, formatTooltipValue, interactionOptions, nearestFocus, seriesColor } from "../distribution/frame";
import { bandOf, distributionMark, oriented } from "../distribution/marks";
import { seededNormal, skeletonBands } from "../distribution/skeleton";
import { erase } from "../erased-types";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { BeeswarmChartProps, BeeswarmPoint, BeeswarmProps } from "../types/beeswarm";
import { describeSamples } from "../distribution/describe";

/** The props a BeeswarmChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type BeeswarmControllerProps = Omit<BeeswarmChartProps<unknown, unknown>, "children" | "className" | "style">;

interface Dot {
  readonly datum: BeeswarmPoint;
  readonly series: number;
  readonly category: number;
  readonly radius: number;
}

const DEFAULT_ENTER_MS = 1100;
/** One dot's pop (ms): the entrance's length is the stagger across the swarm. */
const DOT_POP_MS = 420;
const ONE_SWARM = "";
/** The skeleton's swarms without data, and the dots in each (without data, else about the chart's own count). */
const SKELETON_CATEGORIES = 3;
const SKELETON_DOTS = 64;

export function beeswarmPass({ props, table, uid, live, phase }: DistributionPassInput<BeeswarmControllerProps>): DistributionPass {
  const carriers = propsFor<BeeswarmProps>(table, "beeswarm");
  const tooltipProps = propsFor<Readonly<Record<string, unknown>>>(table, "beeswarmTooltip").at(0) ?? null;
  const series = carriers.map((c, n) => ({ label: c.label ?? c.dataKey, color: seriesColor(c.fill, n), radius: Math.max(1, c.radius ?? 4), animate: c.animate !== false, faded: c.fadedOpacity ?? 0.3 }));
  const { categoryKey } = props;
  const categories = categoryKey === undefined ? [ONE_SWARM] : categoriesOf(props.data, categoryKey);
  const index = new Map(categories.map((category, i) => [category, i]));
  const dots: Dot[] = [];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const row of props.data) {
    const category = categoryKey === undefined ? ONE_SWARM : String(row[categoryKey] ?? "");
    const c = index.get(category);
    if (c === undefined) {
      continue;
    }
    for (const [n, carrier] of carriers.entries()) {
      const value = finite(row[carrier.dataKey]);
      const s = series[n];
      if (value !== null && s !== undefined) {
        dots.push({ datum: { value, category: categoryKey === undefined ? undefined : category, label: s.label, color: s.color, row }, series: n, category: c, radius: s.radius });
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
    }
  }
  // Item order is value order: the pop sweeps from low to high, and the keyboard steps the same way.
  dots.sort((a, b) => a.datum.value - b.datum.value);
  const extent: [number, number] = Number.isFinite(lo) ? [lo, hi] : [0, 1];
  // `horizontal` (the default): values along x.
  const frame = categoryFrame({ categories, orientation: props.orientation === "vertical" ? "vertical" : "horizontal", table, xRole: "beeswarmXAxis", yRole: "beeswarmYAxis", extent, domain: props.domain, margin: props.margin, paddingInner: 0.08, paddingOuter: 0.04 });
  const { horizontal } = frame;
  // `oriented` lays shapes along the value axis: a horizontal frame has values along x.
  const shape = oriented(horizontal);
  const animationMs = props.animationDuration ?? DEFAULT_ENTER_MS;
  const enterMs = Math.min(DOT_POP_MS, animationMs);
  const staggerMs = dots.length > 1 ? Math.max(0, animationMs - enterMs) / dots.length : 0;
  const format = formatTooltipValue(erase(tooltipProps?.formatValue), frame.valueAxisProps);

  const mark = distributionMark<BeeswarmPoint>({
    id: "beeswarm",
    live,
    phase,
    x: horizontal ? frame.valueDomain : categories,
    y: horizontal ? categories : frame.valueDomain,
    layout: ({ x, y }) => {
      const band = horizontal ? y : x;
      const value = horizontal ? x : y;
      const placed = dots.map(() => ({ c: 0, v: 0 }));
      for (const [c, category] of categories.entries()) {
        const { start, width } = bandOf(band, category);
        const members = dots.flatMap((dot, i) => (dot.category === c ? [i] : []));
        const positions = members.map((i) => value.map(dots[i]?.datum.value));
        const radii = members.map((i) => dots[i]?.radius ?? 4);
        const offsets = dodgeOffsets(positions, radii, 1);
        const reach = Math.max(1, ...offsets.map((o, k) => Math.abs(o) + (radii[k] ?? 0)));
        // A swarm taller than its band is squeezed into it (dots may then touch).
        const squeeze = Math.min(1, width / 2 / reach);
        const center = start + width / 2;
        for (const [k, i] of members.entries()) {
          placed[i] = { c: center + (offsets[k] ?? 0) * squeeze, v: positions[k] ?? 0 };
        }
      }
      // One group per series, dimmed as one layer while a dot is hovered (the overlay redraws that dot on top): a hover restyles a few
      // groups, never every dot. Each dot pops in on its own, a step after the dot below its value.
      const nodes: SceneNode[] = series.map((s, n) => ({
        kind: "group",
        key: `beeswarm:s${n}`,
        className: `bkm-d-g bkm-d-i bkm-d-s bkm-d-s${n}`,
        children: dots.flatMap((dot, i): SceneNode[] => {
          if (dot.series !== n) {
            return [];
          }
          const at = shape.at(placed[i]?.c ?? 0, placed[i]?.v ?? 0);
          return [{ kind: "dot", key: `d${i}`, className: s.animate ? `bkm-d-enter bkm-d-pop ${staggerClass(i)}` : undefined, x: at.x, y: at.y, radius: dot.radius, style: { fill: dot.datum.color } }];
        }),
      }));
      return {
        nodes,
        points: dots.map((dot, i) => {
          const at = shape.at(placed[i]?.c ?? 0, placed[i]?.v ?? 0);
          return { key: `d${i}`, datum: dot.datum, index: i, x: at.x, y: at.y, xValue: horizontal ? dot.datum.value : (dot.datum.category ?? ""), yValue: horizontal ? (dot.datum.category ?? "") : dot.datum.value, color: dot.datum.color, label: dot.datum.label };
        }),
      };
    },
    // Each band's swarm: seeded values on a bell, packed by the same tangent packing as the chart's dots and squeezed into the band.
    skeleton: ({ x, y, chart }) => {
      const band = horizontal ? y : x;
      const span: [number, number] = horizontal ? [chart.y, chart.y + chart.height] : [chart.x, chart.x + chart.width];
      const bands = skeletonBands(band, categories, span, SKELETON_CATEGORIES, 0.08, 0.04);
      const count = Math.round(Math.min(110, Math.max(48, dots.length > 0 ? dots.length / bands.length : SKELETON_DOTS)));
      const radius = series[0]?.radius ?? 4;
      const normal = seededNormal(bands.length * 13 + count);
      const along = (t: number): number => (horizontal ? chart.x + t * chart.width : chart.y + chart.height - t * chart.height);
      const shapes: SceneNode[] = [];
      for (const [b, { start, width }] of bands.entries()) {
        const mean = 0.36 + (b % 3) * 0.08;
        const positions = Array.from({ length: count }, () => along(Math.min(0.96, Math.max(0.04, mean + normal() * 0.11)))).toSorted((p, q) => p - q);
        const radii = positions.map(() => radius);
        const offsets = dodgeOffsets(positions, radii, 1);
        const reach = Math.max(1, ...offsets.map((o) => Math.abs(o) + radius));
        const squeeze = Math.min(1, width / 2 / reach);
        const center = start + width / 2;
        for (const [k, position] of positions.entries()) {
          const at = shape.at(center + (offsets[k] ?? 0) * squeeze, position);
          shapes.push({ kind: "dot", key: `c${b}d${k}`, x: at.x, y: at.y, radius });
        }
      }
      return { shapes };
    },
  });

  const reach = Math.max(10, ...series.map((s) => s.radius * 2.5));
  const definition = defineChart(
    erase({
      chart: ({ width }: { readonly width: number }) => ({ marks: [mark], scales: frame.scalesAt(width), margin: frame.margin, theme: bklitTheme }),
      ...interactionOptions(nearestFocus(live, reach), tooltipProps !== null, "point"),
    }),
  );

  return {
    definition,
    aspectRatio: parseAspectRatio(props.aspectRatio),
    margin: frame.margin,
    describe: () => describeSamples("Beeswarm chart", props.data, carriers, categoryKey, format),
    ariaLabel: props.ariaLabel,
    ariaDescription: props.ariaDescription,
    css: distributionCss({ uid, items: dots.length, faded: series.map((s) => s.faded), enterMs, staggerMs, dimItems: "all", dimSelf: true }),
    // One value for every dot: the rule dims them all and the overlay redraws the hovered one, so moving between dots restyles nothing.
    hoverIndex: () => 0,
    tooltip: (focused) => {
      const point = focused.at(0);
      const datum: BeeswarmPoint | undefined = point?.datum;
      if (point === undefined || datum === undefined) {
        return undefined;
      }
      return { title: datum.category ?? datum.label, rows: [{ color: datum.color, label: datum.label, value: format(datum.value) }], point: datum, index: point.datumIndex };
    },
    tooltipProps,
    // The hovered dot over the dimmed swarm, a little larger, in bklit's TooltipDot ring (the chart's background).
    overlay: { crosshair: false, dots: (point) => [{ x: point.x, y: point.y, color: String(point.color), radius: (dots[point.datumIndex]?.radius ?? 4) + 1.5 }] },
  };
}
