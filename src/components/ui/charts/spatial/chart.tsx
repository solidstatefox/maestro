"use client";
// The spatial charts in React (hexbin, density, bubble map, route map, globe, vector field): one adapter over the shared spatial controller
// (core/spatial/controller.ts), which builds the family's definition from the props and the carriers, hosts the renderer and owns the
// hover, the entrance, the loading state and the drag. The adapter calls it at the phases RendererChart ran that work in: `prepare` while
// rendering, `update` after every commit (layout), `attach` / `detach` at mount (layout). It renders the host, the surface, the tooltip
// leaf (bklit's TooltipBox around the tooltip carrier's `content`, or TooltipContent's title and rows), the loading label over the plot
// and the legend under it; hover never re-renders it. Its carriers render nothing: the chart reads them as its direct children.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { warnOnce } from "../core/carriers/registry";
import { erase } from "../core/erased-types";
import { createSpatialController } from "../core/spatial/controller";
import type { SpatialControllerProps, SpatialView } from "../core/spatial/controller";
import type { SpatialFamily } from "../core/spatial/family";
import { toCamel } from "../core/style";
import { useChartConfig, useStaticChartPreview } from "../kit/cartesian/chart-config";
import { useRenderStart } from "../kit/entrance/entrance-align";
import { readChildren } from "../kit/read-children";
import { warnUnrenderedChildren } from "../kit/stable-children";
import { TooltipBox, TooltipContent } from "../kit/tooltip/tooltip-primitives";
import { useHydratingAttrs } from "../kit/use-hydrating";
import { useSanitizedId } from "../kit/use-sanitized-id";
import { renderMarkup } from "../runtime/markup";
import { ControllerSurface } from "../runtime/surface";

/** What a spatial chart's React props add to its controller's: the host's class and the carriers. */
interface ChartShell {
  readonly className?: string;
  readonly children?: ReactNode;
}

/** The tooltip carrier's props a body reads (core/types/spatial.ts `SpatialTooltipProps`). */
interface TooltipCarrier {
  readonly content?: (args: Readonly<Record<string, unknown>>) => ReactNode;
  readonly className?: string;
  readonly panelStyle?: CSSProperties;
  readonly backgroundColor?: string;
}

/** The body for one target: bklit's panel around the reader's `content`, or the default title and rows; the renderer's default body
 * for a point the family does not describe. */
const spatialTooltipBody = (context: ChartTooltipBodyRenderContext, plan: SpatialView["tooltip"]): ReactNode => {
  const shown = plan?.shown(erase(context.points));
  if (plan === null || shown === undefined) {
    return context.defaultBody;
  }
  // SAFETY: the plan's carrier is the family's tooltip carrier's props (SpatialTooltipProps with React's nodes and styles).
  const { content, className, panelStyle, backgroundColor } = plan.carrier as TooltipCarrier;
  return (
    <TooltipBox backgroundColor={backgroundColor} className={className} panelStyle={panelStyle}>
      {content === undefined ? <TooltipContent rows={shown.rows} title={shown.title} /> : content(shown.args)}
    </TooltipBox>
  );
};

/** A spatial chart component over `family`, named `name`. */
export const defineSpatialChart = <Props extends SpatialControllerProps & ChartShell>(name: string, family: SpatialFamily<Props>) =>
  Object.assign(function SpatialChart(props: Readonly<Props>): ReactElement {
    const { className, children } = props;
    const uid = useSanitizedId();
    const staticPreview = useStaticChartPreview();
    const config = useChartConfig();
    const hydratingAttrs = useHydratingAttrs();
    const table = useMemo(() => {
      warnUnrenderedChildren(children, name);
      return readChildren(children);
    }, [children]);
    const input = { props, table };
    const [controller] = useState(() => createSpatialController<Props>({ uid, staticPreview, config, warn: warnOnce }, input, family, { commits: "adapter" }));
    controller.prepare(input);
    const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const renderStart = useRenderStart();
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
    // Stable (the surface never re-renders on hover); reads the latest plan when a body is built.
    const planRef = useRef(view.tooltip);
    planRef.current = view.tooltip;
    const renderTooltipBody = useCallback((context: ChartTooltipBodyRenderContext): ReactNode => spatialTooltipBody(context, planRef.current), []);
    const hostStyle = useMemo(() => toCamel(view.hostStyle), [view.hostStyle]);
    return (
      <div className={className} {...view.hostAttrs} {...hydratingAttrs} ref={hostRef} style={hostStyle}>
        <ControllerSurface prerender={controller.prerender} renderTooltipBody={renderTooltipBody} style={view.surfaceStyle} surfaceRef={surfaceRef} tooltip={controller.tooltip} />
        {view.loadingLabel === null ? null : renderMarkup(view.loadingLabel)}
        {view.legend === null ? null : renderMarkup(view.legend)}
      </div>
    );
  }, { displayName: name });
