import type { ChildTable } from "../carriers/table";
import type { TooltipBase } from "../cartesian/view";
import type { Row } from "../cartesian/series";
import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import { seriesLabels } from "../tooltip/series-labels";
import type { ScatterBuild } from "./definition";

export interface ScatterView {
  /** The host's attributes (`undefined` leaves one out), beside the adapter's own `class` and hydration marker. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`. */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`): RendererChart.js:116-119 at the chart's aspect ratio. */
  readonly surfaceStyle: StyleObject;
  /** The carriers and the data the tooltip body and the custom children read. */
  readonly table: ChildTable;
  readonly data: readonly Row[];
  /** The default tooltip body's rows: one per `Scatter` in declaration order, its dot the series colour, its name the `label`. */
  readonly tooltipBase: TooltipBase;
  /** The renderer's options: a new definition is a new view, so the adapter's next commit hands it over. */
  readonly surface: object;
}

/** The surface's host box as RendererChart.js:116-119 writes it: no height, the width and the aspect ratio. */
export const scatterSurfaceStyle = (aspectRatio: number): StyleObject => surfaceHostStyle(surfaceBox({ aspectRatio }));

/** `Scatter` `label` names the default rows; a row's dot is bklit's series colour (`fill || stroke || palette`). */
export const scatterTooltipBase = (series: ScatterBuild["series"]): TooltipBase => ({
  order: series.map((s) => s.dataKey),
  colors: Object.fromEntries(series.map((s) => [s.dataKey, s.tooltipColor])),
  labels: seriesLabels(series),
});
