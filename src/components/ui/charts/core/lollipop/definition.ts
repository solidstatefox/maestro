import { barX, barY, defineChart, dot, text } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { intFmt } from "../format";
import { memoCell } from "../memo";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { LollipopChartProps, LollipopProps as LollipopSeriesProps } from "../types/lollipop";
import { categoryCarriers, categoryChrome, categoryDot, categoryFocus, categoryMargin, categoryScales, categorySpan, skeletonFrame, zeroShare } from "../plot/category";
import type { CategoryFrame } from "../plot/category";
import { hoverDimCss, lateFadeCss, PLOT_FADE_KEYFRAMES, PLOT_POP_KEYFRAMES, popInCss } from "../plot/css";
import { enterMotion, focusCopy, itemKey, plotEnter, plotTooltip, stagger, valueDomain } from "../plot/definition";
import { skeletonBetween, skeletonSeed } from "../plot/loading";
import type { PlotSkeleton } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { describeLollipop } from "../plot/describe";

/** The props a LollipopChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type LollipopInput = Omit<LollipopChartProps<unknown, unknown>, "className" | "style" | "children">;

interface Pop {
  readonly index: number;
  readonly value: number;
  readonly label: string;
  readonly row: PlotDatum;
}

const MARK = { stems: "lp-stems", heads: "lp-heads", labels: "lp-labels", hit: "lp-hit" } as const;

const numberOf = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Skeleton lollipops when there are no rows yet. */
const SKELETON_POPS = 10;

/** The loading skeleton: a stem from the zero line and a head on each band, at seeded lengths (to either side when the axis spans zero). */
const lollipopSkeleton = (chart: CategoryFrame, stemWidth: number, radius: number): PlotSkeleton => {
  const frame = skeletonFrame(chart, SKELETON_POPS);
  const base = zeroShare(frame);
  const ends = Array.from({ length: frame.count }, (_, i) => {
    const down = base > 0.05 && (base > 0.95 || skeletonSeed(i, 11) < 0.35);
    const room = down ? base : 1 - base;
    return base + (down ? -1 : 1) * room * skeletonBetween(i, 0.3, 0.88, 13);
  });
  return (size) => ends.flatMap((end, i) => [
    categorySpan(frame, size, i, base, end, { thickness: stemWidth, radius: stemWidth / 2, tone: 0.6 }),
    categoryDot(frame, size, i, end, radius),
  ]);
};

