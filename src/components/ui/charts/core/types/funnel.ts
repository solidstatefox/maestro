import type { FunnelGradientStopInput, FunnelStageInput } from "../funnel/marks";
import type { Transition } from "../motion/phase";
import type { ChartDataTableProps } from "../a11y/data-table";

/** One colour stop of a stage `gradient`: an `offset` and a `color`. */
export type FunnelGradientStop = FunnelGradientStopInput;

/** One stage of a `FunnelChart`: `label`, `value`, and optional `displayValue`, `color` and `gradient`. */
export type FunnelStage = FunnelStageInput & {
  /** Colour stops for a linear gradient on this stage. Takes precedence over `color` for the innermost ring; the outer halo rings use the first stop as a solid colour. */
  readonly gradient?: FunnelGradientStop[];
};

/** Stack direction of grouped funnel labels. */
type FunnelLabelOrientation = "vertical" | "horizontal";

/** Where grouped funnel labels sit in their segment. */
type FunnelLabelAlign = "center" | "start" | "end";

/** Props for `FunnelChart`. */
export interface FunnelChartProps<Node, Style> {
  /** The stages, in order from widest to narrowest. The chart renders nothing when this is empty. */
  readonly data: FunnelStage[];
  /**
   * `"horizontal"` lays the stages out left to right; `"vertical"` top to bottom.
   * @default "horizontal"
   */
  readonly orientation?: "horizontal" | "vertical";
  /**
   * Default colour of the stages. A stage's own `color` or `gradient` overrides it.
   * @default "var(--chart-1)"
   */
  readonly color?: string;
  /**
   * Number of concentric halo rings drawn for each stage.
   * @default 3
   */
  readonly layers?: number;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /**
   * Show each stage's share of the first stage as a badge.
   * @default true
   */
  readonly showPercentage?: boolean;
  /**
   * Show each stage's value.
   * @default true
   */
  readonly showValues?: boolean;
  /**
   * Show each stage's name.
   * @default true
   */
  readonly showLabels?: boolean;
  /**
   * Index of the hovered stage, for controlled hover. Pass `null` for no hover; leave it `undefined` to let the chart manage hover itself.
   */
  readonly hoveredIndex?: number | null;
  /** Called with the index of the hovered or keyboard-focused stage, or `null` when hover ends. */
  readonly onHoverChange?: (index: number | null) => void;
  /** Formats a percentage (0 to 100) for the badge. Defaults to a rounded whole number with a `%` sign. */
  readonly formatPercentage?: (pct: number) => string;
  /** Formats a stage value for display. Defaults to a whole number with locale grouping. */
  readonly formatValue?: (value: number) => string;
  /**
   * Delay between one stage's entrance and the next, in seconds.
   * @default 0.12
   */
  readonly staggerDelay?: number;
  /**
   * Transition for the stage entrance, in the shape used by the `motion` library: a tween (`duration` in seconds, default 1.1, and `ease`, a four-number cubic-bezier or one of motion's named eases such as `"easeOut"`) or `type: "spring"` (`stiffness`, `damping`, `mass`, or `duration` and `bounce`).
   */
  readonly enterTransition?: Transition;
  /**
   * Gap between stages in pixels.
   * @default 4
   */
  readonly gap?: number;
  /**
   * Returns a pattern definition (for example an SVG `<pattern>`) for each stage, called with a unique `id` and the stage colour. The pattern paints the innermost ring; the outer halo rings stay solid.
   */
  readonly renderPattern?: (id: string, color: string) => Node;
  /**
   * `"curved"` joins stages with smooth curves; `"straight"` uses straight edges.
   * @default "curved"
   */
  readonly edges?: "curved" | "straight";
  /**
   * `"spread"` places the value, percentage and name apart within the segment; `"grouped"` stacks them together.
   * @default "spread"
   */
  readonly labelLayout?: "spread" | "grouped";
  /**
   * Stack direction of grouped labels. Only used with `labelLayout="grouped"`. Defaults to `"vertical"` for horizontal funnels and `"horizontal"` for vertical ones.
   */
  readonly labelOrientation?: FunnelLabelOrientation;
  /**
   * Where grouped labels sit in their segment: `"center"`, `"start"` (top or left) or `"end"` (bottom or right). Only used with `labelLayout="grouped"`.
   * @default "center"
   */
  readonly labelAlign?: FunnelLabelAlign;
  /**
   * Background bands and grid lines. `true` enables both with default styling; an object adjusts them. Off by default.
   * @default false
   */
  readonly grid?:
    | boolean
    | {
        /**
         * Show alternating background bands behind the stages.
         * @default true
         */
        readonly bands?: boolean;
        /**
         * Colour of the background bands.
         * @default "var(--bkm-muted)"
         */
        readonly bandColor?: string;
        /**
         * Show grid lines at each gap between stages.
         * @default true
         */
        readonly lines?: boolean;
        /**
         * Colour of the grid lines.
         * @default "var(--chart-grid)"
         */
        readonly lineColor?: string;
        /**
         * Opacity of the grid lines, from 0 to 1.
         * @default 1
         */
        readonly lineOpacity?: number;
        /**
         * Width of the grid lines in pixels.
         * @default 1
         */
        readonly lineWidth?: number;
      };
  /**
   * Accessible name of the chart.
   * @default "Funnel chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. Default: a summary of its stages. */
  readonly ariaDescription?: string;
  /** The chart's data as an HTML table (a `<ChartDataTable>`'s props: the funnel takes no children): `{}` for a visually hidden table,
   * `{ toggle: true }` for a "View as table" button. */
  readonly dataTable?: ChartDataTableProps;
}
