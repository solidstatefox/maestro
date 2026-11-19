import { barX, barY, defineChart, dot, link, ruleX, ruleY } from "@tanstack/charts";
import type { ChartCurve } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { memoCell } from "../memo";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { ErrorBarChartProps, ErrorBarProps } from "../types/uncertainty";
import { categoryCarriers, categoryChrome, categoryFocus, categoryMargin, categoryScales, categoryDot, categorySpan, skeletonFrame } from "../plot/category";
import type { CategoryFrame } from "../plot/category";
import { hoverDimCss, lateFadeCss, PLOT_FADE_KEYFRAMES, PLOT_POP_KEYFRAMES, popInCss } from "../plot/css";
import { enterMotion, focusCopy, itemKey, plotEnter, plotTooltip, stagger, valueDomain } from "../plot/definition";
import { skeletonBetween } from "../plot/loading";
import type { PlotSkeleton, SkeletonShape } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { describeErrorBars } from "../plot/describe";

/** The props an ErrorBarChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type ErrorBarInput = Omit<ErrorBarChartProps<unknown, unknown>, "className" | "style" | "children">;

interface Estimate {
  readonly index: number;
  readonly value: number;
  readonly low: number;
  readonly high: number;
  readonly label: string;
  readonly color: string;
  readonly row: PlotDatum;
}

const MARK = { whiskers: "eb-whiskers", lowCaps: "eb-low-caps", highCaps: "eb-high-caps", points: "eb-points", reference: "eb-reference", hit: "eb-hit" } as const;

/** Up to two decimals, grouped: an estimate is rarely whole. */
export const decimalFormat: (value: number) => string = /* @__PURE__ */ (() => {
  const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  return (value: number): string => format.format(value);
})();

const numberOf = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

/** A cap across an interval's end, `width` px wide, centred on its point (the link's two points coincide). */
const capCurve = (width: number, horizontal: boolean): ChartCurve => ({
  line: (points) => {
    const [a] = points;
    if (a === undefined) {
      return "";
    }
    const [x, y] = a;
    const h = width / 2;
    return horizontal ? `M${x},${y - h}L${x},${y + h}` : `M${x - h},${y}L${x + h},${y}`;
  },
  area: () => "",
});

/** Skeleton estimates when there are no rows yet. */
const SKELETON_ESTIMATES = 6;

/** The loading skeleton: on each band a whisker around a seeded estimate, a cap across either end and the estimate's dot. */
const errorBarSkeleton = (chart: CategoryFrame, width: number, capWidth: number, radius: number, caps: boolean): PlotSkeleton => {
  const frame = skeletonFrame(chart, SKELETON_ESTIMATES);
  const bars = Array.from({ length: frame.count }, (_, i) => {
    const value = skeletonBetween(i, 0.32, 0.68, 23);
    const half = skeletonBetween(i, 0.1, 0.24, 29);
    return { value, low: Math.max(0.04, value - half), high: Math.min(0.96, value + half * skeletonBetween(i, 0.8, 1.25, 31)) };
  });
  return (size) => bars.flatMap(({ value, low, high }, i): SkeletonShape[] => {
    // A cap is a short bar across the band at the end: `capWidth` px across, the whisker's width thick.
    const cap = (at: number): SkeletonShape => {
      const along = frame.horizontal ? size.width : size.height;
      const thick = width / along;
      return categorySpan(frame, size, i, at - thick / 2, at + thick / 2, { thickness: capWidth, radius: width / 2, tone: 0.6 });
    };
    return [
      categorySpan(frame, size, i, low, high, { thickness: width, radius: width / 2, tone: 0.6 }),
      ...(caps ? [cap(low), cap(high)] : []),
      categoryDot(frame, size, i, value, radius),
    ];
  });
};

