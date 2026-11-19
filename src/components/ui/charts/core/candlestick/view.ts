import type { ChildTable } from "../carriers/table";
import { OWN_PILL_NAMES, pillTickStaticCss } from "../cartesian/date-pill";
import { focusEmptyHiddenCss } from "../cartesian/gate-css";
import type { MarkupNode } from "../markup/node";
import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import { bklitSurfaceStyle } from "../theme";
import type { LineConfig } from "../types/context";
import { CANDLE_HOVER_CSS } from "./definition";
import type { Candle, CandlestickBuild } from "./definition";

/** The close price's colour: its tooltip row's dot and the series the public context names. */
const CLOSE_COLOR = "var(--chart-line-primary)";

/** The default tooltip body's rows (`TooltipBodyOptions` `order` / `colors`): the close alone. */
export const CANDLESTICK_TOOLTIP_BASE = { order: ["close"], colors: { close: CLOSE_COLOR } } as const;

/** The series the public context names (`lines`): the close, as a fresh array per chart. */
export const candlestickLines = (): LineConfig[] => [{ dataKey: "close", stroke: CLOSE_COLOR, strokeWidth: 2 }];

export interface CandlestickView {
  /** The host's attributes (`undefined` leaves one out), beside the adapter's own class, hydration marker and legend hover (`data-bkm-legend`). */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`: the dim opacity the owned CSS reads (`--bkm-faded`) and the surface tokens. */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`, RendererChart.js:116-119): it fills the host's height when the reader's style sets a height or
   * unsets the aspect ratio. */
  readonly surfaceStyle: StyleObject;
  /** The ReferenceAreas' patterns, hidden beside the svg (null without one). */
  readonly resources: MarkupNode | null;
  /** The carriers and the rows the default tooltip body reads (`bklitTooltipOptions(tooltip carrier, data, tooltipBase)`). */
  readonly table: ChildTable;
  readonly data: readonly Candle[];
  readonly tooltipBase: typeof CANDLESTICK_TOOLTIP_BASE;
}

/** Container-owned height: the host follows the wrapper's CSS content height (TanStack renderer.ts observesContainerHeight, responsive-charts.md). */
const FILL_HOST_STYLE: StyleObject = { height: "100%" };

export const candlestickHostAttrs = (uid: string, built: CandlestickBuild): CandlestickView["hostAttrs"] => ({ "data-bkm-chart": "candlestick", "data-slot": "chart", "data-bkm-kit": uid, ...built.gridAttrs });

export const candlestickHostStyle = (fadedOpacity: number): StyleObject => ({ width: "100%", position: "relative", "--bkm-faded": fadedOpacity, ...bklitSurfaceStyle });

/** The surface host's box (`surfaceBox`, as RendererChart.js lays it out) with bklit's explicit-height fill after it. */
export const candlestickSurfaceStyle = (aspectRatio: number | undefined, fillHeight: boolean): StyleObject =>
  surfaceHostStyle(surfaceBox({ aspectRatio }), fillHeight ? FILL_HOST_STYLE : undefined);

/** The host's owned <style>: the candles' hover and legend dim, the date pill's tick fade and the empty-focus gate, scoped to this chart. */
export const candlestickCss = (uid: string, pillTicks: CandlestickBuild["pillTicks"]): string => {
  const scope = `[data-bkm-kit="${uid}"]`;
  const pillCss = pillTicks.active ? (pillTickStaticCss(scope, pillTicks.times, pillTicks.reachPx, OWN_PILL_NAMES) ?? "") : "";
  return `${CANDLE_HOVER_CSS}${pillCss}${focusEmptyHiddenCss(scope)}`;
};
