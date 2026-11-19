import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import { resolveIndicatorWidth } from "../tooltip/tooltip-carriers";
import { indicatorFadeGradientStops, resolveVerticalFadeSides } from "../helpers";
import type { IndicatorFadeEdges, IndicatorWidth } from "../types/cartesian";
import type { LineConfig } from "../types/context";
import { toNumber } from "./domains";
import type { PillLayout } from "./date-pill";
import type { CartesianInput } from "./input";
import type { HoverOverlayModel, OverlayDot, OverlayShape } from "./hover-overlay";
import { lineConfigOf } from "./series";
import type { ResolvedSeries, Row } from "./series";

export interface TooltipProps extends TooltipBoxMotionProps {
  showDatePill?: boolean;
  showCrosshair?: boolean;
  showDots?: boolean;
  dotSize?: number;
  dotStrokeWidth?: number;
  dotScale?: number;
  indicatorColor?: string | ((point: Row) => string);
  indicatorDasharray?: string;
  dotColor?: string | ((point: Row, line: LineConfig) => string);
  indicatorWidth?: IndicatorWidth;
  /** ChartTooltip `pinnable`: a click, Enter or Space pins the tooltip (TanStack's sticky tooltip). */
  pinnable?: boolean;
  indicatorFadeEdges?: IndicatorFadeEdges;
  indicatorFadeLength?: number;
  indicatorEndColor?: string;
  indicatorEnd?: "plot" | "point";
  dotHaloScale?: number;
  dotHaloOpacity?: number;
  dotHaloBlur?: number;
  topOffset?: number;
  dateLabels?: readonly string[];
}

export interface HoverOverlayContext {
  readonly input: CartesianInput;
  readonly rows: readonly Row[];
  readonly keyOf: (d: Row) => number;
  readonly tooltipProps: TooltipProps;
  readonly pill: PillLayout | null;
  readonly pillActive: boolean;
  /** The bands' edge dots (range-overlays.ts `rangeDots`), after the series dots. */
  readonly rangeDots?: readonly OverlayDot[];
  /** A band takes the focus: the crosshair and pill show on a chart with no series. */
  readonly rangeFocus?: boolean;
  /** The date pill's text of a row (`dateLabels`, else the short date). */
  readonly pillText: (row: Row) => string;
}

/** bklit TooltipDot's halo (tooltip-dot.tsx): a disc in the dot's colour at `dotHaloScale` × its radius and `dotHaloOpacity`, `dotHaloBlur` px of blur; none at a scale of 1 or less or no opacity. */
const DEFAULT_HALO_SCALE = 2.6;
const DEFAULT_HALO_OPACITY = 0.3;

function seriesDotShapes(tooltipProps: TooltipProps, s: ResolvedSeries, radius: number): OverlayShape[] {
  const paint = dotFill(tooltipProps, s);
  const haloRadius = Math.max(0, radius * (tooltipProps.dotHaloScale ?? DEFAULT_HALO_SCALE));
  const haloOpacity = tooltipProps.dotHaloOpacity ?? DEFAULT_HALO_OPACITY;
  const halo: OverlayShape[] = haloRadius > radius && haloOpacity > 0 ? [{ r: haloRadius, ...paint, opacity: haloOpacity, blur: tooltipProps.dotHaloBlur ?? 0, stroke: "none", strokeWidth: 0 }] : [];
  // bklit's dot has no outline by default (`dotStrokeWidth` 0); a width draws one in the chart background.
  const outline = tooltipProps.dotStrokeWidth ?? 0;
  return [...halo, { r: radius, ...paint, stroke: outline > 0 ? "var(--chart-background)" : "none", strokeWidth: outline }];
}

/** The tooltip dot's fill: `dotColor` (a string, or bklit's function of the hovered row and the series config, re-read on every focused row), else the series colour.
 * Accepted divergence: a ProfitLossLine's dot takes the hovered value's sign colour; bklit's dot reads the hidden `Line` bklit pairs with it (docs profit-loss-line.md),
 * and here the ProfitLossLine's own stroke is the profit colour, which put a green dot on a loss. */
function dotFill(tooltipProps: TooltipProps, s: ResolvedSeries): Pick<OverlayShape, "fill" | "fillOf"> {
  const { dotColor } = tooltipProps;
  if (typeof dotColor === "string") {
    return { fill: dotColor };
  }
  if (typeof dotColor === "function") {
    const line = lineConfigOf(s);
    return { fill: s.stroke, fillOf: (row) => dotColor(row, line) };
  }
  const pl = s.profitLoss;
  if (pl) {
    return { fill: pl.positive, fillOf: (row) => (toNumber(row[s.dataKey]) >= 0 ? pl.positive : pl.negative) };
  }
  return { fill: s.stroke };
}

