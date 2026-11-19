import { defineChart, dot, link, text } from "@tanstack/charts";
import type { ChartPoint } from "@tanstack/charts";
import { focusNearestX } from "@tanstack/charts/focus";
import { scalePoint } from "@tanstack/charts/scales/point";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { decimalFormat } from "../error-bar/definition";
import { memoCell } from "../memo";
import { scaleLinear } from "../scales";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import type { SlopeChartProps, SlopeProps } from "../types/slope";
import { hoverDimCss, PLOT_WIPE_KEYFRAMES, wipeInCss } from "../plot/css";
import { focusCopy, itemKey, plotEnter, plotTooltip, valueDomain } from "../plot/definition";
import { skeletonBetween, skeletonSeed } from "../plot/loading";
import type { PlotSkeleton, SkeletonShape } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { describeSlope } from "../plot/describe";

/** The props a SlopeChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type SlopeInput = Omit<SlopeChartProps<unknown, unknown>, "className" | "style" | "children">;

interface Line {
  readonly index: number;
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly up: boolean;
  readonly row: PlotDatum;
}

const MARK = { lines: "slope-lines", fromHit: "slope-hit-from", toHit: "slope-hit-to" } as const;
const LABEL_GAP = 14;

const numberOf = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

/** Pixel offsets that push labels at `positions` (px, top down) at least `gap` apart, kept inside [0, height]. */
function dodge(positions: readonly number[], gap: number, height: number): number[] {
  const order = positions.map((y, i) => ({ y, i })).toSorted((a, b) => a.y - b.y);
  const placed = order.map((o) => o.y);
  for (let k = 1; k < placed.length; k += 1) {
    placed[k] = Math.max(placed[k] ?? 0, (placed[k - 1] ?? 0) + gap);
  }
  const overflow = (placed.at(-1) ?? 0) - height;
  if (overflow > 0) {
    for (let k = placed.length - 1; k >= 0; k -= 1) {
      placed[k] = Math.min(placed[k] ?? 0, k === placed.length - 1 ? height : (placed[k + 1] ?? 0) - gap);
    }
  }
  const offsets = Array.from({ length: positions.length }, () => 0);
  for (const [k, o] of order.entries()) {
    offsets[o.i] = (placed[k] ?? o.y) - o.y;
  }
  return offsets;
}

/** Skeleton lines when there are no rows yet. */
const SKELETON_LINES = 6;

/** The loading skeleton: a line per row from a seeded height on the first column to one on the second, a dot on each end and, when the
 * margins have room, a pill where each end's label goes. */
const slopeSkeleton = (rows: number, width: number, left: number, right: number): PlotSkeleton => {
  const n = rows > 0 ? rows : SKELETON_LINES;
  // Each column keeps its rows a slot apart: the second column's order is the first's with seeded neighbours swapped (lines cross).
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i + 1 < n; i += 1) {
    if (skeletonSeed(i, 53) < 0.45) {
      [order[i], order[i + 1]] = [order[i + 1] ?? i + 1, order[i] ?? i];
      i += 1;
    }
  }
  const slot = (place: number, i: number, salt: number): number => (place + skeletonBetween(i, 0.2, 0.8, salt)) / n;
  const ends = Array.from({ length: n }, (_, i) => [slot(i, i, 47), slot(order.indexOf(i), i, 49)] as const);
  const pill = (room: number, i: number, salt: number): number => Math.min(room - width - 28, skeletonBetween(i, 48, 96, salt));
  return ({ width: w, height: h }) =>
    ends.flatMap(([from, to], i): SkeletonShape[] => {
      const y1 = from * h;
      const y2 = to * h;
      const shapes: SkeletonShape[] = [
        { kind: "line", points: [[0, y1], [w, y2]], width, tone: 0.8 },
        { kind: "dot", x: 0, y: y1, r: width + 2.5 },
        { kind: "dot", x: w, y: y2, r: width + 2.5 },
      ];
      if (left >= 64) {
        const size = pill(left, i, 59);
        shapes.push({ kind: "rect", x: -(width + 12) - size, y: y1 - 4, width: size, height: 8, radius: 4, tone: 0.7 });
      }
      if (right >= 64) {
        shapes.push({ kind: "rect", x: w + width + 12, y: y2 - 4, width: pill(right, i, 61), height: 8, radius: 4, tone: 0.7 });
      }
      return shapes;
    });
};

