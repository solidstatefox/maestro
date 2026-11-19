"use client";
// Bklit RadarChart on TanStack Charts 1.0 native polar marks: radialLine rings, radialRule spokes,
// radialText labels, radialArea + radialDot series, mark `states` for hover emphasis, `motion()` for entrances.
// React's adapter over the radar controller (core/radar/controller.ts), which owns the definition, the renderer it hosts, the owned
// <style>, the entrance alignment, the hover and the listeners. The adapter calls it at the phases the shell ran that work in: `prepare`
// while rendering, `update` after every commit (layout), `attach` / `detach` in the commit that mounts the surface (layout), `committed`
// after every commit's paint (passive). It renders the host, the surface and RadarProvider; hover never re-renders it.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ControllerSurface } from "./runtime/surface";
import { RadarProvider } from "./radar/context";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useSanitizedId } from "./kit/use-sanitized-id";
import { extract } from "./radar/extract";
import { warnOnce } from "./core/carriers/registry";
import { joinClasses } from "./core/cn";
import { createRadarController } from "./core/radar/controller";
import { toCamel } from "./core/style";
import type { RadarChartProps as CoreRadarChartProps } from "./core/types/radar";

export type { RadarData, RadarMetric } from "./core/radar/rows";
export type { RadarAreaProps } from "./core/radar/area";
export type { RadarAxisProps } from "./core/radar/axis";
export type { RadarGridProps } from "./core/radar/grid";
export type { RadarLabelsProps } from "./core/radar/labels";
export { DEFAULT_RADAR_COLORS } from "./core/radar/area";
export { RadarArea } from "./core/radar/area";
export { RadarAxis } from "./core/radar/axis";
export { RadarGrid } from "./core/radar/grid";
export { RadarLabels } from "./core/radar/labels";

/** Props for `RadarChart`. */
export interface RadarChartProps extends CoreRadarChartProps<ReactNode, CSSProperties> {}

// The radar shows no tooltip: its surface's tooltip leaf never has a target.
const noTooltipBody = (): ReactNode => null;

/**
 * Radar (spider) chart that compares several series across the same set of metrics. Compose it from `RadarGrid`, `RadarAxis`, `RadarLabels` and one `RadarArea` per series.
 * Hovering or keyboard-focusing a series enlarges it and dims the others. The chart is drawn on the client after mount; on the server it renders an empty shell.
 */
export const RadarChart = (props: Readonly<RadarChartProps>): ReactElement | null => {
  const { className, style, children } = props;
  const renderStart = useRenderStart();
  const uid = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const input = { props, table: extract(children) };
  const [controller] = useState(() => createRadarController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  // The view and the hover's props of this pass, read below in the same render.
  controller.prepare(input);
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // The scene mounts after the host commits (before paint), the same gate pie/ring/funnel use: the renderer then mounts once instead of
  // being created, torn down and recreated by the dev double-mount of an initial-tree child, which replays every entrance animation.
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => { setMounted(true); }, []);
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  // The surface's commit (the one the gate above schedules); again when a hidden chart's host comes back.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, mounted, view.hidden, renderStart]);
  useEffect(() => { controller.committed(); });

  if (view.hidden) { return null; }

  return (
    <RadarProvider source={controller.hover} value={view.provider}>
    <div
      {...view.hostAttrs}
      ref={hostRef}
      className={joinClasses(view.hostClass, className)}
      style={{ ...toCamel(view.hostStyle), ...style }}
    >
      {mounted ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={noTooltipBody} /> : null}
    </div>
    </RadarProvider>
  );
};
