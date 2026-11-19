import { labelsThatFit } from "../axis-fit";
import { formatTick } from "../cartesian/y-axis";
import { barX, barY, defineChart, group, stack } from "@tanstack/charts";
import type { ChartDefinition, ChartMark, ChartMotionContext } from "@tanstack/charts";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { tooltipBoxMotion } from "../tooltip/box-motion";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import { mergeTooltipCarriers } from "../tooltip/tooltip-carriers";
import { sizedTooltipPlacement } from "../tooltip/sized-tooltip-placement";
import { scaleBand } from "d3-scale";
import { scaleLinear } from "../scales";
import type { ScaleBand } from "d3-scale";
import { erase } from "../erased-types";
import { bklitYDomain } from "../cartesian/definition";
import { niced } from "../cartesian/domains";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { isString } from "../guards";
import { pillLayout } from "../cartesian/date-pill";
import type { HoverOverlayModel } from "../cartesian/hover-overlay";
import { userGradients } from "../gradients";
import { gridHostAttrs, gridLineStyle, gridRowGuides } from "../cartesian/grid-guides";
import type { GridGuideProps as GridProps } from "../cartesian/grid-guides";
import { bklitTheme, BKLIT_TOOLTIP_PLACEMENT } from "../theme";
import type { ChartMargin } from "../theme";
import { REVEAL_EASING } from "../motion/easing";
import { STAGGER_SPREAD } from "./easing";
import { enterOrResume } from "./enter-timing";
import type { EnterTiming } from "./enter-timing";
import { buildBarData, DEFAULT_GROUP_GAP, FADED_OPACITY } from "./model";
import type { BarDatum, BarSeries, Row } from "./model";
import type { BarDepthProviderProps, BarLabelCount, BarProps, BarXAxisProps, BarYAxisProps } from "../types/bar";
import { barEndValues, barOverlayDots, buildExtraMarks, memoBand } from "./marks";
import { valueLabelMarks } from "./value-labels";
import { fadeEntranceCss, fadeSeriesKeys } from "./fade-entrance";
import type { RingDots } from "./marks";
import { barFocusStrategy } from "./focus";
import type { PlotRect } from "./focus";
import { depthBarFor, depthMarksFor, hasDepth } from "./depth-feature";
import { cssAttr } from "./hover";
import type { HoverTarget } from "./hover";
import { keyEnds, keyStarts } from "../renderer-dom";

export interface BarInput {
  readonly data: readonly Row[];
  readonly xKey: string;
  readonly table: ChildTable;
  readonly series: readonly BarSeries[];
  readonly margin: ChartMargin;
  readonly barGap: number;
  readonly animationDuration: number;
  readonly uid: string;
  readonly horizontal: boolean;
  readonly stacked: boolean;
  readonly stackGap: number;
  /** BarChart `squareSnap` (bklit bar-chart.tsx:89): snaps the tooltip dots onto the top square and sets the ring dot slot gap. */
  readonly squareSnap?: { readonly squareGap: number; readonly groupGap?: number; readonly fit?: boolean };
  /** First paint of an entrance: custom marks collapsed, no bars; the build after it runs the reveal. */
  readonly seed: boolean;
  /** Entrance clock shared by the custom marks across the seed and full builds. */
  readonly clock: { at: number | null };
  /** The data changed after the first paint: bklit snaps the guides too (ticks and grid lines neither fade in nor out). */
  readonly updated?: boolean;
  /** bklit `status="loading"` (bar-chart.tsx:654-665): grid and axes stay, bars / squares / depth / tooltip guides are not drawn (the skeleton replaces them). */
  readonly loading?: boolean;
  /** Plot rect read lazily at pointer time (gates hover to the plot and sets bklit's column hit zones). */
  readonly plot?: () => PlotRect;
  /** BarChart `barWidth`: a fixed bar thickness in px, centred in its slot (bklit sizes the bars to it instead of the band). */
  readonly barWidth?: number;
}

const GUIDE_ROLES: ReadonlySet<string> = /* @__PURE__ */ new Set(["axis", "axis-label", "grid", "tick", "tick-label"]);
const CROSSHAIR_COLOR = "var(--chart-crosshair)";

type BandRange = (r?: [number, number]) => [number, number] | ScaleBand<string>;
type BandDomain = (d?: string[]) => string[] | ScaleBand<string>;

