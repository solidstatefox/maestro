"use client";
// React's host for the plot families (core/plot/controller.ts: Gantt, waterfall, lollipop, dumbbell, error bar, ribbon, bump, slope): it
// reads the carriers, creates the family's controller once and drives it — `update` after every commit (layout), `attach` / `detach` at
// mount (layout), `mounted` after the first paint — and renders the host, the surface, the tooltip leaf (bklit's panel, or `ChartTooltip`'s
// `content`), the loading label while `status="loading"` and the legend hover sync. Hover never re-renders it: the controller writes the
// host and its chrome, and only the tooltip leaf follows the pointer.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { warnOnce } from "../core/carriers/registry";
import { propsFor } from "../core/carriers/table";
import type { ChartEnv, ChartInput } from "../core/chart/controller";
import type { PlotController } from "../core/plot/controller";
import type { PlotDatum } from "../core/plot/types";
import { toCamel } from "../core/style";
import { useRenderStart } from "../kit/entrance/entrance-align";
import { useChartConfig, useStaticChartPreview } from "../kit/cartesian/chart-config";
import { LegendHostSync } from "../kit/cartesian/hover-host";
import { useChildTable, warnUnrenderedChildren } from "../kit/stable-children";
import { TooltipContent } from "../kit/tooltip/tooltip-primitives";
import { LoadingLabel } from "../kit/loading-label";
import { useHydratingAttrs } from "../kit/use-hydrating";
import { useSanitizedId } from "../kit/use-sanitized-id";
import { ControllerSurface } from "../runtime/surface";

/** What every plot chart takes beside its family's props. */
export interface PlotHostProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/** `ChartTooltip`'s props the tooltip leaf reads. */
interface TooltipCarrier {
  readonly content?: (args: { point: PlotDatum; index: number }) => ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

type Create<P> = (env: ChartEnv, initial: ChartInput<P>) => PlotController<P>;

/** One plot chart: `create` is the family's controller factory, `name` its component name (for the development warnings). */
export function PlotChart<P extends object>({ create, name, props }: { readonly create: Create<P>; readonly name: string; readonly props: Readonly<P & PlotHostProps> }): ReactElement {
  const { className, style, children } = props;
  const uid = `p${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  const { table, ready } = useChildTable(children);
  warnUnrenderedChildren(children, name);
  const input: ChartInput<P> = { props, table };
  const [controller] = useState(() => create({ uid, staticPreview, config, warn: warnOnce }, input));
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  useLayoutEffect(() => { controller.update(input); });
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!ready || !host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, ready, renderStart]);
  useEffect(() => { controller.mounted(); }, [controller]);
  const renderTooltipBody = useCallback(
    ({ points }: ChartTooltipBodyRenderContext): ReactNode => {
      const model = view.tooltip(points);
      if (model === null) {
        return null;
      }
      const carrier = propsFor<TooltipCarrier>(view.table, "tooltip").at(0);
      if (carrier?.content) {
        return carrier.content({ point: model.point, index: model.index });
      }
      return (
        <TooltipContent className={carrier?.className} rows={[...model.rows]} title={model.title}>
          {carrier?.children}
        </TooltipContent>
      );
    },
    [view],
  );
  return (
    <div ref={hostRef} className={className} {...view.hostAttrs} {...hydratingAttrs} style={{ ...toCamel(view.hostStyle), ...style }}>
      {ready ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={renderTooltipBody} /> : null}
      {view.loadingLabel === null ? null : <div style={toCamel(view.loadingLabel.boxStyle)}><LoadingLabel text={view.loadingLabel.text} /></div>}
      <LegendHostSync hostRef={hostRef} />
    </div>
  );
}
