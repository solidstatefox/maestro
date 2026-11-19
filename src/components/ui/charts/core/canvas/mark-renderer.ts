import { createCanvasChartRenderer } from "@tanstack/charts/canvas";
import { erase } from "../erase";
import type { ChartCanvasRenderer } from "./renderer";

type CanvasRenderer = ReturnType<typeof createCanvasChartRenderer>;
type CanvasSurface = ReturnType<CanvasRenderer["mount"]>;

/** The kit's own custom properties: interaction and layout state, never a colour. */
const KIT_VAR = "--bkm-";
/** Theme tokens read whatever the browser lists in a computed style (some list no custom property). */
const TOKENS = [
  "--background", "--foreground", "--card", "--muted", "--muted-foreground", "--border", "--primary",
  "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5",
  "--chart-scale-01", "--chart-scale-02", "--chart-scale-03", "--chart-scale-04", "--chart-scale-05",
  "--chart-positive", "--chart-negative", "--chart-background", "--chart-foreground",
] as const;

/** What a canvas repaint depends on, as one string: the pixel ratio, the colour and scheme, and the custom properties but the kit's. */
function paintSignature(el: Element): string {
  const view = el.ownerDocument.defaultView;
  if (!view) {
    return "";
  }
  const style = view.getComputedStyle(el);
  const parts = [String(view.devicePixelRatio), style.color, style.getPropertyValue("color-scheme")];
  for (const name of TOKENS) {
    parts.push(style.getPropertyValue(name));
  }
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (name.startsWith("--") && !name.startsWith(KIT_VAR)) {
      parts.push(`${name}:${style.getPropertyValue(name)}`);
    }
  }
  return parts.join("|");
}

const tanstackCanvas = /* @__PURE__ */ createCanvasChartRenderer();

/** A canvas paints a gradient between its stops' colours with their alpha applied (a 0-opacity stop is transparent black), so a fade to
 * nothing turns grey on the way; SVG fades the colour and its opacity apart. On a canvas a 0 stop keeps its colour at an alpha of 0.002. */
const CANVAS_CLEAR = 0.002;

/** TanStack's canvas renderer with the kit's mount (see the head of this file). One instance: adjacent canvas marks share its layer. */
const kitCanvas: CanvasRenderer & Pick<ChartCanvasRenderer, "paintStops"> = /* @__PURE__ */ (() => ({
  ...tanstackCanvas,
  paintStops: <T extends { readonly opacity: number }>(stops: readonly T[]): T[] => stops.map((stop) => (stop.opacity > 0 ? stop : { ...stop, opacity: CANVAS_CLEAR })),
  mount(container: HTMLElement, requestRender: (force?: boolean) => void): CanvasSurface {
    let painted = "";
    const guarded = (force?: boolean): void => {
      if (force !== true) {
        requestRender(force);
        return;
      }
      const next = paintSignature(container);
      if (next !== painted) {
        painted = next;
        requestRender(true);
      }
    };
    const inner = tanstackCanvas.mount(container, guarded);
    painted = paintSignature(container);
    // The surface as mounted, with a focus paint that paints nothing (its own fields and methods are read through the prototype).
    const surface: CanvasSurface = Object.create(inner);
    Object.defineProperty(surface, "paintFocus", { value: (): undefined => undefined });
    return surface;
  },
}))();

/**
 * The canvas renderer of the dense marks: pass it as `renderer` on `Line`, `Area`, `Scatter` or `HeatmapCells` to paint that mark on one
 * canvas, for tens of thousands of points (the grid, axes, hover highlight, markers, crosshair and tooltip stay SVG).
 *
 * ```tsx
 * <Line dataKey="p50" renderer={canvasRenderer} />
 * ```
 */
// The brand only marks the kit's own instance for the prop's type (renderer.ts); at run time it is TanStack's renderer.
export const canvasRenderer: ChartCanvasRenderer = /* @__PURE__ */ erase(kitCanvas);