/** d3 band whose group slots are `gap` apart with outer edges flush (bklit: `(W - gap*(n-1)) / n` wide bars). */
function gapBand(gap: number): () => ScaleBand<string> {
  const make = (domain: string[], initial: [number, number]): ScaleBand<string> => {
    const band = scaleBand().paddingOuter(0).align(0);
    const fit = (): void => {
      const n = Math.max(1, band.domain().length);
      const [a, b] = band.range();
      const w = (Math.abs(b - a) - gap * (n - 1)) / n;
      band.paddingInner(w > 0 ? gap / (w + gap) : 0);
    };
    // SAFETY: d3's overloaded getters/setters bind to their `range(r)` / `domain(d)` call signatures.
    const range0 = band.range.bind(band) as BandRange;
    // SAFETY: as above, for `domain`.
    const domain0 = band.domain.bind(band) as BandDomain;
    // d3 scales are plain objects; the wrappers refit the padding whenever the range or domain is set.
    const range: BandRange = (r) => {
      if (r === undefined) {
        return range0();
      }
      range0(r);
      fit();
      return band;
    };
    const domainFn: BandDomain = (d) => {
      if (d === undefined) {
        return domain0();
      }
      domain0(d);
      fit();
      return band;
    };
    Reflect.set(band, "range", range);
    Reflect.set(band, "domain", domainFn);
    Reflect.set(band, "copy", () => make(band.domain(), band.range()));
    domain0(domain);
    range0(initial);
    fit();
    return band;
  };
  return () => make([], [0, 1]);
}

/** bklit `resolveBarValueDomain`: bars grow from zero, so the value domain always holds 0, also when every value is negative (the shared
 * cartesian domain pads around the data alone, which left an all-negative chart's bars floating off a baseline above the plot). */
export function barValueDomain(values: readonly number[]): [number, number] {
  const [lo, hi] = bklitYDomain(values);
  return lo <= 0 && hi >= 0 ? [lo, hi] : niced([Math.min(0, lo), Math.max(0, hi)]);
}

export interface BarDefinition {
  readonly definition: ChartDefinition<BarDatum, string, number>;
  readonly tooltipEnabled: boolean;
  /** The hover indicator (null without a Tooltip), placed by the host's HoverOverlay. */
  readonly overlay: HoverOverlayModel | null;
  /** Resolved value-axis domain (y when vertical, x when horizontal). */
  readonly valueDomain: readonly [number, number];
  /** Hover dim targets, rendered as focus-keyed CSS by `barStaticCss` (static-css.ts). */
  readonly hover: readonly HoverTarget[];
  /** Position of each category's tick label among the drawn labels (-1: not drawn). */
  readonly tickPositions: readonly number[];
  /** Host attributes for the static grid edge-fade rules (styles.css). */
  readonly gridAttrs: Record<string, string | undefined>;
  /** The `animationType="fade"` series' entrance rules (fade-entrance.ts), "" without one. */
  readonly entranceCss: string;
}

// gap #36: native barY rects take no className, so hover selects them by key.
const barKeySelector = (index: number, key: string): string => keyEnds(`:${index}:${cssAttr(key)}`);

type BarMarkList = ChartMark<BarDatum, string, number>[];
type BarMode = Pick<BarInput, "horizontal" | "stacked" | "stackGap">;

// bklit rounds every bar when grouped; stacked rounds only the outer segment unless a stackGap separates them.
// One radius for every series stays a scalar: the native rect's `rx` (the static CSS clamps it to half the bar); a per-series radius is a channel,
// which the renderer draws as a corner-radii path.
function barRadius(radiusOf: (d: BarDatum) => number, uniform: number | null, { stacked, stackGap }: BarMode): number | ((d: BarDatum) => number) | { end: (d: BarDatum) => number; stack: string } {
  if (stacked) {
    return { end: uniform === null ? radiusOf : (): number => uniform, stack: stackGap > 0 ? "each" : "outer" };
  }
  return uniform ?? radiusOf;
}

/** bklit bar.tsx `cornerRadius`: `"round"` is 8px (the static CSS clamps it to half the bar, bklit's `min(barWidth / 2, 8)`), `"butt"` square, a number that radius. */
const lineCapRadius = (lineCap: BarProps["lineCap"]): number => {
  if (typeof lineCap === "number") {
    return Math.max(0, lineCap);
  }
  return lineCap === "butt" ? 0 : 8;
};

