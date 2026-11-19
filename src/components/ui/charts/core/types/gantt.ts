import type { ChartMargin } from "../theme";
import type { PlotLoadingProps } from "./plot-loading";

/** A date as the chart reads it: a `Date`, an ISO string or epoch milliseconds. */
export type GanttDate = Date | string | number;

/** One task of a `GanttChart`. */
export interface GanttTask {
  /** A unique id: other tasks name it in `dependsOn`. */
  readonly id: string;
  /** The task's name: its label on the task axis and its tooltip's title. */
  readonly name: string;
  /** When it starts. */
  readonly start: GanttDate;
  /** When it ends. A milestone may leave it out (it sits on `start`). */
  readonly end?: GanttDate;
  /** The share done, 0 to 1: the bar fills that far in full colour. */
  readonly progress?: number;
  /** The phase the task belongs to: tasks sharing one are gathered under a phase row that spans them, in the order the phases first appear. */
  readonly group?: string;
  /** Ids of the tasks that must finish before this one starts (finish-to-start): an arrow runs from each to this one. */
  readonly dependsOn?: readonly string[];
  /** Draw a diamond on `start` instead of a bar (a review, a launch). */
  readonly milestone?: boolean;
  /** The bar's colour. Defaults to `GanttTasks`' `fill`. */
  readonly color?: string;
}

/** Props of `GanttChart`. */
export interface GanttChartProps<Node, Style> extends PlotLoadingProps {
  /** The tasks, top to bottom (grouped under their `group`'s phase row when they have one). */
  readonly data: readonly GanttTask[];
  /**
   * Height of one row in px: the chart is as tall as its rows.
   * @default 36
   */
  readonly rowHeight?: number;
  /** Width in px below which the schedule stops shrinking and scrolls sideways instead, so a long plan stays readable on a phone. */
  readonly minWidth?: number;
  /** Space around the plot in px. The task labels' gutter is `GanttYAxis`' `width`, added to `left`. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Animate the bars in on mount: each grows from its start, row by row, then the dependencies fade in.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Length of the entrance in milliseconds.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Accessible name of the chart.
   * @default "Gantt chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: `GanttTasks`, `GanttDependencies`, `GanttToday`, `GanttXAxis`, `GanttYAxis`, `Grid` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `GanttTasks`: the bars, phase rows and milestones. */
export interface GanttTasksProps {
  /**
   * Colour of the bars and milestones. A task's own `color` wins.
   * @default "var(--chart-1)"
   */
  readonly fill?: string;
  /**
   * Thickness of a task bar as a share of its row.
   * @default 0.56
   */
  readonly barSize?: number;
  /**
   * Corner radius of the bars in px.
   * @default 6
   */
  readonly radius?: number;
  /**
   * Fill each bar with its `progress` in full colour over a lighter track. Off, the whole bar is full colour.
   * @default true
   */
  readonly showProgress?: boolean;
  /**
   * Colour of the phase rows' summary bars.
   * @default "var(--chart-foreground-muted)"
   */
  readonly phaseFill?: string;
  /**
   * Opacity of the other rows while one is hovered.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
}

/** Props of `GanttDependencies`: one elbow arrow per `dependsOn` link. */
export interface GanttDependenciesProps {
  /**
   * Colour of the arrows. A hovered task's own arrows turn to the foreground colour; the others fade.
   * @default "var(--chart-foreground-muted)"
   */
  readonly stroke?: string;
  /**
   * Width of the arrows in px.
   * @default 1.25
   */
  readonly strokeWidth?: number;
}

/** Props of `GanttToday`: a dashed rule on a status date. */
export interface GanttTodayProps {
  /** The date the rule marks. */
  readonly date: GanttDate;
  /**
   * The label under the rule. Pass an empty string for none.
   * @default "Today"
   */
  readonly label?: string;
  /**
   * Colour of the rule and its label.
   * @default "var(--chart-date-pill-background)"
   */
  readonly stroke?: string;
}

/** Props of `GanttXAxis`: the time axis. */
export interface GanttXAxisProps {
  /**
   * Target number of date ticks.
   * @default 6
   */
  readonly numTicks?: number;
  /** Formats a tick date into its label. Defaults to a short month and day such as "Apr 6". */
  readonly formatValue?: (value: Date) => string;
  /**
   * Where the axis sits.
   * @default "top"
   */
  readonly position?: "top" | "bottom";
}

/** Props of `GanttYAxis`: the task labels in a gutter on the left. */
export interface GanttYAxisProps {
  /**
   * Width of the label gutter in px.
   * @default 168
   */
  readonly width?: number;
}

export type { GanttChartLoadingProps } from "./plot-loading";
