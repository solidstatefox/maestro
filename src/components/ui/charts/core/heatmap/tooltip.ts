import type { ChartPoint } from "@tanstack/charts";
import { resolveTooltipBoxMotion } from "../helpers";
import { memoCell } from "../memo";
import { REST_NEVER, REST_PX, settleMs, springOf } from "../motion/spring-curve";
import { SNAPPY_HOVER_MS, TOOLTIP_BOX_SPRING } from "../motion/springs";
import type { SpringConfig } from "../types/cartesian";
import type { HeatmapTooltipConfig, HeatmapTooltipProps } from "../types/heatmap";
import type { CellDatum } from "./definition";
import { formatHeatmapContributionLabel, formatHeatmapTooltipDate, formatHeatmapTooltipWeekday } from "./format";

/** bklit's tooltip hold after the pointer leaves a cell (ms), unless `hideDelay` says otherwise. */
export const HEATMAP_TOOLTIP_HIDE_DELAY_MS = 120;

/** A `HeatmapTooltip`'s props with their defaults, or null without one. */
export const heatmapTooltipConfig = <Style>(props: HeatmapTooltipProps<Style> | undefined): HeatmapTooltipConfig<Style> | null =>
  props === undefined ? null : {
    backgroundColor: props.backgroundColor,
    className: props.className ?? "",
    instant: props.instant ?? false,
    showDelay: props.showDelay ?? 0,
    hideDelay: props.hideDelay ?? HEATMAP_TOOLTIP_HIDE_DELAY_MS,
    formatLabel: props.formatLabel ?? formatHeatmapContributionLabel,
    panelStyle: props.panelStyle,
    damping: props.damping,
    springConfig: props.springConfig,
  };

/** The travel the follow spring's settle time is measured over (px): a hop of a few cells. */
const SETTLE_TRAVEL_PX = 100;
const SETTLE_STEP_MS = 5;
const SETTLE_LIMIT_MS = 2000;
/** The glide's keyframes: as many samples of the spring as TanStack's tooltip motion takes (motion.js `tooltipMotionSamples`). */
const GLIDE_SAMPLES = 30;
const glideCache = /* @__PURE__ */ new Map<string, HeatmapTooltipGlideCurve>();

/** The fade after the hold (bklit TooltipBox's exit: opacity over 0.1s; the snappy variant: the hover profile, styles.css `bkm-hm-tt-out`). */
export const HEATMAP_TOOLTIP_FADE_MS = SNAPPY_HOVER_MS;

/**
 * How long the tooltip stays after the pointer leaves a cell, as TanStack's native tooltip `hideDelay` (the heatmap renders on the plain
 * SVG renderer, pass.ts `HEATMAP_RENDERER`): bklit's `hideDelay` hold, then its fade (TooltipBox's exit; the controller marks the leaving
 * tooltip `data-hm-out` and styles.css `bkm-hm-tt-out` fades it after the host's `--bkm-hm-hide-delay`). `instant` holds for `hideDelay`
 * alone, with no fade.
 */
export const heatmapTooltipHold = (config: Readonly<HeatmapTooltipConfig<unknown>> | null): number => {
  const hideDelay = Math.max(config?.hideDelay ?? HEATMAP_TOOLTIP_HIDE_DELAY_MS, 0);
  return config?.instant === true ? hideDelay : hideDelay + HEATMAP_TOOLTIP_FADE_MS;
};

/** The tooltip's glide from cell to cell: the follow spring sampled as keyframe progress (`values[i]` at `offsets[i]`, 0 -> 1). */
export interface HeatmapTooltipGlideCurve {
  readonly duration: number;
  readonly offsets: readonly number[];
  readonly values: readonly number[];
}

/**
 * The tooltip's glide (bklit TooltipBox: the panel springs between cells, `damping` / `springConfig` as `ChartTooltip`'s; the snappy
 * variant's hover spring by default): the follow spring's own curve over its settle time, which tooltip-glide.ts plays as a Web Animation
 * of `translate` (on the compositor) without TanStack's motion engine. Null snaps: `damping={0}`, or `instant` (no glide, no fade).
 */
