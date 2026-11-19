import { motion } from "@tanstack/charts/motion";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { memoCell } from "../memo";
import type { StyleObject } from "../style";
import { bklitSurfaceStyle, DEFAULT_ANIMATION_MS, DEFAULT_MARGIN, parseAspectRatio } from "../theme";
import type { ChartMargin } from "../theme";
import type { BarChartProps, BarOrientation, BarXAxisProps } from "../types/bar";
import { buildBarDefinition } from "./definition";
import type { BarDefinition, BarInput } from "./definition";
import { barDepthConfigOf } from "./depth-entries";
import type { BarDepthConfig } from "./depth-entries";
import { hasDepth } from "./depth-feature";
import type { PlotRect } from "./focus";
import { MAX_INDEX } from "./hover";
import { resolveBarSeries } from "./model";
import type { BarSeries, Row } from "./model";
import { barStaticCss } from "./static-css";
import { barTooltipSeries } from "./tooltip";
import type { BarTooltipSeries } from "./tooltip";

/** The props the pass reads: the adapter keeps `className` and `children`, and merges the reader's `style` itself (read here for
 * `aspectRatio: "unset"` only). */
export type BarChartOptions = Omit<BarChartProps<unknown, { readonly aspectRatio?: unknown }>, "children" | "className">;

export interface BarPassInput {
  readonly props: BarChartOptions;
  readonly table: ChildTable;
  /** The chart's id: the `data-bkm-bar` scope of its stylesheet and the prefix of its svg ids. */
  readonly uid: string;
  /** Custom marks (squares, depth) only animate enter when they join a painted scene, so charts that have them (`needsSeed`) paint a seeded
   * first build, then one `entered` flip (after that first paint) builds the full definition and the update tweens it in. */
  readonly entered: boolean;
  /** `data` differs in content from the first data drawn (core/data-updated.ts): bklit snaps the guides too (ticks and grid lines neither fade in nor out). */
  readonly updated: boolean;
  /** The plot rect of the latest draw (core/bar/host.ts), read lazily by the focus strategy. */
  readonly plot: () => PlotRect;
  /** The legend's hovered series index (`ChartLegendHoverProvider`), null for none. */
  readonly legendHovered: number | null;
}

export interface BarPass {
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly animationDuration: number;
  readonly orientation: BarOrientation;
  readonly horizontal: boolean;
  readonly stacked: boolean;
  readonly barGap: number;
  /** `status="loading"`: the skeleton instead of the bars, the host inert to the pointer. */
  readonly loading: boolean;
  readonly series: readonly BarSeries[];
  /** The chart has custom marks: its first build is seeded (`BarPassInput.entered`). */
  readonly needsSeed: boolean;
  readonly margin: ChartMargin;
  /** The bars' entrance clock (enter-timing.ts): it restarts with each reveal, so the controller clears it while loading. */
  readonly clock: { at: number | null };
  readonly built: BarDefinition;
  readonly renderer: ReturnType<typeof motion>;
  readonly categories: readonly string[];
  /** The interaction-ready gate's timer (ms). */
  readonly readyDelay: number;
  readonly tooltip: BarTooltipSeries;
  /** The `<BarDepthProvider>` options `useBarDepthEntries` reads. */
  readonly depthConfig: BarDepthConfig;
  readonly staticCss: string;
  /** The host's attributes (`undefined` leaves one out). */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's. */
  readonly hostStyle: StyleObject;
  /** The reader's style unsets the aspect ratio: the surface fills the host's height. */
  readonly fillHeight: boolean;
  /** The surface's aspect ratio, undefined when it fills the host's height. */
  readonly chartAspect: number | undefined;
  readonly ariaLabel: string;
}

