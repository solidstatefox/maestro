import type { ChildTable } from "../carriers/table";
import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import type { ChartMargin } from "../theme";
import type { BarDepthConfig } from "./depth-entries";
import type { Row } from "./model";
import type { BarTooltipSeries } from "./tooltip";

/** bklit's loading skeleton (bar-chart.tsx:654-660), an svg over the plot rect sized from the host's box (`barInnerSize`). */
export interface BarSkeleton {
  readonly barCount: number;
  /** The skeleton bars' fill (`loadingFill`, else the first series' colour); undefined keeps the skeleton's foreground. */
  readonly fill?: string;
  /** The skeleton svg's style: at the plot's corner, inert to the pointer. */
  readonly style: StyleObject;
}

export interface BarView {
  /** The host's attributes (`undefined` leaves one out), beside the adapter's own `class` and hydration marker. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`. */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`): RendererChart.js:116-119, filling the host's height when the reader's style unsets the aspect ratio. */
  readonly surfaceStyle: StyleObject;
  /** The chart's stylesheet. React renders it after the surface (in its server markup too); a self-driven controller owns the element. */
  readonly staticCss: string;
  /** While `status="loading"`, in place of the bars. */
  readonly skeleton: BarSkeleton | null;
  /** The resolved margin: the plot inside the host box (`barInnerSize`), where the skeleton and the custom children sit. */
  readonly margin: ChartMargin;
  /** The carriers and data the tooltip body reads. */
  readonly table: ChildTable;
  readonly data: readonly Row[];
  /** The default tooltip rows' series inputs. */
  readonly tooltipBase: BarTooltipSeries;
  /** Horizontal bars carry the value on x and the category on y (the tooltip body swaps them back). */
  readonly horizontal: boolean;
  /** The `<BarDepthProvider>` options `useBarDepthEntries` reads in the custom children. */
  readonly depthConfig: BarDepthConfig;
  /** The renderer's options: a new definition is a new view, so the adapter's next commit hands it over. */
  readonly surface: object;
}

/** Container-owned height: the host follows the wrapper's CSS content height (TanStack renderer.ts observesContainerHeight, responsive-charts.md). */
const FILL_HOST_STYLE: StyleObject = { height: "100%" };

/** The surface's host box: the renderer's own (`surfaceBox`), its height the host's when `fillHeight` (the reader's `aspectRatio: "unset"`). */
export const barSurfaceStyle = (aspectRatio: number | undefined, fillHeight: boolean): StyleObject =>
  surfaceHostStyle(surfaceBox({ aspectRatio }), fillHeight ? FILL_HOST_STYLE : undefined);
