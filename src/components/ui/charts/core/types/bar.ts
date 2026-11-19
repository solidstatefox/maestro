import type { Row } from "../bar/model";
import type { ChartPhase, ChartStatus, Transition } from "../motion/phase";
import type { ChartMargin } from "../theme";
import type { ChartLinkProps } from "./link";

/** Cap of a bar: `"round"`, `"butt"`, or a corner radius in pixels. */
export type BarLineCap = "round" | "butt" | number;
/** Entrance style of the bars: grow from the baseline or fade in. */
export type BarAnimationType = "grow" | "fade";
/** Direction of a bar's value label: `"auto"` prefers horizontal text and rotates it when only vertical text fits. */
export type BarValueLabelOrientation = "auto" | "horizontal" | "vertical";
/** Where a bar's value label sits along the bar. On horizontal bars `"top"` is the value end and `"bottom"` the base. */
export type BarValueLabelPosition = "top" | "center" | "bottom";

export interface BarProps {
  /** Key of the data field that holds this series' values. */
  readonly dataKey: string;
  /** Name of the series in the default tooltip row. Defaults to `dataKey`. */
  readonly label?: string;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. A bar chart has a single value scale.
   */
  readonly yAxisId?: string | number;
  /**
   * Fill color of the bars. Can be a color or a `url(#id)` reference to a gradient or pattern child.
   * @default "var(--chart-line-primary)"
   */
  readonly fill?: string;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  readonly stroke?: string;
  /**
   * Bar end style: `"round"` rounds the outer corners, `"butt"` leaves them square. A number is treated like `"round"`.
   * @default "round"
   */
  readonly lineCap?: BarLineCap;
  /**
   * Grow this series' bars in on entrance. `false` draws them at their value from the first frame.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Entrance of this series' bars: `"grow"` from the baseline, or `"fade"` in from a soft blur at their full height, staggered the same way.
   * @default "grow"
   */
  readonly animationType?: BarAnimationType;
  /**
   * Opacity of the bars that are not hovered while another bar is hovered. Read from the first `Bar`.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
  /**
   * Delay in seconds between the entrances of consecutive bars of this series. Defaults to 40% of `animationDuration` spread across the categories.
   */
  readonly staggerDelay?: number;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. Set `stackGap` on `BarChart` instead.
   */
  readonly stackGap?: number;
  /**
   * Gap in px between the bars of a group. Read from the first `Bar`.
   * @default 4
   */
  readonly groupGap?: number;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. Depth surfaces trim the front face automatically.
   */
  readonly perspective?: boolean;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. Set `minBarHeight` on `BarDepthProvider` for depth surfaces.
   */
  readonly minBarHeight?: number;
  /**
   * Show each bar's formatted value inside the bar, where it fits. The fit is checked again on every resize, so narrow charts show fewer labels.
   * @default false
   */
  readonly showValue?: boolean;
  /** Formats a value shown inside a bar. Defaults to English integers, for example `12,000`. */
  readonly valueLabelFormatter?: (value: number) => string;
  /**
   * Text color of the values shown inside the bars.
   * @default "white"
   */
  readonly valueLabelColor?: string;
  /**
   * Direction of the value text: `"auto"` uses horizontal text, rotated when only vertical text fits; `"horizontal"` or `"vertical"` require that direction and hide labels that do not fit it.
   * @default "auto"
   */
  readonly valueLabelOrientation?: BarValueLabelOrientation;
  /**
   * Where the value sits inside the bar. On horizontal bars `"top"` is the value end (right) and `"bottom"` the base (left).
   * @default "center"
   */
  readonly valueLabelPosition?: BarValueLabelPosition;
  /** Extra CSS class name for the value labels. */
  readonly valueLabelClassName?: string;
}

interface GradientStop {
  /** Position of the stop in percent of the column height, from 0 (the baseline) to 100 (the top square), as in bklit-ui. */
  readonly offset: number;
  /** Color at this stop. */
  readonly color: string;
}

