import { createChartRendererAdapter } from "@tanstack/charts/adapter/renderer";
import type { ChartPoint, ChartRendererHostOptions, ChartTooltipBodyTarget, ChartValue } from "@tanstack/charts";
import { createChartA11yLayer, descriptionOf, KEYBOARD_HINT } from "../a11y/layer";
import type { ChartA11yInput } from "../a11y/layer";
import { withHostPointer } from "../interaction/host-pointer";
import { px } from "../style";
import { finalPositions } from "./final-positions";
import { attachSvgMaskMirror } from "./svg-css-mask";
import type { SvgMaskMirror } from "./svg-css-mask";
import { createSurfaceTextMeasure } from "./text-measure";
import type { StyleObject } from "../style";

/** The host element's class: RendererChart.js:113, the reader's `className` after it. */
export const surfaceHostClass = (className: string | undefined): string => (className ? `ts-chart-host ${className}` : "ts-chart-host");

/** The surface element (RendererChart.js:12-22): the renderer's svg goes in it. */
export const SURFACE_CLASS = "ts-chart-surface";
export const SURFACE_STYLE: StyleObject = { width: "100%", height: "100%" };

/** RendererChart.js:39-40: a finite positive aspect ratio, else none. */
const surfaceAspectRatio = (aspectRatio: number | undefined): number | undefined =>
  typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : undefined;

/** RendererChart.js:37: the chart's ids' prefix, the given one or the framework's generated id made id-safe. */
export const surfaceIdPrefix = (idPrefix: string | undefined, generatedId: string): string => idPrefix ?? `ts-chart-${generatedId.replaceAll(/[^a-zA-Z0-9_-]/g, "")}`;

/** The host's box (RendererChart.js:116-119), before the reader's style: each value as React writes the number (a px length, bare when 0). */
interface SurfaceBox {
  /** The given width, else the container's. */
  readonly width: string | number;
  /** The given height; none when the aspect ratio sizes the host; else 320px. */
  readonly height: string | number | undefined;
  /** The aspect ratio, when no height is given. */
  readonly aspectRatio: string | undefined;
}

export const surfaceBox = ({ width, height, aspectRatio }: { readonly width?: number; readonly height?: number; readonly aspectRatio?: number }): SurfaceBox => {
  const ratio = surfaceAspectRatio(aspectRatio);
  let boxHeight: string | number | undefined;
  if (height !== undefined) {
    boxHeight = px(height);
  } else if (ratio === undefined) {
    boxHeight = px(320);
  }
  return {
    width: width === undefined ? "100%" : px(width),
    height: boxHeight,
    aspectRatio: height === undefined && ratio !== undefined ? String(ratio) : undefined,
  };
};

/** The host element's style (dist/react/RendererChart.js:104-110): the box, then `style` spread over it (a key it repeats keeps its place). */
export const surfaceHostStyle = (box: SurfaceBox, style?: StyleObject): StyleObject => {
  const out: Record<string, string | number> = { position: "relative", width: box.width };
  if (box.height !== undefined) { out.height = box.height; }
  if (box.aspectRatio !== undefined) { out["aspect-ratio"] = box.aspectRatio; }
  return { ...out, ...style };
};

/** The chart a surface draws: the adapter's options, and the kit's screen-reader layer (core/a11y/layer.ts), which the renderer never reads. */
type SurfaceOptions<TDatum = unknown, TXValue extends ChartValue = ChartValue, TYValue extends ChartValue = ChartValue> = ChartRendererHostOptions<TDatum, TXValue, TYValue> & {
  readonly a11y?: ChartA11yInput;
};

/** A surface's props as a framework takes them (its own `className` and `style` aside). */
export type SurfaceProps<TDatum = unknown, TXValue extends ChartValue = ChartValue, TYValue extends ChartValue = ChartValue> = Omit<SurfaceOptions<TDatum, TXValue, TYValue>, "className">;

/** The svg's description when the reader gives none: the family's summary of its data, then how the keyboard walks it. */
const describedBy = (props: { readonly a11y?: ChartA11yInput; readonly tabIndex?: number; readonly definition: { readonly keyboard?: unknown; readonly focus?: unknown } }): string | undefined => {
  const summary = descriptionOf(props.a11y?.describe)?.summary;
  if (summary === undefined) {
    return undefined;
  }
  const walkable = props.tabIndex !== -1 && props.definition.keyboard !== false && props.definition.focus !== false;
  return walkable ? `${summary} ${KEYBOARD_HINT}` : summary;
};

/** RendererChart.js:42-62: the adapter's options for the props, the aspect ratio checked, the width to lay out at before the first measure 640px.
 * The renderer hit-tests the final positions while its marks move (final-positions.ts): hover during an entrance lands on the data. */
