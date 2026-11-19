import { createMark } from "@tanstack/charts";
import type { ChartMark, ChartMotionContext, ResolvedScale, SceneNode } from "@tanstack/charts";
import type { BarValueLabelOrientation, BarValueLabelPosition } from "../types/bar";
import type { EnterTiming } from "./enter-timing";
import { barIndexClass } from "./hover";
import type { HoverTarget } from "./hover";
import type { BarDatum, BarSeries } from "./model";

/** bklit chart-formatters.ts `valueLabelFmt`: English integers. */
const VALUE_LABEL_FMT = /* @__PURE__ */ new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const defaultFormat = (value: number): string => VALUE_LABEL_FMT.format(value);

/** Approximate rendered height of a 12px label. */
const LABEL_LINE_HEIGHT = 12;
/** Distance between a top / bottom-aligned label and the bar edge. */
const LABEL_INSET = 6;
/** Smallest bar thickness (across the text) that still fits a 12px label. */
const MIN_CROSS_SIZE = LABEL_LINE_HEIGHT + 6;
/** bklit's width estimate: 7.2px a character at 12px / 600. */
const CHAR_PX = 7.2;

export interface BarLabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BarLabelLayout {
  readonly fits: boolean;
  readonly rotated: boolean;
  readonly x: number;
  readonly y: number;
}

/** bklit `getBarValueLabelLayout`: where a label of `labelWidth` px sits in `box`, and whether it fits there at all. */
export function barValueLabelLayout(
  box: BarLabelBox,
  labelWidth: number,
  horizontal: boolean,
  orientation: BarValueLabelOrientation,
  position: BarValueLabelPosition,
): BarLabelLayout {
  const { x, y, width, height } = box;
  const normalFits = width >= labelWidth + 10 && height >= MIN_CROSS_SIZE;
  const rotatedFits = height >= labelWidth + 10 && width >= MIN_CROSS_SIZE;
  let fits = normalFits || rotatedFits;
  if (orientation === "horizontal") {
    fits = normalFits;
  } else if (orientation === "vertical") {
    fits = rotatedFits;
  }
  const rotated = fits && (orientation === "vertical" || (orientation === "auto" && !normalFits));
  // The (possibly rotated) label's footprint, so top / bottom placement keeps the whole label inside the bar.
  const extentX = rotated ? LABEL_LINE_HEIGHT : labelWidth;
  const extentY = rotated ? labelWidth : LABEL_LINE_HEIGHT;
  let labelX = x + width / 2;
  let labelY = y + height / 2;
  if (horizontal) {
    // Horizontal bars: "top" is the value end (right), "bottom" the base (left).
    if (position === "top") {
      labelX = x + width - LABEL_INSET - extentX / 2;
    } else if (position === "bottom") {
      labelX = x + LABEL_INSET + extentX / 2;
    }
  } else if (position === "top") {
    labelY = y + LABEL_INSET + extentY / 2;
  } else if (position === "bottom") {
    labelY = y + height - LABEL_INSET - extentY / 2;
  }
  return { fits, rotated, x: labelX, y: labelY };
}

/** Class of every value label (the hover dim selects them), and of one series' labels (the legend dim). */
const LABEL_CLASS = "bkm-bvl";
const seriesLabelClass = (seriesIndex: number): string => `bkm-bvl-s${seriesIndex}`;

/** A stacked segment's extent in value units and its level in its category's stack (definition.ts `stackExtents`). */
export interface LabelStackExtent {
  readonly start: number;
  readonly end: number;
  readonly level: number;
  readonly sign: 1 | -1;
}

export interface ValueLabelInput {
  readonly datums: readonly BarDatum[];
  /** The bar series (not squares), in slot order. */
  readonly barSeries: readonly BarSeries[];
  readonly horizontal: boolean;
  readonly stacked: boolean;
  readonly stackGap: number;
  readonly groupGap: number;
  readonly faded: number;
  /** Stacked segments' extents (definition.ts `stackExtents`), by datum. */
  readonly extents: ReadonlyMap<BarDatum, LabelStackExtent> | null;
  /** The bars' entrance timing (definition.ts `barEnter`): a label fades in on its bar's delay and curve. */
  readonly enter: (ctx: ChartMotionContext<BarDatum>) => EnterTiming | undefined;
  /** The bars' first paint is empty (the seed build): no labels either. */
  readonly seed: boolean;
  /** BarChart `barWidth`: bars at most this thick, centred in their slot. */
  readonly barWidth?: number;
}

export interface ValueLabelMarks {
  readonly marks: ChartMark<BarDatum, string, number>[];
  readonly hover: HoverTarget[];
}

const scaleAt = (scales: Readonly<Record<string, ResolvedScale>>, key: string): ResolvedScale | undefined => scales[key];