function createErrorBarBuilder(): PlotFamily<ErrorBarInput>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<ErrorBarInput>): PlotBuild => {
    const series = propsFor<ErrorBarProps>(table, "errorBar").at(0);
    const carriers = categoryCarriers(table);
    return cell([props, series, carriers.grid, carriers.xAxis, carriers.yAxis, carriers.tooltip], () => {
      const xKey = props.xDataKey ?? "name";
      const horizontal = props.orientation === "horizontal";
      const color = series?.color ?? "var(--chart-1)";
      const estimates: Estimate[] = series === undefined
        ? []
        : props.data.map((row, index) => {
            const value = numberOf(row[series.dataKey]);
            const low = numberOf(row[series.lowKey]);
            const high = numberOf(row[series.highKey]);
            return { index, value, low: Math.min(low, high), high: Math.max(low, high), label: String(row[xKey] ?? ""), color: typeof row.color === "string" ? row.color : color, row };
          });
      const margin = categoryMargin(props.margin);
      const values = estimates.flatMap((e) => [e.low, e.high, e.value]).filter(Number.isFinite);
      const frame: CategoryFrame = {
        count: estimates.length,
        labels: estimates.map((e) => e.label),
        horizontal,
        padding: 0.3,
        margin,
        domain: valueDomain(props.reference === undefined ? values : [...values, props.reference], { zero: false, pad: 0.1 }),
      };
      const format = series?.formatValue ?? decimalFormat;
      const enter = plotEnter(props);
      const delayOf = stagger(enter, estimates.length);
      const run = enter.durationMs * 0.6;
      const cat = (e: Estimate): string => String(e.index);
      const key = (e: Estimate): string => itemKey(e.index);
      const colorOf = (e: Estimate): string => e.color;
      const width = series?.strokeWidth ?? 2;
      const capWidth = series?.capWidth ?? 14;
      const radius = series?.radius ?? 5;
      const whisker = (id: string, motion: boolean, opacity: number) => {
        const common = { key, fill: colorOf, fillOpacity: opacity, maxThickness: width, radius: width / 2, motion: motion ? enterMotion(enter, (e: Estimate | undefined, i: number) => delayOf(e?.index ?? i)) : false };
        return horizontal ? barX(estimates, { ...common, id, y: cat, x1: (e) => e.low, x2: (e) => e.high }) : barY(estimates, { ...common, id, x: cat, y1: (e) => e.low, y2: (e) => e.high });
      };
      const cap = (id: string, end: "low" | "high", group: readonly Estimate[], stroke: string, opacity: number) =>
        link(group, {
          id,
          x1: horizontal ? (e: Estimate) => e[end] : cat,
          x2: horizontal ? (e: Estimate) => e[end] : cat,
          y1: horizontal ? cat : (e: Estimate) => e[end],
          y2: horizontal ? cat : (e: Estimate) => e[end],
          key,
          stroke,
          strokeOpacity: opacity,
          strokeWidth: width,
          curve: capCurve(capWidth, horizontal),
          motion: false,
        });
      const point = (id: string) =>
        dot(estimates, { id, x: horizontal ? (e: Estimate) => e.value : cat, y: horizontal ? cat : (e: Estimate) => e.value, key, r: radius, fill: color, stroke: "var(--chart-background)", strokeWidth: 2, motion: false });
      const marks: object[] = [];
      const copies: object[] = [];
      const dims: string[] = [];
      const late: string[] = [];
      // The caps' marks: [mark id, its rows' indices in node order].
      const capDelays: [string, number[]][] = [];
      if (props.reference !== undefined) {
        const reference = [props.reference];
        marks.push(horizontal
          ? ruleX(reference, { id: MARK.reference, x: (v) => v, stroke: "var(--chart-foreground-muted)", strokeWidth: 1, strokeDasharray: "4 4", motion: false })
          : ruleY(reference, { id: MARK.reference, y: (v) => v, stroke: "var(--chart-foreground-muted)", strokeWidth: 1, strokeDasharray: "4 4", motion: false }));
        late.push(MARK.reference);
      }
      if (series !== undefined) {
        marks.push(whisker(MARK.whiskers, true, 0.65));
        copies.push(focusCopy(whisker(`${MARK.whiskers}-hover`, false, 1)));
        dims.push(MARK.whiskers);
        if (series.showCaps !== false) {
          // A cap's colour is its row's: a mark per colour (a link's stroke is one per mark here).
          for (const [n, c] of [...new Set(estimates.map(colorOf))].entries()) {
            const group = estimates.filter((e) => e.color === c);
            for (const end of ["low", "high"] as const) {
              const id = `${end === "low" ? MARK.lowCaps : MARK.highCaps}-${n}`;
              marks.push(cap(id, end, group, c, 0.65));
              copies.push(focusCopy(cap(`${id}-hover`, end, group, c, 1)));
              dims.push(id);
              capDelays.push([id, group.map((e) => e.index)]);
            }
          }
        }
        marks.push(point(MARK.points));
        copies.push(focusCopy(point(`${MARK.points}-hover`)));
        dims.push(MARK.points);
      }
      const hit = dot(estimates, { id: MARK.hit, x: horizontal ? (e: Estimate) => e.high : cat, y: horizontal ? cat : (e: Estimate) => e.value, key, r: 1, fillOpacity: 0, motion: false });
      const definition = defineChart(erase({
        chart: ({ width: w, height }: { readonly width: number; readonly height: number }) => {
          size.set(w, height);
          return { marks: [...marks, ...copies, hit], scales: categoryScales(frame, carriers, series?.formatValue, w), margin, theme: bklitTheme };
        },
        focus: categoryFocus(MARK.hit, frame, size),
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(carriers.tooltip, horizontal ? "point" : "column", {}),
      }));
      const name = series?.label ?? series?.dataKey ?? "";
      const interval = series?.intervalLabel ?? "Range";
      const items: PlotItem[] = estimates.map((e) => ({
        datum: e.row,
        index: e.index,
        title: e.label,
        rows: [
          { color: e.color, label: name, value: format(e.value) },
          { color: "transparent", label: interval, value: `${format(e.low)} – ${format(e.high)}` },
        ],
      }));
      const set = new Set<unknown>(estimates);
      const rowIndex = new Map<unknown, number>(estimates.map((e) => [e.row, e.index] as const));
      const chrome = categoryChrome(frame, carriers.tooltip, [{ valueOf: (i) => estimates[i]?.value, color: (i) => estimates[i]?.color ?? color }], rowIndex);
      const reveal = enter.animate ? enter.durationMs : 0;
      const css = [
        hoverDimCss(scope, dims.map((id) => (capDelays.some(([cap]) => cap === id) ? { id, lines: { strokeOpacity: 0.65 } } : { id })), series?.fadedOpacity),
        reveal > 0
          ? [
              PLOT_FADE_KEYFRAMES,
              PLOT_POP_KEYFRAMES,
              lateFadeCss(scope, late, 0),
              popInCss(scope, MARK.points, "circle", estimates.map((e) => delayOf(e.index) + run * 0.55)),
              // Caps fade in as a group once the intervals are out (a scale from a zero-height line box glitches under the hover's opacity).
              lateFadeCss(scope, capDelays.map(([id]) => id), enter.durationMs * 0.75, 300),
            ].join("")
          : "",
      ].join("");
      return {
        definition,
        items,
        itemOf: (datum) => (set.has(datum) ? (datum as Estimate).index : -1),
        margin,
        box: { aspectRatio: parseAspectRatio(props.aspectRatio ?? (horizontal ? "3 / 2" : "2 / 1")) },
        describe: () => describeErrorBars(props.data, xKey, table),
        ariaLabel: props.ariaLabel ?? "Error bar chart",
        ariaDescription: props.ariaDescription,
        css,
        chrome,
        skeleton: errorBarSkeleton(frame, width, capWidth, radius, series?.showCaps !== false),
      };
    });
  };
}

/** The error bar chart on the shared plot controller (core/plot/controller.ts). */
export const errorBarFamily = (): PlotFamily<ErrorBarInput> => ({ chart: "error-bar", build: createErrorBarBuilder() });
