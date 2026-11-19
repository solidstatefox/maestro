"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { NO_CARRIERS } from "./core/carriers/table";
import { warnOnce } from "./core/carriers/registry";
import { createFunnelController } from "./core/funnel/controller";
import type { FunnelPatternTile } from "./core/funnel/model";
import { toCamel } from "./core/style";
import type { FunnelChartProps as CoreFunnelChartProps } from "./core/types/funnel";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { ResourceHost, scopeResourceIds, translatePatterns } from "./kit/resource-host";
import { useHydrating, useHydratingAttrs } from "./kit/use-hydrating";
import { useSanitizedId } from "./kit/use-sanitized-id";
import { ControllerSurface } from "./runtime/surface";

/** Props for `FunnelChart`. */
interface FunnelChartProps extends CoreFunnelChartProps<ReactNode, CSSProperties> {}

// A funnel has no tooltip.
const noTooltipBody = (): null => null;

const stagePatterns = (
  tiles: readonly FunnelPatternTile[],
  renderPattern: NonNullable<FunnelChartProps["renderPattern"]>,
  patternPrefix: string,
): ReactElement[] => tiles.map(({ key, id, color, dx, dy }) => (
  <Fragment key={key}>{translatePatterns(scopeResourceIds(renderPattern(id, color), patternPrefix), dx, dy)}</Fragment>
));

/**
 * Funnel chart that shows how a value narrows across ordered stages, such as a sales pipeline. Each stage is drawn as a segment with halo rings, sized relative to the first stage, with its value, percentage and name.
 * Hovering or keyboard-focusing a stage pops it out and dims the others. Server-rendered; the entrance plays after hydration.
 */
const FunnelChart = /* @__PURE__ */ Object.assign(function FunnelChart(props: Readonly<FunnelChartProps>): ReactElement | null {
  const { className, style, renderPattern } = props;
  const uid = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydrating = useHydrating();
  const hydratingAttrs = useHydratingAttrs();
  const input = { props: { ...props, hydrating }, table: NO_CARRIERS };
  const [controller] = useState(() => createFunnelController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input);
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  const shown = view !== null;
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  // Entrance starts on the first draw, without bklit's measure-effect re-render (funnel-chart.tsx:798-803), at the user's direction (no frame waits); the curve is unchanged.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, renderStart, shown]);
  useEffect(() => { controller.committed(); });

  if (view === null) {return null;}

  return (
    <div className={className} {...view.hostAttrs} {...hydratingAttrs} ref={hostRef} style={{ ...toCamel(view.hostStyle), ...style }}>
      <ControllerSurface prerender={controller.prerender} renderTooltipBody={noTooltipBody} style={view.surfaceStyle} surfaceRef={surfaceRef} tooltip={controller.tooltip} />
      {renderPattern && view.patterns ? <ResourceHost idPrefix={view.patterns.prefix} resources={stagePatterns(view.patterns.tiles, renderPattern, view.patterns.prefix)} /> : null}
    </div>
  );
}, { displayName: "FunnelChart" });

export { FunnelChart };
export type { FunnelChartProps };