/** The value labels of every `Bar` with `showValue`, as one mark; none without one. */
export function valueLabelMarks(input: ValueLabelInput): ValueLabelMarks {
  const shown = input.barSeries.filter((s) => s.bar?.showValue === true);
  if (shown.length === 0) {
    return { marks: [], hover: [] };
  }
  const { horizontal, stacked, stackGap, groupGap, extents } = input;
  const slots = input.barSeries.length;
  const slotOf = new Map(input.barSeries.map((s, i) => [s.key, i] as const));
  const shownKeys = new Map(shown.map((s) => [s.key, s] as const));
  const datums = input.datums.filter((d) => shownKeys.has(d.series));
  const categoryChannel = horizontal ? "y" : "x";
  const valueChannel = horizontal ? "x" : "y";
  // Node keys are `<id>:<category index>:<series>`: the entrance reads the category index back for its stagger.
  const id = "bar-values";
  const motion = (ctx: ChartMotionContext<BarDatum>): EnterTiming | undefined => {
    const index = Number(ctx.key.slice(id.length + 1).split(":")[0]);
    const series = ctx.key.slice(ctx.key.indexOf(":", id.length + 1) + 1);
    const datum = datums.find((d) => d.index === index && d.series === series);
    return input.enter({ ...ctx, datum, datumIndex: Number.isFinite(index) ? index * Math.max(1, slots) : ctx.datumIndex });
  };
  const mark = createMark<BarDatum, string, number>(() => ({
    id,
    channels: {
      [categoryChannel]: { scale: categoryChannel, values: datums.map((d) => d.category) },
      [valueChannel]: { scale: valueChannel, includeZero: true, values: datums.map((d) => d.value) },
    },
    motion,
    render: ({ scales }) => {
      const nodes: SceneNode[] = [];
      const cat = scaleAt(scales, categoryChannel);
      const val = scaleAt(scales, valueChannel);
      if (input.seed || cat === undefined || val === undefined) {
        return { nodes, points: [] };
      }
      const band = cat.bandwidth ?? 0;
      const gapPx = slots > 1 ? groupGap : 0;
      const thickness = stacked ? band : Math.max(0, (band - gapPx * (slots - 1)) / slots);
      const zero = val.map(0);
      for (const d of datums) {
        const s = shownKeys.get(d.series);
        const centre = cat.map(d.category);
        if (s?.bar === undefined || !Number.isFinite(d.value) || !Number.isFinite(centre)) {
          continue;
        }
        const slot = slotOf.get(d.series) ?? 0;
        const slotStart = centre - band / 2 + (stacked ? 0 : slot * (thickness + gapPx));
        const drawn = input.barWidth !== undefined && input.barWidth > 0 ? Math.min(thickness, input.barWidth) : thickness;
        const crossStart = slotStart + (thickness - drawn) / 2;
        // The bar's value extent in px: from zero (grouped) or along its stack, raised by one gap per level below it (definition.ts gappedStackMark).
        let a = zero;
        let b = val.map(d.value);
        const e = stacked ? extents?.get(d) : undefined;
        if (e !== undefined) {
          const raise = e.sign * e.level * stackGap * (horizontal ? 1 : -1);
          a = val.map(e.start) + raise;
          b = val.map(e.end) + raise;
        }
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          continue;
        }
        const box: BarLabelBox = horizontal
          ? { x: Math.min(a, b), y: crossStart, width: Math.abs(b - a), height: drawn }
          : { x: crossStart, y: Math.min(a, b), width: drawn, height: Math.abs(b - a) };
        const text = (s.bar.valueLabelFormatter ?? defaultFormat)(d.value);
        const layout = barValueLabelLayout(box, text.length * CHAR_PX, horizontal, s.bar.valueLabelOrientation ?? "auto", s.bar.valueLabelPosition ?? "center");
        if (!layout.fits) {
          continue;
        }
        const own = s.bar.valueLabelClassName;
        nodes.push({
          kind: "label",
          key: `${id}:${d.index}:${d.series}`,
          className: `${LABEL_CLASS} ${seriesLabelClass(s.index)} ${barIndexClass(d.index)}${own === undefined || own === "" ? "" : ` ${own}`}`,
          x: layout.x,
          y: layout.y,
          text,
          anchor: "middle",
          baseline: "middle",
          rotate: layout.rotated ? -90 : undefined,
          fontSize: 12,
          fontWeight: 600,
          ariaHidden: true,
          style: { fill: s.bar.valueLabelColor ?? "white" },
        });
      }
      return { nodes, points: [] };
    },
  }));
  // Labels dim with their bar: the category hover keeps the focused category's, a legend hover keeps its series'.
  const hover: HoverTarget[] = [
    { select: `text.${LABEL_CLASS}`, keep: (index) => `.${barIndexClass(index)}`, dim: input.faded },
    ...shown.map((s): HoverTarget => ({ select: `text.${seriesLabelClass(s.index)}`, keep: null, dim: input.faded, seriesIndex: s.index, legendOnly: true })),
  ];
  return { marks: [mark], hover };
}
