import type { SunburstSegmentProps } from "../types/sunburst";
import type { ArcDatum } from "./arcs";

/** @internal */
export const sunburstCssVars = {
  background: "var(--chart-background)",
  foreground: "var(--chart-foreground)",
  foregroundMuted: "var(--chart-foreground-muted)",
  label: "var(--chart-label)",
  ring: "var(--chart-background)",
  slice1: "var(--chart-1)",
  slice2: "var(--chart-2)",
  slice3: "var(--chart-3)",
  slice4: "var(--chart-4)",
  slice5: "var(--chart-5)",
};

/** Default category colors: the `--chart-1` to `--chart-5` variables. */
export const defaultSunburstColors = /* @__PURE__ */ (() => [
  sunburstCssVars.slice1,
  sunburstCssVars.slice2,
  sunburstCssVars.slice3,
  sunburstCssVars.slice4,
  sunburstCssVars.slice5,
])();

const OPACITY_STEP = 0.15;
const OPACITY_FLOOR = 0.45;

/**
 * Relative depth within the current focus view (1 = innermost visible ring).
 * @internal
 */
export const opacityForRelativeDepth = (relativeDepth: number): number => {
  if (relativeDepth <= 1) {
    return 1;
  }
  return Math.max(OPACITY_FLOOR, 1 - (relativeDepth - 1) * OPACITY_STEP);
};

const PERCENT = 100;

/**
 * Fill alpha rides color-mix because the native sunburst mark takes one numeric fillOpacity per mark.
 * Divergence from bklit (a translucent fill): the fade mixes toward the chart surface, opaque, instead of toward transparent. A wide-gamut
 * token (an oklch `--chart-N`) mixed with transparent lands outside sRGB, and Chrome paints that translucent colour off-hue (chartreuse for
 * a blue) once the hover dim's `opacity` stacks on it. Over the card the opaque mix reads the same as bklit's translucent fill.
 */
export const withAlpha = (color: string, alpha: number): string => {
  if (alpha >= 1 || color.startsWith("url(")) {
    return color;
  }
  return `color-mix(in oklab, ${color} ${Math.round(alpha * PERCENT)}%, ${sunburstCssVars.background})`;
};

const arcColor = (arc: ArcDatum): string => arc.fill ?? arc.color ?? defaultSunburstColors.at(arc.categoryIndex % defaultSunburstColors.length) ?? sunburstCssVars.slice1;

const isUrl = (paint: string): boolean => paint.startsWith("url(");

/** A sector's paint before its depth fade, and that fade: its `SunburstSegment` override (by arc index), else the node's own fill or colour or its branch's. */
const segmentPaint = (arc: ArcDatum, segments: ReadonlyMap<number, SunburstSegmentProps>, focusDepth: number): { readonly base: string; readonly alpha: number } => {
  const override = segments.get(arc.arcIndex);
  return { alpha: override?.fillOpacity ?? opacityForRelativeDepth(arc.depth - focusDepth), base: override?.fill ?? override?.color ?? arcColor(arc) };
};

/**
 * A sector's fill, faded by its depth below the focus. A pattern or gradient paint (`url(#id)`) is handed to `scopePaint` (the chart's
 * resource ids are scoped to it) and keeps its own colours: its fade is the sector's `fill-opacity` (`segmentFillOpacityOf`), as bklit's.
 */
export const segmentFillOf =
  (arcById: ReadonlyMap<string, ArcDatum>, segments: ReadonlyMap<number, SunburstSegmentProps>, focusDepth: number, scopePaint: (paint: string) => string = (paint) => paint) =>
  (nodeId: string): string => {
    const arc = arcById.get(nodeId);
    if (arc === undefined) {
      return sunburstCssVars.slice1;
    }
    const { base, alpha } = segmentPaint(arc, segments, focusDepth);
    return isUrl(base) ? scopePaint(base) : withAlpha(base, alpha);
  };

/** The `fill-opacity` of a sector painted with a pattern or gradient (its depth fade); undefined for a colour, whose fade is in its fill. */
export const segmentFillOpacityOf =
  (arcById: ReadonlyMap<string, ArcDatum>, segments: ReadonlyMap<number, SunburstSegmentProps>, focusDepth: number) =>
  (nodeId: string): number | undefined => {
    const arc = arcById.get(nodeId);
    if (arc === undefined) {
      return undefined;
    }
    const { base, alpha } = segmentPaint(arc, segments, focusDepth);
    return isUrl(base) && alpha < 1 ? alpha : undefined;
  };
