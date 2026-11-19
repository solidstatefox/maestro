import { whenFocused } from "@tanstack/charts";
import type { ChartMotionContext, ChartMotionDefinition, ChartMotionTiming } from "@tanstack/charts";
import { gridLineStyle } from "../cartesian/grid-guides";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { formatTick } from "../cartesian/y-axis";
import { erase } from "../erased-types";
import { REVEAL_EASING } from "../motion/easing";
import { scaleLinear } from "../scales";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { tooltipBoxMotion } from "../tooltip/box-motion";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import { sizedTooltipPlacement } from "../tooltip/sized-tooltip-placement";
import { BKLIT_TOOLTIP_PLACEMENT, DEFAULT_ANIMATION_MS, X_TICK_PADDING } from "../theme";
import type { PlotSizeStore } from "./types";

/** An item's datum key: every mark of item `index` keys its datum with it (a stable node across data updates). */
export const itemKey = (index: number): string => `i${index}`;

/** A mark's hover copy: the renderer's focus layer shows the nodes whose datum is the focused point's (`match: "key"` compares the datum),
 * at full strength over the dimmed groups (core/plot/css.ts); `match: "series"` shows every node of the focused point's `z` group. Its `id`
 * must differ from the mark's. */
export const focusCopy = <M extends object>(mark: M, match: "key" | "series" = "key"): M => erase(whenFocused(erase(mark), { match }));

/** The measured-size store the definition's `chart` callback writes (`PlotSizeStore`). */
export function createPlotSizeStore(): PlotSizeStore {
  let size = { width: 0, height: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => size,
    set: (width, height) => {
      if (width === size.width && height === size.height) {
        return;
      }
      size = { width, height };
      for (const listener of listeners) { listener(); }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** A value domain bklit's way: zero included (unless `zero` is false), padded to nice ticks. */
export function valueDomain(values: readonly number[], { zero = true, pad = 0 }: { readonly zero?: boolean; readonly pad?: number } = {}): [number, number] {
  let lo = zero ? 0 : Number.POSITIVE_INFINITY;
  let hi = zero ? 0 : Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return [0, 1];
  }
  if (lo === hi) {
    hi = lo + 1;
  }
  const span = hi - lo;
  const padded: [number, number] = [lo === 0 && zero ? 0 : lo - span * pad, hi === 0 && zero ? 0 : hi + span * pad];
  const [a, b] = scaleLinear().domain(padded).nice(5).domain() as [number, number];
  return [a, b];
}

/** The value axis' tick labels: the reader's `formatValue`, else bklit's (`2k` above 1000 unless `formatLargeNumbers` is false). */
export const valueFormat = (axis: { readonly formatValue?: (value: number) => string; readonly formatLargeNumbers?: boolean } | undefined) =>
  (value: number): string => (axis?.formatValue ? axis.formatValue(value) : formatTick(value, axis?.formatLargeNumbers !== false));

/** bklit's tick label look: 12px, full opacity (the theme's muted colour), no collision thinning unless asked. */
export const TICK_LABELS = { fontSize: 12, opacity: 1, thin: false } as const;

/** A category axis (the categories are the item indices as strings, so a label can repeat): bklit's bar axis, no line, no tick stubs.
 * `labelled`: only these categories get a label (the ones that fit, core/axis-fit.ts). */
export function categoryAxis(labels: readonly string[], side: "x" | "y", shown: boolean, labelled?: readonly string[]): object | false {
  if (!shown) {
    return false;
  }
  return {
    line: false,
    ticks: { size: 0, padding: side === "x" ? X_TICK_PADDING : 10, format: (value: string): string => labels[Number(value)] ?? value, ...(labelled === undefined ? null : { values: labelled }) },
    tickLabels: side === "x" ? TICK_LABELS : { ...TICK_LABELS, opacity: 1 },
  };
}

/** A value axis: no line, no stubs, `count` ticks, or exactly `values` (fewer, when `count` would not fit, core/axis-fit.ts). */
export function valueAxis(format: (value: number) => string, count: number, shown: boolean, side: "x" | "y", values?: readonly number[]): object | false {
  if (!shown) {
    return false;
  }
  return { line: false, ticks: { ...(values === undefined ? { count } : { values }), size: 0, padding: side === "x" ? X_TICK_PADDING : 8, format }, tickLabels: TICK_LABELS };
}

/** The grid the scale draws: bklit's dashed rules in `--chart-grid` (Grid `horizontal` on the y scale, `vertical` on the x scale). */
export function scaleGrid(grid: GridGuideProps | undefined, axis: "x" | "y"): object | false {
  if (grid === undefined) {
    return false;
  }
  const on = axis === "y" ? grid.horizontal !== false : grid.vertical === true;
  return on ? gridLineStyle(grid) : false;
}

/** The categories of `count` items as a band domain: their indices, as strings. */
export const categoryDomain = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i));

/** The entrance of a plot family: bklit's reveal span and ease, `delayOf` spreading the items (0 for none). `animate: false` snaps. */
export interface PlotEnter {
  readonly animate: boolean;
  readonly durationMs: number;
}

/** bklit's reveal timing from a chart's `animate` and `animationDuration` (ms). */
export const plotEnter = (props: { readonly animate?: boolean; readonly animationDuration?: number }): PlotEnter => ({
  animate: props.animate !== false,
  durationMs: props.animationDuration ?? DEFAULT_ANIMATION_MS,
});

/** A mark's motion: on its first paint each node grows in over the reveal span after `delayOf(index)` ms (its datum's), on later data it
 * moves over 500ms bklit-eased; `animate: false` paints at once. `share` is the part of the span the node itself runs (the rest is stagger). */
export function enterMotion<Datum>(enter: PlotEnter, delayOf: (datum: Datum | undefined, index: number) => number, share = 0.6): ChartMotionDefinition<Datum> {
  if (!enter.animate) {
    return false;
  }
  const run = Math.max(1, enter.durationMs * share);
  return (context: ChartMotionContext<Datum>): ChartMotionTiming<Datum> | undefined => {
    if (context.phase === "enter") {
      return { delay: Math.max(0, delayOf(context.datum, context.datumIndex)), transition: { type: "tween", duration: run, easing: REVEAL_EASING } };
    }
    if (context.phase === "update") {
      return { transition: { type: "tween", duration: 500, easing: REVEAL_EASING } };
    }
    return undefined;
  };
}

/** A stagger over `count` items: item `i` starts at `i / count` of the reveal's free share. */
export const stagger = (enter: PlotEnter, count: number, share = 0.6) => (index: number): number =>
  count <= 1 ? 0 : (index / (count - 1)) * enter.durationMs * (1 - share);

/** The tooltip as a family's definition takes it: bklit's panel (instant hide, the snappy glide) at bklit's placement — beside the
 * focused x, its top on the plot's (`"column"`), or beside the focused point, flipping sides (`"point"`). `false` without a ChartTooltip. */
export function plotTooltip(tooltip: TooltipBoxMotionProps | undefined, placement: "column" | "point", content: object): object | false {
  if (tooltip === undefined) {
    return false;
  }
  const where = placement === "column"
    ? BKLIT_TOOLTIP_PLACEMENT
    : { anchor: { x: "point", y: "point" }, placement: ["right", "left"], offset: 16, portal: sizedTooltipPlacement() };
  return erase({ use: bklitTooltip, ...where, sticky: false, motion: tooltipBoxMotion(tooltip), ...content });
}