// gap #36: native barY rects take no className or per-datum hover hook, so hover/legend select them by key (`bars:<index>:<series>`).
function barHoverTargets(barSeries: readonly BarSeries[], faded: number): HoverTarget[] {
  const perSeries = barSeries.map(
    (s): HoverTarget => ({ select: `${keyStarts("bars:")}${keyEnds(`:${cssAttr(s.key)}`)}:not(g)`, keep: null, dim: faded, seriesIndex: s.index, legendOnly: true }),
  );
  return [
    ...perSeries,
    {
      select: `${keyStarts("bars:")}:not(g)`,
      keep: (index) => `:is(${barSeries.map((s) => barKeySelector(index, s.key)).join(",")})`,
      dim: faded,
    },
  ];
}

interface BarMarksContext {
  readonly datums: readonly BarDatum[];
  readonly categories: readonly string[];
  readonly barSeries: readonly BarSeries[];
  readonly fillFor: (key: string) => string;
  readonly enter: (ctx: ChartMotionContext<BarDatum>) => EnterTiming | undefined;
  readonly depthOn: boolean;
  /** Corner radius of a datum's bar (its series' `lineCap`; 0 under depth faces). */
  readonly radiusOf: (d: BarDatum) => number;
  /** The one radius every series shares, else null. */
  readonly uniformRadius: number | null;
  readonly groupGap: number;
  readonly faded: number;
  /** Value-axis domain: the stack gap is px, the bar ends are values. */
  readonly domain: readonly [number, number];
  /** Plot size of the latest draw (the `chart` callback writes it before the marks resolve). */
  readonly live: LivePlot;
}

/** Plot size of the latest draw, unfloored: written by the definition's `chart` callback, read by marks when they resolve. */
interface LivePlot {
  innerWidth: number;
  innerHeight: number;
}

/** A stacked segment in value units: where it starts and ends on its category's stack, and its position in that stack (the stack gap raises it by that many gaps). */
interface StackExtent {
  readonly start: number;
  readonly end: number;
  readonly level: number;
  /** 1 grows up (or right) from the baseline, -1 down (or left): positives and negatives stack apart, as the native diverging stack does. */
  readonly sign: 1 | -1;
}

/** Each datum's stacked extent, in series order per category (`buildBarData` is category-major). Its level is its series position, as bklit's dots count it (marks.ts barOverlayDots). */
function stackExtents(datums: readonly BarDatum[]): ReadonlyMap<BarDatum, StackExtent> {
  const out = new Map<BarDatum, StackExtent>();
  const sums = new Map<string, { up: number; down: number; level: number }>();
  for (const d of datums) {
    const acc = sums.get(d.category) ?? { up: 0, down: 0, level: 0 };
    sums.set(d.category, acc);
    const value = Number.isFinite(d.value) ? d.value : 0;
    if (value >= 0) {
      out.set(d, { start: acc.up, end: acc.up + value, level: acc.level, sign: 1 });
      acc.up += value;
    } else {
      out.set(d, { start: acc.down, end: acc.down + value, level: acc.level, sign: -1 });
      acc.down += value;
    }
    acc.level += 1;
  }
  return out;
}

interface BarSeriesMarks {
  readonly marks: BarMarkList;
  readonly hover: HoverTarget[];
}