function createLollipopBuilder(): PlotFamily<LollipopInput>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<LollipopInput>): PlotBuild => {
    const series = propsFor<LollipopSeriesProps>(table, "lollipop").at(0);
    const carriers = categoryCarriers(table);
    return cell([props, series, carriers.grid, carriers.xAxis, carriers.yAxis, carriers.tooltip], () => {
      const xKey = props.xDataKey ?? "name";
      const horizontal = props.orientation === "horizontal";
      const pops: Pop[] = series === undefined ? [] : props.data.map((row, index) => ({ index, value: numberOf(row[series.dataKey]), label: String(row[xKey] ?? ""), row }));
      const margin = categoryMargin(props.margin);
      const frame: CategoryFrame = { count: pops.length, labels: pops.map((p) => p.label), horizontal, padding: 0.2, margin, domain: valueDomain(pops.map((p) => p.value)) };
      const color = series?.color ?? "var(--chart-1)";
      const format = series?.formatValue ?? intFmt;
      const enter = plotEnter(props);
      const delayOf = stagger(enter, pops.length);
      const cat = (p: Pop): string => String(p.index);
      const at = { x: horizontal ? (p: Pop) => p.value : cat, y: horizontal ? cat : (p: Pop) => p.value };
      const radius = series?.radius ?? 6;
      // A stem is a thin bar from zero: the renderer grows it from its baseline on the first paint, as it does bklit's bars.
      const stemWidth = series?.strokeWidth ?? 2;
      const stem = (id: string, motion: boolean, opacity: number) => {
        const common = { key: (p: Pop) => itemKey(p.index), fill: color, fillOpacity: opacity, maxThickness: stemWidth, radius: stemWidth / 2, motion: motion ? enterMotion(enter, (p: Pop | undefined, i: number) => delayOf(p?.index ?? i)) : false };
        return horizontal ? barX(pops, { ...common, id, y: cat, x: (p) => p.value }) : barY(pops, { ...common, id, x: cat, y: (p) => p.value });
      };
      const head = (id: string, motion: boolean) =>
        dot(pops, { id, x: at.x, y: at.y, key: (p) => itemKey(p.index), r: radius, fill: color, stroke: "var(--chart-background)", strokeWidth: 2, motion: motion ? enterMotion(enter, () => 0) : false });
      const label = (id: string, fill: string) =>
        text(pops, { id, x: at.x, y: at.y, text: (p) => format(p.value), key: (p) => itemKey(p.index), fill, fontSize: 12, fontWeight: 500, anchor: horizontal ? "start" : "middle", dx: horizontal ? radius + 8 : 0, dy: horizontal ? 0 : -(radius + 10), motion: false });
      const marks: object[] = [];
      const copies: object[] = [];
      const dims: string[] = [];
      const late: string[] = [];
      if (series !== undefined) {
        const stemOpacity = series.stemOpacity ?? 0.45;
        marks.push(stem(MARK.stems, true, stemOpacity), head(MARK.heads, true));
        copies.push(focusCopy(stem(`${MARK.stems}-hover`, false, Math.min(1, stemOpacity + 0.35))), focusCopy(head(`${MARK.heads}-hover`, false)));
        dims.push(MARK.stems, MARK.heads);
        if (series.showValues === true) {
          marks.push(label(MARK.labels, "var(--chart-label)"));
          copies.push(focusCopy(label(`${MARK.labels}-hover`, "var(--chart-foreground)")));
          dims.push(MARK.labels);
          late.push(MARK.labels);
        }
      }
      const hit = dot(pops, { id: MARK.hit, x: at.x, y: at.y, key: (p) => itemKey(p.index), r: 1, fillOpacity: 0, motion: false });
      const definition = defineChart(erase({
        chart: ({ width, height }: { readonly width: number; readonly height: number }) => {
          size.set(width, height);
          return { marks: [...marks, ...copies, hit], scales: categoryScales(frame, carriers, series?.formatValue, width), margin, theme: bklitTheme };
        },
        focus: categoryFocus(MARK.hit, frame, size),
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(carriers.tooltip, horizontal ? "point" : "column", {}),
      }));
      const name = series?.label ?? series?.dataKey ?? "";
      const items: PlotItem[] = pops.map((p) => ({ datum: p.row, index: p.index, title: p.label, rows: [{ color, label: name, value: format(p.value) }] }));
      const popSet = new Set<unknown>(pops);
      const rowIndex = new Map<unknown, number>(pops.map((p) => [p.row, p.index] as const));
      const chrome = categoryChrome(frame, carriers.tooltip, [{ valueOf: (i) => pops[i]?.value, color }], rowIndex);
      const reveal = enter.animate ? enter.durationMs : 0;
      // The heads pop in as their stems arrive (the renderer gives dots no first-paint entrance).
      const run = reveal * 0.6;
      const css = [
        hoverDimCss(scope, dims.map((id) => ({ id })), series?.fadedOpacity),
        reveal > 0 ? `${PLOT_FADE_KEYFRAMES}${PLOT_POP_KEYFRAMES}${lateFadeCss(scope, late, reveal * 0.75)}${popInCss(scope, MARK.heads, "circle", pops.map((p) => delayOf(p.index) + run * 0.7))}` : "",
      ].join("");
      return {
        definition,
        items,
        itemOf: (datum) => (popSet.has(datum) ? (datum as Pop).index : -1),
        margin,
        box: { aspectRatio: parseAspectRatio(props.aspectRatio ?? "2 / 1") },
        describe: () => describeLollipop(props.data, xKey, table),
        ariaLabel: props.ariaLabel ?? "Lollipop chart",
        ariaDescription: props.ariaDescription,
        css,
        chrome,
        skeleton: lollipopSkeleton(frame, stemWidth, radius),
      };
    });
  };
}

/** The lollipop family on the shared plot controller (core/plot/controller.ts). */
export const lollipopFamily = (): PlotFamily<LollipopInput> => ({ chart: "lollipop", build: createLollipopBuilder() });