export interface BarSquaresProps {
  /** Key of the data field that holds this series' values. */
  readonly dataKey: string;
  /** Name of the series in the default tooltip row. Defaults to `dataKey`. */
  readonly label?: string;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  readonly yAxisId?: string | number;
  /**
   * Fill color of the squares, or a `url(#id)` reference to a gradient or pattern child.
   * @default "var(--chart-line-primary)"
   */
  readonly fill?: string;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  readonly stroke?: string;
  /** Key of a data field holding a color per column: a row with a string there solid-fills its column with it (no gradient), the others use `fill`. */
  readonly colorKey?: string;
  /**
   * Gap between stacked squares in px.
   * @default 3
   */
  readonly squareGap?: number;
  /**
   * Corner radius of each square as a fraction of its size (0 is flat, 0.5 is a circle).
   * @default 0.25
   */
  readonly squareRadius?: number;
  /**
   * Redistribute the gap so the squares fill the bar height exactly.
   * @default false
   */
  readonly squareFit?: boolean;
  /**
   * Paint the column with a gradient built from `gradientStops` (needs at least two stops).
   * @default false
   */
  readonly useGradient?: boolean;
  /**
   * Color stops of the column gradient used when `useGradient` is on. Each `offset` is a percentage of the column height, 0 (bottom) to 100 (top), not a 0 to 1 fraction.
   */
  readonly gradientStops?: readonly GradientStop[];
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  readonly patternPreset?: string;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  readonly animate?: boolean;
  /**
   * Opacity of the squares that are not hovered while another bar is hovered.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
  /** Delay in seconds between consecutive column entrances. Defaults to 40% of `animationDuration` spread across the categories. */
  readonly staggerDelay?: number;
  /**
   * Gap in px between the columns of a group.
   * @default 4
   */
  readonly groupGap?: number;
}

export interface BarColumnTrackProps {
  /**
   * Fill color of the track behind the bars.
   * @default "var(--chart-grid)"
   */
  readonly fill?: string;
  /**
   * Opacity of the track.
   * @default 0.3
   */
  readonly opacity?: number;
  /**
   * Gap between the squares in px, which sets where the track starts above them. Match the `BarSquares` value.
   * @default 3
   */
  readonly squareGap?: number;
  /**
   * Corner radius of the track as a fraction of the column width. Match the `BarSquares` value.
   * @default 0.25
   */
  readonly squareRadius?: number;
  /**
   * Gap in px between the track columns of a group.
   * @default 4
   */
  readonly groupGap?: number;
  /**
   * Whether the squares are redistributed to fill the bar height exactly, which sets where the track starts above them. Match the `BarSquares` value.
   * @default false
   */
  readonly squareFit?: boolean;
  /** Delay in seconds between consecutive column entrances. Defaults to 40% of `animationDuration` spread across the categories. */
  readonly staggerDelay?: number;
}

export interface BarXAxisProps {
  /**
   * Half-width in px of the zone around the date pill inside which tick labels are hidden.
   * @default 50
   */
  readonly tickerHalfWidth?: number;
  /**
   * Show every category label, even where they overlap, instead of thinning them to `maxLabels` and to the plot width.
   * @default false
   */
  readonly showAllLabels?: boolean;
  /**
   * Maximum number of category labels when `showAllLabels` is off. Fewer are shown, evenly spaced, when that many would not fit the plot width.
   * Pass `{ base, sm, md, lg, xl }` to vary it with the chart's width (640, 768, 1024 and 1280 px and up).
   * @default 12
   */
  readonly maxLabels?: BarLabelCount;
}

/** A label count, or one per chart width breakpoint: `base` below 640px, then `sm` (640), `md` (768), `lg` (1024), `xl` (1280). */
export type BarLabelCount = number | { readonly base?: number; readonly sm?: number; readonly md?: number; readonly lg?: number; readonly xl?: number };