function barSeriesMarks(input: BarInput, ctx: BarMarksContext): BarSeriesMarks {
  const { datums, categories, barSeries, fillFor, depthOn } = ctx;
  const { table, series, animationDuration, horizontal, stacked, stackGap } = input;
  const keys = new Set(barSeries.map((s) => s.key));
  // bklit trims the front face by the perspective rise whenever depth is on (the lid sits above it): a custom mark draws it.
  if (depthOn) {
    const provider = propsFor<BarDepthProviderProps>(table, "barDepthProvider").at(0);
    const depthBar = depthBarFor({ datums, series, categories, minBar: provider?.minBarHeight ?? 0, animationDuration, seed: input.seed, clock: input.clock, fill: fillFor });
    return { marks: depthBar ? [depthBar] : [], hover: barHoverTargets(barSeries, ctx.faded) };
  }
  // The seeded first paint renders no bars so they ENTER on the next build.
  const barData = input.seed ? [] : datums.filter((d) => keys.has(d.series));
  const groupLayout = barSeries.length < 2 ? group({ padding: 0 }) : group({ scale: erase(gapBand(ctx.groupGap)) });
  const gapped = stacked && stackGap > 0;
  const options = {
    id: "bars",
    z: (d: BarDatum): string => d.series,
    color: (d: BarDatum): string => d.series,
    key: (d: BarDatum): string => `${d.index}:${d.series}`,
    fill: (d: BarDatum): string => fillFor(d.series),
    // A gapped stack places its segments itself (explicit ends below); the native stack layout cannot take them.
    layout: gapped ? undefined : stacked ? stack() : groupLayout,
    inset: 0,
    ...(input.barWidth !== undefined && input.barWidth > 0 ? { maxThickness: input.barWidth } : null),
    radius: barRadius(ctx.radiusOf, ctx.uniformRadius, { stacked, stackGap, horizontal }),
    motion: ctx.enter,
  };
  if (gapped) {
    const mark = gappedStackMark(barData, options, { horizontal, stackGap, domain: ctx.domain, live: ctx.live });
    return { marks: [erase(mark)], hover: barHoverTargets(barSeries, ctx.faded) };
  }
  const mark = horizontal
    ? barX(barData, erase({ ...options, x: (d: BarDatum): number => d.value, y: (d: BarDatum): string => d.category }))
    : barY(barData, erase({ ...options, x: (d: BarDatum): string => d.category, y: (d: BarDatum): number => d.value }));
  return { marks: [erase(mark)], hover: barHoverTargets(barSeries, ctx.faded) };
}

/** The stacked bars with `stackGap`: each segment raised off the one below by its level times the gap, where the tooltip dots put its top
 * (marks.ts barOverlayDots: `seen * stackGap` above the cumulative value).
 * The gap is cut from the geometry, not painted: a stroke in a surface colour (`--chart-background`, the Card's) shows as an outline round every bar
 * wherever the chart does not sit on `--card` (a page in dark mode, a muted panel, the site's preview frame, which strips the Card fill). An empty gap
 * shows whatever is behind the chart, so it reads as a gap on every surface. */
function gappedStackMark(
  barData: readonly BarDatum[],
  options: Record<string, unknown>,
  geo: { readonly horizontal: boolean; readonly stackGap: number; readonly domain: readonly [number, number]; readonly live: LivePlot },
): ChartMark<BarDatum, string, number> {
  const extents = stackExtents(barData);
  // The gap is px; the ends are values: converted at resolve time from the plot the `chart` callback measured.
  const gapUnits = (): number => {
    const length = geo.horizontal ? geo.live.innerWidth : geo.live.innerHeight;
    return (geo.stackGap * (geo.domain[1] - geo.domain[0])) / Math.max(1, length);
  };
  const raised = (d: BarDatum, end: "start" | "end"): number => {
    const e = extents.get(d);
    return e === undefined ? Number.NaN : e[end] + e.sign * e.level * gapUnits();
  };
  const start = (d: BarDatum): number => raised(d, "start");
  const end = (d: BarDatum): number => raised(d, "end");
  return geo.horizontal
    ? erase(barX(barData, erase({ ...options, x: (d: BarDatum): number => d.value, x1: start, x2: end, y: (d: BarDatum): string => d.category })))
    : erase(barY(barData, erase({ ...options, x: (d: BarDatum): string => d.category, y: (d: BarDatum): number => d.value, y1: start, y2: end })));
}

// bklit: vertical bars get a rolling date pill, a fade rule at the band centre and a dot on every bar end;
// horizontal bars only a fade rule at the end of the focused category's longest bar (no pill, no dots).
/** The ChartTooltip props the bar guides and panel read. */
interface BarTooltipProps extends TooltipBoxMotionProps {
  readonly dotVariant?: "dot" | "ring";
  readonly dotSize?: number;
  readonly dotScale?: number;
  readonly dotRadiusFraction?: number;
  readonly dotStrokeWidth?: number;
  readonly dotColor?: unknown;
  readonly showCrosshair?: boolean;
  readonly showDots?: boolean;
}

