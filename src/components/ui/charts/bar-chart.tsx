"use client";
// Bklit BarChart on native TanStack Charts: React's adapter over the bar controller (core/bar/controller.ts), which compiles the children's
// carriers into one `defineChart` definition (bar) and hosts it with the native `motion()` entrance. The adapter calls it at the phases the
// shell ran that work in: `prepare` while rendering, `update` after every commit (layout), `attach` / `detach` at mount (layout) once the
// carriers nested in custom children have registered, `committed` after every commit's paint (passive). It renders the host, the surface,
// the tooltip leaf, the stylesheet and the sized layer (skeleton, custom children); hover never re-renders it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { createBarController } from "./core/bar/controller";
import type { BarChartProps as CoreBarChartProps } from "./core/types/bar";
import { warnOnce } from "./core/carriers/registry";
import { propsFor } from "./core/carriers/table";
import { erase } from "./core/erased-types";
import type { LegendHover } from "./core/legend/store";
import type { Readable } from "./core/store";
import { toCamel } from "./core/style";
import { ControllerSurface } from "./runtime/surface";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useChildTable } from "./kit/stable-children";
import { useHydratingAttrs } from "./kit/use-hydrating";
import { useSanitizedId } from "./kit/use-sanitized-id";
import { useChartLegendHover } from "./kit/legend/legend";
import { bklitTooltipOptions } from "./kit/tooltip/tooltip-body";
import type { BklitTooltipCarrier } from "./kit/tooltip/tooltip-body";
import { readBarChildren } from "./bar/read-children";
import { BarSizedLayer } from "./bar/sized-layer";
import { BarTooltipBody } from "./bar/tooltip";
import type { BarTooltipOptions } from "./bar/tooltip";

/** Props of {@link BarChart}. */
interface BarChartProps extends CoreBarChartProps<ReactNode, CSSProperties> {}

const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * Bar chart over categories, grouped or stacked, vertical or horizontal. Compose it from children: `Bar` (or `BarSquares`), `Grid`, `BarXAxis`, `BarYAxis`, `ChartTooltip`.
 * Bars grow in with a stagger; hover and keyboard focus pick a category and show the tooltip.
 */
const BarChart = (props: Readonly<BarChartProps>): ReactElement => {
  const { className, style, children } = props;
  const uid = `b${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  // The legend's hovered series is a host attribute of the view: a legend hover re-renders the chart, and that render's pass reads it here.
  const legendHovered = useChartLegendHover().hoveredIndex;
  const legend = useRef<LegendHover>({ legend: legendHovered, profitLoss: null });
  legend.current = { legend: legendHovered, profitLoss: null };
  // Legend hover re-renders the host with fresh `children`; keep the previous table while every carrier is structurally equal.
  const { table, custom, ready } = useChildTable(children, readBarChildren);
  const input = { props, table };
  const [controller] = useState(() => {
    const legendHover: Readable<LegendHover> = { get: () => legend.current, subscribe: NO_SUBSCRIPTION };
    return createBarController({ uid, staticPreview, config, legendHover, warn: warnOnce }, input, { commits: "adapter" });
  });
  controller.prepare(input);
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  // The surface mounts once the custom children's carriers have registered (the first definition waits for them).
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!ready || !host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, ready, renderStart]);
  useEffect(() => { controller.committed(); });
  // <ChartTooltip rows content className> and its children, as on the line chart; `Bar` / `BarSquares` `label` names the default rows.
  const tooltipOptions: BarTooltipOptions = { ...bklitTooltipOptions(propsFor<BklitTooltipCarrier>(view.table, "tooltip").at(0), view.data, view.tooltipBase), horizontal: view.horizontal };
  const tooltipRef = useRef(tooltipOptions);
  tooltipRef.current = tooltipOptions;
  // Stable callback (the surface never re-renders on hover); reads the latest options at tooltip time.
  const renderTooltipBody = useCallback(({ points }: ChartTooltipBodyRenderContext) => <BarTooltipBody points={erase(points)} options={tooltipRef.current} />, []);
  // Entrance starts on the first draw, without bklit's ParentSize frames (bar-chart.tsx:701), at the user's direction (no frame waits); the curve is unchanged.
  return (
    <div
      ref={hostRef}
      className={className}
      {...view.hostAttrs}
      {...hydratingAttrs}
      // SAFETY: the core's style objects hold CSS properties and `--ts-chart-*` custom properties only.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      style={{ ...(toCamel(view.hostStyle) as CSSProperties), ...style }}
    >
      {ready ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={renderTooltipBody} /> : null}
      <style>{view.staticCss}</style>
      {view.skeleton || custom.length > 0 ? <BarSizedLayer controller={controller} view={view} host={hostRef} custom={custom} /> : null}
    </div>
  );
};

export type { BarChartProps };
export { BarChart };
