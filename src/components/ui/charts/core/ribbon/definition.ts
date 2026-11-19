import { areaY, defineChart, dot, lineY } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { curveMonotoneX } from "d3-shape";
import { propsFor } from "../carriers/table";
import { toDate } from "../cartesian/series";
import type { GridGuideProps } from "../cartesian/grid-guides";
import type { HoverOverlayModel, OverlayDot, OverlayPlot } from "../cartesian/hover-overlay";
import { erase } from "../erased-types";
import { shortDateFmt, weekdayDateFmt } from "../format";
import { memoCell } from "../memo";
import { scaleLinear, scaleTime } from "../scales";
import { bklitTheme, parseAspectRatio, X_TICK_PADDING } from "../theme";
import type { TooltipRow } from "../types/tooltip";
import type { XAxisConfig, YAxisConfig } from "../types/cartesian";
import type { RibbonChartProps, RibbonLineProps, RibbonProps } from "../types/uncertainty";
import { categoryFocus, categoryMargin } from "../plot/category";
import type { CategoryFrame, CategoryTooltipProps } from "../plot/category";
import { legendDimCss, PLOT_WIPE_KEYFRAMES, wipeInCss } from "../plot/css";
import { itemKey, plotEnter, plotTooltip, scaleGrid, TICK_LABELS, valueAxis, valueDomain, valueFormat } from "../plot/definition";
import { skeletonSeed } from "../plot/loading";
import type { PlotSkeleton, SkeletonPoint, SkeletonShape } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { decimalFormat } from "../error-bar/definition";
import { describeRibbons } from "../plot/describe";

/** The props a RibbonChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type RibbonInput = Omit<RibbonChartProps<unknown, unknown>, "className" | "style" | "children">;

interface Step {
  readonly index: number;
  readonly date: Date;
  readonly row: PlotDatum;
}

const HIT = "rb-hit";

const numberOf = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

/** The skeleton's points across the plot. */
const SKELETON_POINTS = 14;

/** The loading skeleton: nested bands around a wandering median, widening with time (a forecast's), on the monotone curve. `bands` and
 * `lines` are the chart's counts (two bands and a line before it has parts). */
const ribbonSkeleton = (bands: number, lines: number): PlotSkeleton => {
  const last = SKELETON_POINTS - 1;
  const mid = Array.from({ length: SKELETON_POINTS }, (_, j) => 0.48 + 0.13 * Math.sin(j * 0.62 + 0.8) + (skeletonSeed(j, 37) - 0.5) * 0.05);
  const spread = (j: number): number => 0.1 + 0.1 * (j / last);
  const shown = bands > 0 || lines > 0 ? { bands, lines } : { bands: 2, lines: 1 };
  return ({ width, height }) => {
    const at = (j: number, share: number): SkeletonPoint => [(j / last) * width, height * (1 - share)];
    const shapes: SkeletonShape[] = [];
    for (let b = 0; b < shown.bands; b += 1) {
      // The outer band first: each next one is narrower, so the middle reads stronger where they overlap.
      const scale = 1 - b * (0.5 / Math.max(1, shown.bands - 1));
      shapes.push({
        kind: "band",
        top: mid.map((m, j) => at(j, m + spread(j) * scale)),
        bottom: mid.map((m, j) => at(j, m - spread(j) * scale)),
        curve: "monotone",
        tone: 0.4,
      });
    }
    if (shown.lines > 0) {
      shapes.push({ kind: "line", points: mid.map((m, j) => at(j, m)), width: 2, curve: "monotone" });
    }
    return shapes;
  };
};