function ringOf(tip: BarTooltipProps | undefined, seriesCount: number, squareGroupGap: number | undefined): RingDots | undefined {
  if (tip?.dotVariant !== "ring") {
    return undefined;
  }
  const color = isString(tip.dotColor) ? tip.dotColor : undefined;
  return { fraction: tip.dotRadiusFraction ?? 0.25, scale: tip.dotScale ?? 1, size: tip.dotSize ?? 5, slotGap: squareGroupGap ?? (seriesCount > 1 ? 4 : 0), strokeWidth: tip.dotStrokeWidth ?? 2, color };
}

/** The hover indicator for the HoverOverlay the host owns (core/cartesian/hover-overlay.ts): the rule, and for vertical bars the date pill and a dot on every bar end. Keys are category indexes. */
function tooltipOverlay(input: BarInput, datums: readonly BarDatum[], categories: readonly string[], groupGap: number, domain: readonly [number, number], tip: BarTooltipProps | undefined): HoverOverlayModel {
  const { horizontal, stacked, stackGap, series } = input;
  // bklit hides the crosshair line on bar charts unless `showCrosshair` opts in (chart-tooltip.tsx: `showCrosshair ?? !barXAccessor`): the dots and the pill mark the bar.
  const crosshair = tip?.showCrosshair === true ? { color: CROSSHAIR_COLOR, dash: undefined, width: 1 } : null;
  if (horizontal) {
    const ends = barEndValues(datums, stacked);
    // A gapped stack's last segment sits one stackGap per segment below it past the total (gappedStackMark).
    const raise = stacked ? Math.max(0, series.filter((s) => s.kind === "bar").length - 1) * stackGap : 0;
    return {
      crosshair,
      dots: [],
      indexOf: (index) => index,
      pill: null,
      xOf: (index, plot) => (((ends.get(categories[index] ?? "") ?? Number.NaN) - domain[0]) / (domain[1] - domain[0] || 1)) * plot.innerWidth + raise,
    };
  }
  const squares = new Map(
    series.flatMap((s) =>
      s.squares ? [[s.key, { gap: s.squares.squareGap ?? 3, fit: s.squares.squareFit ?? false, groupGap: s.squares.groupGap ?? 4 }] as const] : [],
    ),
  );
  const bandFor = memoBand(categories, input.barGap);
  return {
    crosshair,
    dots: tip?.showDots !== false
      ? barOverlayDots({ datums, series, categories, barGap: input.barGap, groupGap, stacked, stackGap, squares, squareSnap: input.squareSnap, ring: ringOf(tip, series.length, input.squareSnap?.groupGap ?? [...squares.values()].at(0)?.groupGap) })
      : [],
    indexOf: (index) => index,
    pill: { labels: categories, layout: pillLayout(categories) },
    xOf: (index, plot) => bandFor(plot.innerWidth).centre(categories[index] ?? ""),
  };
}

// bklit bar-x-axis.tsx:91-93 / bar-y-axis.tsx:79-80: category labels thin to every ceil(n / maxLabels)-th unless showAllLabels.
// Accepted divergence: bklit thins by count only, so at phone width twelve month labels ran together ("NovDecJan..."). A vertical chart also caps the
// count by what fits the plot width (`plotWidth`, the `chart` callback's); bklit's even every-nth spacing is kept.
/** bklit `resolveResponsiveChartLabelCount`: a breakpoint count by the chart's width (largest breakpoint it reaches that has a count), else `fallback`. */
export function labelCountAt(value: BarLabelCount | undefined, chartWidth: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number") {
    return value;
  }
  const steps: readonly (readonly [number, number | undefined])[] = [[1280, value.xl], [1024, value.lg], [768, value.md], [640, value.sm], [0, value.base]];
  return steps.find(([min, count]) => chartWidth >= min && count !== undefined)?.[1] ?? fallback;
}

function thinnedLabels(labelAxis: BarXAxisProps | BarYAxisProps | undefined, horizontal: boolean, categories: readonly string[], plotWidth?: number, chartWidth = 0): string[] | undefined {
  const showAllLabels = labelAxis?.showAllLabels ?? horizontal;
  const byCount = Math.max(1, labelCountAt(labelAxis?.maxLabels, chartWidth, horizontal ? 20 : 12));
  const maxLabels = horizontal || plotWidth === undefined ? byCount : Math.min(byCount, labelsThatFit(categories, plotWidth));
  if (!labelAxis || showAllLabels || categories.length <= maxLabels) {
    return undefined;
  }
  return categories.filter((_, i) => i % Math.ceil(categories.length / maxLabels) === 0);
}

