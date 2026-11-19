import type { CSSProperties, ReactNode } from "react";
import type {
  ChartMarker as CoreChartMarker,
  ChartMarkersProps as CoreChartMarkersProps,
  ChartTooltipProps as CoreChartTooltipProps,
  MarkerGroupProps as CoreMarkerGroupProps,
} from "../core/types/cartesian";

/** One event marker for `ChartMarkers`: a circle with an icon at a date on the x-axis. */
export interface ChartMarker extends CoreChartMarker<ReactNode> {}

/** Props of `ChartMarkers`, a row of event markers along the top of the plot. */
export interface ChartMarkersProps extends CoreChartMarkersProps<ChartMarker> {}

/**
 * Props of `MarkerGroup`. As a chart child it draws one `ChartMarkers` group at the dates of its `markers`; the pixel-placement and portal props exist so bklit-ui code compiles and are not read.
 */
export interface MarkerGroupProps extends CoreMarkerGroupProps<ChartMarker> {}

export interface ChartTooltipProps extends CoreChartTooltipProps<ReactNode, CSSProperties> {}