function createSlopeBuilder(): PlotFamily<SlopeInput>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<SlopeInput>): PlotBuild => {
    const slope = propsFor<SlopeProps>(table, "slope").at(0);
    const tooltip = propsFor<TooltipBoxMotionProps>(table, "tooltip").at(0);
    return cell([props, slope, tooltip], () => {
      const labelKey = props.labelKey ?? "name";
      const lines: Line[] = slope === undefined
        ? []
        : props.data.flatMap((row, index) => {
            const from = numberOf(row[slope.from]);
            const to = numberOf(row[slope.to]);
            return Number.isFinite(from) && Number.isFinite(to) ? [{ index, label: String(row[labelKey] ?? ""), from, to, up: to >= from, row }] : [];
          });
      const format = slope?.formatValue ?? decimalFormat;
      const showLabels = slope?.showLabels !== false;
      const longest = Math.max(0, ...lines.map((l) => `${l.label} ${format(Math.max(Math.abs(l.from), Math.abs(l.to)))}`.length));
      const side = showLabels ? Math.min(180, 28 + longest * 6.6) : 28;
      const margin = { top: 44, right: side, bottom: 20, left: side, ...props.margin };
      const domain = valueDomain(lines.flatMap((l) => [l.from, l.to]), { zero: false, pad: 0.04 });
      const up = slope?.increaseColor ?? "var(--chart-1)";
      const down = slope?.decreaseColor ?? "var(--chart-negative)";
      const colorOf = (l: Line): string => (l.up ? up : down);
      const width = slope?.strokeWidth ?? 2;
      const key = (l: Line): string => itemKey(l.index);
      // The labels' pushes, per side, at the latest draw's height (the definition's `chart` callback sets them before the marks resolve).
      const push = { from: new Map<Line, number>(), to: new Map<Line, number>() };
      const lineMark = (id: string, strokeWidth: number) =>
        link(lines, { id, x1: () => "0", x2: () => "1", y1: (l) => l.from, y2: (l) => l.to, key, stroke: colorOf, strokeWidth, motion: false });
      const ends = (id: string, end: "from" | "to", group: readonly Line[], fill: string) =>
        dot(group, { id, x: () => (end === "from" ? "0" : "1"), y: (l) => l[end], key, r: width + 2.5, fill, stroke: "var(--chart-background)", strokeWidth: 2, motion: false });
      const label = (id: string, end: "from" | "to", fill: string, weight: number) =>
        text(lines, {
          id,
          x: () => (end === "from" ? "0" : "1"),
          y: (l) => l[end],
          text: (l) => (end === "from" ? `${l.label}  ${format(l.from)}` : `${format(l.to)}  ${l.label}`),
          key,
          fill,
          fontSize: 12,
          fontWeight: weight,
          anchor: end === "from" ? "end" : "start",
          dx: end === "from" ? -(width + 12) : width + 12,
          dy: (l) => push[end].get(l) ?? 0,
          motion: false,
        });
      const marks: object[] = [];
      const copies: object[] = [];
      const dims: string[] = [];
      if (slope !== undefined) {
        marks.push(lineMark(MARK.lines, width));
        copies.push(focusCopy(lineMark(`${MARK.lines}-hover`, width + 1)));
        dims.push(MARK.lines);
        for (const [direction, fill] of [["up", up], ["down", down]] as const) {
          const group = lines.filter((l) => l.up === (direction === "up"));
          for (const end of ["from", "to"] as const) {
            const id = `slope-dots-${end}-${direction}`;
            marks.push(ends(id, end, group, fill));
            copies.push(focusCopy(ends(`${id}-hover`, end, group, fill)));
            dims.push(id);
          }
        }
        if (showLabels) {
          for (const end of ["from", "to"] as const) {
            const id = `slope-labels-${end}`;
            marks.push(label(id, end, "var(--chart-label)", 400));
            copies.push(focusCopy(label(`${id}-hover`, end, "var(--chart-foreground)", 500)));
            dims.push(id);
          }
        }
      }
      const hits = [
        dot(lines, { id: MARK.fromHit, x: () => "0", y: (l) => l.from, key, r: 1, fillOpacity: 0, motion: false }),
        dot(lines, { id: MARK.toHit, x: () => "1", y: (l) => l.to, key, r: 1, fillOpacity: 0, motion: false }),
      ];
      const lineSet = new Set<unknown>(lines);
      // The line nearest the pointer at its x: each line's height there, between its two ends' pixels; the nearer end is the focus.
      const focus = {
        ...focusNearestX,
        resolve: (points: readonly ChartPoint[], context: { readonly x: number; readonly y: number }): ChartPoint[] => {
          const fromOf = new Map<unknown, ChartPoint>();
          const toOf = new Map<unknown, ChartPoint>();
          for (const p of points) {
            if (p.markId === MARK.fromHit) {
              fromOf.set(p.datum, p);
            } else if (p.markId === MARK.toHit) {
              toOf.set(p.datum, p);
            }
          }
          let best: ChartPoint | undefined;
          let distance = Number.POSITIVE_INFINITY;
          for (const [datum, a] of fromOf) {
            const b = toOf.get(datum);
            if (b === undefined) {
              continue;
            }
            const t = Math.min(1, Math.max(0, (context.x - a.x) / (b.x - a.x || 1)));
            const d = Math.abs(a.y + (b.y - a.y) * t - context.y);
            if (d < distance) {
              distance = d;
              best = t < 0.5 ? a : b;
            }
          }
          // Anywhere between the columns' labels: the focus never drops between lines, so a sweep keeps the dim.
          const { width, height } = size.get();
          const outside = width > 0 && (context.y < margin.top - 12 || context.y > height - margin.bottom + 12);
          return best === undefined || outside ? [] : [best];
        },
        group: (_points: readonly ChartPoint[], context: { readonly point: ChartPoint }): ChartPoint[] => [context.point],
        navigation: (points: readonly ChartPoint[]): ChartPoint[] => points.filter((p) => p.markId === MARK.toHit).toSorted((a, b) => a.y - b.y),
      };
      const definition = defineChart(erase({
        chart: ({ width: w, height }: { readonly width: number; readonly height: number }) => {
          size.set(w, height);
          const inner = Math.max(1, height - margin.top - margin.bottom);
          const py = (v: number): number => inner * (1 - (v - domain[0]) / (domain[1] - domain[0] || 1));
          for (const end of ["from", "to"] as const) {
            const offsets = dodge(lines.map((l) => py(l[end])), LABEL_GAP, inner);
            push[end] = new Map(lines.map((l, i) => [l, offsets[i] ?? 0] as const));
          }
          return {
            marks: [...marks, ...copies, ...hits],
            scales: {
              x: {
                scale: scalePoint<string>().domain(["0", "1"]).padding(0),
                side: "top",
                grid: { stroke: "var(--chart-grid)", strokeOpacity: 1, strokeWidth: 1, strokeDasharray: "none" },
                axis: { line: false, ticks: { size: 0, padding: 16, format: (v: string): string => (v === "0" ? (slope?.fromLabel ?? slope?.from ?? "") : (slope?.toLabel ?? slope?.to ?? "")) }, tickLabels: { fontSize: 12, opacity: 1, thin: false, fontWeight: 600 } },
              },
              y: { scale: scaleLinear().domain([...domain]), grid: false, axis: false },
            },
            margin,
            theme: bklitTheme,
          };
        },
        focus,
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(tooltip, "point", {}),
      }));
      const fromName = slope?.fromLabel ?? slope?.from ?? "";
      const toName = slope?.toLabel ?? slope?.to ?? "";
      const items: PlotItem[] = [];
      const itemIndex = new Map<Line, number>();
      for (const l of lines) {
        itemIndex.set(l, items.length);
        const diff = l.to - l.from;
        const pct = l.from === 0 ? "" : ` (${diff >= 0 ? "+" : "−"}${Math.abs(Math.round((diff / l.from) * 1000) / 10)}%)`;
        items.push({
          datum: l.row,
          index: l.index,
          title: l.label,
          rows: [
            { color: "transparent", label: fromName, value: format(l.from) },
            { color: colorOf(l), label: toName, value: format(l.to) },
            { color: "transparent", label: "Change", value: `${diff >= 0 ? "+" : "−"}${format(Math.abs(diff))}${pct}` },
          ],
        });
      }
      const enter = plotEnter(props);
      const css = [
        hoverDimCss(scope, dims.map((id) => ({ id, dim: slope?.fadedOpacity ?? 0.18 }))),
        enter.animate ? `${PLOT_WIPE_KEYFRAMES}${wipeInCss(scope, enter.durationMs)}` : "",
      ].join("");
      return {
        definition,
        items,
        itemOf: (datum) => (lineSet.has(datum) ? (itemIndex.get(datum as Line) ?? -1) : -1),
        margin,
        box: { aspectRatio: parseAspectRatio(props.aspectRatio ?? "4 / 3") },
        describe: () => describeSlope(props.data, labelKey, table),
        ariaLabel: props.ariaLabel ?? "Slope chart",
        ariaDescription: props.ariaDescription,
        css,
        chrome: null,
        skeleton: slopeSkeleton(lines.length, width, showLabels ? margin.left : 0, showLabels ? margin.right : 0),
      };
    });
  };
}

/** The slope family on the shared plot controller (core/plot/controller.ts). */
export const slopeFamily = (): PlotFamily<SlopeInput> => ({ chart: "slope", build: createSlopeBuilder() });
