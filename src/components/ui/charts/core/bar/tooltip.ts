import type { AnyPoint } from "../erased-types";
import { seriesLabels } from "../tooltip/series-labels";
import type { BarDatum, BarSeries } from "./model";

/** A bar point as the shared options read it: category on x, value on y, and its data row as the datum, so `rows` / `content` get the row (not the internal BarDatum). */
const rowPoint = (p: AnyPoint, horizontal: boolean): AnyPoint => {
  // SAFETY: every point of the bar chart's marks (bars, squares, depth) carries a BarDatum, built by buildBarData.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const { source } = p.datum as BarDatum;
  return horizontal ? { ...p, xValue: p.yValue, yValue: p.xValue, datum: source } : { ...p, datum: source };
};

/** The hovered points as tooltip rows read them (horizontal bars carry the value on x and the category on y). */
export const barTooltipPoints = (points: readonly AnyPoint[], horizontal: boolean): AnyPoint[] => points.map((p) => rowPoint(p, horizontal));

/** The default rows' series inputs: rows in series order, each with its fill and the `label` its carrier names it by. */
export interface BarTooltipSeries {
  readonly order: readonly string[];
  readonly colors: Readonly<Record<string, string>>;
  readonly labels: Readonly<Partial<Record<string, string>>>;
}

export const barTooltipSeries = (series: readonly BarSeries[]): BarTooltipSeries => ({
  order: series.map((s) => s.key),
  colors: Object.fromEntries(series.map((s) => [s.key, s.fill])),
  labels: seriesLabels(series.flatMap((s) => s.bar ?? s.squares ?? [])),
});
