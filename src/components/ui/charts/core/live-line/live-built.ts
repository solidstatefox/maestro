import type { ChartDefinition } from "@tanstack/charts";
import type { ChartTooltipExtension } from "@tanstack/charts/tooltip";
import { memoCell } from "../memo";
import type { ChartMargin } from "../theme";
import type { GridGuideProps } from "../cartesian/grid-guides";
import type { ReferenceAreaProps } from "../types/reference-area";
import type { ChartTooltipProps } from "../types/cartesian";
import type { LiveLineConfig, LiveXAxisConfig, LiveYAxisConfig } from "../types/live-line";
import { buildLiveDefinition, smoothStepsFor } from "./definition";
import type { LiveRow } from "./definition";
import type { TailGeometry } from "./live-tail";
import { commitSteps, headLabels, introEasing, sampledEasing } from "./head-ease";
import type { HeadLabel } from "./head-ease";
import type { Frame } from "./live-frame";
import { liveCss } from "./live-css";

/** The live chart's injected rules (live-css.ts): the same for every chart. */
const LIVE_CSS = /* @__PURE__ */ liveCss();

/** The `ChartTooltip` carrier's props as the live chart reads them (its node and style fields are a framework's). */
export type LiveTooltipConfig = ChartTooltipProps<unknown, unknown>;

export interface LiveBuiltInput {
  readonly frame: Frame | null;
  readonly width: number;
  readonly margin: ChartMargin;
  readonly plotMargin: ChartMargin;
  readonly innerHeight: number;
  readonly windowSecs: number;
  readonly numXTicks: number;
  readonly lerpSpeed: number;
  readonly pxPerMs: number;
  /** The sample interval (s) the window is laid out on (live-geometry.ts). */
  readonly stepSecs: number;
  readonly uid: string;
  readonly dataKey: string;
  readonly momentumStroke: string;
  readonly dotColor: string;
  readonly line: LiveLineConfig | undefined;
  readonly xAxis: LiveXAxisConfig | undefined;
  readonly yAxis: LiveYAxisConfig | undefined;
  readonly tooltipCfg: LiveTooltipConfig | undefined;
  readonly tooltipEnabled: boolean;
  /** The tooltip extension (stable): the stock one, painting the hover indicator too (live-hover.ts). */
  readonly tooltipUse: ChartTooltipExtension;
  /** Where the tail mark hands its geometry for the head clock (live-head.ts). */
  readonly tailSink: { tail: TailGeometry | null };
  readonly grid: GridGuideProps | undefined;
  /** The Background child's paint (none without one, or without its tile registered). */
  readonly background: { readonly opacity: number } | undefined;
  readonly references: readonly ReferenceAreaProps[];
  readonly formatValue: (value: number) => string;
  readonly formatTime: (time: number) => string;
}

export interface LiveBuilt {
  readonly built: { readonly definition: ChartDefinition<LiveRow, Date, number>; readonly fillRamp: { readonly top: number; readonly bottom: number } } | null;
  /** The badge's walk over the tick (headLabels): its first text is drawn, the rest written by the label walk (live-steps.ts). */
  readonly badgeLabels: readonly HeadLabel[];
  /** The x label slots' times at the start of the roll (live-xlabels.ts), in the order they are drawn. */
  readonly xTickTimes: readonly number[];
  readonly hoverBounds: { left: number; right: number; top: number; bottom: number };
  readonly pad: number;
  readonly headCss: string;
  /** The intro roll's easing (the path's tween and the head clock's), and as a CSS timing function. */
  readonly introEase: (progress: number) => number;
  readonly introEaseCss: string;
}

