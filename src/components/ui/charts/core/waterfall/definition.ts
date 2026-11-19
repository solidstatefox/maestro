import { barY, defineChart, dot, link, text } from "@tanstack/charts";
import type { ChartCurve } from "@tanstack/charts";
import { labelWidth } from "../axis-fit";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { intFmt } from "../format";
import { memoCell } from "../memo";
import { bklitTheme } from "../theme";
import type { TooltipRow } from "../types/tooltip";
import type { WaterfallChartProps, WaterfallProps as WaterfallSeriesProps } from "../types/waterfall";
import { bandWidth, categoryCarriers, categoryChrome, categoryFocus, categoryMargin, categoryScales, categorySpan, skeletonFrame, zeroShare } from "../plot/category";
import type { CategoryFrame } from "../plot/category";
import { hoverDimCss, lateFadeCss, PLOT_FADE_KEYFRAMES } from "../plot/css";
import { enterMotion, focusCopy, itemKey, plotEnter, plotTooltip, stagger, valueDomain } from "../plot/definition";
import { skeletonBetween, skeletonSeed } from "../plot/loading";
import type { PlotSkeleton } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { parseAspectRatio } from "../theme";
import { describeWaterfall } from "../plot/describe";

/** The props a WaterfallChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type WaterfallInput = Omit<WaterfallChartProps<unknown, unknown>, "className" | "style" | "children">;

/** One bar: a step from `start` to `end`, or a total from zero. */
interface Step {
  readonly index: number;
  readonly kind: "increase" | "decrease" | "total";
  readonly start: number;
  readonly end: number;
  readonly delta: number;
  readonly label: string;
  /** The reader's row (the appended total's is made up). */
  readonly row: PlotDatum;
  /** The row's index in `data` (`data.length` for the appended total). */
  readonly dataIndex: number;
}

const MARK = { bars: "wf-bars", connectors: "wf-connectors", labels: "wf-labels", hit: "wf-hit" } as const;
/** Two value labels run together when they are less than LABEL_GAP px apart side to side and less than LABEL_LINE px apart in height. */
const LABEL_GAP = 4;
const LABEL_LINE = 14;
const DEFAULT_ASPECT_RATIO = "2 / 1";

const numberOf = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** The cumulative preparation: each row's change from the running total; a total row with a value of its own sets the running total to it
 * (a starting balance), one without shows the running total (a subtotal); both are drawn from zero. */
function stepsOf(data: readonly PlotDatum[], xKey: string, series: WaterfallSeriesProps): Step[] {
  const totalKey = series.totalKey ?? "total";
  const steps: Step[] = [];
  let running = 0;
  for (const [dataIndex, row] of data.entries()) {
    const label = String(row[xKey] ?? "");
    const raw = row[series.dataKey];
    if (row[totalKey] === true) {
      const own = raw === undefined || raw === null || raw === "" ? undefined : numberOf(raw);
      running = own ?? running;
      steps.push({ index: steps.length, kind: "total", start: 0, end: running, delta: running, label, row, dataIndex });
      continue;
    }
    const delta = numberOf(raw);
    steps.push({ index: steps.length, kind: delta < 0 ? "decrease" : "increase", start: running, end: running + delta, delta, label, row, dataIndex });
    running += delta;
  }
  if (series.showTotal === true) {
    const label = series.totalLabel ?? "Total";
    steps.push({ index: steps.length, kind: "total", start: 0, end: running, delta: running, label, row: { [xKey]: label, [series.dataKey]: running, [totalKey]: true }, dataIndex: data.length });
  }
  return steps;
}

/** A dashed connector trimmed to the gap between two bars: its points are the two band centres, `half()` half a bar's width. */
const gapCurve = (half: () => number): ChartCurve => ({
  line: (points) => {
    const [a, b] = points;
    if (a === undefined || b === undefined) {
      return "";
    }
    const h = half();
    return `M${a[0] + h},${a[1]}L${b[0] - h},${b[1]}`;
  },
  area: () => "",
});

const valueOf = (step: Step): string => String(step.index);

/** Skeleton bars when there are no rows yet. */
const SKELETON_STEPS = 8;

/** The loading skeleton: a bridge on the chart's bands, a total from zero, steps rising and falling from where the last one ended, and
 * the closing total from zero (shares of the plot's height, seeded). */
