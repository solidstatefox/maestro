import type { IndicatorFadeEdges, IndicatorWidth } from "./cartesian";

/**
 * Props of `TooltipDot`. They are merged into the chart's `ChartTooltip` dot options; an explicit `ChartTooltip` prop wins.
 */
export interface TooltipDotProps {
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly x?: number;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly y?: number;
  /**
   * Show the dots. Same as `showDots` on `ChartTooltip`.
   * @default true
   */
  readonly visible?: boolean;
  /** Fill color of the dots. Defaults to each series' color. */
  readonly color?: string;
  /**
   * Dot radius in px. Same as `dotSize`.
   * @default 5
   */
  readonly size?: number;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly strokeColor?: string;
  /**
   * Stroke width of the dots in px. Same as `dotStrokeWidth`.
   * @default 2
   */
  readonly strokeWidth?: number;
  /**
   * `"dot"` or `"ring"`. Same as `dotVariant`; read by `BarChart` only.
   * @default "dot"
   */
  readonly variant?: "dot" | "ring";
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly cornerRadiusFraction?: number;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly springConfig?: { readonly stiffness: number; readonly damping: number };
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly animate?: boolean;
}

/**
 * Props of `TooltipIndicator`. They are merged into the chart's `ChartTooltip` crosshair options; an explicit `ChartTooltip` prop wins.
 */
export interface TooltipIndicatorProps {
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly x?: number;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly height?: number;
  /**
   * Show the crosshair. Same as `showCrosshair` on `ChartTooltip`.
   * @default true
   */
  readonly visible?: boolean;
  /**
   * Thickness of the crosshair: a width in px, or `"line"` (1px), `"thin"` (2px), `"medium"` (4px) or `"thick"` (8px).
   * @default "line"
   */
  readonly width?: IndicatorWidth;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly span?: number;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly columnWidth?: number;
  /**
   * Color of the crosshair. Same as `indicatorColor`.
   * @default "var(--chart-crosshair)"
   */
  readonly colorEdge?: string;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly colorMid?: string;
  /** Accepted so bklit-ui code compiles. Has no effect. The crosshair is solid. */
  readonly fadeEdges?: IndicatorFadeEdges | boolean;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly fadeLength?: number;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly animate?: boolean;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly gradientId?: string;
  /** Accepted so bklit-ui code compiles. Has no effect. */
  readonly springConfig?: { readonly stiffness: number; readonly damping: number };
  /** Dash pattern of the crosshair. Omit for a solid line. Same as `indicatorDasharray`. */
  readonly strokeDasharray?: string;
}

/** One row of a tooltip: a colored dot, a label and a value. */
export interface TooltipRow {
  /** Color of the dot before the label. */
  readonly color: string;
  /** Row label, usually the series name. */
  readonly label: string;
  /** Row value. Numbers are formatted in the en-US number format; strings are shown as given. */
  readonly value: string | number;
}

/** Props of `TooltipContent`. */
export interface TooltipContentProps<Node> {
  /** Heading above the rows, for example the formatted date. */
  readonly title?: string;
  /** The rows to show, one per series. */
  readonly rows: readonly TooltipRow[];
  /** Extra content rendered below the rows, for example marker details. */
  readonly children?: Node;
  /** Class names added to the content wrapper. */
  readonly className?: string;
}

/**
 * Props of `TooltipBox`. Only `visible`, `className`, `children`, `panelStyle` and `backgroundColor` change anything; the rest exist so bklit-ui code compiles.
 */
export interface TooltipBoxProps<Node, Style> {
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly x?: number;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly y?: number;
  /**
   * Render the box. Nothing is rendered when false.
   * @default true
   */
  readonly visible?: boolean;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly containerRef?: unknown;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly containerWidth?: number;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly containerHeight?: number;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly offset?: number;
  /** Class names added to the box. */
  readonly className?: string;
  /** Content of the box. */
  readonly children?: Node;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly left?: unknown;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly top?: unknown;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly flipped?: boolean;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly springConfig?: { readonly stiffness: number; readonly damping: number };
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly animate?: boolean;
  /** Accepted so bklit-ui code compiles. Has no effect; the chart places the tooltip itself. */
  readonly entrance?: boolean;
  /** Inline styles merged into the box, after the defaults. */
  readonly panelStyle?: Style;
  /** Background color of the box (a color or a CSS variable). */
  readonly backgroundColor?: string;
}

/** Props of `DateTicker`. */
export interface DateTickerProps {
  /** Index of the label to show. */
  readonly currentIndex: number;
  /** The date labels, usually the hovered chart's formatted x values. The first is used when the index is out of range. */
  readonly labels: readonly string[];
  /** Show the pill. Nothing is rendered when false or when `labels` is empty. */
  readonly visible: boolean;
}

/** One marker shown by `MarkerTooltipContent`. */
export interface MarkerTooltipItem<Node> {
  /** Marker title. */
  readonly title: string;
  /** Marker description shown under the title. */
  readonly description?: string;
  /** Icon shown in the marker disc. */
  readonly icon?: Node;
  /** Background color of the marker disc. */
  readonly color?: string;
  /** Custom content that replaces the title and description. */
  readonly content?: Node;
  /** Called when the marker is clicked. */
  readonly onClick?: () => void;
  /** URL to open when the marker is clicked. */
  readonly href?: string;
}

/** Props of `MarkerTooltipContent`. */
export interface MarkerTooltipContentProps<Item> {
  /** The markers at the hovered date. */
  readonly markers: readonly Item[];
}
