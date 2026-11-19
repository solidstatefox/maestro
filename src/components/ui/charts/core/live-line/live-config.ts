import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { GridGuideProps } from "../cartesian/grid-guides";
import type { ChartMargin } from "../theme";
import type { LiveLineConfig, LiveXAxisConfig, LiveYAxisConfig } from "../types/live-line";
import type { LiveTooltipConfig } from "./live-built";
import { defaultFormatTime, defaultFormatValue } from "./live-format";
import type { Frame } from "./live-frame";

/** bklit's live chart margin (each side a prop's `margin` leaves out). */
export const LIVE_DEFAULT_MARGIN: ChartMargin = { top: 24, right: 16, bottom: 32, left: 16 };
/** bklit's `lerpSpeed` default. */
export const LIVE_LERP_SPEED = 0.08;

/** The carriers' props and what the chart resolves from them. `Tooltip` is the framework's `ChartTooltip` props. */
export interface LiveCarriers<Tooltip extends LiveTooltipConfig> {
  readonly line: LiveLineConfig | undefined;
  readonly xAxis: LiveXAxisConfig | undefined;
  readonly yAxis: LiveYAxisConfig | undefined;
  readonly tooltipCfg: Tooltip | undefined;
  readonly grid: GridGuideProps | undefined;
  /** The value field: the `LiveLine`'s `dataKey`, else the chart's. */
  readonly key: string;
  readonly formatValue: (value: number) => string;
  readonly formatTime: (time: number) => string;
  readonly tooltipEnabled: boolean;
  readonly rightAxis: boolean;
  /** The y labels' minimum gap (px). */
  readonly minGap: number;
}

/** The first carrier of each role in `table`, and the chart's resolved keys, formats and axis side. */
export function liveCarriers<Tooltip extends LiveTooltipConfig>(table: ChildTable, dataKey: string): LiveCarriers<Tooltip> {
  const line = propsFor<LiveLineConfig>(table, "liveLine").at(0);
  const xAxis = propsFor<LiveXAxisConfig>(table, "liveXAxis").at(0);
  const yAxis = propsFor<LiveYAxisConfig>(table, "liveYAxis").at(0);
  const tooltipCfg = propsFor<Tooltip>(table, "tooltip").at(0);
  const grid = propsFor<GridGuideProps>(table, "grid").at(0);
  return {
    line,
    xAxis,
    yAxis,
    tooltipCfg,
    grid,
    key: line?.dataKey ?? dataKey,
    formatValue: line?.formatValue ?? defaultFormatValue,
    formatTime: xAxis?.formatTime ?? defaultFormatTime,
    tooltipEnabled: tooltipCfg !== undefined,
    rightAxis: yAxis?.position === "right",
    minGap: yAxis?.minGap ?? 36,
  };
}

/** The line's stroke (by momentum when `momentumColors` is set) and the live dot's color for `frame`. */
export function liveInk(frame: Frame | null, line: LiveLineConfig | undefined): { readonly momentumStroke: string; readonly dotColor: string } {
  const stroke = line?.stroke ?? "var(--chart-line-primary)";
  const momentumStroke = frame && line?.momentumColors ? line.momentumColors[frame.momentum] : stroke;
  const dotPalette = line?.momentumColors ?? { up: "var(--chart-1)", down: "var(--chart-5)", flat: stroke };
  const dotColor = frame ? dotPalette[frame.momentum] : stroke;
  return { momentumStroke, dotColor };
}

/** The roll's host attributes (liveline.css): rolling past the seed frame, the tick's parity (restarts its animations), and a jump tick's. */
export function liveHostAttributes(frame: Frame | null): { readonly "data-bkm-rolling": string | undefined; readonly "data-bkm-jump": string | undefined; readonly "data-bkm-roll": string | undefined } {
  return {
    "data-bkm-rolling": frame?.seed === true ? undefined : "",
    "data-bkm-jump": frame?.jump === true && !frame.seed ? String(frame.parity) : undefined,
    "data-bkm-roll": frame && !frame.seed ? String(frame.parity) : undefined,
  };
}