/** One pass builder per chart instance, fed on every render. */
export function createBarPass(): (input: BarPassInput) => BarPass {
  const clock: { at: number | null } = { at: null };
  const snapCell = memoCell<BarInput["squareSnap"]>();
  const seriesCell = memoCell<BarSeries[]>();
  const marginCell = memoCell<ChartMargin>();
  const builtCell = memoCell<BarDefinition>();
  const rendererCell = memoCell<ReturnType<typeof motion>>();
  const categoriesCell = memoCell<string[]>();
  const tooltipCell = memoCell<BarTooltipSeries>();
  const depthCell = memoCell<BarDepthConfig>();
  const cssCell = memoCell<string>();
  const attrsCell = memoCell<BarPass["hostAttrs"]>();
  const hostStyleCell = memoCell<StyleObject>();
  return ({ props, table, uid, entered, updated, plot, legendHovered }) => {
    const {
      data,
      xDataKey = "name",
      animationDuration = DEFAULT_ANIMATION_MS,
      margin,
      aspectRatio = "2 / 1",
      style,
      barGap = 0.2,
      orientation = "vertical",
      stacked = false,
      stackGap = 0,
      squareSnap: squareSnapProp,
      status = "ready",
      barWidth,
    } = props;
    // Keyed on its values so an inline `squareSnap` object does not rebuild the definition every render.
    const snapGap = squareSnapProp?.squareGap;
    const snapGroupGap = squareSnapProp?.groupGap;
    const snapFit = squareSnapProp?.fit;
    const squareSnap = snapCell([snapGap, snapGroupGap, snapFit], () => (snapGap === undefined ? undefined : { squareGap: snapGap, groupGap: snapGroupGap, fit: snapFit }));
    const loading = status === "loading";
    const horizontal = orientation === "horizontal";
    const series = seriesCell([table], () => resolveBarSeries(table));
    const needsSeed = series.some((s) => s.squares) || hasDepth(table);
    const seed = needsSeed && !entered;
    const resolvedMargin = marginCell([margin], () => ({ ...DEFAULT_MARGIN, ...margin }));
    const built = builtCell(
      [loading, seed, clock, data, xDataKey, table, series, resolvedMargin, barGap, animationDuration, uid, orientation, stacked, stackGap, squareSnap, plot, updated, barWidth],
      () =>
        buildBarDefinition({
          data,
          xKey: xDataKey,
          table,
          series,
          margin: resolvedMargin,
          barGap,
          animationDuration,
          uid,
          horizontal,
          stacked,
          stackGap,
          squareSnap,
          seed,
          clock,
          updated,
          plot,
          loading,
          barWidth,
        }),
    );
    // `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too.
    const renderer = rendererCell([animationDuration], () => motion({ initial: "always", transition: { type: "tween", duration: animationDuration } }));
    const categories = categoriesCell([data, xDataKey], () => data.map((d) => String(d[xDataKey])));
    const tooltip = tooltipCell([series], () => barTooltipSeries(series));
    const depthConfig = depthCell([table], () => barDepthConfigOf(table));
    // bklit bar-x-axis.tsx:91: the date pill hides ticks within tickerHalfWidth of the focused band centre.
    const tickerHalfWidth = propsFor<BarXAxisProps>(table, "barXAxis").at(0)?.tickerHalfWidth ?? 50;
    const hasSeries = series.length > 0;
    const staticCss = cssCell(
      [uid, built.hover, built.tickPositions, hasSeries, horizontal, tickerHalfWidth, built.entranceCss],
      () => barStaticCss({ uid, hover: built.hover, tickPositions: built.tickPositions, hasSeries, horizontal, tickerHalfWidth }) + built.entranceCss,
    );
    const legend = legendHovered !== null && legendHovered < MAX_INDEX ? String(legendHovered) : undefined;
    const hostAttrs = attrsCell([uid, loading, legend, built.gridAttrs], () => ({
      "data-bkm-chart": "bar",
      "data-bkm-bar": uid,
      "data-bkm-status": loading ? "loading" : undefined,
      "data-legend": legend,
      ...built.gridAttrs,
      "data-slot": "chart",
    }));
    // bklit's outer div carries `style={{ aspectRatio }}` from its first render (bar-chart.tsx:696-700); only the svg waits for the layout-effect mount.
    const hostStyle = hostStyleCell([aspectRatio], () => ({ width: "100%", position: "relative", "aspect-ratio": aspectRatio, ...bklitSurfaceStyle }));
    const fillHeight = style?.aspectRatio === "unset";
    return {
      data,
      xDataKey,
      animationDuration,
      orientation,
      horizontal,
      stacked,
      barGap,
      loading,
      series,
      needsSeed,
      margin: resolvedMargin,
      clock,
      built,
      renderer,
      categories,
      // bklit `canInteract = isLoaded` (bar-chart.tsx:549), set by a setTimeout at animationDuration + staggerMs, staggerMs =
      // data.length > 1 ? animationDuration * 0.4 : 0 (bklit bar-chart.tsx:381-384): hover is inert until then.
      readyDelay: animationDuration + (data.length > 1 ? animationDuration * 0.4 : 0),
      tooltip,
      depthConfig,
      staticCss,
      hostAttrs,
      hostStyle,
      fillHeight,
      chartAspect: fillHeight ? undefined : parseAspectRatio(aspectRatio),
      ariaLabel: props.ariaLabel ?? "Bar chart",
    };
  };
}