type BarFocus = ReturnType<typeof barFocusStrategy> | "group-x" | "group-y";

function barFocus(input: BarInput, categories: readonly string[]): BarFocus {
  const { horizontal, plot } = input;
  if (plot) {
    return barFocusStrategy({ categories, horizontal, plot });
  }
  return horizontal ? "group-y" : "group-x";
}

function yFormatter(yAxis: BarYAxisProps | undefined): (v: number) => string {
  const large = yAxis?.formatLargeNumbers !== false;
  return (v) => {
    if (yAxis?.formatValue) {
      return yAxis.formatValue(v);
    }
    return formatTick(v, large);
  };
}

// Clock of the first bar entrance: a render forced mid-entrance (web-font swap after a hydrated mount) arrives as an "update".
function barEnter(input: BarInput, labels = false): (ctx: ChartMotionContext<BarDatum>) => EnterTiming | undefined {
  const { animationDuration, series } = input;
  const seriesCount = Math.max(1, series.length);
  const stagger = (animationDuration * STAGGER_SPREAD) / Math.max(1, input.data.length);
  // A Bar's own `staggerDelay` (seconds) replaces the derived spread for its series: index * staggerDelay (bklit bar.tsx:215-217, 131).
  const ownStagger = new Map(series.flatMap((s) => (s.bar?.staggerDelay === undefined ? [] : [[s.key, s.bar.staggerDelay * 1000] as const])));
  // A Bar with `animate={false}` lands at once (bklit renders its static bars from the first frame); one with `animationType="fade"` lands
  // at once too and fades in by CSS (fade-entrance.ts).
  const still = new Set([...series.flatMap((s) => (s.bar?.animate === false ? [s.key] : [])), ...(labels ? [] : fadeSeriesKeys(series))]);
  const enter = (ctx: ChartMotionContext<BarDatum>): EnterTiming | undefined => {
    if (still.has(ctx.datum?.series ?? "")) { return false; }
    const index = ctx.datum?.index ?? Math.floor(ctx.datumIndex / seriesCount);
    const plan = { delay: index * (ownStagger.get(ctx.datum?.series ?? "") ?? stagger), duration: animationDuration, easing: REVEAL_EASING };
    // Loading -> ready arrives as an update from collapsed bars, with the clock reset, so it grows them too (bklit revealEpoch, bar-chart.tsx:372-386).
    // Later data updates snap (clock spent); one forced inside the entrance window resumes the schedule.
    if (input.loading === true) { return false; }
    return ctx.phase === "exit" ? undefined : enterOrResume(input.clock, ctx.phase, plan);
  };
  return enter;
}

interface ScaleSpec {
  readonly [key: string]: unknown;
}

function categoryScaleSpec(input: BarInput, categories: readonly string[], axis: BarXAxisProps | BarYAxisProps | undefined, tickValues: string[] | undefined, labelLift: number): ScaleSpec {
  const { horizontal } = input;
  const padding = horizontal ? 8 : 14.4;
  // bklit bar-x-axis.tsx:91-107 only thins by maxLabels, never by collision: `thin: false` below keeps overlapping labels like bklit.
  const ticks = tickValues === undefined ? { size: 0, padding } : { values: tickValues, size: 0, padding };
  return {
    scale: scaleBand().domain(categories).padding(input.barGap),
    grid: false,
    axis: axis === undefined ? false : { line: false, ticks, tickLabels: { fontSize: 12, opacity: horizontal ? 0.7 : 1, thin: false, ...(labelLift < 0 ? { dy: labelLift } : null) } },
  };
}

function valueScaleSpec(input: BarInput, domain: readonly [number, number], grid: GridProps | undefined, yAxis: BarYAxisProps | undefined, rowGuides: ReturnType<typeof gridRowGuides> | undefined): ScaleSpec {
  const gridEnabled = grid !== undefined && (rowGuides ? rowGuides.native : grid.vertical !== false);
  const tickCount = rowGuides?.count ?? yAxis?.numTicks ?? grid?.numTicksRows ?? 5;
  return {
    scale: scaleLinear().domain(domain),
    grid: gridEnabled ? gridLineStyle(grid) : false,
    axis: input.horizontal ? false : {
      line: false,
      ticks: { count: tickCount, size: 0, format: yFormatter(yAxis) },
      // bklit y-axis.tsx:106-142 draws every scale tick, no collision test.
      tickLabels: yAxis === undefined ? false : { fontSize: 12, opacity: 1, thin: false },
    },
  };
}

