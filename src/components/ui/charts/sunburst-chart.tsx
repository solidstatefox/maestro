"use client";

// Bklit SunburstChart on TanStack Charts: React's adapter over the sunburst controller (core/sunburst/controller.ts), which builds the native
// `sunburst` mark inside `polar` and hosts it with the native `motion()` entrance and drill, native focus and the `onSelect` zoom. The adapter
// calls it at the phases the shell ran that work in: `prepare` while rendering, `update` after every commit (layout), `attach` / `detach` at mount
// (layout) once the tree draws, `committed` after every commit's paint (passive). It renders the host, the breadcrumbs, the stage and its surface,
// the hints and the two contexts; hover never re-renders it. Compound children are config carriers (sunburst/carriers.ts); custom pieces are
// documented in core/sunburst/sunburst-mark.ts.
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { warnOnce } from "./core/carriers/registry";
import { createSunburstController } from "./core/sunburst/controller";
import { toCamel } from "./core/style";
import { surfaceIdPrefix } from "./core/surface/surface";
import type { SunburstChartProps as CoreSunburstChartProps } from "./core/types/sunburst";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useHydratingAttrs } from "./kit/use-hydrating";
import { ResourceHost, scopeResourceIds } from "./kit/resource-host";
import { ControllerSurface } from "./runtime/surface";
import { parseChildren } from "./sunburst/carriers";
import { SunburstHoverProvider, SunburstStableProvider } from "./sunburst/context";

/** Props of `SunburstChart`. */
export interface SunburstChartProps extends CoreSunburstChartProps<ReactNode> {}

const bump = (n: number): number => n + 1;
// bklit's sunburst has no tooltip: the surface reports no body (the hint names the hovered path).
const noTooltipBody = (): null => null;

/**
 * A hierarchical sunburst chart: concentric rings of segments sized by value, with an enter sweep, drill-down zoom on click or Enter, hover growth, a center hub to zoom out, and keyboard navigation.
 * Compose it with `SunburstSegment`, `SunburstCenter`, `SunburstLabels`, `SunburstBreadcrumb` and `SunburstHint` children.
 * It server-renders and replays its enter animation after hydration.
 */
export const SunburstChart = /* @__PURE__ */ Object.assign(function SunburstChart(props: Readonly<SunburstChartProps>): ReactNode {
  const { className, children } = props;
  const { table, breadcrumbs, hints, defs } = parseChildren(children);
  const input = { props, table };
  // The svg ids' prefix as TanStack's RendererChart made it (RendererChart.js:37).
  const uid = surfaceIdPrefix(undefined, useId());
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  const renderStart = useRenderStart();
  const [controller] = useState(() => createSunburstController({ config, staticPreview, uid, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input, { renderStart: renderStart.current });
  // A change from inside re-renders through state, not useSyncExternalStore: the settle timer and a stage resize commit on the default lane
  // (after paint), as the shell's useReducer and useResizeBox did, and a click or key zoom on the discrete one; a store read would commit at once.
  const [, rerender] = useReducer(bump, 0);
  useLayoutEffect(() => {
    const offs = [controller.view.subscribe(rerender), controller.context.subscribe(rerender)];
    return () => {
      for (const off of offs) { off(); }
    };
  }, [controller]);
  const view = controller.view.get();
  const stable = controller.context.get();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  const { drawn } = view;
  useLayoutEffect(() => {
    const host = hostRef.current;
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!drawn || !host || !stage || !surface) {
      return undefined;
    }
    controller.attach({ host, stage, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, drawn, renderStart]);
  useEffect(() => { controller.committed(); });

  if (!view.shown || stable === null) {
    return null;
  }

  return (
    <SunburstStableProvider value={stable}>
      <SunburstHoverProvider value={controller.hover}>
        <div ref={hostRef} className={className} {...hydratingAttrs} {...view.hostAttrs} style={toCamel(view.hostStyle)}>
          {breadcrumbs}
          <div ref={stageRef} className="bk-sb-stage" style={toCamel(view.stageStyle)}>
            {drawn ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={noTooltipBody} /> : null}
          </div>
          {hints}
          {defs.length === 0 ? null : <ResourceHost idPrefix={uid} resources={scopeResourceIds(defs, uid)} />}
        </div>
      </SunburstHoverProvider>
    </SunburstStableProvider>
  );
}, { displayName: "SunburstChart" });

export { SunburstBreadcrumb, useSunburstBreadcrumbItems } from "./sunburst/breadcrumb";
export type { SunburstBreadcrumbProps } from "./sunburst/breadcrumb";
export { SunburstCenter, SunburstLabels, SunburstSegment } from "./sunburst/carriers";
export type { SunburstCenterProps, SunburstLabelsProps, SunburstSegmentProps, SunburstBreadcrumbItem, SunburstHintContext } from "./core/types/sunburst";
export { SunburstHint } from "./sunburst/hint";
export type { SunburstHintProps } from "./sunburst/hint";
export type { ArcDatum, Focus, SunburstNode } from "./core/sunburst/arcs";
export { useSunburstHover, useSunburstStable } from "./sunburst/context";
export { defaultSunburstColors, opacityForRelativeDepth, sunburstCssVars } from "./core/sunburst/colors";
export { buildArcs, clockwiseFraction, defaultSunburstGrowPadding, ringOptions, sumValues } from "./core/sunburst/arcs";
