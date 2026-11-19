import { memoCell } from "../memo";
import type { HoverSource } from "../polar/hover";
import { TAU } from "../polar/tau";
import type { RadarContextValue, RadarHoverContextValue, RadarStableContextValue } from "../types/radar";
import { DEFAULT_RADAR_COLORS } from "./area";
import { RADAR_VALUE_MAX } from "./rows";
import type { RadarData, RadarMetric } from "./rows";

export const RADAR_STABLE_MISSING = "useRadarStable must be used within a RadarProvider. Make sure your component is wrapped in <RadarChart>.";
export const RADAR_HOVER_MISSING = "useRadarHover must be used within a RadarProvider. Make sure your component is wrapped in <RadarChart>.";

/** @internal */
export const radarCssVars = {
  area1: "var(--chart-1)",
  area2: "var(--chart-2)",
  area3: "var(--chart-3)",
  area4: "var(--chart-4)",
  area5: "var(--chart-5)",
  background: "var(--chart-background)",
  border: "var(--bkm-border)",
  foreground: "var(--chart-foreground)",
  foregroundMuted: "var(--chart-foreground-muted)",
  grid: "var(--chart-grid)",
  label: "var(--chart-label, oklch(0.65 0.01 260))",
};

/** What RadarChart provides: the stable context and the hover setter. */
export type RadarProviderValue = RadarStableContextValue & Pick<RadarHoverContextValue, "setHoveredIndex">;

interface PointPosition {
  readonly x: number;
  readonly y: number;
}

interface RadarContextInput {
  readonly data: readonly RadarData[];
  readonly metrics: readonly RadarMetric[];
  readonly size: number | undefined;
  readonly levels: number;
  readonly margin: number;
  readonly animate: boolean;
  readonly enterDurationMs: number;
  readonly staggerScale: number;
  readonly motionReplayKey: string;
  /** hover.ts `setHoveredIndex`. */
  readonly setHoveredIndex: (index: number | null) => void;
}

/** RadarChart's context value: one builder per chart, fed on every input. */
export function createRadarContext(): (input: Readonly<RadarContextInput>) => RadarProviderValue {
  const cell = memoCell<RadarProviderValue>();
  return (input) => {
    const { animate, data, enterDurationMs, levels, margin, metrics, motionReplayKey, setHoveredIndex, size, staggerScale } = input;
    return cell([animate, data, enterDurationMs, levels, margin, metrics, motionReplayKey, setHoveredIndex, size, staggerScale], () => {
      const px = size ?? 0;
      const radius = Math.max(0, (px - margin * 2) / 2);
      const step = TAU / Math.max(1, metrics.length);
      const getAngle = (i: number): number => i * step - Math.PI / 2;
      const yScale = (v: number): number => (v / RADAR_VALUE_MAX) * radius;
      return {
        animate, data: [...data], enterDurationMs, getAngle,
        getColor: (i: number): string => data.at(i)?.color ?? DEFAULT_RADAR_COLORS.at(i % DEFAULT_RADAR_COLORS.length) ?? "var(--chart-1)",
        getPointPosition: (i: number, v: number): PointPosition => ({ x: yScale(v) * Math.cos(getAngle(i)), y: yScale(v) * Math.sin(getAngle(i)) }),
        levels, metrics: [...metrics], motionReplayKey, radius, setHoveredIndex, size: px, staggerScale, yScale,
      };
    });
  };
}

/** The hover handle RadarProvider hands its readers. */
export interface RadarHoverHandle {
  readonly source: HoverSource;
  readonly setHoveredIndex: RadarHoverContextValue["setHoveredIndex"];
}

/** RadarProvider's two values from RadarChart's: the stable half, rebuilt only when the geometry changes (data, metrics, size, radius, levels,
 * entrance), and the hover handle, which only holds the store, so a hover never re-renders the provider or anything it wraps. */
export function createRadarProviderValue(): (value: Readonly<RadarProviderValue>, source: HoverSource) => { readonly stable: RadarStableContextValue; readonly hover: RadarHoverHandle } {
  const stableCell = memoCell<RadarStableContextValue>();
  const hoverCell = memoCell<RadarHoverHandle>();
  return (value, source) => {
    const { setHoveredIndex, ...stable } = value;
    return {
      hover: hoverCell([setHoveredIndex, source], () => ({ setHoveredIndex, source })),
      stable: stableCell([value.data, value.metrics, value.size, value.radius, value.levels, value.animate, value.enterDurationMs, value.staggerScale, value.motionReplayKey], () => stable),
    };
  };
}

/** `useRadarHover()`'s value: the hovered series and the setter. */
export const radarHoverValue = (hoveredIndex: number | null, setHoveredIndex: RadarHoverContextValue["setHoveredIndex"]): RadarHoverContextValue => ({ hoveredIndex, setHoveredIndex });

/** `useRadar()`'s value: the stable half with the hover's. */
export const radarContextValue = (stable: RadarStableContextValue, hover: RadarHoverContextValue): RadarContextValue => ({ ...stable, ...hover });
