import type { ChartTextMeasureOptions, ChartTextMeasurer, ChartTextMetrics } from "@tanstack/charts";

interface FontStyle {
  readonly family: string;
  readonly style: string;
  readonly stretch: string;
  readonly weight: string;
  readonly direction: ChartTextMeasureOptions["direction"];
  readonly letterSpacing: number;
}

const STRETCHES = new Set(["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded"]);

/** dom-text.js `normalizeFontStretch`. */
function fontStretch(value: string | undefined): string {
  if (value !== undefined && STRETCHES.has(value)) {
    return value;
  }
  const percentage = Number.parseFloat(value ?? "");
  if (!Number.isFinite(percentage)) {
    return "normal";
  }
  const steps: readonly (readonly [number, string])[] = [
    [50, "ultra-condensed"],
    [62.5, "extra-condensed"],
    [75, "condensed"],
    [87.5, "semi-condensed"],
  ];
  for (const [limit, name] of steps) {
    if (percentage <= limit) {
      return name;
    }
  }
  if (percentage < 112.5) {
    return "normal";
  }
  if (percentage < 125) {
    return "semi-expanded";
  }
  if (percentage < 150) {
    return "expanded";
  }
  return percentage < 200 ? "extra-expanded" : "ultra-expanded";
}

const finitePixels = (value: string | undefined): number => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};
const positive = (value: number | undefined, fallback: number): number => (value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback);

/** dom-text.js `readFontStyle`. */
function readFontStyle(container: HTMLElement): FontStyle {
  const computed = container.ownerDocument.defaultView?.getComputedStyle(container);
  let direction: FontStyle["direction"] = "inherit";
  if (computed?.direction === "rtl" || computed?.direction === "ltr") {
    direction = computed.direction;
  }
  return {
    family: computed?.fontFamily || "sans-serif",
    style: computed?.fontStyle || "normal",
    stretch: fontStretch(computed?.fontStretch),
    weight: computed?.fontWeight || "400",
    direction,
    letterSpacing: finitePixels(computed?.letterSpacing),
  };
}

const signatureOf = (style: FontStyle): string => [style.family, style.style, style.stretch, style.weight, style.direction, style.letterSpacing].join("\0");

/** dom-text.js `logicalTextAnchorOffset` (guide-layout.js). */
const anchorOffset = (width: number, anchor: ChartTextMeasureOptions["anchor"], direction: ChartTextMeasureOptions["direction"]): number => {
  if (anchor === "middle") {
    return -width / 2;
  }
  return (anchor === "start") === (direction !== "rtl") ? 0 : -width;
};

/** dom-text.js `paintedBounds`. */
function paintedBounds(measured: TextMetrics, options: ChartTextMeasureOptions): ChartTextMetrics {
  const fontSize = options.fontSize * positive(options.fontScale, 1);
  const left = measured.actualBoundingBoxLeft;
  const right = measured.actualBoundingBoxRight;
  const ascent = measured.actualBoundingBoxAscent;
  const descent = measured.actualBoundingBoxDescent;
  if ([left, right, ascent, descent].every((value) => Number.isFinite(value)) && (left + right > 0 || measured.width === 0) && (ascent + descent > 0 || measured.width === 0)) {
    return { x: -left, y: -ascent, width: left + right, height: ascent + descent };
  }
  const width = Number.isFinite(measured.width) ? Math.max(0, measured.width) : 0;
  let y = -fontSize * 0.8;
  if (options.baseline === "middle") {
    y = -fontSize / 2;
  } else if (options.baseline === "hanging") {
    y = 0;
  }
  return { x: anchorOffset(width, options.anchor, options.direction), y, width, height: fontSize };
}

/** dom-text.js `configureContext`. */
function configure(context: CanvasRenderingContext2D, defaultWeight: string, options: ChartTextMeasureOptions): void {
  const fontScale = positive(options.fontScale, 1);
  context.font = [options.fontStyle, options.fontWeight ?? defaultWeight, `${options.fontSize * fontScale}px`, options.fontFamily].join(" ");
  if ("fontStretch" in context) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- the canvas takes the CSS keyword dom-text.js hands it
    context.fontStretch = fontStretch(options.fontStretch) as CanvasFontStretch;
  }
  context.textAlign = options.anchor === "middle" ? "center" : options.anchor;
  context.textBaseline = options.baseline === "auto" ? "alphabetic" : options.baseline;
  context.direction = options.direction;
  if ("letterSpacing" in context) {
    context.letterSpacing = `${options.letterSpacing * fontScale}px`;
  }
}

