"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { warnOnce } from "../core/carriers/registry";
import type { LegendHover } from "../core/legend/store";
import { createMarkChartController } from "../core/mark-chart/controller";
import type { MarkChartFamily, MarkDatum } from "../core/mark-chart/types";
import { writable } from "../core/store";
import type { Writable } from "../core/store";
import { toCamel } from "../core/style";
import { useChartConfig, useStaticChartPreview } from "../kit/cartesian/chart-config";
import { useRenderStart } from "../kit/entrance/entrance-align";
import { useChartLegendHover } from "../kit/legend/legend";
import { LoadingLabel } from "../kit/loading-label";
import { readChildren } from "../kit/read-children";
import { useHydratingAttrs } from "../kit/use-hydrating";
import { useSanitizedId } from "../kit/use-sanitized-id";
import { ControllerSurface } from "../runtime/surface";

/** What every mark chart takes beside its family's props. */
export interface MarkChartHostProps {
  /** Extra class name for the chart's root element. */
  readonly className?: string;
  /** Inline style for the chart's root element. */
  readonly style?: CSSProperties;
  /** Carriers: `ChartTooltip` and the family's own. */
  readonly children?: ReactNode;
}

const NO_LEGEND: LegendHover = { legend: null, profitLoss: null };

/** Feeds the nearest `ChartLegendHoverProvider`'s hovered row to the controller's legend store (only this leaf re-renders on a legend hover). */
const LegendSync = ({ store }: { readonly store: Writable<LegendHover> }): null => {
  const legend = useChartLegendHover().hoveredIndex;
  useEffect(() => {
    store.set(legend === null ? NO_LEGEND : { legend, profitLoss: null });
  }, [store, legend]);
  return null;
};

/** A chart component for `family`, named `displayName`. */
export const createMarkChart = <Props extends object>(family: MarkChartFamily<Props>, displayName: string) =>
  Object.assign(function MarkChart(props: Readonly<Props & MarkChartHostProps>): ReactElement {
    const { className, style, children } = props;
    const uid = useSanitizedId();
    const staticPreview = useStaticChartPreview();
    const config = useChartConfig();
    const hydratingAttrs = useHydratingAttrs();
    const table = useMemo(() => readChildren(children), [children]);
    const input = { props: props as Props, table };
    const [legendHover] = useState(() => writable<LegendHover>(NO_LEGEND));
    const [controller] = useState(() => createMarkChartController<Props, ReactNode>(family, { uid, staticPreview, config, legendHover, warn: warnOnce }, input));
    controller.prepare(input);
    const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const renderStart = useRenderStart();
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
    useEffect(() => { controller.mounted(); }, [controller]);
    const carrier = view.tooltip;
    const renderTooltipBody = useMemo(() => (context: ChartTooltipBodyRenderContext): ReactNode => {
      const datum = context.points[0]?.datum as MarkDatum | undefined;
      const content = carrier?.content;
      return content === undefined || datum === undefined ? context.defaultBody : content({ index: datum.index, point: datum.row });
    }, [carrier]);
    const hostStyle = useMemo(() => toCamel(view.hostStyle), [view.hostStyle]);
    const label = view.loadingLabel;
    return (
      <div className={className} {...view.hostAttrs} {...hydratingAttrs} ref={hostRef} style={style === undefined ? hostStyle : { ...hostStyle, ...style }}>
        <ControllerSurface prerender={controller.prerender} renderTooltipBody={renderTooltipBody} style={view.surfaceStyle} surfaceRef={surfaceRef} tooltip={controller.tooltip} />
        {label === null ? null : <div style={toCamel(label.boxStyle)}><LoadingLabel text={label.text} /></div>}
        <LegendSync store={legendHover} />
      </div>
    );
  }, { displayName });

/**
 * A family's loading placeholder, named `displayName`: `Chart` at `status="loading"` with the family's empty props (`family.placeholder`),
 * drawing its shimmering skeleton. Its `label` is the chart's `loadingLabel`; its other props (`aspectRatio`, `height`, a family's shape
 * props, `className`) pass through to the chart.
 */
export const createMarkChartLoading = <Props extends object, LoadingProps extends { readonly label?: string }>(
  family: MarkChartFamily<Props>,
  Chart: (props: Readonly<Props & MarkChartHostProps>) => ReactElement,
  displayName: string,
) =>
  Object.assign(function MarkChartLoading({ label, ...props }: Readonly<LoadingProps>): ReactElement {
    // SAFETY: every mark chart takes `status` and `loadingLabel` (core/mark-chart/controller.ts), and a placeholder's props are its chart's.
    const chartProps = { ...family.placeholder, ...props, loadingLabel: label, status: "loading" } as unknown as Readonly<Props & MarkChartHostProps>;
    return <Chart {...chartProps} />;
  }, { displayName });