function createRibbonBuilder(): PlotFamily<RibbonInput>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<RibbonInput>): PlotBuild => {
    const ribbons = propsFor<RibbonProps>(table, "ribbon");
    const lines = propsFor<RibbonLineProps>(table, "ribbonLine");
    const grid = propsFor<GridGuideProps>(table, "grid").at(0);
    const xAxis = propsFor<XAxisConfig>(table, "xAxis").at(0);
    const yAxis = propsFor<YAxisConfig>(table, "yAxis").at(0);
    const tooltip = propsFor<CategoryTooltipProps>(table, "tooltip").at(0);
    return cell([props, ribbons, lines, grid, xAxis, yAxis, tooltip], () => {
      const xKey = props.xDataKey ?? "date";
      const steps: Step[] = props.data.map((row, index) => ({ index, date: toDate(row[xKey]), row })).filter((s) => Number.isFinite(s.date.getTime()));
      const margin = categoryMargin(props.margin);
      const values = steps.flatMap((s) => [
        ...ribbons.flatMap((r) => [numberOf(s.row[r.lowKey]), numberOf(s.row[r.highKey])]),
        ...lines.map((l) => numberOf(s.row[l.dataKey])),
      ]).filter(Number.isFinite);
      const domain = valueDomain(values, { zero: false, pad: 0.05 });
      const t0 = steps[0]?.date ?? new Date(0);
      const t1 = steps.at(-1)?.date ?? new Date(1);
      const enter = plotEnter(props);
      const curve = d3Curve(curveMonotoneX);
      const format = lines.find((l) => l.formatValue !== undefined)?.formatValue ?? decimalFormat;
      const x = (s: Step): Date => s.date;
      const marks: object[] = [];
      const series: string[][] = [];
      for (const [i, r] of ribbons.entries()) {
        const id = `rb-band-${i}`;
        marks.push(areaY(steps, { id, x, y1: (s) => numberOf(s.row[r.lowKey]), y2: (s) => numberOf(s.row[r.highKey]), fill: r.fill ?? "var(--chart-1)", fillOpacity: r.fillOpacity ?? 0.2, curve, motion: false }));
        series.push([id]);
      }
      for (const [i, l] of lines.entries()) {
        const id = `rb-line-${i}`;
        marks.push(lineY(steps, { id, x, y: (s) => numberOf(s.row[l.dataKey]), stroke: l.stroke ?? "var(--chart-1)", strokeWidth: l.strokeWidth ?? 2, strokeDasharray: l.strokeDasharray, curve, motion: false }));
        series.push([id]);
      }
      // The focus targets: one invisible point per row, on its first line (else its first band's middle).
      const anchor = (s: Step): number => {
        const [line] = lines;
        if (line !== undefined) {
          return numberOf(s.row[line.dataKey]);
        }
        const [band] = ribbons;
        return band === undefined ? domain[0] : (numberOf(s.row[band.lowKey]) + numberOf(s.row[band.highKey])) / 2;
      };
      const hit = dot(steps, { id: HIT, x, y: anchor, key: (s) => itemKey(s.index), r: 1, fillOpacity: 0, motion: false });
      const frame: CategoryFrame = { count: steps.length, labels: steps.map((s) => shortDateFmt.format(s.date)), horizontal: false, padding: 0, margin, domain };
      const xFormat = xAxis?.formatValue ?? ((d: Readonly<Date>): string => shortDateFmt.format(d));
      const scales = {
        x: {
          scale: scaleTime().domain([t0, t1]),
          grid: scaleGrid(grid, "x"),
          axis: xAxis === undefined ? false : { line: false, ticks: { count: xAxis.numTicks ?? 5, size: 0, padding: X_TICK_PADDING, format: xFormat }, tickLabels: TICK_LABELS },
        },
        y: {
          scale: scaleLinear().domain([...domain]),
          grid: scaleGrid(grid, "y"),
          axis: valueAxis(valueFormat({ formatValue: format, ...yAxis }), yAxis?.numTicks ?? 5, yAxis !== undefined, "y"),
        },
      };
      const definition = defineChart(erase({
        chart: ({ width, height }: { readonly width: number; readonly height: number }) => {
          size.set(width, height);
          return { marks: [...marks, hit], scales, margin, theme: bklitTheme };
        },
        focus: categoryFocus(HIT, frame, size),
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(tooltip, "column", {}),
      }));
      const items: PlotItem[] = steps.map((s) => {
        // A line or band without a value at this time (a forecast before it starts) has no row.
        const rows: TooltipRow[] = [
          ...lines.flatMap((l): TooltipRow[] => {
            const v = numberOf(s.row[l.dataKey]);
            return Number.isFinite(v) ? [{ color: l.stroke ?? "var(--chart-1)", label: l.label ?? l.dataKey, value: format(v) }] : [];
          }),
          ...ribbons.flatMap((r): TooltipRow[] => {
            const lo = numberOf(s.row[r.lowKey]);
            const hi = numberOf(s.row[r.highKey]);
            return Number.isFinite(lo) && Number.isFinite(hi) ? [{ color: r.fill ?? "var(--chart-1)", label: r.label ?? `${r.lowKey}–${r.highKey}`, value: `${format(lo)} – ${format(hi)}` }] : [];
          }),
        ];
        return { datum: s.row, index: s.index, title: weekdayDateFmt.format(s.date), rows };
      });
      const set = new Set<unknown>(steps);
      const span = t1.getTime() - t0.getTime() || 1;
      const yOf = (value: number, plot: OverlayPlot): number => plot.innerHeight - ((value - domain[0]) / (domain[1] - domain[0] || 1)) * plot.innerHeight;
      const dots: OverlayDot[] = tooltip?.showDots === false
        ? []
        : lines.map((l): OverlayDot => ({
            yAxis: "y",
            valueOf: () => undefined,
            at: (row, plot) => {
              const v = numberOf((row as PlotDatum)[l.dataKey]);
              return Number.isFinite(v) ? { dx: 0, y: yOf(v, plot) } : undefined;
            },
            shapes: [{ r: tooltip?.dotSize ?? 5, fill: l.stroke ?? "var(--chart-1)", stroke: "var(--chart-background)", strokeWidth: tooltip?.dotStrokeWidth ?? 2 }],
            glide: true,
          }));
      const model: HoverOverlayModel | null = tooltip === undefined
        ? null
        : {
            crosshair: tooltip.showCrosshair === false ? null : { color: "var(--chart-crosshair)", width: 1, dash: tooltip.indicatorDasharray },
            pill: tooltip.showDatePill === false ? null : { labels: frame.labels, layout: null },
            dots,
            indexOf: (key) => key,
            xOf: (key, plot) => (((steps[key]?.date.getTime() ?? t0.getTime()) - t0.getTime()) / span) * plot.innerWidth,
          };
      return {
        definition,
        items,
        itemOf: (datum) => (set.has(datum) ? (datum as Step).index : -1),
        margin,
        box: { aspectRatio: parseAspectRatio(props.aspectRatio ?? "2 / 1") },
        describe: () => describeRibbons(props.data, xKey, table),
        ariaLabel: props.ariaLabel ?? "Ribbon chart",
        ariaDescription: props.ariaDescription,
        // bklit's line reveal: the ribbons and lines wipe in left to right (the renderer would grow them up from the baseline).
        css: `${legendDimCss(scope, series)}${enter.animate ? `${PLOT_WIPE_KEYFRAMES}${wipeInCss(scope, enter.durationMs)}` : ""}`,
        chrome: model === null ? null : { model, keyOf: (index) => index },
        skeleton: ribbonSkeleton(ribbons.length, lines.length),
      };
    });
  };
}

/** The ribbon chart on the shared plot controller (core/plot/controller.ts). */
export const ribbonFamily = (): PlotFamily<RibbonInput> => ({ chart: "ribbon", build: createRibbonBuilder() });
