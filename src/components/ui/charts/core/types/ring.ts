import type { EnterTransition } from "../motion/phase";
import type { CenterStatFormat } from "./polar";

type RingEnterTransition = EnterTransition;

/** Shape of a ring's leading end: `"round"` rounds it, `"butt"` cuts it square. */
export type RingLineCap = "round" | "butt";

/** One ring of a `RingChart`. */
export interface RingData {
  /** Display name of the ring. Shown as the label in `RingCenter` while the ring is hovered. */
  readonly label: string;
  /** Current value of the ring. */
  readonly value: number;
  /** Value at which the ring is full. The ring fills `value / maxValue`, limited to 0 to 1. */
  readonly maxValue: number;
  /**
   * Ring colour, any CSS colour or `var(--...)` reference. Defaults to the `--chart-1` to `--chart-5` palette, in order.
   */
  readonly color?: string;
}

/** Props for `Ring`. */
export interface RingProps {
  /** Index of the ring this element configures, matching its position in the `data` array. */
  readonly index: number;
  /** Colour override for this ring. Takes precedence over the data item's `color`. */
  readonly color?: string;
  /**
   * Play the entrance animation for this ring. Set `false` to draw it without animating.
   * @default true
   */
  readonly animate?: boolean;
  /** Accepted for bklit-ui compatibility. No glow is drawn, which matches how bklit-ui renders. */
  readonly showGlow?: boolean;
  /**
   * Shape of the ring's leading end: `"round"` or `"butt"` (square).
   * @default "round"
   */
  readonly lineCap?: RingLineCap;
}

