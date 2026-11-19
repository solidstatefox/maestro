"use client";
// React's chart surface: TanStack's React RendererChart (dist/react/RendererChart.js) on the core's surface (core/surface/surface.ts), at
// its phases: the adapter made on the first render, the markup prerendered while hydrating, `update` then `mount` in a layout effect,
// `destroy` on unmount. Its tooltip body is a leaf (core/surface/tooltip-target.ts): react-charts' RendererChart re-renders the whole
// chart on every target change; here only <TooltipBodyLeaf> subscribes, and portals the body into the target's element.
import { forwardRef, memo, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import type { ChartTooltipContent, ChartValue } from "@tanstack/charts";
import type { ChartTooltipBodyRenderContext, RendererChartProps as TooltipRendererChartProps } from "@tanstack/charts/react/tooltip";
import { defaultTooltipBody } from "../core/surface/default-body";
import { createChartSurface, SURFACE_CLASS, SURFACE_STYLE, surfaceBox, surfaceHostClass, surfaceIdPrefix, surfaceOptions } from "../core/surface/surface";
import type { ChartSurface, SurfaceProps } from "../core/surface/surface";
import { tooltipTargetStore } from "../core/surface/tooltip-target";
import type { TooltipEqual, TooltipTarget, TooltipTargetStore } from "../core/surface/tooltip-target";
import type { Readable } from "../core/store";
import { toCamel } from "../core/style";
import type { StyleObject } from "../core/style";
import { renderMarkup } from "./markup";

const subscribeToHydration = () => () => {};
const clientSnapshot = () => false;
const serverSnapshot = () => true;
// RendererChart.js:9: no layout effects on a server.
const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;
const SURFACE_CSS = /* @__PURE__ */ toCamel(SURFACE_STYLE);

// Memoised never to re-render: the renderer owns the markup once it mounts (RendererChart.js:10-23).
const ChartSurfaceElement = /* @__PURE__ */ memo(
  /* @__PURE__ */ forwardRef<HTMLDivElement, { readonly markup: string }>(function ChartSurfaceElement({ markup }, ref) {
    // oxlint-disable-next-line react/no-danger -- the renderer's own markup, as react-charts serves it
    return <div ref={ref} className={SURFACE_CLASS} style={SURFACE_CSS} dangerouslySetInnerHTML={{ __html: markup }} />;
  }),
  () => true,
);

type SurfaceHostProps<TDatum, TXValue extends ChartValue, TYValue extends ChartValue> = SurfaceProps<TDatum, TXValue, TYValue> & Pick<TooltipRendererChartProps<TDatum, TXValue, TYValue>, "className" | "style">;

const SurfaceHost = <TDatum, TXValue extends ChartValue, TYValue extends ChartValue>(props: Readonly<SurfaceHostProps<TDatum, TXValue, TYValue>>): ReactElement => {
  const { className, style } = props;
  const generatedId = useId();
  const options = surfaceOptions(props, surfaceIdPrefix(props.idPrefix, generatedId));
  const surfaceRef = useRef<ChartSurface<TDatum, TXValue, TYValue> | null>(null);
  surfaceRef.current ??= createChartSurface(options);
  const surface = surfaceRef.current;
  const needsInitialMarkup = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const initialMarkupRef = useRef<string | null>(null);
  initialMarkupRef.current ??= needsInitialMarkup ? surface.prerender() : "";
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Every render hands the chart its latest options, as RendererChart.js's effect on a fresh `hostOptions` does.
  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (container) {
      surface.render(container, options);
    }
  }, [surface, options]);
  useIsomorphicLayoutEffect(() => () => {
    surface.destroy();
  }, [surface]);
  const box = surfaceBox(props);
  return (
    <div className={surfaceHostClass(className)} style={{ position: "relative", width: box.width, height: box.height, aspectRatio: box.aspectRatio, ...style }}>
      <ChartSurfaceElement ref={containerRef} markup={initialMarkupRef.current} />
    </div>
  );
};

/** The default body handed to a reader's `renderTooltipBody` (core/surface/default-body.ts), rendered only where the reader places it. */
const DefaultTooltipBody = ({ content }: { readonly content: ChartTooltipContent | string }): ReactNode => renderMarkup(defaultTooltipBody(content));

const nothing = () => null;

const TooltipBodyLeaf = ({ store, render }: { readonly store: Readable<TooltipTarget | null>; readonly render: (context: ChartTooltipBodyRenderContext) => ReactNode }): ReactNode => {
  const target = useSyncExternalStore(store.subscribe, store.get, nothing);
  if (target === null) {
    return null;
  }
  return createPortal(render({ ...target.body, defaultBody: <DefaultTooltipBody content={target.body.content} /> }), target.element);
};

type RendererChartTooltipProps<TDatum, TXValue extends ChartValue, TYValue extends ChartValue> = TooltipRendererChartProps<TDatum, TXValue, TYValue> & {
  readonly tooltipEqual?: TooltipEqual;
};

/** Drop-in for `@tanstack/charts/react/tooltip` RendererChart (incl. `defaultBody`): hover never re-renders the chart. */
export const RendererChart = <TDatum, TXValue extends ChartValue = ChartValue, TYValue extends ChartValue = ChartValue>(
  props: RendererChartTooltipProps<TDatum, TXValue, TYValue>,
): ReactElement => {
  const { renderTooltipBody, tooltipEqual, ...rest } = props;
  const storeRef = useRef<TooltipTargetStore | null>(null);
  storeRef.current ??= tooltipTargetStore(tooltipEqual);
  const store = storeRef.current;
  // SAFETY: kit charts erase the datum generics, and the store only hands the reported target back to the leaf that portals it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const render = renderTooltipBody as ((context: ChartTooltipBodyRenderContext) => ReactNode) | undefined;
  return (
    <>
      {/* oxlint-disable-next-line react/jsx-props-no-spreading -- a drop-in wrapper forwards every chart prop untouched */}
      <SurfaceHost {...rest} onTooltipBodyChange={render === undefined ? undefined : store.onChange} />
      {render === undefined ? null : <TooltipBodyLeaf render={render} store={store} />}
    </>
  );
};

interface ControllerSurfaceProps {
  /** The surface element, for the controller's `attach` (or its `setSurface`). */
  readonly surfaceRef: Ref<HTMLDivElement>;
  /** The host box's class after `ts-chart-host` (RendererChart's `className`). */
  readonly className?: string;
  /** The host box (core/surface/surface.ts `surfaceBox`) as the controller's view gives it. */
  readonly style: StyleObject;
  /** The controller's server markup, read on the first render while hydrating. */
  readonly prerender: () => string;
  readonly tooltip: Readable<TooltipTarget | null>;
  readonly renderTooltipBody: (context: ChartTooltipBodyRenderContext) => ReactNode;
}

/** The surface of a chart whose controller hosts the renderer (core/chart/controller.ts): the elements `RendererChart` renders, the controller mounting
 * into them from `attach` (core/surface/surface.ts is the adapter it drives), and the tooltip leaf. */
export const ControllerSurface = ({ surfaceRef, className, style, prerender, tooltip, renderTooltipBody }: ControllerSurfaceProps): ReactElement => {
  const needsInitialMarkup = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const initialMarkupRef = useRef<string | null>(null);
  initialMarkupRef.current ??= needsInitialMarkup ? prerender() : "";
  return (
    <>
      <div className={surfaceHostClass(className)} style={toCamel(style)}>
        <ChartSurfaceElement ref={surfaceRef} markup={initialMarkupRef.current} />
      </div>
      <TooltipBodyLeaf render={renderTooltipBody} store={tooltip} />
    </>
  );
};
