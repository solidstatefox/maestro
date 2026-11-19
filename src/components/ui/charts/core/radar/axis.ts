export interface RadarAxisProps {
  /**
   * Colour of the axis lines.
   * @default "var(--bkm-border)"
   */
  readonly stroke?: string;
  /**
   * Opacity of the axis lines, from 0 to 1.
   * @default 0.6
   */
  readonly strokeOpacity?: number;
  /** Extra class name for the axis lines. */
  readonly className?: string;
}

// Role marker: a declarative config carrier, read once by RadarChart and never rendered.
/**
 * Draws one spoke from the centre to each metric. Include it as a child of `RadarChart`; it renders nothing by itself.
 */
export const RadarAxis = /* @__PURE__ */ Object.assign(function RadarAxis(_props: Readonly<RadarAxisProps>): null {
  return null;
}, { displayName: "RadarAxis" });
