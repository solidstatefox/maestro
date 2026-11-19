"use client";
// bklit ScatterChart on native TanStack Charts: React's adapter over the scatter controller (core/scatter/controller.ts), which compiles the
// <Scatter> children's carriers into one definition and owns the two-pass mount, the reveal timer, the overlay and the listeners. The adapter
// calls it at the phases the shell ran that work in: `prepare` while rendering, `update` after every commit (layout), `attach` / `detach` at
// mount (layout) once the carriers nested in custom children have registered, then the reveal render at once, `committed` after every commit
// (passive). It renders the host, the surface, the tooltip leaf and the custom children; hover never re-renders it.
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useHydratingAttrs } from "./kit/use-hydrating";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { ControllerSurface } from "./runtime/surface";
import { BklitTooltipBody, bklitTooltipOptions } from "./kit/tooltip/tooltip-body";
import type { BklitTooltipCarrier, TooltipBodyOptions } from "./kit/tooltip/tooltip-body";
import { propsFor } from "./core/carriers/table";
import { erase } from "./core/erased-types";
import { warnOnce } from "./core/carriers/registry";
import { useChildTable } from "./kit/stable-children";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { createScatterController } from "./core/scatter/controller";
import type { ScatterController } from "./core/scatter/controller";
import { FocusLayer } from "./kit/cartesian/focus-layer";
import type { ChartContextValue } from "./kit/cartesian/chart-context";
import { toCamel } from "./core/style";
import { useSanitizedId } from "./kit/use-sanitized-id";
import type { ScatterChartProps as CoreScatterChartProps } from "./core/types/cartesian";

/** Props of {@link ScatterChart}. */
export interface ScatterChartProps extends CoreScatterChartProps<ReactNode, CSSProperties> {}

/** The hook <FocusLayer> calls: the controller's public context, at the size TanStack measured and the focused row. */
const contextHookOf = (controller: ScatterController) =>
  function useContextValue(): ChartContextValue {
    return useSyncExternalStore(controller.context.subscribe, controller.context.get, controller.context.get);
  };

const nextReveal = (n: number): number => n + 1;

const ScatterChartInner = (props: Readonly<ScatterChartProps>): ReactElement => {
  const { className, style, children } = props;
  const uid = `s${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  const { table, custom, ready } = useChildTable(children);
  const input = { props, table };
  const [controller] = useState(() => createScatterController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input);
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const [useContextValue] = useState(() => contextHookOf(controller));
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  // The render after `attach` reveals (the shell's `revealed` state, set in this layout effect): a layout-effect update renders before paint.
  const [, revealRender] = useReducer(nextReveal, 0);
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
    revealRender();
    return () => { controller.detach(); };
  }, [controller, ready, renderStart]);
  useEffect(() => { controller.committed(); });
  // <ChartTooltip rows content className> and its children, as on the line chart; `Scatter` `label` names the default rows.
  const tooltipCarrier = propsFor<BklitTooltipCarrier>(view.table, "tooltip").at(0);
  const tooltipOptions = useMemo((): TooltipBodyOptions => bklitTooltipOptions(tooltipCarrier, view.data, view.tooltipBase), [tooltipCarrier, view.data, view.tooltipBase]);
  const renderTooltipBody = useCallback(
    ({ points }: ChartTooltipBodyRenderContext) => <BklitTooltipBody points={erase(points)} options={tooltipOptions} />,
    [tooltipOptions],
  );
  return (
    <div ref={hostRef} className={className} {...view.hostAttrs} {...hydratingAttrs} style={{ ...toCamel(view.hostStyle), ...style }}>
      {ready ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={renderTooltipBody} /> : null}
      <FocusLayer store={controller.focus} useContextValue={useContextValue}>
        {custom}
      </FocusLayer>
    </div>
  );
};

/** Time-series scatter chart. Compose it from children: `Grid`, one or more `Scatter` series, `XAxis`, `YAxis` and `ChartTooltip`. Points enter one after another; hover or keyboard focus reports the nearest x position through the tooltip. */
export const ScatterChart = /* @__PURE__ */ Object.assign(function ScatterChart({ revealSignature = "", ...props }: Readonly<ScatterChartProps>): ReactElement {
  return (
  // Remounting on `revealSignature` replays the entrance.
  <ScatterChartInner key={revealSignature} {...props} />
);
}, { displayName: "ScatterChart" });
