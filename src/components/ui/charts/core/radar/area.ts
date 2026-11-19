import { CHART_PALETTE } from "../palette";

/** Props for `RadarArea`. */
export interface RadarAreaProps {
  /**
   * Index of the series this element draws, matching its position in the `data` array of the chart. Entries with an index outside the array are ignored.
   */
  readonly index: number;
  /**
   * Colour of the series. Takes precedence over the data item's `color`, which in turn takes precedence over the `--chart-1` to `--chart-5` palette (by index).
   */
  readonly color?: string;
  /**
   * Draw a dot at each metric value.
   * @default true
   */
  readonly showPoints?: boolean;
  /**
   * Draw an outline around the polygon.
   * @default true
   */
  readonly showStroke?: boolean;
  /**
   * Draw a glow behind the polygon while the series is hovered: a 12 px drop shadow in the series colour.
   * @default false
   */
  readonly showGlow?: boolean;
  /** Extra class name for the polygon. */
  readonly className?: string;
}

// Role marker: a declarative config carrier, read once by RadarChart and never rendered.
/**
 * Draws one series of the chart as a filled polygon. Render one `RadarArea` per item of `data`, with `index` pointing at that item. It renders nothing by itself outside a `RadarChart`.
 */
export const RadarArea = /* @__PURE__ */ Object.assign(function RadarArea(_props: Readonly<RadarAreaProps>): null {
  return null;
}, { displayName: "RadarArea" });

/**
 * Default series colours, applied by index and repeated: `--chart-1` to `--chart-5`. Exported as `defaultRadarColors`.
 */
export const DEFAULT_RADAR_COLORS: string[] = /* @__PURE__ */ ((): string[] => [...CHART_PALETTE])();

export const radarAreaColor = (a: RadarAreaProps, data: readonly { readonly color?: string }[]): string =>
  a.color ?? data.at(a.index)?.color ?? DEFAULT_RADAR_COLORS.at(a.index % DEFAULT_RADAR_COLORS.length) ?? "var(--chart-1)";
