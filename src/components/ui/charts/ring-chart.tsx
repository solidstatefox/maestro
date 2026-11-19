"use client";
// Bklit RingChart: React's adapter over the ring controller (core/ring/controller.ts), which builds the rings' native definition (core/ring/
// definition.ts) and hosts it on the plain svg renderer, the fluid width, the entrance alignment, the hover and the context. The adapter calls
// it at the phases the shell ran that work in: `prepare` while rendering, `update` after every commit (layout), `attach` / `detach` at mount
// (layout), `committed` after every commit's paint (passive). It renders the host, the surface once the view shows it (on the client only:
// the server renders an empty, correctly sized shell), and the RingCenter overlay under the ring contexts; hover never re-renders it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ControllerSurface } from "./runtime/surface";
import { useSanitizedId } from "./kit/use-sanitized-id";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useIsClient } from "./kit/size/use-is-client";
import { createCarrierRegistry, warnOnce } from "./core/carriers/registry";
import type { ChildTable } from "./core/carriers/table";
import type { ChartClock } from "./core/chart/controller";
import { RING_CARRIER, RING_GRID_CARRIER, RING_LABELS_CARRIER, createRingController } from "./core/ring/controller";
import { CENTER_OVERLAY_STYLE } from "./core/polar/layout";
import { toCamel } from "./core/style";
import { RingHoverCoordinatorContext, RingStableContext, classifyRingChildren } from "./ring/model";
import type { RingChartProps as CoreRingChartProps } from "./core/types/ring";
export type { RingData, RingGridProps, RingLabelsProps, RingLineCap, RingProps } from "./core/types/ring";

const CENTER_OVERLAY: CSSProperties = /* @__PURE__ */ toCamel(CENTER_OVERLAY_STYLE);

/** Props for `RingChart`. */
interface RingChartProps extends CoreRingChartProps<ReactNode, CSSProperties> {}

// The ring shows the hovered ring in its centre, not a tooltip (the definition's `tooltip: false`).
const noTooltipBody = (): null => null;

/**
 * Concentric progress rings, one per data item, each filled to `value / maxValue` on a track. Add `Ring` children to configure single rings and a `RingCenter` to show the total.
 * Hovering or keyboard-focusing a ring emphasises it, dims the others and shows its label and value in the centre instead of a tooltip.
 * The rings are drawn on the client after mount; on the server the chart renders an empty, correctly sized shell. If the rings do not fit in `size`, they scale down to fit.
 */
const RingChart = /* @__PURE__ */ Object.assign(function RingChart(props: Readonly<RingChartProps>): ReactElement {
  const renderStart = useRenderStart();
  const { className, style, children } = props;
  const uid = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const isClient = useIsClient();
  const { centerChildren, rings, grids, labels } = useMemo(() => classifyRingChildren(children), [children]);
  // The Ring carriers read from the element tree, stabilised as useChildTable does for the cartesian charts (kit/stable-children.tsx): a parent
  // that owns the hover (ring-legend's `hoveredIndex`) re-renders the chart with new Ring elements but the same props, and a new table would
  // rebuild the definition, whose new progress layer remounts the surface's root and drops the keyboard focus on every arrow key. The
  // ports register their Rings into the same registry, so their table already holds while the props are equal.
  const [registry] = useState(createCarrierRegistry);
  const table = useMemo((): ChildTable => {
    registry.setStatic(new Map([[RING_CARRIER, rings], [RING_GRID_CARRIER, grids], [RING_LABELS_CARRIER, labels]]));
    return registry.table();
  }, [registry, rings, grids, labels]);
  const input = { props, table };
  const [controller] = useState(() => createRingController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input);
  // The view is copied into state from a layout-effect subscription, not read through useSyncExternalStore: a width measure commits on the
  // default lane, as ParentSize's own setState does (core/size/fluid-width.ts measures it), where a store read would commit synchronously.
  const [, setViewVersion] = useState(0);
  useLayoutEffect(() => controller.view.subscribe(() => { setViewVersion((version) => version + 1); }), [controller]);
  const view = controller.view.get();
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Motion's creation clock is the start of the render that mounts the surface, which a fluid chart reaches after mount.
  const [clock] = useState((): ChartClock => ({ get renderStart() { return renderStart.current; } }));
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did; a new surface element mounts in it.
  useLayoutEffect(() => { controller.update(input); });
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    controller.attach({ host }, clock);
    return () => { controller.detach(); };
  }, [controller, clock]);
  useEffect(() => { controller.committed(); });
  const hostStyle = useMemo((): CSSProperties => ({ ...toCamel(view.hostStyle), ...style }), [view.hostStyle, style]);
  return (
    <div className={className} {...view.hostAttrs} ref={hostRef} style={hostStyle}>
      {view.collapsed ? null : (
        <RingStableContext.Provider value={controller.stable.get()}>
          <RingHoverCoordinatorContext.Provider value={controller.hover}>
            {isClient && view.showSurface ? <ControllerSurface surfaceRef={controller.setSurface} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={noTooltipBody} /> : null}
            {centerChildren.length === 0 ? null : <div style={CENTER_OVERLAY}>{centerChildren}</div>}
          </RingHoverCoordinatorContext.Provider>
        </RingStableContext.Provider>
      )}
    </div>
  );
}, { displayName: "RingChart" });

export { Ring, RingGrid, RingLabels } from "./ring/model";
export { RingChart };
export type { RingChartProps };
export type { RingContextValue } from "./ring/model";
