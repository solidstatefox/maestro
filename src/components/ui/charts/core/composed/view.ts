import type { ChildTable } from "../carriers/table";
import { rowColorOf } from "../cartesian/view";
import type { TooltipBase } from "../cartesian/view";
import type { ResolvedSeries, Row } from "../cartesian/series";
import type { MarkupNode } from "../markup/node";
import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import { bklitSurfaceStyle } from "../theme";
import { seriesLabels } from "../tooltip/series-labels";
import type { TooltipRowColor } from "../tooltip/series-labels";
import type { SeriesBarSpec } from "./bars";
import type { ComposedCandleSpec, ComposedScatterSpec } from "./extras";

export interface ComposedView {
  /** The host's attributes (`undefined` leaves one out), beside the adapter's own `class` and hydration marker. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style (the chart takes no reader `style`). */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`): RendererChart.js:116-119. */
  readonly surfaceStyle: StyleObject;
  /** The hidden defs before the surface: the hover band's clipPath while a series draws a highlight. */
  readonly resources: readonly (MarkupNode | null)[];
  /** The carriers and data the tooltip body and the custom children read. */
  readonly table: ChildTable;
  readonly data: readonly Row[];
  /** The default tooltip body's rows: the series in tree order, each with its dot colour and label (no event markers). */
  readonly tooltipBase: TooltipBase;
  /** The renderer's options: a new definition is a new view, so the adapter's next commit hands it over. */
  readonly surface: object;
}

/** The host's style: the box at the chart's aspect ratio, the surface tokens and the entrance span the scoped CSS reads. */
export const composedHostStyle = (aspectRatio: string, duration: number): StyleObject => ({
  width: "100%",
  position: "relative",
  "aspect-ratio": aspectRatio,
  ...bklitSurfaceStyle,
  "--bkm-enter-ms": `${duration}ms`,
});

/** The surface's host box at the parsed aspect ratio, each value as React wrote RendererChart's box (`surfaceBox`). */
export const composedSurfaceStyle = (aspectRatio: number): StyleObject => surfaceHostStyle(surfaceBox({ aspectRatio }));

/** Each tooltip row's dot colour by dataKey: a line's or area's stroke, a bar's `stroke` or `fill`, a point's fill, the candle's close in its direction's
 * colour; a dataKey drawn twice takes its bar's. */
const composedTooltipColors = (series: readonly ResolvedSeries[], bars: readonly SeriesBarSpec[], candle: ComposedCandleSpec | null, scatters: readonly ComposedScatterSpec[]): Record<string, TooltipRowColor> => {
  // A ProfitLossLine's row takes the hovered value's sign colour, as on the line chart.
  const colors: Record<string, TooltipRowColor> = Object.fromEntries(series.map((s) => [s.dataKey, rowColorOf(s)]));
  for (const s of scatters) {
    colors[s.dataKey] = s.fill;
  }
  if (candle) {
    colors.close = candle.positiveFill;
  }
  for (const bar of bars) {
    colors[bar.dataKey] = bar.dotColor;
  }
  return colors;
};

/** The default body's rows: tree order, the row colours above, and the labels of the lines and areas first, then the bars and points (a dataKey drawn twice
 * takes the label its first series sets). */
export const composedTooltipBase = (
  series: readonly ResolvedSeries[],
  bars: readonly SeriesBarSpec[],
  order: readonly string[],
  candle: ComposedCandleSpec | null = null,
  scatters: readonly ComposedScatterSpec[] = [],
): TooltipBase => ({
  order,
  colors: composedTooltipColors(series, bars, candle, scatters),
  // bklit names the candle's row by its dataKey, `close`; it reads as a series name here.
  labels: { ...(candle ? { close: "Close" } : null), ...seriesLabels([...series, ...bars, ...scatters]) },
});
