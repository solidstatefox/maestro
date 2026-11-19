"use client";

import { useRenderStart } from "./kit/entrance/entrance-align";
import { useHydratingAttrs } from "./kit/use-hydrating";
import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { ControllerSurface } from "./runtime/surface";
import { warnOnce } from "./core/carriers/registry";
import { createSankeyController } from "./core/sankey/controller";
import { isConfigCarrier, sankeyTable } from "./sankey/data";
import { SankeyContextLayer } from "./sankey/context";
import { ResourceHost, scopeResourceIds } from "./kit/resource-host";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { toCamel } from "./core/style";
import { useSanitizedId } from "./kit/use-sanitized-id";
import type { SankeyChartProps as CoreSankeyChartProps } from "./core/types/sankey";

/** Props of `SankeyChart`. */
interface SankeyChartProps extends CoreSankeyChartProps<ReactNode> {}

/**
 * Flow diagram of nodes joined by weighted links. Configure it with `SankeyNode`, `SankeyLink` and `SankeyTooltip` children.
 * It server-renders and replays its enter animation after hydration. Hovering a node or a flow dims everything not connected to it.
 */
const SankeyChart = (props: SankeyChartProps): ReactElement => {
  const { className, children } = props;
  const idPrefix = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  // The config carriers among the direct children, read by displayName (the last of each wins).
  const table = useMemo(() => sankeyTable(children), [children]);
  const input = { props, table };
  const [controller] = useState(() => createSankeyController<ReactNode>({ uid: idPrefix, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  // The hover reads the latest props from this render.
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
  useEffect(() => { controller.committed(); });
  const hostStyle = useMemo(() => toCamel(view.hostStyle), [view.hostStyle]);
  // The public `useSankey()` layer exists only when the chart has children beyond its own config carriers.
  const hasContextChildren = !Children.toArray(children).every(isConfigCarrier);

  return (
    <div className={className} {...view.hostAttrs} {...hydratingAttrs} ref={hostRef} style={hostStyle}>
      <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={view.renderTooltipBody} />
      {hasContextChildren ? <SankeyContextLayer controller={controller}>{children}</SankeyContextLayer> : null}
      {view.patterns === null ? null : <ResourceHost idPrefix={idPrefix} resources={scopeResourceIds(view.patterns, idPrefix)} />}
    </div>
  );
};

export { SankeyLink } from "./sankey/link";
export { SankeyNode } from "./sankey/node";
export { SankeyTooltip } from "./sankey/tooltip";
export { SankeyChart };
export type { SankeyLinkProps } from "./sankey/link";
export type { SankeyLabelOrientation, SankeyNodeProps } from "./core/types/sankey";
export type { SankeyTooltipProps } from "./sankey/tooltip";
export type { SankeyData } from "./core/sankey/types";
export type { SankeyChartProps };
