import type { AnySparklineProps, SparklinePadding } from "../types/sparkline";
import { resolveSparklinePadding } from "./geometry";

/** Which sparkline a controller draws. */
export type SparklineKind = "line" | "area" | "bar";

/** The default height of a sparkline, in px. */
export const SPARKLINE_HEIGHT = 32;

/** Everything a sparkline's look reads, resolved against its defaults. */
export interface SparklineLook {
  readonly color: string;
  readonly height: number;
  readonly padding: SparklinePadding;
  readonly yMin: number | undefined;
  readonly yMax: number | undefined;
  readonly strokeWidth: number;
  readonly curve: NonNullable<AnySparklineProps["curve"]>;
  readonly endDot: boolean;
  readonly fill: "gradient" | "solid";
  readonly fillOpacity: number;
  readonly barGap: number;
  readonly barRadius: number;
  readonly highlight: boolean;
  readonly inactiveOpacity: number;
  readonly crosshair: NonNullable<AnySparklineProps["crosshair"]>;
  readonly dot: boolean;
}

/** The props the look reads: none of them depend on the rows' type. */
export type SparklineLookProps = Omit<AnySparklineProps, "data" | "dataKey" | "onHoverChange">;

export const sparklineLook = (kind: SparklineKind, p: SparklineLookProps): SparklineLook => {
  const bars = kind === "bar";
  const highlight = !bars && p.showHighlight !== false;
  return {
    color: p.color ?? "var(--chart-line-primary)",
    height: p.height ?? SPARKLINE_HEIGHT,
    padding: resolveSparklinePadding(p.padding, bars ? 2 : 4),
    yMin: p.yDomain?.[0],
    yMax: p.yDomain?.[1],
    strokeWidth: p.strokeWidth ?? 1.5,
    curve: p.curve ?? "monotone",
    endDot: !bars && p.endDot === true,
    fill: p.fill ?? "gradient",
    fillOpacity: p.fillOpacity ?? (kind === "area" ? 0.3 : 0),
    barGap: p.barGap ?? 2,
    barRadius: p.barRadius ?? 1,
    highlight,
    // A line or area without its highlight keeps full strength while hovered (bklit: `showHighlight ? inactiveOpacity : 1`).
    inactiveOpacity: bars ? (p.inactiveOpacity ?? 0.4) : highlight ? (p.inactiveOpacity ?? 0.5) : 1,
    crosshair: p.crosshair ?? "dashed",
    dot: p.dot !== false,
  };
};

/** The look's parts that change what is drawn (not just where): a change rebuilds the svg's attributes and its overlays. */
export const sparklinePaintKey = (l: SparklineLook): string =>
  `${l.color}|${l.strokeWidth}|${l.curve}|${l.endDot}|${l.fill}|${l.fillOpacity}|${l.barGap}|${l.barRadius}|${l.highlight}|${l.inactiveOpacity}|${l.crosshair}|${l.dot}|${l.height}|${l.padding.top}|${l.padding.bottom}`;

/** The attributes of the line's stroke, the area's top stroke and the hover highlight (paint, `highlight`). */
export const sparklineStrokeAttrs = (l: SparklineLook): Readonly<Record<string, string | number>> => ({
  fill: "none",
  stroke: l.color,
  "stroke-width": l.strokeWidth,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
});

/** The line's dash, so the enter can draw it along its stroke (bklit's `pathLength={1}` and `strokeDasharray={1}`): line sparklines only. */
export const SPARKLINE_LINE_DASH: Readonly<Record<string, number>> = { pathLength: 1, "stroke-dasharray": 1 };

/** The end dot and the hover dot: the series colour in a ring of the surface. */
export const sparklineDotAttrs = (l: SparklineLook): Readonly<Record<string, string | number>> => ({
  r: 3,
  fill: l.color,
  stroke: "var(--chart-background)",
  "stroke-width": 1.5,
});
