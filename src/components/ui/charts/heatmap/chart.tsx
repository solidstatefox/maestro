"use client";
// Bklit HeatmapChart: React's adapter over the heatmap controller (core/heatmap/controller.ts), which builds the `cell`/`rect` marks on band
// scales from the props and the config carriers and hosts them with motion()'s per-datum entrance, and runs the fluid width, the cells'
// second commit, the grid arrows, the hover emphasis and the touch and keyboard listeners. The adapter calls it at the phases the shell ran
// that work in: `prepare` while rendering, `update` after every commit (layout), `attach` / `detach` at mount (layout), `setSurface` as the
// surface's ref, `committed` after every commit's paint (passive). It renders the host, the inner box, the surface, the defs, the loading
// label, the tooltip leaf and the children under the `useHeatmap()` context; hover never re-renders it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { warnOnce } from "../core/carriers/registry";
import { erase } from "../core/erased-types";
import { createHeatmapController } from "../core/heatmap/controller";
import type { HeatmapController } from "../core/heatmap/controller";
import { heatmapLoadingXDomain, heatmapSkeletonColumns } from "../core/heatmap/loading";
import type { HeatmapTooltipView } from "../core/heatmap/tooltip";
import { toCamel } from "../core/style";
import type { HeatmapChartLoadingProps, HeatmapChartProps as CoreHeatmapChartProps } from "../core/types/heatmap";
import { useChartConfig, useStaticChartPreview } from "../kit/cartesian/chart-config";
import { LoadingLabel } from "../kit/loading-label";
import { readChildren } from "../kit/read-children";
import { warnUnrenderedChildren } from "../kit/stable-children";
import { useSanitizedId } from "../kit/use-sanitized-id";
import { renderMarkup } from "../runtime/markup";
import { ControllerSurface } from "../runtime/surface";
import { HeatmapCells, HeatmapXAxis, HeatmapYAxis } from "./carriers";
import { HeatmapContext, HeatmapInteractionProvider, useHeatmapCoordinatorOptional } from "./context";

/** Props of `HeatmapChart`. */
interface HeatmapChartProps extends CoreHeatmapChartProps<ReactNode> {}

const tooltipBody = (view: HeatmapTooltipView<CSSProperties>): ReactElement => {
  const panelStyle: CSSProperties = { backgroundColor: view.backgroundColor, ...view.panelStyle };
  return (
    <div className={view.panelClass} style={panelStyle}>
      <div className="bkm-tooltip-content">
        <div className="ts-bkm-heatmap-tooltip-date">{view.date}</div>
        <div className="ts-bkm-heatmap-tooltip-weekday">{view.weekday}</div>
        <div className="ts-bkm-heatmap-tooltip-divider" />
        <div className="ts-bkm-heatmap-tooltip-value">{view.label}</div>
      </div>
    </div>
  );
};

/** Re-renders on a change from inside (a measured width, the cells joining) on the default lane, as ParentSize's setState does, where a
 * `useSyncExternalStore` read would commit synchronously. The render reads the view after `prepare`. */
const useViewCommits = (controller: HeatmapController<CSSProperties>): void => {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => controller.view.subscribe(() => { setVersion((version) => version + 1); }), [controller]);
};

/**
 * A contribution heatmap: a grid of week columns and weekday rows whose cells are colored by level, with entrance animation, hover dimming, a tooltip and keyboard navigation.
 * Compose it with `HeatmapCells` (required), `HeatmapXAxis`, `HeatmapYAxis`, `HeatmapTooltip` and `HeatmapSeparator` children.
 * It renders an empty container on the server and draws after mount.
 */
const HeatmapChart = /* @__PURE__ */ Object.assign(function HeatmapChart(props: Readonly<HeatmapChartProps>): ReactElement {
  const { className, children } = props;
  const upstream = useHeatmapCoordinatorOptional();
  const uid = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const table = useMemo(() => { warnUnrenderedChildren(children, "HeatmapChart"); return readChildren(children); }, [children]);
  const input = { props: { ...props, coordinator: upstream }, table };
  const [controller] = useState(() => createHeatmapController<CSSProperties>({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input);
  useViewCommits(controller);
  const view = controller.view.get();
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Every commit hands the renderer its latest options (mounting it into a new surface), as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    controller.attach({ host });
    return () => { controller.detach(); };
  }, [controller]);
  useEffect(() => { controller.committed(); });
  // Stable callback (the surface never re-renders on hover); reads the latest body at tooltip time.
  const tooltipBodyRef = useRef(view.tooltipBody);
  tooltipBodyRef.current = view.tooltipBody;
  const renderTooltipBody = useCallback((context: ChartTooltipBodyRenderContext): ReactNode => {
    const body = tooltipBodyRef.current(erase(context));
    return body === undefined ? undefined : tooltipBody(body);
  }, []);
  const hostStyle = useMemo(() => toCamel(view.hostStyle), [view.hostStyle]);
  const { chart } = view;

  const surface = (
    <div className={className} {...view.hostAttrs} ref={hostRef} style={hostStyle}>
      {chart === null ? null : (
        <HeatmapContext.Provider value={controller.context.get()}>
          <div style={toCamel(chart.innerStyle)}>
            <ControllerSurface className={chart.surfaceClassName} prerender={controller.prerender} renderTooltipBody={renderTooltipBody} style={chart.surfaceStyle} surfaceRef={controller.setSurface} tooltip={controller.tooltip} />
            {chart.resources === null ? null : renderMarkup(chart.resources)}
            {chart.loadingLabel === null ? null : (
              <div className="ts-bkm-heatmap-loading-box" style={toCamel(chart.loadingLabel.boxStyle)}><LoadingLabel text={chart.loadingLabel.text} /></div>
            )}
            {children}
          </div>
        </HeatmapContext.Provider>
      )}
    </div>
  );

  return upstream === null ? <HeatmapInteractionProvider coordinator={controller.coordinator}>{surface}</HeatmapInteractionProvider> : surface;
}, { displayName: "HeatmapChart" });

/** A ready-made loading state: a skeleton grid shaped like `data`, with a shimmer and a centered label. */
const HeatmapChartLoading = ({ data, xDomain, margin, gap = 2, cornerRadius = 2, label = "Loading", className = "" }: Readonly<HeatmapChartLoadingProps>): ReactElement => {
  const skeletonData = useMemo(() => heatmapSkeletonColumns(data), [data]);
  const mutableXDomain = useMemo(() => heatmapLoadingXDomain(xDomain), [xDomain]);
  return (
    <HeatmapChart className={className} data={skeletonData} gap={gap} loadingLabel={label} margin={margin} status="loading" xDomain={mutableXDomain}>
      <HeatmapCells cornerRadius={cornerRadius} interactive={false} />
      <HeatmapXAxis />
      <HeatmapYAxis />
    </HeatmapChart>
  );
};

export { HeatmapChart, HeatmapChartLoading };
export type { HeatmapChartProps };
