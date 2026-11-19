"use client";
// React's adapter over the distribution engine (core/distribution/controller.ts), shared by the six distribution families (histogram,
// box plot, violin, beeswarm, ECDF, ridgeline): it reads the carriers (`useChildTable`), creates the family's controller once, hands it
// every later input after the commit (layout), attaches it to the host and the surface at mount, and renders the host, the surface and
// the tooltip leaf: the carrier's `content` for the hovered item, else bklit's panel body (`TooltipContent`), and while loading the
// loading label over the plot. Hover never re-renders it.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { warnOnce } from "../core/carriers/registry";
import type { ChartEnv, ChartInput } from "../core/chart/controller";
import type { DistributionController } from "../core/distribution/controller";
import { erase } from "../core/erased-types";
import type { LegendHover } from "../core/legend/store";
import { writable } from "../core/store";
import { toCamel } from "../core/style";
import { useChartConfig, useStaticChartPreview } from "../kit/cartesian/chart-config";
import { useChartLegendHover } from "../kit/legend/legend";
import { LoadingLabel } from "../kit/loading-label";
import { useChildTable, warnUnrenderedChildren } from "../kit/stable-children";
import { TooltipContent } from "../kit/tooltip/tooltip-primitives";
import { useHydratingAttrs } from "../kit/use-hydrating";
import { useSanitizedId } from "../kit/use-sanitized-id";
import { ControllerSurface } from "../runtime/surface";

type TooltipContentProp = (context: { readonly point: unknown; readonly index: number }) => ReactNode;

/** What a distribution chart hands the shared adapter. */
interface DistributionChartAdapterProps<Props> {
  /** The chart's name in warnings. */
  readonly name: string;
  readonly create: (env: ChartEnv, input: ChartInput<Props>) => DistributionController<Props>;
  /** The props the controller reads (the chart's own, without `className`, `style` and `children`). */
  readonly props: Props;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/** A distribution chart: the family's controller over its carriers. */
export function DistributionChart<Props extends object>({ name, create, props, className, style, children }: Readonly<DistributionChartAdapterProps<Props>>): ReactElement {
  const uid = `d${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  useMemo(() => { warnUnrenderedChildren(children, name); }, [children, name]);
  const { table } = useChildTable(children);
  const input: ChartInput<Props> = { props, table };
  // The legend's hovered series (ChartLegendHoverProvider), which the controller writes on its host (`data-bkm-legend`).
  const legendHovered = useChartLegendHover().hoveredIndex;
  const [legend] = useState(() => writable<LegendHover>({ legend: legendHovered, profitLoss: null }));
  const [controller] = useState(() => create({ uid, staticPreview, config, legendHover: legend, warn: warnOnce }, input));
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (legend.get().legend !== legendHovered) {
      legend.set({ legend: legendHovered, profitLoss: null });
    }
  }, [legend, legendHovered]);
  // Every commit hands the controller its latest input (it derives again only when a prop or a carrier changed).
  useLayoutEffect(() => { controller.update(input); });
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: performance.now() });
    return () => { controller.detach(); };
  }, [controller]);
  // Stable (the surface never re-renders on hover): reads the latest view at tooltip time.
  const viewRef = useRef(view);
  viewRef.current = view;
  const renderTooltipBody = useCallback((context: ChartTooltipBodyRenderContext): ReactNode => {
    const current = viewRef.current;
    const body = current.tooltip(erase(context.points));
    if (body === undefined) {
      return null;
    }
    const content: unknown = current.tooltipProps?.content;
    if (typeof content === "function") {
      // SAFETY: a distribution tooltip's `content` is its documented render prop (core/types/distribution.ts DistributionTooltipProps).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      return (content as TooltipContentProp)({ point: body.point, index: body.index });
    }
    return <TooltipContent rows={body.rows} title={body.title} />;
  }, []);
  const hostStyle = useMemo(() => ({ ...toCamel(view.hostStyle), ...style }), [view.hostStyle, style]);
  const label = view.loadingLabel;
  const labelBoxStyle = useMemo(() => (label === null ? undefined : toCamel(label.boxStyle)), [label]);
  return (
    <div className={className} {...view.hostAttrs} {...hydratingAttrs} ref={hostRef} style={hostStyle}>
      <ControllerSurface prerender={controller.prerender} renderTooltipBody={renderTooltipBody} style={view.surfaceStyle} surfaceRef={surfaceRef} tooltip={controller.tooltip} />
      {label === null ? null : (
        <div className="ts-bkm-d-loading-box" style={labelBoxStyle}>
          <LoadingLabel text={label.text} />
        </div>
      )}
    </div>
  );
}