const waterfallSkeleton = (chart: CategoryFrame, radius: number): PlotSkeleton => {
  const frame = skeletonFrame(chart, SKELETON_STEPS);
  const n = frame.count;
  // The totals stand on the zero line (the plot's foot until there is data).
  const base = zeroShare(frame);
  const floor = Math.min(0.9, base + 0.14);
  const spans: [number, number][] = [];
  let running = base + (0.92 - base) * skeletonBetween(0, 0.45, 0.62, 3);
  spans.push([base, running]);
  for (let i = 1; i < n - 1; i += 1) {
    const rise = skeletonSeed(i, 5) < 0.62 || running < floor + 0.12;
    const step = (0.92 - base) * skeletonBetween(i, 0.08, 0.22, 7);
    const next = Math.min(0.92, Math.max(floor, running + (rise ? step : -step)));
    spans.push([running, next]);
    running = next;
  }
  if (n > 1) {
    spans.push([base, running]);
  }
  return (size) => spans.map(([from, to], i) => categorySpan(frame, size, i, from, Math.abs(to - from) < 0.02 ? from + 0.02 : to, { radius }));
};

/** The waterfall family's builder (core/plot/types.ts `PlotFamily`). */
function createWaterfallBuilder(): PlotFamily<WaterfallInput>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<WaterfallInput>): PlotBuild => {
    const series = propsFor<WaterfallSeriesProps>(table, "waterfall").at(0);
    const carriers = categoryCarriers(table);
    return cell([props, series, carriers.grid, carriers.xAxis, carriers.yAxis, carriers.tooltip], () => {
      const xKey = props.xDataKey ?? "label";
      const steps = series === undefined ? [] : stepsOf(props.data, xKey, series);
      const margin = categoryMargin(props.margin);
      const frame: CategoryFrame = {
        count: steps.length,
        labels: steps.map((s) => s.label),
        horizontal: false,
        padding: props.barGap ?? 0.24,
        margin,
        domain: valueDomain(steps.flatMap((s) => [s.start, s.end])),
      };
      const positive = series?.positiveFill ?? "var(--chart-positive)";
      const negative = series?.negativeFill ?? "var(--chart-negative)";
      const totalFill = series?.totalFill ?? "var(--chart-1)";
      const colorOf = (step: Step): string => (step.kind === "total" ? totalFill : step.kind === "increase" ? positive : negative);
      const format = series?.formatValue ?? intFmt;
      const signed = (step: Step): string => {
        if (step.kind === "total") {
          return format(step.end);
        }
        const sign = step.delta > 0 ? "+" : step.delta < 0 ? "−" : "";
        return `${sign}${format(Math.abs(step.delta))}`;
      };
      const enter = plotEnter(props);
      const delayOf = stagger(enter, steps.length);
      const radius = series?.radius ?? 4;
      const live = { band: 0 };
      const bars = (id: string, motion: boolean) =>
        barY(steps, { id, x: valueOf, y1: (s) => s.start, y2: (s) => s.end, key: (s) => itemKey(s.index), fill: colorOf, radius, motion: motion ? enterMotion(enter, (s, i) => delayOf(s?.index ?? i)) : false });
      const label = (id: string, color: string) =>
        text(steps, { id, x: valueOf, y: (s) => Math.max(s.start, s.end), text: signed, key: (s) => itemKey(s.index), fill: color, fontSize: 12, fontWeight: 500, anchor: "middle", dy: -10, motion: false });
      const marks: object[] = [];
      const copies: object[] = [];
      const dims: string[] = [];
      const late: string[] = [];
      let valueLabels: object | undefined;
      if (series !== undefined) {
        marks.push(bars(MARK.bars, true));
        copies.push(focusCopy(bars(`${MARK.bars}-hover`, false)));
        dims.push(MARK.bars);
        if (series.showConnectors !== false && steps.length > 1) {
          marks.push(link(steps.slice(0, -1), {
            id: MARK.connectors,
            x1: valueOf,
            x2: (s) => String(s.index + 1),
            y1: (s) => s.end,
            y2: (s) => s.end,
            key: (s) => itemKey(s.index),
            stroke: "var(--chart-foreground-muted)",
            strokeWidth: 1,
            strokeDasharray: "3 3",
            curve: gapCurve(() => live.band / 2),
            motion: false,
          }));
          dims.push(MARK.connectors);
          late.push(MARK.connectors);
        }
        if (series.showValues !== false) {
          valueLabels = label(MARK.labels, "var(--chart-label)");
          marks.push(valueLabels);
          copies.push(focusCopy(label(`${MARK.labels}-hover`, "var(--chart-foreground)")));
          dims.push(MARK.labels);
          late.push(MARK.labels);
        }
      }
      const hit = dot(steps, { id: MARK.hit, x: valueOf, y: (s) => s.end, key: (s) => itemKey(s.index), r: 1, fillOpacity: 0, motion: false });
      // Each value label sits over its bar's top. When two neighbours would run into each other (a narrow chart, steps of about the same
      // height), the labels show on hover only.
      const labelWidths = steps.map((step) => labelWidth(signed(step)));
      const crowded = (innerWidth: number, innerHeight: number): boolean => {
        const pitch = innerWidth / Math.max(1, steps.length);
        const [lo, hi] = frame.domain;
        const top = (step: Step): number => ((Math.max(step.start, step.end) - lo) / (hi - lo || 1)) * innerHeight;
        return steps.some((step, i) => {
          const next = steps[i + 1];
          return next !== undefined && ((labelWidths[i] ?? 0) + (labelWidths[i + 1] ?? 0)) / 2 + LABEL_GAP > pitch && Math.abs(top(step) - top(next)) < LABEL_LINE;
        });
      };
      const definition = defineChart(erase({
        chart: ({ width, height }: { readonly width: number; readonly height: number }) => {
          size.set(width, height);
          const innerWidth = Math.max(0, width - margin.left - margin.right);
          live.band = bandWidth(frame, innerWidth);
          const shown = valueLabels !== undefined && crowded(innerWidth, height - margin.top - margin.bottom) ? marks.filter((mark) => mark !== valueLabels) : marks;
          return { marks: [...shown, ...copies, hit], scales: categoryScales(frame, carriers, series?.formatValue, width), margin, theme: bklitTheme };
        },
        focus: categoryFocus(MARK.hit, frame, size),
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(carriers.tooltip, "column", {}),
      }));
      const name = series?.label;
      const items: PlotItem[] = steps.map((step) => {
        const rows: TooltipRow[] = step.kind === "total"
          ? [{ color: colorOf(step), label: name ?? "Total", value: format(step.end) }]
          : [
              { color: colorOf(step), label: name ?? (step.kind === "increase" ? "Increase" : "Decrease"), value: signed(step) },
              { color: "transparent", label: "Running total", value: format(step.end) },
            ];
        return { datum: step.row, index: step.dataIndex, title: step.label, rows };
      });
      const rowIndex = new Map<unknown, number>(steps.map((s) => [s.row, s.index] as const));
      const stepSet = new Set<unknown>(steps);
      const chrome = categoryChrome(frame, carriers.tooltip, [{ valueOf: (i) => steps[i]?.end, color: (i) => (steps[i] === undefined ? totalFill : colorOf(steps[i])) }], rowIndex);
      const reveal = enter.animate ? enter.durationMs : 0;
      const css = [
        hoverDimCss(scope, dims.map((id) => (id === MARK.connectors ? { id, lines: {} } : { id })), series?.fadedOpacity),
        reveal > 0 ? `${PLOT_FADE_KEYFRAMES}${lateFadeCss(scope, late, reveal * 0.75)}` : "",
      ].join("");
      return {
        definition,
        items,
        itemOf: (datum) => (stepSet.has(datum) ? (datum as Step).index : -1),
        margin,
        box: { aspectRatio: parseAspectRatio(props.aspectRatio ?? DEFAULT_ASPECT_RATIO) },
        describe: () => describeWaterfall(props.data, xKey, table),
        ariaLabel: props.ariaLabel ?? "Waterfall chart",
        ariaDescription: props.ariaDescription,
        css,
        chrome,
        skeleton: waterfallSkeleton(frame, radius),
      };
    });
  };
}

/** The waterfall family on the shared plot controller (core/plot/controller.ts). */
export const waterfallFamily = (): PlotFamily<WaterfallInput> => ({ chart: "waterfall", build: createWaterfallBuilder() });