/** Props for `RingChart`. */
export interface RingChartProps<Node, Style> {
  /** The rings to draw, from the innermost outwards. Each ring fills `value / maxValue` of its track. */
  readonly data: RingData[];
  /** Chart width and height in pixels. Omit to fill the width of the parent element; the chart stays square. */
  readonly size?: number;
  /**
   * Thickness of each ring in pixels.
   * @default 12
   */
  strokeWidth?: number;
  /**
   * Gap between neighbouring rings in pixels.
   * @default 6
   */
  readonly ringGap?: number;
  /**
   * Inner radius of the innermost ring in pixels. Also sets the size of the area available to `RingCenter`.
   * @default 60
   */
  readonly baseInnerRadius?: number;
  /**
   * Space kept clear between the outermost ring and the chart's edge, in pixels. The rings scale down to keep it.
   * @default 8, or 32 with a `RingGrid` (room for its labels)
   */
  readonly padding?: number;
  /** Accepted for bklit-ui compatibility; has no effect. Use `enterTransition` to change the entrance timing. */
  readonly animationDuration?: number;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container, merged over the default sizing. */
  readonly style?: Style;
  /**
   * Index of the hovered ring, for controlled hover. Pass `null` for no hover; leave it `undefined` to let the chart manage hover itself.
   */
  hoveredIndex?: number | null;
  /** Called with the index of the hovered or keyboard-focused ring, or `null` when hover ends. */
  readonly onHoverChange?: (index: number | null) => void;
  /**
   * Angle where every ring starts, in radians, clockwise from 12 o'clock (d3's convention): the default `-Math.PI / 2` is 9 o'clock.
   * bklit-ui's own comment calls the default "top", but its d3 arcs start at 9 o'clock too.
   * @default -Math.PI / 2
   */
  readonly startAngle?: number;
  /**
   * Angle where a full ring ends, in radians. Together with `startAngle` this sets the sweep; the default is a full circle.
   * @default (3 * Math.PI) / 2
   */
  readonly endAngle?: number;
  /**
   * Transition for the entrance, in the shape used by the `motion` library (`type`, `duration` in seconds, `ease`, and spring values). Defaults to a 1.1 second tween on the shared reveal curve.
   */
  readonly enterTransition?: RingEnterTransition;
  /**
   * Multiplier for the delay between one ring's entrance and the next. `0` starts all rings together.
   * @default 1
   */
  readonly enterStaggerScale?: number;
  /**
   * Turns off hover effects and `Ring` overrides. Meant for live editors that redraw the geometry while a control is dragged; leave it off otherwise.
   * @default false
   */
  readonly geometryScrubbing?: boolean;
  /** `Ring` elements to configure individual rings and an optional `RingCenter`. */
  readonly children: Node;
  /**
   * Accessible name of the chart.
   * @default "Ring chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
}

/** Props for `RingGrid`. */
export interface RingGridProps {
  /**
   * Progress ticks: fractions of each ring's `maxValue` (0 to 1), or the number of equal intervals. On a full circle the 100% tick
   * lands on 0% and only 0% is drawn.
   * @default 4
   */
  readonly ticks?: number | readonly number[];
  /**
   * Formats a tick's label from its fraction.
   * @default whole percent, "25%"
   */
  readonly tickFormat?: (fraction: number) => string;
  /**
   * Draw spokes across the rings at every tick.
   * @default true
   */
  readonly showSpokes?: boolean;
  /**
   * Draw the tick labels along the outer edge of the arc.
   * @default true
   */
  readonly showLabels?: boolean;
  /**
   * Spoke colour.
   * @default "var(--chart-foreground)"
   */
  readonly stroke?: string;
  /**
   * Spoke opacity.
   * @default 0.2
   */
  readonly strokeOpacity?: number;
  /**
   * How far a spoke runs past the outermost ring, in pixels.
   * @default 4
   */
  readonly tickLength?: number;
  /**
   * Tick label colour.
   * @default "var(--chart-label)"
   */
  readonly labelColor?: string;
  /** Tick label font size in pixels. Defaults to a size that follows the chart's (9 to 12). */
  readonly fontSize?: number;
  /**
   * Gap between a spoke's end and its label, in pixels.
   * @default 4
   */
  readonly labelOffset?: number;
}

/** Props for `RingLabels`. */
export interface RingLabelsProps {
  /** Each ring's label text. Defaults to its data item's `label`. */
  readonly format?: (data: RingData, index: number) => string;
  /**
   * Colour each label like its ring instead of the muted label colour.
   * @default false
   */
  readonly colorByRing?: boolean;
  /**
   * Label colour while `colorByRing` is off.
   * @default "var(--chart-label)"
   */
  readonly color?: string;
  /** Font size in pixels. Defaults to a size that follows the ring width (9 to 12). */
  readonly fontSize?: number;
  /** Distance in pixels before each ring's start. Defaults to 0.6 times the font size. */
  readonly offset?: number;
}

/** Values passed to the `children` render function of `RingCenter`. */
interface RingCenterRenderProps {
  /** Value of the hovered ring. */
  readonly value: number;
  /** Label of the hovered ring. */
  readonly label: string;
  /** Always `true` when the function is called. */
  readonly isHovered: boolean;
  /** The `RingData` item of the hovered ring. */
  readonly data: RingData;
}

/** Props for `RingCenter`. */
export interface RingCenterProps<Node> {
  /**
   * Label shown under the total while no ring is hovered. A hovered ring shows its own label instead.
   * @default "Total"
   */
  readonly defaultLabel?: string;
  /**
   * Number format for the centre value, in `Intl.NumberFormat` terms (notation, currency, fraction digits and so on).
   * @default { maximumFractionDigits: 0, notation: "standard" }
   */
  readonly formatOptions?: CenterStatFormat;
  /**
   * Render function for custom centre content. It is called with `{ value, label, isHovered, data }` while a ring is hovered; when nothing is hovered the default total is shown.
   */
  readonly children?: (props: Readonly<RingCenterRenderProps>) => Node;
  /** Extra class name for the centre container. */
  readonly className?: string;
  /** Class name for the value text. */
  readonly valueClassName?: string;
  /** Class name for the label text. */
  readonly labelClassName?: string;
  /** Text shown before the value, for example `"$"`. */
  readonly prefix?: string;
  /** Text shown after the value, for example `"%"`. */
  readonly suffix?: string;
}

interface ScrubRingLayer {
  readonly bgPath: string;
  readonly progressPath: string;
  readonly color: string;
}

export interface RingStableValue<ContainerRef> {
  /** The `data` passed to the chart. */
  readonly data: RingData[];
  /** Chart width and height in pixels. */
  readonly size: number;
  /** Centre of the chart in pixels, on both axes (half of `size`). */
  readonly center: number;
  /** Thickness of each ring in pixels, after any scaling to fit. */
  strokeWidth: number;
  /** Gap between rings in pixels, after any scaling to fit. */
  readonly ringGap: number;
  /** Inner radius of the innermost ring in pixels, after any scaling to fit. */
  readonly baseInnerRadius: number;
  /** Kept for bklit-ui compatibility. Always `0`. */
  readonly animationKey: number;
  /** Kept for bklit-ui compatibility. Always `true`. */
  readonly isLoaded: boolean;
  /** Ref to the chart container element. */
  readonly containerRef: ContainerRef;
  /** The entrance transition passed to the chart, if any. */
  readonly enterTransition?: RingEnterTransition;
  /** The entrance stagger multiplier. */
  readonly enterStaggerScale: number;
  /** Sum of all ring values. */
  readonly totalValue: number;
  /** Returns the colour of the ring at the given index: its `color`, or the palette colour. */
  readonly getColor: (index: number) => string;
  /** Returns the inner and outer radius in pixels of the ring at the given index. */
  readonly getRingRadii: (index: number) => { innerRadius: number; outerRadius: number };
  /** Start angle in radians. */
  readonly startAngle: number;
  /** End angle of a full ring in radians. */
  readonly endAngle: number;
  /** Whether geometry scrubbing is on. */
  readonly geometryScrubbing: boolean;
  /** Kept for bklit-ui compatibility. Always `null` or `undefined`. */
  readonly scrubRingLayers?: readonly ScrubRingLayer[] | null;
}
