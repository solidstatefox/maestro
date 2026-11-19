export interface RadarLabelsProps {
  /**
   * Distance in pixels between the outer grid ring and the labels.
   * @default 24
   */
  readonly offset?: number;
  /**
   * Font size of the labels in pixels.
   * @default 11
   */
  readonly fontSize?: number;
  /**
   * Dim the labels at rest and brighten them while a series is hovered.
   * @default false
   */
  readonly interactive?: boolean;
  /** Extra class name for the labels. */
  readonly className?: string;
}

// Role marker: a declarative config carrier, read once by RadarChart and never rendered.
/**
 * Prints each metric's `label` around the outside of the chart. Include it as a child of `RadarChart`; it renders nothing by itself.
 */
export const RadarLabels = /* @__PURE__ */ Object.assign(function RadarLabels(_props: Readonly<RadarLabelsProps>): null {
  return null;
}, { displayName: "RadarLabels" });
