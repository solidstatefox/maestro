import { barX, barY, defineChart, dot, text } from "@tanstack/charts";
import { labelWidth } from "../axis-fit";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { intFmt } from "../format";
import { memoCell } from "../memo";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { TooltipRow } from "../types/tooltip";
import type { DumbbellChartProps, DumbbellProps as DumbbellSeriesProps } from "../types/dumbbell";
import { categoryCarriers, categoryChrome, categoryFocus, categoryMargin, categoryScales, categoryDot, categorySpan, skeletonFrame } from "../plot/category";
import type { CategoryFrame } from "../plot/category";
import { hoverDimCss, lateFadeCss, legendDimCss, PLOT_FADE_KEYFRAMES, PLOT_POP_KEYFRAMES, popInCss } from "../plot/css";
import { enterMotion, focusCopy, itemKey, plotEnter, plotTooltip, stagger, valueDomain } from "../plot/definition";
import { skeletonBetween } from "../plot/loading";
import type { PlotSkeleton } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { describeDumbbell } from "../plot/describe";

/** The props a DumbbellChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type DumbbellInput = Omit<DumbbellChartProps<unknown, unknown>, "className" | "style" | "children">;

interface Bell {
  readonly index: number;
  readonly from: number;
  readonly to: number;
  readonly label: string;
  readonly row: PlotDatum;
}

const MARK = { bars: "db-bars", from: "db-from", to: "db-to", fromLabels: "db-from-labels", toLabels: "db-to-labels", hit: "db-hit" } as const;
/** A value label's room past its dot's edge: the label's offset (6px) and a gap to whatever is beyond it. */
const LABEL_ROOM = 10;

const numberOf = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Skeleton dumbbells when there are no rows yet. */
const SKELETON_BELLS = 6;

/** The loading skeleton: on each band a bar between two seeded points of the value axis and a dot on either end. */
const dumbbellSkeleton = (chart: CategoryFrame, barSize: number, radius: number): PlotSkeleton => {
  const frame = skeletonFrame(chart, SKELETON_BELLS);
  const pairs = Array.from({ length: frame.count }, (_, i) => {
    const from = skeletonBetween(i, 0.1, 0.5, 17);
    return [from, Math.min(0.94, from + skeletonBetween(i, 0.16, 0.42, 19))] as const;
  });
  return (size) => pairs.flatMap(([from, to], i) => [
    categorySpan(frame, size, i, from, to, { thickness: barSize, radius: barSize / 2, tone: 0.55 }),
    categoryDot(frame, size, i, from, radius, 0.7),
    categoryDot(frame, size, i, to, radius),
  ]);
};