// Horizontal: the native placement without the per-paint size read (gap #21, kit/tooltip/sized-tooltip-placement.ts).
function tooltipPlacement(horizontal: boolean): object {
  return horizontal ? { anchor: { x: "point", y: "point" }, placement: ["right", "left"], offset: 16, portal: sizedTooltipPlacement() } : BKLIT_TOOLTIP_PLACEMENT;
}

// bklit snaps every bar on a data change, and the guides too once the data has updated.
const snapsOnUpdate = (input: BarInput, context: ChartMotionContext<BarDatum>): boolean => context.phase === "update" || (input.updated === true && GUIDE_ROLES.has(context.role));

export function buildBarDefinition(input: BarInput): BarDefinition {
  const { data, xKey, table, series, horizontal, stacked } = input;
  const loading = input.loading === true;
  const tooltipProps = mergeTooltipCarriers(propsFor<BarTooltipProps>(table, "tooltip").at(0), table);
  const tooltipEnabled = !loading && tooltipProps !== undefined;
  const boxMotion = tooltipBoxMotion(tooltipProps);
  const grid = propsFor<GridProps>(table, "grid").at(0);
  const xAxis = propsFor<BarXAxisProps>(table, "barXAxis").at(0);
  const yAxis = propsFor<BarYAxisProps>(table, "barYAxis").at(0);

  const categories = data.map((row) => String(row[xKey]));
  const datums = buildBarData(data, xKey, series);
  const barSeries = series.filter((s) => s.kind === "bar");
  const fillOf = new Map(series.map((s) => [s.key, s.fill] as const));
  const groupGap = barSeries[0]?.bar?.groupGap ?? DEFAULT_GROUP_GAP;
  const faded = barSeries[0]?.bar?.fadedOpacity ?? FADED_OPACITY;
  const depthOn = hasDepth(table) && !horizontal && !stacked;
  const radiusBySeries = new Map(barSeries.map((s) => [s.key, depthOn ? 0 : lineCapRadius(s.bar?.lineCap)] as const));
  const radiusOf = (d: BarDatum): number => radiusBySeries.get(d.series) ?? 0;
  const radii = new Set(radiusBySeries.values());
  const uniformRadius = radii.size <= 1 ? ([...radii][0] ?? 0) : null;
  const fillFor = (key: string): string => fillOf.get(key) ?? "var(--chart-line-primary)";

  // Written by the `chart` callback below at every draw, read by the square columns and the gapped stack when they resolve.
  const live: LivePlot = { innerWidth: Number.POSITIVE_INFINITY, innerHeight: Number.POSITIVE_INFINITY };
  // A stack's ends: positives and negatives stack apart (the diverging stack above), so a category reaches its positive sum up and its negative sum down, not its net.
  const yValues = stacked
    ? categories.flatMap((c) => {
        const values = datums.filter((d) => d.category === c && Number.isFinite(d.value)).map((d) => d.value);
        const up = values.reduce((sum, v) => (v > 0 ? sum + v : sum), 0);
        const down = values.reduce((sum, v) => (v < 0 ? sum + v : sum), 0);
        return down < 0 ? [up, down] : [up];
      })
    : datums.map((d) => d.value);
  const domain = barValueDomain(yValues);
  // UPSTREAM-GAPS #12 (addendum): a group joining on an update only fades, so the bars stay present at value 0 while loading.
  // Loading keeps the bar marks collapsed to zero (grid, axes and scales stay) so the flip to ready is an update that grows them.
  const own = barSeries.length > 0 ? barSeriesMarks(input, { datums: loading ? datums.map((d) => ({ ...d, value: 0 })) : datums, categories, barSeries, fillFor, enter: barEnter(input), depthOn, radiusOf, uniformRadius, groupGap, faded, domain, live }) : { marks: [], hover: [] };
  const extra = horizontal || loading ? undefined : buildExtraMarks({ live, datums, series, table, categories, animationDuration: input.animationDuration, faded, uid: input.uid, seed: input.seed, clock: input.clock });
  const depth = horizontal || loading ? undefined : depthMarksFor({ table, datums, series, categories, animationDuration: input.animationDuration, groupGap, uid: input.uid, faded, seed: input.seed, clock: input.clock });
  // bklit's in-bar values (Bar `showValue`), above the bars and their depth faces.
  const labels = loading ? undefined : valueLabelMarks({ datums, barSeries, horizontal, stacked, stackGap: input.stackGap, groupGap, faded, extents: stacked ? stackExtents(datums.filter((d) => barSeries.some((b) => b.key === d.series))) : null, enter: barEnter(input, true), seed: input.seed, barWidth: input.barWidth });
  const marks: BarMarkList = [...own.marks, ...(extra?.marks ?? []), ...(depth?.marks ?? []), ...(labels?.marks ?? [])];
  // bklit dims every bar outside the hovered category (see hover.ts: scoped CSS, not native states).
  const hover: HoverTarget[] = [...own.hover, ...(extra?.hover ?? []), ...(depth?.hover ?? []), ...(labels?.hover ?? [])];

  // Vertical bars: bklit's Grid rows (own tick set, edge lines, highlight rows) sit under the bars; the value scale is y.
  const rowGuides = horizontal ? undefined : gridRowGuides(grid, scaleLinear().domain(domain), yAxis !== undefined, yAxis?.numTicks);
  if (rowGuides) {
    marks.unshift(...rowGuides.marks);
  }
  const overlay = tooltipEnabled ? tooltipOverlay(input, datums, categories, groupGap, domain, tooltipProps) : null;

  const categoryAxis = horizontal ? yAxis : xAxis;
  // By count only: the positions the horizontal label highlight looks up (the vertical tick fade reads the label x, see hover.ts).
  const tickValues = thinnedLabels(categoryAxis, horizontal, categories);

  const valueScale = valueScaleSpec(input, domain, grid, yAxis, rowGuides);
  const gradients = [...(depth?.gradients ?? []), ...userGradients(table)];
  const spec = erase({
    chart: ({ width, height }: { width: number; height: number }) => {
      live.innerWidth = Math.round(width) - input.margin.left - input.margin.right;
      live.innerHeight = Math.round(height) - input.margin.top - input.margin.bottom;
      // bklit lays the x labels at `bottom: 12` of the host (bar-x-axis.tsx), so a plot shorter than its margins (barsquares beside a legend at 390px)
      // lifts them with it; the renderer floors the plot at 1px, hence the lift by the lost height.
      // Accepted divergence: bklit's degenerate plot has a negative inner height and its grid rows draw upward from it; the native grid collapses on the 1px floor instead.
      const labelLift = horizontal ? 0 : Math.min(0, live.innerHeight - 1);
      const categoryScale = categoryScaleSpec(input, categories, categoryAxis, horizontal ? tickValues : thinnedLabels(categoryAxis, horizontal, categories, live.innerWidth, width), labelLift);
      return {
        marks,
        scales: { [horizontal ? "y" : "x"]: categoryScale, [horizontal ? "x" : "y"]: valueScale },
        margin: input.margin,
        gradients,
        theme: bklitTheme,
      };
    },
    // Loading swaps instantly both ways (bklit renders the skeleton in place of the bars, no exit); the grow reveal plays on the flip back.
    motion: (context: ChartMotionContext<BarDatum>) => (loading || snapsOnUpdate(input, context) ? false : undefined),
    focus: tooltipEnabled ? barFocus(input, categories) : undefined,
    maxFocusDistance: Number.POSITIVE_INFINITY,
    focusRing: false,
    // Horizontal: the native placement without the per-paint size read (gap #21, kit/tooltip/sized-tooltip-placement.ts).
    tooltip: tooltipEnabled ? { use: bklitTooltip, ...tooltipPlacement(horizontal), sticky: false, motion: boxMotion } : false,
  });
  const definition: ChartDefinition<BarDatum, string, number> = erase(defineChart(spec));

  const tickPositions = categories.map((c, i) => (tickValues === undefined ? i : tickValues.indexOf(c)));
  const entranceCss = loading || depthOn ? "" : fadeEntranceCss({ uid: input.uid, series, categoryCount: categories.length, animationDuration: input.animationDuration, staggerMs: (input.animationDuration * STAGGER_SPREAD) / Math.max(1, data.length) });
  return { definition, tooltipEnabled, overlay, valueDomain: domain, hover, tickPositions, gridAttrs: gridHostAttrs(grid), entranceCss };
}