export const heatmapTooltipGlide = (config: Readonly<HeatmapTooltipConfig<unknown>> | null): HeatmapTooltipGlideCurve | null => {
  if (config?.instant === true) {return null;}
  const box = config?.springConfig === undefined ? resolveTooltipBoxMotion(config?.damping) : { animate: true, springConfig: config.springConfig };
  if (!box.animate) {return null;}
  const spring: SpringConfig = config?.springConfig === undefined && config?.damping === undefined ? TOOLTIP_BOX_SPRING : box.springConfig;
  const key = `${spring.stiffness}/${spring.damping}`;
  const cached = glideCache.get(key);
  if (cached !== undefined) {return cached;}
  const native = springOf({ ...spring, mass: 1 }, REST_NEVER);
  const duration = settleMs(springOf({ ...spring, mass: 1 }, REST_PX), { from: 0, to: SETTLE_TRAVEL_PX, velocity: 0 }, SETTLE_STEP_MS, SETTLE_LIMIT_MS);
  const state = { from: 0, to: 1, velocity: 0 };
  const offsets = Array.from({ length: GLIDE_SAMPLES + 1 }, (_, i) => i / GLIDE_SAMPLES);
  const values = offsets.map((progress) => (progress >= 1 ? 1 : native.sample(progress * duration, state).value));
  const curve: HeatmapTooltipGlideCurve = { duration, offsets, values };
  glideCache.set(key, curve);
  return curve;
};

/** What a framework renders for a cell's tooltip: the panel (`backgroundColor` under the reader's `panelStyle`) over date, weekday, a divider and the count. */
export interface HeatmapTooltipView<Style> {
  readonly panelClass: string;
  readonly backgroundColor: string | undefined;
  readonly panelStyle: Readonly<Style> | undefined;
  readonly date: string;
  readonly weekday: string;
  readonly label: string;
}

const heatmapTooltipView = <Style>(datum: Readonly<CellDatum>, config: Readonly<HeatmapTooltipConfig<Style>>): HeatmapTooltipView<Style> => ({
  backgroundColor: config.backgroundColor,
  date: formatHeatmapTooltipDate(datum.date),
  label: config.formatLabel(datum.count, datum.date),
  panelClass: config.className ? `bkm-tooltip-panel ${config.className}` : "bkm-tooltip-panel",
  panelStyle: config.panelStyle,
  weekday: formatHeatmapTooltipWeekday(datum.date),
});

type CellPoint = ChartPoint<Readonly<CellDatum>, number | string, string>;

/** What the renderer hands the tooltip body. */
export interface HeatmapTooltipContext {
  readonly primaryPoint?: CellPoint;
  readonly points: readonly CellPoint[];
}

/** The body for the latest cells and config: the view of the full cell datum (by grid key) a framework renders; none without a cell or a config. */
export type HeatmapTooltipBody<Style> = (context: HeatmapTooltipContext) => HeatmapTooltipView<Style> | undefined;

/** One chart's body builder: the same body while the cells and the config hold. */
export function createHeatmapTooltipBody<Style>(): (cellData: readonly CellDatum[], config: HeatmapTooltipConfig<Style> | null) => HeatmapTooltipBody<Style> {
  const byKeyCell = memoCell<ReadonlyMap<string, CellDatum>>();
  const bodyCell = memoCell<HeatmapTooltipBody<Style>>();
  return (cellData, config) => {
    const cellByKey = byKeyCell([cellData], () => new Map(cellData.map((datum) => [`${datum.column}-${datum.row}`, datum])));
    return bodyCell([cellByKey, config], () => (context) => {
      const point = context.primaryPoint ?? context.points.at(0);
      if (point === undefined || config === null) {return undefined;}
      return heatmapTooltipView(cellByKey.get(`${point.datum.column}-${point.datum.row}`) ?? point.datum, config);
    });
  };
}
