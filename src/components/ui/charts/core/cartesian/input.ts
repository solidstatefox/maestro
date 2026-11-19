import type { ChartFocusStrategy, ChartGradient } from "@tanstack/charts";
import type { ChartMargin } from "../theme";
import type { YDomainOverride } from "./y-domain-utils";
import type { ChildTable } from "../carriers/table";
import type { AnyMark } from "../erased-types";
import type { ResolvedSeries, Row } from "./series";
import type { PlotSize } from "./plot-size";
import type { OverlayDot } from "./hover-overlay";
import type { WipeConfig, WipeSpec } from "./wipe";

/** The y domains a build resolved, by axis id (the draw's scales). */
export type ExtraDomains = ReadonlyMap<string, readonly [number, number]>;

export interface CartesianInput {
  readonly data: readonly Row[];
  readonly xKey: string;
  readonly table: ChildTable;
  readonly series: readonly ResolvedSeries[];
  readonly margin: ChartMargin;
  readonly xDomain?: readonly [Date, Date];
  /** Where a line's edge fade is pinned when it is not `xDomain` (a ChartZoom chart: the data's extent, so a pan's transform shows the data past the window, link.ts). */
  readonly fadeDomain?: readonly [Date, Date];
  /** Plot (inner) size in px, for the segment drag geometry; the height is unclamped (negative when the margins exceed the host). */
  readonly plotWidth?: number;
  readonly plotHeight?: number;
  /** Inner plot width in px: the decimation threshold (bklit `maxRenderPointsForWidth`). Absent or 0: no decimation. */
  readonly innerWidth?: number;
  readonly uid: string;
  /** The chart's `status="loading"`: the grid takes its loading look (grid-guides.ts `loadingGridProps`). */
  readonly chartLoading?: boolean;
  readonly animationDuration: number;
  readonly animationEasing?: string;
  /** ProfitLossLegend hover: 0 = Profit, 1 = Loss (dims the other sign on ProfitLossLine), or null. */
  readonly profitLossHovered?: number | null;
  /** Marks the series list does not describe (composed bars, candles, scatters); a function of the resolved y domains when they place by them. */
  readonly extraMarks: readonly AnyMark[] | ((yDomains: ExtraDomains) => readonly AnyMark[]);
  /** Hover dots of marks the series list does not describe (composed bars), after the series dots. */
  readonly extraDots?: readonly OverlayDot[] | ((yDomains: ExtraDomains) => readonly OverlayDot[]);
  readonly extraXValues: readonly Date[];
  readonly extraYValues: readonly number[];
  /** Values of the extra marks by axis id, beyond `extraYValues` (on the primary axis): an axis only they use still gets a scale. */
  readonly extraYByAxis?: ReadonlyMap<string, readonly number[]>;
  /** Axes whose domain floats around their values instead of anchoring at zero (a composed Candlestick's). */
  readonly floatingAxes?: ReadonlySet<string>;
  readonly extraGradients: readonly ChartGradient[];
  readonly renderTooltipEnabled: boolean;
  /** Controlled brush range (strip charts that contain a ChartBrush child): the last ACCEPTED range, never a preview. */
  readonly brush?: {
    readonly range: { start: Date; end: Date };
    /** Hatch colour (ChartBrush `selectionPattern.color`). */
    readonly color?: string;
    readonly onChange: (range: { start: Date; end: Date }, type: "preview" | "commit" | "cancel") => void;
  };
  /** Data-update step (core/cartesian/data-update-step.ts). "snap": new data over `yDomainFrom`, nothing animates (bklit snaps on a data change). "glide": new y domain, 500ms tween.
   * "window": a brushed x domain change (bklit snaps the x scale, axis and grid and tweens the series paths and y domain, 500ms). Absent: a size or selection change, which keeps the short UPDATE_MOTION. */
  readonly updateStep?: "snap" | "glide" | "window";
  readonly yDomainFrom?: Readonly<Record<string, readonly [number, number]>>;
  /** The chart's `yDomains`: per-axis overrides of the auto y domain (applied before nice). */
  readonly yDomainOverrides?: Readonly<Record<string, YDomainOverride>>;
  /** Native left-to-right reveal (bklit ChartRevealClip) of line / area / projection marks: progress 0..1 (seeded 0, flipped to 1 by `<RevealArm>`). Absent = not wrapped.
   * `w` / `h` are the inner plot size; `pad` extends the clip each side (composed: half a bar group, bklit `revealClipPadding`). */
  readonly wipe?: WipeConfig;
  /** bklit `yScaleDomainMax`: on a chart whose series all use the default axis, the y domain is `[0, yScaleDomainMax × 1.1]` (niced). */
  readonly yScaleDomainMax?: number;
  /** Duration (ms) of the y-domain glide of a data update or a brushed window (bklit `yDomainTweenDuration`, 500 by default). */
  readonly yGlideMs?: number;
  /** The entrance reveal's easing (`enterTransition.ease` / `animationEasing`); bklit's cubic-bezier(0.85, 0, 0.15, 1) when absent. */
  readonly revealEasing?: (t: number) => number;
}

/** What a cartesian definition is built from: the sized fields of `CartesianInput` are resolved inside TanStack's draw (`chart({ width, height })`), from the size it measured. */
export interface CartesianSpec extends Omit<CartesianInput, "plotWidth" | "plotHeight" | "innerWidth" | "wipe" | "extraMarks" | "extraDots"> {
  readonly extraDots?: readonly OverlayDot[] | ((size: PlotSize, yDomains: ExtraDomains) => readonly OverlayDot[]);
  readonly wipe?: WipeSpec;
  readonly extraMarks: readonly AnyMark[] | ((size: PlotSize, yDomains: ExtraDomains) => readonly AnyMark[]);
  /** Final say on the built marks (composed re-orders them to the JSX order). */
  readonly orderMarks?: (marks: readonly AnyMark[]) => readonly AnyMark[];
  /** Replaces the cartesian focus; reads the size lazily through `size()`. */
  readonly focusOf?: (size: () => PlotSize) => ChartFocusStrategy;
}
