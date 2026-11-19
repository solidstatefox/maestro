"use client";
// Config-carrier children for the native cartesian charts: a carrier renders nothing, the chart reads its props with React.Children (`readChildren`) and compiles them into one TanStack definition,
// so the declarative bklit API (`<LineChart><Line/><Grid/>...`) survives with no store.
import { enableValueLabels } from "../../core/cartesian/enable-value-labels";
import { defineCarrier } from "../role";
import type { ChartTooltipProps } from "../types";
import type { AreaConfig, GridProps, LineConfig, PatternAreaConfig, ProfitLossLineProps, ScatterConfig, SeriesMarkersProps, XAxisConfig, YAxisConfig } from "../../core/types/cartesian";

/** A line series for the chart's `dataKey` column, with optional markers, gradient stroke and animated entrance. It renders nothing itself; place it as a child of the chart. */
export const Line = /* @__PURE__ */ defineCarrier<Readonly<LineConfig>>("line", "Line");
/** A filled area series for the `dataKey` column, with an optional gradient fill and stroke. It renders nothing itself; place it as a child of the chart. */
export const Area = /* @__PURE__ */ defineCarrier<Readonly<AreaConfig>>("area", "Area", undefined, enableValueLabels);
/** An area series filled with a pattern instead of a gradient. It renders nothing itself; place it as a child of the chart. */
export const PatternArea = /* @__PURE__ */ defineCarrier<Readonly<PatternAreaConfig>>("patternArea", "PatternArea");
/** Grid lines behind the series. Draw horizontal lines, vertical lines or both. It renders nothing itself; place it as a child of the chart. */
export const Grid = /* @__PURE__ */ defineCarrier<GridProps>("grid", "Grid");
/** The x axis: tick labels along the bottom of the plot. It renders nothing itself; place it as a child of the chart. */
export const XAxis = /* @__PURE__ */ defineCarrier<Readonly<XAxisConfig>>("xAxis", "XAxis");
/** The y axis: tick labels along the left or right edge of the plot. It renders nothing itself; place it as a child of the chart. */
export const YAxis = /* @__PURE__ */ defineCarrier<Readonly<YAxisConfig>>("yAxis", "YAxis");
/** The hover and keyboard tooltip: crosshair indicator, series dots and a floating box with the values at the focused x position. It renders nothing itself; place it as a child of the chart. */
export const ChartTooltip = /* @__PURE__ */ defineCarrier<ChartTooltipProps>("tooltip", "ChartTooltip");
/** A single line that is green above zero and red below it, with the color switching at each zero crossing. It renders nothing itself; place it as a child of the chart instead of `Line`. */
export const ProfitLossLine = /* @__PURE__ */ defineCarrier<ProfitLossLineProps>("profitLossLine", "ProfitLossLine");
/** A scatter series: one dot per data row, positioned by `xDataKey` and `yDataKey`. It renders nothing itself; place it as a child of the chart. */
export const Scatter = /* @__PURE__ */ defineCarrier<Readonly<ScatterConfig>>("scatter", "Scatter");
/** Point markers on the series with this `dataKey`, with the same options as `showMarkers` and `markers` on `Line` and `Area`. It renders nothing itself; place it as a child of the chart. */
export const SeriesMarkers = /* @__PURE__ */ defineCarrier<SeriesMarkersProps>("seriesMarkers", "SeriesMarkers");