const valueOfSeries = (s: ResolvedSeries) => (row: Row): number | undefined => toNumber(row[s.dataKey]);

function activeMarkers(interactive: readonly ResolvedSeries[]): OverlayDot[] {
  const out: OverlayDot[] = [];
  // bklit renders the active marker only with `fadeOnHover` (series-markers.tsx:269-272).
  for (const s of interactive.filter((x) => x.showMarkers && x.marker.fadeOnHover)) {
    // bklit showActiveHighlight redraws the hovered marker 1.35x larger (series-markers.tsx:196, :270-292) in the main svg, under the portalled crosshair svg (tooltip/chart-tooltip.tsx:257-283) and dots svg (:286-311);
    // it jumps to the focused point, only the TooltipDot glides.
    const mk = s.marker;
    const k = mk.showActiveHighlight ? 1.35 : 1;
    const ringOuter = mk.strokeWidth > 0 ? mk.radius + mk.ringGap + mk.strokeWidth : mk.radius;
    const circles = [
      ...(mk.outlineWidth > 0 ? [{ r: (ringOuter + mk.outlineWidth / 2) * k, fill: "none", stroke: mk.outlineColor, strokeWidth: mk.outlineWidth * k }] : []),
      { r: mk.radius * k, fill: mk.fill, stroke: "none", strokeWidth: 0 },
      ...(mk.strokeWidth > 0 ? [{ r: (mk.radius + mk.ringGap + mk.strokeWidth / 2) * k, fill: "none", stroke: mk.stroke, strokeWidth: mk.strokeWidth * k }] : []),
    ];
    out.push({ shapes: circles, glide: false, valueOf: valueOfSeries(s), yAxis: s.yAxisId });
  }
  return out;
}

/** Hover indicator: active markers, crosshair rule, date pill, then one dot per series (only with a ChartTooltip). */
export function buildHoverOverlayModel(ctx: HoverOverlayContext): HoverOverlayModel {
  const { tooltipProps } = ctx;
  const showCrosshair = tooltipProps.showCrosshair !== false;
  const showDots = tooltipProps.showDots !== false;
  const interactive = ctx.input.series.filter((s) => s.kind !== "pattern" && (s.kind === "line" || s.showLine !== false || s.kind === "area"));
  const head = interactive[0] ?? (ctx.rangeFocus === true ? true : undefined);
  const labelIndex = new Map<number, number>();
  const labels: string[] = [];
  ctx.rows.forEach((row, i) => {
    labelIndex.set(ctx.keyOf(row), i);
    labels.push(ctx.pillText(row));
  });
  const dotRadius = (tooltipProps.dotSize ?? 5) * (tooltipProps.dotScale ?? 1);
  const fade = resolveVerticalFadeSides(tooltipProps.indicatorFadeEdges ?? "both");
  return {
    // bklit portals the crosshair as an <svg> over the chart (tooltip/chart-tooltip.tsx:257-283).
    crosshair: head && showCrosshair
      ? {
          color: typeof tooltipProps.indicatorColor === "string" ? tooltipProps.indicatorColor : "var(--chart-crosshair)",
          colorOf: typeof tooltipProps.indicatorColor === "function" ? tooltipProps.indicatorColor : undefined,
          endColor: tooltipProps.indicatorEndColor,
          dash: tooltipProps.indicatorDasharray,
          width: resolveIndicatorWidth(tooltipProps.indicatorWidth),
          stops: indicatorFadeGradientStops(fade, tooltipProps.indicatorFadeLength ?? 10),
          toPoint: tooltipProps.indicatorEnd === "point",
        }
      : null,
    dots: showDots
      ? [
          ...activeMarkers(interactive),
          // Resolved against the build's y domains before the overlay is built (definition.ts `extraDotsOf`).
          ...(typeof ctx.input.extraDots === "function" ? [] : (ctx.input.extraDots ?? [])),
          ...interactive.map((s): OverlayDot => ({
            shapes: seriesDotShapes(tooltipProps, s, dotRadius),
            glide: true,
            series: true,
            valueOf: valueOfSeries(s),
            yAxis: s.yAxisId,
          })),
          ...(ctx.rangeDots ?? []),
        ]
      : [],
    indexOf: (time) => labelIndex.get(time) ?? 0,
    pill: head && ctx.pillActive && tooltipProps.showDatePill !== false ? { labels, layout: ctx.pill } : null,
  };
}
