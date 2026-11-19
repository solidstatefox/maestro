import { intFmt } from "../format";
import type { RadialAngleValue, RadialCenterState, RadialLegendProps } from "../types/radial";
import { radialNumberAt, radialSeriesColor } from "./series";
import type { RadialShell } from "./shell";
import { seriesTextColor } from "../theme";

/** Everything `useRadialChart()` returns: the shared geometry and scales, the hover and the legend hover, the crosshair and the enter flag. */
export interface RadialChartContextValue extends RadialShell {
  readonly hoveredIndex: number | null;
  readonly setHoveredIndex: (index: number | null) => void;
  /** The animated crosshair angle (radians): the scrubber's spring, else the chart's with the same config. It may run past one turn (it
   * takes the short way round), so treat it as periodic. */
  readonly crosshairAngle: RadialAngleValue;
  /** Hands the chart a crosshair of its own (a custom scrubber's angle): the dots locked to the crosshair follow it. Returns the cleanup. */
  readonly registerCrosshair: (angle: RadialAngleValue) => () => void;
  /** The legend-hovered series (the layers dim the others). */
  readonly hoveredSeries: number | null;
  readonly setHoveredSeries: (index: number | null) => void;
  /** False until the chart's first draw: enter transitions run from it. */
  readonly revealed: boolean;
}

export const RADIAL_MISSING = "useRadialChart must be used within a <RadialChart> component.";

/** RadialCenter's state for the hovered bin (or at rest). */
export const radialCenterState = (shell: Pick<RadialShell, "data" | "series" | "xDataKey" | "futureBins" | "totals">, hoveredIndex: number | null): RadialCenterState => {
  const datum = hoveredIndex === null ? null : (shell.data[hoveredIndex] ?? null);
  const values: Record<string, number> = {};
  for (const s of shell.series) {
    values[s.dataKey] = radialNumberAt(datum, s.dataKey) ?? 0;
  }
  const rawLabel = datum?.[shell.xDataKey];
  return {
    // SAFETY: a datum is a plain record of the chart's data (readonly to the chart, handed back as the reader's own).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    datum: datum as Record<string, unknown> | null,
    index: hoveredIndex,
    isFuture: hoveredIndex === null ? false : Boolean(shell.futureBins[hoveredIndex]),
    label: rawLabel === undefined || datum === null ? null : String(rawLabel),
    totals: shell.totals,
    values,
  };
};

/** The default centre's value: the hovered bin's sum, else the sum of the totals. */
export const radialCenterValue = (state: RadialCenterState): number => Object.values(state.datum ? state.values : state.totals).reduce((sum, v) => sum + v, 0);

/** One RadialLegend item. */
export interface RadialLegendItem {
  readonly label: string;
  readonly value: number;
  readonly color: string;
  /** The formatted total (empty when values are hidden). */
  readonly text: string;
  /** Tint the total with the series colour. */
  readonly emphasize: boolean;
  /** The total's colour when emphasised: the series' colour toward the foreground, readable on the card (core/theme.ts `seriesTextColor`). */
  readonly textColor: string;
}

/** RadialLegend's items: one per series, its total formatted. */
export const radialLegendItems = (shell: Pick<RadialShell, "series" | "totals">, props: Readonly<RadialLegendProps>): RadialLegendItem[] => {
  const format = props.formatValue ?? intFmt;
  const show = props.showValues ?? true;
  return shell.series.map((s, i) => {
    const value = shell.totals[s.dataKey] ?? 0;
    return { label: s.label ?? s.dataKey, value, color: radialSeriesColor(s, i), textColor: seriesTextColor(radialSeriesColor(s, i)), text: show ? format(value) : "", emphasize: s.emphasize === true };
  });
};

/** The legend row's classes (bklit-ui's: a centred, wrapping row below the chart). */
export const RADIAL_LEGEND_CLASS = "legend-container bk-legend bkm-rd-legend";