export interface BarYAxisProps {
  /**
   * Horizontal charts: show every category label instead of thinning to `maxLabels`.
   * @default true
   */
  readonly showAllLabels?: boolean;
  /**
   * Horizontal charts: maximum number of category labels when `showAllLabels` is off.
   * @default 20
   */
  readonly maxLabels?: number;
  /**
   * Vertical charts: target number of value ticks. Grid settings take precedence.
   * @default 5
   */
  readonly numTicks?: number;
  /**
   * Vertical charts: abbreviate values of 1000 and above as thousands, for example `2k`.
   * @default true
   */
  readonly formatLargeNumbers?: boolean;
  /** Vertical charts: formats a value tick into its label. Overrides `formatLargeNumbers`. */
  readonly formatValue?: (value: number) => string;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. The value axis is always on the left.
   */
  readonly orientation?: "left" | "right";
}

export interface BarDepthSegment {
  /** Size of this segment. The values of all segments should add up to the bar's value. */
  readonly value: number;
  /** Color of this segment's side face. */
  readonly color?: string;
}

export interface BarDepthProviderProps<Node = unknown> {
  /** The chart children that use the shared depth settings. */
  readonly children?: Node;
  /**
   * Splits a stacked bar into segments, bottom to top, so each gets its own side face. Return `null` or `undefined` for a single color.
   */
  readonly segmentsAccessor?: (datum: Record<string, unknown>) => readonly BarDepthSegment[] | null | undefined;
  /**
   * Opacity of the contact shadow under the bars. `0` turns it off.
   * @default 0.26
   */
  readonly groundShadow?: number;
  /**
   * Minimum rendered bar height in px, so short or zero-value bars stay visible.
   * @default 0
   */
  readonly minBarHeight?: number;
}

export interface BarDepthBackProps {
  /** Key of the data field that holds the values drawn as the 3D side and top faces. */
  readonly dataKey: string;
  /** Color of the faces. Defaults to the series fill. */
  readonly color?: string;
  /** Picks a color per row (with its index). Return `undefined` to use `color`. */
  readonly colorAccessor?: (datum: Record<string, unknown>, index: number) => string | undefined;
}

export interface BarDepthFrontProps {
  /** Key of the data field that holds the values drawn as the glass front face. */
  readonly dataKey: string;
}

export interface BarPulseProps {
  /** Key of the data field of the bar that pulses. */
  readonly dataKey: string;
  /**
   * Index of the category whose bar pulses. Defaults to the last category.
   */
  readonly activeIndex?: number;
  /**
   * Pause the pulse animation.
   * @default false
   */
  readonly pulsePaused?: boolean;
}

/** Direction the bars grow: `"vertical"` (columns) or `"horizontal"` (rows). */
export type BarOrientation = "vertical" | "horizontal";