/** How often (ms) the font is checked again after a paint, at most: a live chart renders every tick. */
const CHECK_EVERY_MS = 1000;

export interface SurfaceTextMeasure {
  /** The measurer for the next `update` (a new one after the font changed), or undefined where there is no canvas (the renderer's own then). */
  current(container: HTMLElement): ChartTextMeasurer | undefined;
  /** After a render: checks the font after the next paint (throttled), calling `changed` when it moved. */
  rendered(container: HTMLElement, changed: () => void): void;
  /** Stops listening (the surface's destroy). */
  destroy(): void;
}

/** One surface's measurer (see the head of this file). */
export function createSurfaceTextMeasure(): SurfaceTextMeasure {
  let context: CanvasRenderingContext2D | null | undefined;
  let style: FontStyle | undefined;
  let signature = "";
  let measurer: ChartTextMeasurer | undefined;
  let lastCheck = Number.NEGATIVE_INFINITY;
  let pending: number | undefined;
  let stopFonts: (() => void) | undefined;

  const build = (): ChartTextMeasurer => {
    const cache = new Map<string, ChartTextMetrics>();
    const font = style;
    const sign = signature;
    return (text, given) => {
      // The renderer hands the host typography it read at mount (scene.js `withChartTextTypography`); this one is current.
      const options: ChartTextMeasureOptions = font
        ? { ...given, fontFamily: font.family, fontStyle: font.style, fontStretch: font.stretch, letterSpacing: font.letterSpacing, direction: font.direction }
        : given;
      const key = `${sign}\0${options.fontSize}\0${options.fontWeight ?? ""}\0${options.fontFamily}\0${options.fontStyle}\0${options.fontStretch}\0${options.letterSpacing}\0${options.direction}\0${options.locale ?? ""}\0${options.fontScale}\0${options.anchor}\0${options.baseline}\0${text}`;
      const cached = cache.get(key);
      if (cached) {
        return cached;
      }
      // `context` is set before a measurer is built (current()).
      const ctx = context as CanvasRenderingContext2D;
      configure(ctx, font?.weight ?? "400", options);
      const metrics = paintedBounds(ctx.measureText(text), options);
      cache.set(key, metrics);
      return metrics;
    };
  };

  /** Re-reads the font; true when it changed (a new measurer is built). */
  const refresh = (container: HTMLElement): boolean => {
    const next = readFontStyle(container);
    const nextSignature = signatureOf(next);
    if (nextSignature === signature) {
      return false;
    }
    style = next;
    signature = nextSignature;
    measurer = build();
    return true;
  };

  return {
    current(container) {
      if (context === undefined) {
        context = typeof document === "undefined" || typeof CanvasRenderingContext2D === "undefined" ? null : container.ownerDocument.createElement("canvas").getContext("2d");
      }
      if (context === null) {
        return undefined;
      }
      if (measurer === undefined) {
        refresh(container);
      }
      return measurer;
    },
    rendered(container, changed) {
      if (context === null || context === undefined || pending !== undefined) {
        return;
      }
      if (stopFonts === undefined) {
        // A web font that finishes loading changes the widths without changing the computed font: start over (dom-text.js `invalidate`).
        const fonts = container.ownerDocument.fonts as FontFaceSet | undefined;
        const onLoad = (): void => {
          signature = "";
          if (refresh(container)) {
            changed();
          }
        };
        fonts?.addEventListener?.("loadingdone", onLoad);
        stopFonts = (): void => fonts?.removeEventListener?.("loadingdone", onLoad);
      }
      const now = typeof performance === "undefined" ? 0 : performance.now();
      if (now - lastCheck < CHECK_EVERY_MS) {
        return;
      }
      lastCheck = now;
      // After the paint the style is clean, so the read costs nothing (a rAF, then a task: the frame has been painted).
      pending = requestAnimationFrame(() => {
        setTimeout(() => {
          pending = undefined;
          if (container.isConnected && refresh(container)) {
            changed();
          }
        }, 0);
      });
    },
    destroy() {
      if (pending !== undefined) {
        cancelAnimationFrame(pending);
        pending = undefined;
      }
      stopFonts?.();
      stopFonts = undefined;
    },
  };
}
