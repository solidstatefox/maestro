import type { PatternPresetId, PatternPresetOptions } from "../pattern/pattern-preset-helpers";

/** A brushed time range. */
export interface ChartBrushSelection {
  /** Start of the range. */
  start: Date;
  /** End of the range. */
  end: Date;
}

/**
 * Pattern drawn inside the brushed window: any preset id (`"diagonal-up"`, `"grid"`, `"dots"`… or a legacy one such as `"diagonal"`), or `"none"`.
 */
export type ChartBrushPatternPreset = PatternPresetId;

/** Pattern drawn inside the brushed window. Inherits the pattern options of `PatternPresetOptions`. */
export interface ChartBrushSelectionPattern extends PatternPresetOptions {
  /** Which pattern to draw. `"none"` draws nothing. */
  preset: ChartBrushPatternPreset;
  /** Color of the pattern lines or dots. */
  color: string;
  /**
   * Opacity of the pattern.
   * @default 1
   */
  opacity?: number;
}

/** Look of the dimmed area outside the brushed window. */
export interface ChartBrushTrackOverlayStyle {
  /**
   * Blur applied to the dimmed area outside the window, in px (clamped to 0-5).
   * @default 1.5
   */
  blurPx?: number;
  /**
   * Fade the dimmed area out toward the outer edges of the strip.
   * @default true
   */
  fadeOuterEdges?: boolean;
}

/** Props of `ChartBrush`. */
export interface ChartBrushProps<RectAttributes> extends ChartBrushTrackOverlayStyle {
  /**
   * Accepted so bklit-ui code compiles. The brush is always horizontal: the native brush is `brushX` only, and the selection is a time range
   * (bklit reports only the x extent too, chart-brush.tsx:270-288).
   */
  readonly brushDirection?: "horizontal" | "vertical" | "both";
  /** Accepted so bklit-ui code compiles. Has no effect (bklit ignores it as well, chart-brush.tsx:262). Use `initialSelection` to set the window. */
  readonly selection?: ChartBrushSelection | null;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly useWindowMoveEvents?: boolean;
  /**
   * Called while the window is dragged or resized, with the selected range, or `null` when the selection collapses to nothing (which resets to the full range). Escape cancels a drag and reports the previous range. The range is slightly widened (about 2 px per side) so a full drag covers the end points.
   */
  readonly onSelectionChange?: (selection: { readonly start: Readonly<Date>; readonly end: Readonly<Date> } | null) => void;
  /**
   * Window shown on mount, for example the first half of the range. Changing it later does not move the window; it resets when the chart's data changes.
   * It is reported through `onSelectionChange` on mount and after a data change (unless it is the full range), so a `ChartBrushLayout`'s main chart starts zoomed to it.
   */
  readonly initialSelection?: ChartBrushSelection | null;
  /** Styles the brushed window. Only `color` is applied by `ChartBrush`; use `ChartBrushSelectionOverlay` to draw a full pattern. */
  readonly selectionPattern?: ChartBrushSelectionPattern;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly selectedBoxStyle?: RectAttributes;
}

/** Props of `ChartBrushTrackOverlay`. */
export interface ChartBrushTrackOverlayProps extends ChartBrushTrackOverlayStyle {
  /** Plot width in px. */
  innerWidth: number;
  /** Plot height in px. */
  innerHeight: number;
  /** Pixel x of the selection start within the plot area. */
  selectionX0: number;
  /** Pixel x of the selection end within the plot area. */
  selectionX1: number;
}

/** Props of `ChartBrushSelectionOverlay`. */
export interface ChartBrushSelectionOverlayProps {
  /** Plot width in px. */
  innerWidth: number;
  /** Plot height in px. */
  innerHeight: number;
  /** Pixel x of the selection start within the plot area. */
  selectionX0: number;
  /** Pixel x of the selection end within the plot area. */
  selectionX1: number;
  /** Pattern to draw inside the window. Nothing is drawn when omitted or `"none"`. */
  pattern?: ChartBrushSelectionPattern;
}

/** What `ChartBrushLayout` passes to its `children` and `brushStrip` render functions. */
export interface ChartBrushLayoutState {
  /** Visible x range for the main chart. `undefined` shows everything (when `enabled` is false). */
  xDomain: [Date, Date] | undefined;
  /**
   * Number of rows in the full data, for bar and candlestick charts that size columns against it. `undefined` when `enabled` is false.
   */
  xDomainSlotCount: number | undefined;
  /**
   * The brushed range: `null` until the strip reports one (its `ChartBrush` `initialSelection` on mount, or a drag), and again after a data change; meanwhile the main chart shows the full extent.
   * Pass `layout.brushSelection ?? window` as the strip's `initialSelection` to start zoomed to `window`.
   */
  brushSelection: ChartBrushSelection | null;
  /** Pass this to the brush's `onSelectionChange`. Clearing the selection (`null`) resets to the full extent. */
  onBrushSelectionChange: (selection: ChartBrushSelection | null) => void;
}

/** Props of `ChartBrushLayout`. */
export interface ChartBrushLayoutProps<Node> {
  /** The full dataset. The brushed range starts as its extent and resets when this changes. */
  data: Record<string, unknown>[];
  /**
   * Key of the date field in each row.
   * @default "date"
   */
  xDataKey?: string;
  /** Extends the brushable range past the last data point to this date. */
  xExtentMax?: Date;
  /** Turn the brush on. When false, the main chart shows all data and the strip is not rendered. */
  enabled: boolean;
  /** Height of the brush strip in px. */
  height: number;
  /**
   * Pack the main chart and strip tightly at the top instead of stretching the main chart to fill the height.
   * @default false
   */
  fitMainContent?: boolean;
  /** Class names added to the layout container. */
  className?: string;
  /** Render function for the main chart. Receives the layout state. */
  children: (layout: ChartBrushLayoutState) => Node;
  /** Render function for the brush strip, shown below the main chart when `enabled`. Receives the layout state. */
  brushStrip?: (layout: ChartBrushLayoutState) => Node;
}
