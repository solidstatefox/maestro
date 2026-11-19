"use client";
// LineBackdrop and TrendLine: using one is what bundles its builder (core/cartesian/enable-series-layers.ts).
import { defineCarrier } from "../role";
import type { LineBackdropProps, TrendLineProps } from "../../core/types/cartesian";
import { enableLineBackdrop, enableTrendLine } from "../../core/cartesian/enable-series-layers";

/**
 * A fill clipped to the region between a series and the top (or bottom) of the plot, such as a sky glow above the line: a radial gradient that
 * follows the line through its reveal, data changes and y-domain tweens, and fades in once the line has drawn. Render it before the `Line`,
 * with the same `dataKey` (and `curve`). It renders nothing itself; place it as a child of the chart.
 */
export const LineBackdrop = /* @__PURE__ */ defineCarrier<Readonly<LineBackdropProps>>("lineBackdrop", "LineBackdrop", undefined, enableLineBackdrop);
/**
 * A least-squares regression line through one series (`dataKey`), dashed by default, or solid, or a gradient along it, with optional faded
 * ends. It fades in after the reveal and glides to the new fit when the data changes. Place it after the series. It renders nothing itself.
 */
export const TrendLine = /* @__PURE__ */ defineCarrier<Readonly<TrendLineProps>>("trendLine", "TrendLine", undefined, enableTrendLine);
