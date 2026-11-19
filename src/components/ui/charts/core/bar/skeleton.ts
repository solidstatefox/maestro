import { px } from "../style";
import type { StyleObject } from "../style";
import type { ChartMargin } from "../theme";
import type { BarSeries } from "./model";

// bklit bar-chart.tsx:54-55: skeleton bars when `data` is empty.
const FALLBACK_LOADING_BARS = 12;

/** The skeleton's bar count: one per row, bklit's 12 without data (`barCount = data.length || 12`, bar-chart.tsx:54-55). */
export const barSkeletonCount = (rows: number): number => (rows > 0 ? rows : FALLBACK_LOADING_BARS);

/** The skeleton svg's style: at the plot's corner, inert to the pointer. */
export const barSkeletonStyle = (margin: ChartMargin): StyleObject => ({
  position: "absolute",
  left: px(margin.left),
  top: px(margin.top),
  overflow: "visible",
  "pointer-events": "none",
});

/** bklit bar-chart.tsx `effectiveLoadingFill`: `loadingFill`, else the first series' dot colour (its `stroke`, else its fill), so the skeleton
 * shimmers in the colour the bars will take; a chart without a series keeps the skeleton's own foreground. */
export const barSkeletonFill = (loadingFill: string | undefined, series: readonly BarSeries[]): string | undefined => {
  const first = series[0];
  return loadingFill ?? first?.bar?.stroke ?? first?.squares?.stroke ?? first?.fill;
};
