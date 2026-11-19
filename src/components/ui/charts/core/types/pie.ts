import type { PieHoverEffect } from "../pie/arc";
import type { EnterTransition } from "../motion/phase";
import type { CenterStatFormat } from "./polar";

/**
 * How a hovered slice reacts: `"translate"` moves it outward, `"grow"` extends its outer radius, `"none"` leaves it in place.
 */
export type PieSliceHoverEffect = PieHoverEffect;

export type PieEnterTransition = EnterTransition;

/** One slice of a `PieChart`. */
export interface PieData {
  /** Display name of the slice. Shown as the label in `PieCenter` while the slice is hovered. */
  readonly label: string;
  /** Size of the slice. Its angle is this value's share of the sum of all values. */
  readonly value: number;
  /**
   * Slice colour, any CSS colour or `var(--...)` reference. Defaults to the `--chart-1` to `--chart-5` palette, in order.
   */
  readonly color?: string;
  /**
   * Paint for the slice, for example `url(#patternId)` for a pattern or gradient defined as a child of the chart. Takes precedence over `color`.
   */
  readonly fill?: string;
}

/** Computed geometry of one slice, as available through `usePie`. */
export interface PieArcData {
  /** The `PieData` item this arc was computed from. */
  readonly data: PieData;
  /** Position of the arc, matching the index in the `data` array. */
  readonly index: number;
  /** Start angle in radians. */
  readonly startAngle: number;
  /** End angle in radians. */
  readonly endAngle: number;
  /** Padding angle in radians applied to this arc. */
  readonly padAngle: number;
  /** The slice value. */
  readonly value: number;
}

/** Props for `PieSlice`. */
export interface PieSliceProps {
  /** Index of the slice this element configures, matching its position in the `data` array. */
  readonly index: number;
  /**
   * Colour of this slice's hover glow (`showGlow`). Defaults to the data item's `color`, then the palette. To paint the slice itself, set `color` on the `PieData` item, or use `fill`.
   */
  readonly color?: string;
  /**
   * Paint override for this slice, for example `url(#patternId)` for a pattern or gradient defined as a child of the chart. Takes precedence over the data item's `color` and `fill`.
   */
  readonly fill?: string;
  /**
   * Play the entrance animation for this slice. Set `false` to draw it without animating.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Glow while the slice is hovered or keyboard-focused: a 12 px drop shadow in the slice's `color`.
   * @default false
   */
  readonly showGlow?: boolean;
  /**
   * How the slice reacts when hovered: `"translate"` moves it outward, `"grow"` extends its outer radius, `"none"` leaves it in place.
   * @default "translate"
   */
  readonly hoverEffect?: PieSliceHoverEffect;
  /**
   * Distance in pixels for the hover effect. Defaults to the chart's `hoverOffset`.
   * @default the chart's `hoverOffset`
   */
  readonly hoverOffset?: number;
  /** Accepted for bklit-ui compatibility; has no effect. */
  readonly className?: string;
}

