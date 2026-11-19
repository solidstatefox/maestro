"use client";
// Bklit ChoroplethChart on native primitives: React's adapter over the choropleth controller (core/choropleth/controller.ts), which builds the
// geoShape definition from the carriers, hosts it with the native `motion()` entrance and owns the zoom, the wheel, the feature hover, the
// reveal and the contexts. The adapter calls it at the phases the chart ran that work in: `prepare` while rendering, `update` after every
// commit (layout), `attach` / `detach` at mount (layout), `committed` after every commit's paint and `mounted` after the mount's (passive).
// It renders the host, the pattern defs, the surface with the tooltip leaf, the overlay children and the two providers.
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createChoroplethController } from "./core/choropleth/controller";
import { PATTERN_DEFS_STYLE } from "./core/choropleth/view";
import { warnOnce } from "./core/carriers/registry";
import { toCamel } from "./core/style";
import { ControllerSurface } from "./runtime/surface";
import { extractChildren } from "./choropleth/carriers";
import { ChoroplethContext } from "./choropleth/context";
import { scopePatterns } from "./choropleth/projection";
import { useTooltipBody } from "./choropleth/tooltip";
import type { ChoroplethChartProps } from "./choropleth/types";
export type { ChoroplethFeature, ChoroplethFeatureProperties, ChoroplethGraticuleProps, ChoroplethTooltipData } from "./core/types/choropleth";
import { ChoroplethCameraContext, ChoroplethZoomContext } from "./choropleth/zoom";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useHydratingAttrs } from "./kit/use-hydrating";
import { useSanitizedId } from "./kit/use-sanitized-id";

const HIDDEN_DEFS_STYLE = /* @__PURE__ */ toCamel(PATTERN_DEFS_STYLE);
const tick = (version: number): number => version + 1;

/**
 * Map of regions filled by data, drawn from GeoJSON features with a Mercator projection. Configure it with `ChoroplethFeatureComponent` (or
 * `ChoroplethDotGrid`), `ChoroplethGraticule`, `ChoroplethMarker`, `ChoroplethBackground` and `ChoroplethTooltip` children; `clickToZoom` and
 * `perspective` give it a camera. It server-renders and replays its enter animation after hydration.
 */
const ChoroplethChart = /* @__PURE__ */ Object.assign(function ChoroplethChart(props: ChoroplethChartProps): ReactElement {
  const { className = "", children } = props;
  const uid = useSanitizedId();
  // The id RendererChart took for the svg's ids (RendererChart.js:37), taken here in the same order, so they keep their prefix.
  const surfaceId = useId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  const { table, overlayChildren } = useMemo(() => extractChildren(children), [children]);
  const input = { props, table };
  const [controller] = useState(() => createChoroplethController<ReactNode, CSSProperties>({ config, staticPreview, uid, warn: warnOnce }, input, { commits: "adapter", surfaceId }));
  // The reveal epoch moves in this render when its key changes, as the state it replaced was adjusted.
  controller.prepare(input);
  const view = controller.view.get();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  // Only a new view re-renders the chart; the size, a pan, a zoom or a camera move reach the contexts' readers through their stores. Subscribed
  // before `attach` draws, at the lane of the event that changed it (useSyncExternalStore would make every one sync).
  const [, rerender] = useReducer(tick, 0);
  useLayoutEffect(() => controller.view.subscribe(rerender), [controller]);
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, renderStart]);
  useEffect(() => { controller.committed(); });
  // bklit's mount effect arms the reveal (choropleth-chart.tsx:390-397).
  useEffect(() => { controller.mounted(); }, [controller]);
  const renderTooltipBody = useTooltipBody(view.tooltip);
  const { patterns } = view;

  // Entrance starts on the first draw, without bklit's ParentSize frames (choropleth-chart.tsx:482), at the user's direction (no frame waits); the curve is unchanged.
  return (
    <div
      ref={hostRef}
      className={className}
      // SAFETY: the core's style objects hold CSS properties and `--bkm-*` custom properties only.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      style={toCamel(view.hostStyle) as CSSProperties}
      {...view.hostAttrs}
      {...hydratingAttrs}
    >
      <ChoroplethContext.Provider value={controller.contextAtRest}>
        <ChoroplethZoomContext.Provider value={controller.zoom}>
          <ChoroplethCameraContext.Provider value={controller.camera}>
            {patterns ? <svg aria-hidden="true" style={HIDDEN_DEFS_STYLE}><defs>{scopePatterns(patterns.nodes, patterns.prefix)}</defs></svg> : undefined}
            <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={renderTooltipBody} />
            {overlayChildren}
          </ChoroplethCameraContext.Provider>
        </ChoroplethZoomContext.Provider>
      </ChoroplethContext.Provider>
    </div>
  );
}, { displayName: "ChoroplethChart" });

export { ChoroplethBackground, ChoroplethDotGrid, ChoroplethFeatureComponent, ChoroplethGraticule, ChoroplethMarker, ChoroplethTooltip } from "./choropleth/carriers";
export { ChoroplethProvider, useChoropleth } from "./choropleth/context";
export { useChoroplethCamera, useChoroplethZoom } from "./choropleth/zoom";
export { ChoroplethChart };
export type { ChoroplethChartProps, ChoroplethContextValue, ChoroplethFeatureProps, ChoroplethTooltipProps } from "./choropleth/types";