export const surfaceOptions = <TDatum, TXValue extends ChartValue = ChartValue, TYValue extends ChartValue = ChartValue>(
  props: SurfaceProps<TDatum, TXValue, TYValue>,
  idPrefix: string,
): SurfaceOptions<TDatum, TXValue, TYValue> => ({
  renderer: finalPositions(props.renderer),
  ariaLabel: props.ariaLabel,
  ariaDescription: props.ariaDescription ?? describedBy(props),
  a11y: props.a11y,
  height: props.height,
  aspectRatio: surfaceAspectRatio(props.aspectRatio),
  width: props.width,
  initialWidth: props.initialWidth ?? 640,
  tabIndex: props.tabIndex,
  idPrefix,
  measureText: props.measureText,
  onFocusChange: props.onFocusChange,
  onFocusGroupChange: props.onFocusGroupChange,
  onSelect: props.onSelect,
  onRender: props.onRender,
  onTooltipBodyChange: props.onTooltipBodyChange,
  // Every chart follows the raw pointer stream where the browser has one (interaction/host-pointer.ts).
  definition: withHostPointer(props.definition),
});

/** One chart's renderer adapter: the markup to serve, then the mounted chart it keeps up to date. */
export interface ChartSurface<TDatum = unknown, TXValue extends ChartValue = ChartValue, TYValue extends ChartValue = ChartValue> {
  /** The surface's markup for the server and hydration: the scene at its initial size (RendererChart.js:80). */
  prerender(): string;
  /** Hands the chart the latest options, mounting it into `container` the first time, and again after `destroy` (RendererChart.js:82-89). */
  render(container: HTMLElement, options: SurfaceOptions<TDatum, TXValue, TYValue>): void;
  /** Destroys the mounted chart; the next `render` mounts a fresh one (StrictMode runs the effects twice). */
  destroy(): void;
}

export function createChartSurface<TDatum, TXValue extends ChartValue = ChartValue, TYValue extends ChartValue = ChartValue>(
  initial: SurfaceOptions<TDatum, TXValue, TYValue>,
): ChartSurface<TDatum, TXValue, TYValue> {
  const adapter = createChartRendererAdapter(initial);
  let mounted = false;
  // The renderer's own measurer re-reads the host font on every update, forcing a style recalc (text-measure.ts): this one reads it after paints.
  const text = createSurfaceTextMeasure();
  let last: { container: HTMLElement; options: SurfaceOptions<TDatum, TXValue, TYValue> } | undefined;
  const a11y = createChartA11yLayer();
  // Stable, as the renderer keys its custom tooltip body on the callback's identity; each reads the latest options.
  const onFocusChange = (point: ChartPoint<TDatum, TXValue, TYValue> | null): void => {
    last?.options.onFocusChange?.(point);
    // SAFETY: the layer reads a point's datum only.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    a11y.focus(point as ChartPoint | null);
  };
  const onTooltipBodyChange = (target: ChartTooltipBodyTarget<TDatum, TXValue, TYValue> | null): void => {
    last?.options.onTooltipBodyChange?.(target);
    a11y.tooltip(target?.element ?? null, target?.pinned === true);
  };
  // The CSS masks on the chart's SVG content, mirrored into SVG masks in the engines that can't draw them (svg-css-mask.ts; never in Blink).
  let masks: SvgMaskMirror | undefined;
  const update = (container: HTMLElement, options: SurfaceOptions<TDatum, TXValue, TYValue>): void => {
    const measureText = options.measureText ?? text.current(container);
    adapter.update({ ...options, measureText, onFocusChange, onTooltipBodyChange: options.onTooltipBodyChange === undefined ? undefined : onTooltipBodyChange });
  };
  const fontChanged = (): void => {
    if (mounted && last) {
      update(last.container, last.options);
    }
  };
  return {
    prerender: () => adapter.prerender(),
    render(container, options) {
      last = { container, options };
      update(container, options);
      if (!mounted) {
        adapter.mount(container);
        mounted = true;
        masks = attachSvgMaskMirror(container);
      } else {
        masks?.refresh();
      }
      if (options.measureText === undefined) {
        text.rendered(container, fontChanged);
      }
      if (options.a11y !== undefined) {
        a11y.update(container, options.a11y, options.ariaLabel, options.idPrefix ?? "ts-chart");
      }
      // A surface without a name is a layer of another chart (a live line's y labels): decoration, hidden from assistive tech.
      if (options.ariaLabel === "" && container.getAttribute("aria-hidden") !== "true") {
        container.setAttribute("aria-hidden", "true");
      }
    },
    destroy() {
      masks?.detach();
      masks = undefined;
      adapter.destroy();
      text.destroy();
      a11y.destroy();
      mounted = false;
    },
  };
}