function createDumbbellBuilder(): PlotFamily<DumbbellInput>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<DumbbellInput>): PlotBuild => {
    const series = propsFor<DumbbellSeriesProps>(table, "dumbbell").at(0);
    const carriers = categoryCarriers(table);
    return cell([props, series, carriers.grid, carriers.xAxis, carriers.yAxis, carriers.tooltip], () => {
      const xKey = props.xDataKey ?? "name";
      const horizontal = props.orientation !== "vertical";
      const bells: Bell[] = series === undefined ? [] : props.data.map((row, index) => ({ index, from: numberOf(row[series.from]), to: numberOf(row[series.to]), label: String(row[xKey] ?? ""), row }));
      const margin = categoryMargin(props.margin);
      // The distance is the point, not the magnitude: the value axis spans the values (with some air), not from zero.
      const frame: CategoryFrame = { count: bells.length, labels: bells.map((b) => b.label), horizontal, padding: 0.3, margin, domain: valueDomain(bells.flatMap((b) => [b.from, b.to]), { zero: false, pad: 0.08 }) };
      const fromColor = series?.fromColor ?? "var(--chart-foreground-muted)";
      const toColor = series?.toColor ?? "var(--chart-1)";
      const barColor = series?.barColor ?? toColor;
      const format = series?.formatValue ?? intFmt;
      const radius = series?.radius ?? 6;
      const barSize = series?.barSize ?? 6;
      const enter = plotEnter(props);
      const delayOf = stagger(enter, bells.length);
      const run = enter.durationMs * 0.6;
      const cat = (b: Bell): string => String(b.index);
      const key = (b: Bell): string => itemKey(b.index);
      const bar = (id: string, motion: boolean, opacity: number) => {
        const common = { key, fill: barColor, fillOpacity: opacity, maxThickness: barSize, radius: barSize / 2, motion: motion ? enterMotion(enter, (b: Bell | undefined, i: number) => delayOf(b?.index ?? i) + run * 0.25) : false };
        return horizontal ? barX(bells, { ...common, id, y: cat, x1: (b) => b.from, x2: (b) => b.to }) : barY(bells, { ...common, id, x: cat, y1: (b) => b.from, y2: (b) => b.to });
      };
      const end = (id: string, which: "from" | "to", fill: string) =>
        dot(bells, { id, x: horizontal ? (b: Bell) => b[which] : cat, y: horizontal ? cat : (b: Bell) => b[which], key, r: radius, fill, stroke: "var(--chart-background)", strokeWidth: 2, motion: false });
      // A label sits outside its end: past the larger value, before the smaller.
      const label = (id: string, which: "from" | "to", fill: string) =>
        text(bells, {
          id,
          x: horizontal ? (b: Bell) => b[which] : cat,
          y: horizontal ? cat : (b: Bell) => b[which],
          text: (b) => format(b[which]),
          key,
          fill,
          fontSize: 12,
          fontWeight: 500,
          anchor: horizontal ? (b: Bell) => ((b[which] >= (which === "from" ? b.to : b.from)) ? "start" : "end") : "middle",
          dx: horizontal ? (b: Bell) => ((b[which] >= (which === "from" ? b.to : b.from)) ? radius + 6 : -(radius + 6)) : 0,
          dy: horizontal ? 0 : (b: Bell) => ((b[which] >= (which === "from" ? b.to : b.from)) ? -(radius + 10) : radius + 16),
          motion: false,
        });
      const marks: object[] = [];
      const copies: object[] = [];
      const dims: string[] = [];
      const late: string[] = [];
      if (series !== undefined) {
        marks.push(bar(MARK.bars, true, 0.3), end(MARK.from, "from", fromColor), end(MARK.to, "to", toColor));
        copies.push(focusCopy(bar(`${MARK.bars}-hover`, false, 0.55)), focusCopy(end(`${MARK.from}-hover`, "from", fromColor)), focusCopy(end(`${MARK.to}-hover`, "to", toColor)));
        dims.push(MARK.bars, MARK.from, MARK.to);
        if (series.showValues === true) {
          marks.push(label(MARK.fromLabels, "from", "var(--chart-label)"), label(MARK.toLabels, "to", "var(--chart-label)"));
          copies.push(focusCopy(label(`${MARK.fromLabels}-hover`, "from", "var(--chart-foreground)")), focusCopy(label(`${MARK.toLabels}-hover`, "to", "var(--chart-foreground)")));
          dims.push(MARK.fromLabels, MARK.toLabels);
          late.push(MARK.fromLabels, MARK.toLabels);
        }
      }
      const hit = dot(bells, { id: MARK.hit, x: horizontal ? (b: Bell) => Math.max(b.from, b.to) : cat, y: horizontal ? cat : (b: Bell) => Math.max(b.from, b.to), key, r: 1, fillOpacity: 0, motion: false });
      // Lying down with its values shown, each label sits outside its end, so the value axis widens to leave every label its room (the
      // 8% padding alone runs the lowest one into the category labels on a narrow chart).
      const labelled = horizontal && series?.showValues === true;
      const roomFor = (value: number): number => labelWidth(format(value)) + radius + LABEL_ROOM;
      const widened = (innerWidth: number): CategoryFrame => {
        let [lo, hi] = frame.domain;
        // Twice: widening shrinks every value's room a little.
        for (let pass = 0; pass < 2 && innerWidth > 0; pass += 1) {
          const perPx = (hi - lo) / innerWidth;
          let shortLeft = 0;
          let shortRight = 0;
          for (const b of bells) {
            const low = Math.min(b.from, b.to);
            const high = Math.max(b.from, b.to);
            shortLeft = Math.max(shortLeft, roomFor(low) - (low - lo) / perPx);
            shortRight = Math.max(shortRight, roomFor(high) - (hi - high) / perPx);
          }
          lo -= shortLeft * perPx;
          hi += shortRight * perPx;
        }
        return lo === frame.domain[0] && hi === frame.domain[1] ? frame : { ...frame, domain: [lo, hi] };
      };
      const definition = defineChart(erase({
        chart: ({ width, height }: { readonly width: number; readonly height: number }) => {
          size.set(width, height);
          const scaled = labelled ? widened(width - margin.left - margin.right) : frame;
          return { marks: [...marks, ...copies, hit], scales: categoryScales(scaled, carriers, series?.formatValue, width), margin, theme: bklitTheme };
        },
        focus: categoryFocus(MARK.hit, frame, size),
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(carriers.tooltip, horizontal ? "point" : "column", {}),
      }));
      const fromName = series?.fromLabel ?? series?.from ?? "";
      const toName = series?.toLabel ?? series?.to ?? "";
      const items: PlotItem[] = bells.map((b) => {
        const rows: TooltipRow[] = [{ color: fromColor, label: fromName, value: format(b.from) }, { color: toColor, label: toName, value: format(b.to) }];
        if (series?.showChange !== false) {
          const diff = b.to - b.from;
          const pct = b.from === 0 ? "" : ` (${diff >= 0 ? "+" : "−"}${Math.abs(Math.round((diff / b.from) * 1000) / 10)}%)`;
          rows.push({ color: "transparent", label: "Change", value: `${diff >= 0 ? "+" : "−"}${format(Math.abs(diff))}${pct}` });
        }
        return { datum: b.row, index: b.index, title: b.label, rows };
      });
      const bellSet = new Set<unknown>(bells);
      const rowIndex = new Map<unknown, number>(bells.map((b) => [b.row, b.index] as const));
      const chrome = categoryChrome(frame, carriers.tooltip, [{ valueOf: (i) => bells[i]?.from, color: fromColor }, { valueOf: (i) => bells[i]?.to, color: toColor }], rowIndex);
      const reveal = enter.animate ? enter.durationMs : 0;
      const css = [
        hoverDimCss(scope, dims.map((id) => ({ id })), series?.fadedOpacity),
        legendDimCss(scope, [[MARK.from, MARK.fromLabels], [MARK.to, MARK.toLabels]]),
        reveal > 0
          ? `${PLOT_FADE_KEYFRAMES}${PLOT_POP_KEYFRAMES}${lateFadeCss(scope, late, reveal * 0.8)}${popInCss(scope, MARK.from, "circle", bells.map((b) => delayOf(b.index)))}${popInCss(scope, MARK.to, "circle", bells.map((b) => delayOf(b.index) + run * 0.85))}`
          : "",
      ].join("");
      return {
        definition,
        items,
        itemOf: (datum) => (bellSet.has(datum) ? (datum as Bell).index : -1),
        margin,
        box: { aspectRatio: parseAspectRatio(props.aspectRatio ?? (horizontal ? "3 / 2" : "2 / 1")) },
        describe: () => describeDumbbell(props.data, xKey, table),
        ariaLabel: props.ariaLabel ?? "Dumbbell chart",
        ariaDescription: props.ariaDescription,
        css,
        chrome,
        skeleton: dumbbellSkeleton(frame, barSize, radius),
      };
    });
  };
}

/** The dumbbell family on the shared plot controller (core/plot/controller.ts). */
export const dumbbellFamily = (): PlotFamily<DumbbellInput> => ({ chart: "dumbbell", build: createDumbbellBuilder() });