/** Props of {@link BarChart}. */
export interface BarChartProps<Node, Style> extends ChartLinkProps {
  /**
   * The rows to plot. Each row holds a category label under `xDataKey` and one number per series under that series' `dataKey`.
   */
  data: Row[];
  /**
   * Key of the category label in each row.
   * @default "name"
   */
  xDataKey?: string;
  /**
   * Duration of the entrance in milliseconds. Bars are staggered across 40% of this duration.
   * @default 1100
   */
  animationDuration?: number;
  // Accepted divergence: typed as bklit's but not read here (the entrance is fixed; square snapping follows <BarSquares> props).
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. The entrance always uses the default reveal easing.
   */
  animationEasing?: string;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  enterTransition?: Transition;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  revealSignature?: string;
  /**
   * Space around the plot area in pixels, for axis labels and the tooltip. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  margin?: Partial<ChartMargin>;
  /**
   * CSS aspect ratio of the chart, as `"width / height"`.
   * @default "2 / 1"
   */
  aspectRatio?: string;
  /** Extra CSS class name for the chart container. */
  className?: string;
  /**
   * Inline styles for the chart container. Set `aspectRatio: "unset"` to let the chart fill the height of its parent.
   */
  style?: Style;
  /**
   * Gap between bar groups as a fraction of the band width (0 to 1).
   * @default 0.2
   */
  barGap?: number;
  /** Fixed bar thickness in px, centred in its slot. When unset, the bars fill their band (`barGap` sets the gap). */
  barWidth?: number;
  /**
   * Direction the bars grow. `"horizontal"` puts the categories on the y axis.
   * @default "vertical"
   */
  orientation?: BarOrientation;
  /**
   * Stack the series on top of each other instead of grouping them side by side.
   * @default false
   */
  stacked?: boolean;
  /**
   * Gap between stacked segments in px.
   * @default 0
   */
  stackGap?: number;
  /**
   * Snap the tooltip dots of grouped vertical bars onto the centre of the top square of a `squareGap` column (`fit` redistributes the gap); `groupGap` sets the ring dot's slot gap.
   */
  squareSnap?: { squareGap: number; groupGap?: number; fit?: boolean };
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. The bar chart does not report phases.
   */
  onPhaseChange?: (phase: ChartPhase) => void;
  /**
   * The layers to draw: `Bar`, `BarSquares`, `Grid`, `BarXAxis`, `BarYAxis`, `ChartTooltip` and the other chart children. Optional for a `status="loading"` skeleton.
   */
  children?: Node;
  /**
   * Accessible name of the chart.
   * @default "Bar chart"
   */
  ariaLabel?: string;
  /** Longer accessible description of the chart, exposed as `aria-description`. */
  ariaDescription?: string;
  /**
   * `"loading"` replaces the bars with a shimmering skeleton and ignores the pointer; switching to `"ready"` grows the real bars.
   * @default "ready"
   */
  status?: ChartStatus;
  /** Fill color of the loading skeleton's bars. Defaults to the first `Bar`'s `stroke`, else its `fill`. */
  loadingFill?: string;
}

export interface BarChartLoadingProps {
  /**
   * Space around the plot area in pixels. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  readonly margin?: Partial<Readonly<ChartMargin>>;
  /**
   * CSS aspect ratio of the placeholder, as `"width / height"`.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /**
   * Extra CSS class name for the placeholder container.
   * @default ""
   */
  readonly className?: string;
  /** Fill color of the skeleton's bars. Defaults to the chart's foreground. */
  readonly loadingFill?: string;
}

export interface BarDepthEntry {
  /** Category label of the bar. */
  label: string;
  /** Index of the row in the original `data` array. */
  dataIndex: number;
  /** The data row this bar was built from. */
  datum: Record<string, unknown>;
  /** True when `dataIndex` equals the `activeIndex` passed to the hook. */
  isActive: boolean;
  /** True when the value is negative, so the bar extends downward from the baseline. */
  isNegative: boolean;
  /** Pixel y of the baseline (`yScale(0)`). */
  baselineY: number;
  /** Left edge of the bar's band in px. */
  bandX: number;
  /** Width of the bar's band in px. */
  bandWidth: number;
  /** Visual top of the bar in px (smaller is higher). */
  topY: number;
  /** Visual bottom of the bar in px. */
  bottomY: number;
  /** Rendered height of the bar in px. */
  barHeight: number;
  /** Untrimmed pixel height of the bar. */
  naturalHeight: number;
  /** Pixels subtracted from the visual top so the lid's back edge lands on the value. */
  topYTrim: number;
  /** Thickness of the side face in px (`0` for a bar at the center or in a dense chart). */
  depth: number;
  /** Vertical rise of the lid and side face in px. */
  perspectiveRise: number;
  /** True when the bar is right of the chart center, which puts its side face on the left. */
  isRightOfCenter: boolean;
}