/** One chart's render derivations: call it with the latest inputs on every render. */
export function createLiveBuilt(): (input: LiveBuiltInput) => LiveBuilt {
  const xTickTimesCell = memoCell<number[]>();
  const hoverBoundsCell = memoCell<LiveBuilt["hoverBounds"]>();
  const padCell = memoCell<number>();
  const labelsCell = memoCell<HeadLabel[]>();
  const introEaseCell = memoCell<(progress: number) => number>();
  const introEaseCssCell = memoCell<string>();
  const builtCell = memoCell<LiveBuilt["built"]>();
  return ({ frame, width, margin, plotMargin, innerHeight, windowSecs, numXTicks, lerpSpeed, pxPerMs, stepSecs, uid, dataKey: key, momentumStroke, dotColor, line, xAxis, yAxis, tooltipCfg, tooltipEnabled, tooltipUse, tailSink, grid, background, references, formatValue, formatTime }) => {
    // bklit's x labels are `numTicks` fixed slots at 0..100% of the live window; only their text re-derives as it rolls.
    // The labels under the hover pill fade natively (tickLabels.opacity reads the pointer; see live-line/definition.ts).
    const xTickTimes = xTickTimesCell([frame, xAxis?.numTicks, numXTicks, windowSecs], () => {
      const n = Math.max(2, xAxis?.numTicks ?? numXTicks);
      const start = frame?.xDomain[0] ?? 0;
      // xDomain is the view at the end of the roll; the labels' clock starts rollMs earlier, at the sample (live-xlabels.ts).
      return Array.from({ length: n }, (_, i) => start + (i * windowSecs * 1000) / (n - 1) - (frame?.rollMs ?? 0));
    });
    // Only the left/right/top/bottom of bklit's hover area: the plot inside the *requested* margin (the native plot is wider).
    const hoverBounds = hoverBoundsCell([margin, width, innerHeight], () => ({ left: margin.left, right: (width || 800) - margin.right, top: margin.top, bottom: margin.top + innerHeight }));

    // Left path cut in px, applied by CSS clip-path in the path's own coordinates (so it rides the rolling transform):
    // the left pad rows are invisible; the path starts at the first real sample (bklit's fade mask is a cut at the dot).
    const pad = padCell([frame, pxPerMs], () => {
      // The drawn path spans rows[1..length-2] (see smoothRows): the end rows only seed its tangents.
      const rows = frame?.rows ?? [];
      const first = rows.findIndex((r) => !r.pad);
      const start = rows.at(1);
      const firstReal = rows.at(first);
      return first > 1 && firstReal !== undefined && start !== undefined ? Math.round((firstReal.t - start.t) * pxPerMs * 10) / 10 : 0;
    });
    const labels = labelsCell([frame, lerpSpeed, formatValue], () => (frame ? headLabels(frame.disp0, frame.tip?.v ?? 0, lerpSpeed, formatValue) : []));

    const introEase = introEaseCell([lerpSpeed, frame?.rollMs], () => introEasing(lerpSpeed, frame?.rollMs ?? 600));
    // The same easing as a CSS timing function, for the tail's intro slide (live-css.ts).
    const introEaseCss = introEaseCssCell([introEase], () => sampledEasing(introEase));
    const built = builtCell(
      [frame, plotMargin, uid, key, momentumStroke, dotColor, line, formatValue, formatTime, xAxis, yAxis, xTickTimes, hoverBounds, innerHeight, tooltipCfg, tooltipEnabled, tooltipUse, grid, background, references, introEase, labels.at(0)?.text, pxPerMs, stepSecs],
      () =>
        frame
          ? buildLiveDefinition({
              rows: frame.rows,
              xDomain: frame.xDomain,
              yDomain: frame.yDomain,
              areaFloor: frame.areaFloor,
              margin: plotMargin,
              uid,
              dataKey: key,
              stroke: momentumStroke,
              strokeWidth: line?.strokeWidth ?? 2,
              dotColor,
              dotSize: line?.dotSize ?? 4,
              fill: line?.fill !== false,
              badge: line?.badge !== false,
              badgeLabel: labels.at(0)?.text ?? "",
              // bklit's ring rides the dot; the intro's tip follows the chart's own tween, so the ring waits for the first settle.
              pulse: line?.pulse !== false && !frame.intro && !frame.seed,
              badgeParity: frame.parity,
              dispV: frame.disp0,
              pxPerMs,
              smoothSteps: smoothStepsFor(stepSecs * 1000 * pxPerMs),
              still: frame.seed,
              tipEase: !frame.intro && !frame.seed,
              yJump: frame.jump,
              tip: frame.tip,
              rollMs: frame.rollMs,
              easing: frame.intro ? introEase : (p: number) => Math.floor(p * commitSteps(frame.rollMs)) / commitSteps(frame.rollMs),
              xTickTimes,
              hoverBounds,
              formatTime,
              formatValue: yAxis?.formatValue ?? formatValue,
              yPosition: yAxis?.position ?? "left",
              plotHeight: innerHeight,
              tooltipEnabled,
              tooltipUse,
              tailSink,
              tooltipBox: tooltipCfg,
              grid,
              background,
              references,
            })
          : null,
    );

    return { built, badgeLabels: labels, xTickTimes, hoverBounds, pad, headCss: LIVE_CSS, introEase, introEaseCss };
  };
}
