export type FadeEdges = boolean | "left" | "right" | { readonly left?: number; readonly right?: number };

/** A colour stop on a horizontal stroke gradient: `offset` 0-1 across the plot, left to right. */
export interface StrokeGradientStop {
  offset: number;
  color: string;
}

/** Horizontal stroke colours, left to right across the plot: plain colours are spaced evenly; `{ offset, color }` stops place them. */
export type StrokeGradient = readonly string[] | readonly StrokeGradientStop[];

/** One stop of a resolved horizontal paint: `offset` 0-1 of the plot width. */
export interface PlotPaintStop {
  readonly offset: number;
  readonly color: string;
  readonly opacity: number;
}

/** bklit DEFAULT_FADE_EDGES_LENGTH: the fade zone per faded side, % of the plot width. */
export const DEFAULT_FADE_EDGES_LENGTH = 15;

const clampFade = (length: number): number => Math.min(50, Math.max(0, Number.isFinite(length) ? length : 0));

/** The fade zone of each side as a fraction of the plot width (0: that side does not fade); null when neither side fades. */
export function resolveFadeZones(fade: FadeEdges | undefined): { readonly left: number; readonly right: number } | null {
  if (fade === undefined || fade === false) {
    return null;
  }
  const d = DEFAULT_FADE_EDGES_LENGTH;
  let left = d;
  let right = d;
  if (fade === "left") {
    right = 0;
  } else if (fade === "right") {
    left = 0;
  } else if (typeof fade === "object") {
    left = clampFade(fade.left ?? 0);
    right = clampFade(fade.right ?? 0);
  }
  return left > 0 || right > 0 ? { left: left / 100, right: right / 100 } : null;
}

/** bklit resolveStrokeGradientStops: offsets clamped and sorted; plain colours spaced evenly. Null for no (or an empty) gradient. */
export function resolveStrokeGradientStops(gradient: StrokeGradient | undefined): StrokeGradientStop[] | null {
  if (!gradient || gradient.length === 0) {
    return null;
  }
  const last = Math.max(1, gradient.length - 1);
  return gradient
    .map((stop, index) =>
      typeof stop === "string"
        ? { offset: gradient.length === 1 ? 0 : index / last, color: stop }
        : { offset: Math.min(1, Math.max(0, stop.offset)), color: stop.color },
    )
    .sort((a, b) => a.offset - b.offset);
}

const roundPercent = (value: number): number => Math.round(value * 10_000) / 100;

/** The colour at `t` on piecewise-linear stops (sRGB, as SVG interpolates a gradient). */
export function colorAt(stops: readonly StrokeGradientStop[], t: number): string {
  const first = stops[0];
  const last = stops.at(-1);
  if (first === undefined || last === undefined) {
    return "transparent";
  }
  if (t <= first.offset) {
    return first.color;
  }
  if (t >= last.offset) {
    return last.color;
  }
  for (let i = 1; i < stops.length; i += 1) {
    const b = stops[i];
    const a = stops[i - 1];
    if (b === undefined || a === undefined || t > b.offset) {
      continue;
    }
    if (t === b.offset || b.offset === a.offset) {
      return b.color;
    }
    return `color-mix(in srgb, ${b.color} ${roundPercent((t - a.offset) / (b.offset - a.offset))}%, ${a.color})`;
  }
  return last.color;
}

/** The fade's opacity at `t` of the plot (0 at a faded edge, 1 past its zone). */
const fadeOpacityAt = (zones: { readonly left: number; readonly right: number }, t: number): number => {
  if (zones.left > 0 && t < zones.left) {
    return Math.max(0, t / zones.left);
  }
  if (zones.right > 0 && t > 1 - zones.right) {
    return Math.max(0, (1 - t) / zones.right);
  }
  return 1;
};

/** A horizontal paint: its stops across the plot, and the colour / opacity at any fraction of it (for the ends of a mark's own bbox). */
export interface HorizontalPaint {
  readonly stops: readonly PlotPaintStop[];
  readonly at: (t: number) => PlotPaintStop;
}

/**
 * bklit horizontalPaintStops: the colour ramp and the edge fade merged (their offsets united, each stop the ramp's colour and the fade's
 * opacity there), so they compose; null when the series has neither (it paints a plain stroke).
 */
export function horizontalPaint(color: string, gradient: StrokeGradient | undefined, fade: FadeEdges | undefined): HorizontalPaint | null {
  const colorStops = resolveStrokeGradientStops(gradient);
  const zones = resolveFadeZones(fade);
  if (!(colorStops || zones)) {
    return null;
  }
  const at = (t: number): PlotPaintStop => ({ offset: t, color: colorStops ? colorAt(colorStops, t) : color, opacity: zones ? fadeOpacityAt(zones, t) : 1 });
  const offsets = new Set<number>([0, 1]);
  for (const stop of colorStops ?? []) {
    offsets.add(stop.offset);
  }
  if (zones) {
    offsets.add(zones.left);
    offsets.add(1 - zones.right);
  }
  return { stops: [...offsets].sort((a, b) => a - b).map(at), at };
}