/** Props for `PieChart`. */
export interface PieChartProps<Node, Style> {
  /**
   * The slices to draw, in order. Each item's `value` sets its share of the total, and its `label` is shown in the centre while the slice is hovered.
   */
  readonly data: PieData[];
  /** Chart width and height in pixels. Omit to fill the width of the parent element; the chart stays square. */
  readonly size?: number;
  /**
   * Inner radius in pixels. `0` draws a solid pie; a positive value draws a donut and leaves room for `PieCenter`.
   * @default 0
   */
  readonly innerRadius?: number;
  /**
   * Gap between neighbouring slices, in radians.
   * @default 0
   */
  readonly padAngle?: number;
  /**
   * Corner radius of each slice, in pixels.
   * @default 0
   */
  readonly cornerRadius?: number;
  /**
   * Angle where the first slice starts, in radians, clockwise from 12 o'clock (d3's convention): the default `-Math.PI / 2` is 9 o'clock.
   * bklit-ui's own comment calls the default "top", but its d3 arcs start at 9 o'clock too.
   * @default -Math.PI / 2
   */
  readonly startAngle?: number;
  /**
   * Angle where the last slice ends, in radians. Together with `startAngle` this sets the sweep; the default is a full circle.
   * @default (3 * Math.PI) / 2
   */
  readonly endAngle?: number;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container, merged over the default sizing. */
  readonly style?: Style;
  /**
   * Index of the hovered slice, for controlled hover. Pass `null` for no hover; leave it `undefined` to let the chart manage hover itself.
   */
  readonly hoveredIndex?: number | null;
  /** Called with the index of the hovered or keyboard-focused slice, or `null` when hover ends. */
  readonly onHoverChange?: (index: number | null) => void;
  /**
   * Distance in pixels a hovered slice moves out (or grows by). The pie also reserves this much padding around its edge so a hovered slice is never clipped. A `PieSlice` can override it for its own slice.
   * @default 10
   */
  readonly hoverOffset?: number;
  /**
   * `PieSlice` elements to configure individual slices, an optional `PieCenter`, and any pattern or gradient definitions that slices reference through `fill`.
   */
  readonly children: Node;
  /**
   * Transition for the slice entrance sweep, in the shape used by the `motion` library (`type`, `duration` in seconds, `ease`, and spring values). Defaults to a 1.1 second tween on the shared reveal curve.
   */
  readonly enterTransition?: PieEnterTransition;
  /**
   * Multiplier for the delay between one slice's entrance and the next. `0` starts all slices together.
   * @default 1
   */
  readonly enterStaggerScale?: number;
  /**
   * Turns off hover effects, `PieSlice` overrides and the hover readout in `PieCenter`. Meant for live editors that redraw the geometry while a control is dragged; leave it off otherwise.
   * @default false
   */
  readonly geometryScrubbing?: boolean;
  /**
   * Accessible name of the chart.
   * @default "Pie chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
}

/** Values passed to the `children` render function of `PieCenter`. */
interface PieCenterRenderProps {
  /** Value of the hovered slice, or the total at rest. */
  readonly value: number;
  /** Label of the hovered slice, or `defaultLabel` at rest. */
  readonly label: string;
  /** `true` while a slice is hovered or keyboard-focused, `false` at rest. */
  readonly isHovered: boolean;
  /** The `PieData` item of the hovered slice; at rest `{ label: defaultLabel, value: total }`, with no `color` or `fill`. */
  readonly data: PieData;
}

/** Props for `PieCenter`. */
export interface PieCenterProps<Node> {
  /**
   * Label shown under the total while no slice is hovered. A hovered slice shows its own label instead.
   * @default "Total"
   */
  readonly defaultLabel?: string;
  /**
   * Number format for the centre value, in `Intl.NumberFormat` terms (notation, currency, fraction digits and so on).
   * @default { maximumFractionDigits: 0, notation: "standard" }
   */
  readonly formatOptions?: CenterStatFormat;
  /**
   * Render function for custom centre content, called with `{ value, label, isHovered, data }` both at rest (the total, `defaultLabel` and `isHovered: false`) and while a slice is hovered (that slice). Branch on `isHovered` to style the two states.
   */
  readonly children?: (props: Readonly<PieCenterRenderProps>) => Node;
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

/** Props for `PieCenterShell`. It accepts the `PieCenterProps<Node>` except `children`. */
export type PieCenterShellProps<Node> = Omit<PieCenterProps<Node>, "children"> & {
  /** The value to show, in place of the total of a pie. */
  readonly centerValue: number;
  /** Square reference size in pixels, matching the `size` of the pie the centre is modelled on. */
  readonly contextSize: number;
  /** Inner radius in pixels. Must be greater than 0 for the value to render. */
  readonly innerRadiusPx: number;
  /**
   * Roll the number in from 0 on mount. Later changes to `centerValue` always animate.
   * @default true
   */
  readonly animateEntrance?: boolean;
};

export interface PieStableValue<ContainerRef> {
  /** The `data` passed to the chart. */
  readonly data: PieData[];
  /** Computed arc for each slice, in data order. */
  readonly arcs: PieArcData[];
  /** Chart width and height in pixels. */
  readonly size: number;
  /** Centre of the chart in pixels, on both axes (half of `size`). */
  readonly center: number;
  /** Outer radius in pixels, after reserving room for the hover offset. */
  readonly outerRadius: number;
  /** Inner radius in pixels; `0` for a solid pie. */
  readonly innerRadius: number;
  /** Gap between slices in radians. */
  readonly padAngle: number;
  /** Slice corner radius in pixels. */
  readonly cornerRadius: number;
  /** Distance in pixels a hovered slice moves out. */
  readonly hoverOffset: number;
  /** Kept for bklit-ui compatibility. Always `0`. */
  readonly animationKey: number;
  /** The entrance transition passed to the chart, if any. */
  readonly enterTransition?: PieEnterTransition;
  /** The entrance stagger multiplier. */
  readonly enterStaggerScale: number;
  /** Ref to the chart container element. */
  readonly containerRef: ContainerRef;
  /** Sum of all slice values. */
  readonly totalValue: number;
  /** Returns the colour of the slice at the given index: its `color`, or the palette colour. */
  readonly getColor: (index: number) => string;
  /** Returns the paint of the slice at the given index: its `fill`, or its colour. */
  readonly getFill: (index: number) => string;
  /** Whether geometry scrubbing is on. */
  readonly geometryScrubbing: boolean;
  /** Kept for bklit-ui compatibility. Always `null`. */
  readonly scrubSlicePaths: readonly string[] | null;
  /** `true` once the chart is mounted and measured in the browser. */
  readonly isLoaded: boolean;
}
