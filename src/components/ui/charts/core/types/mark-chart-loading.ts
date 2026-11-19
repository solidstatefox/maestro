export interface MarkChartLoadingProps {
  /**
   * Width over height: a number or a string such as `"2 / 1"`. Defaults to the chart's own.
   */
  readonly aspectRatio?: string | number;
  /** A fixed height in px instead of an aspect ratio. */
  readonly height?: number;
  /** Text shown centered over the skeleton, with a shimmer. Nothing is shown when it is unset or empty. */
  readonly label?: string;
  /**
   * Extra CSS class name for the placeholder's root element.
   * @default ""
   */
  readonly className?: string;
}
