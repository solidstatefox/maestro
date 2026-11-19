"use client";
// React's ComposedChart: the adapter over the composed controller (core/composed/controller.ts), which compiles the SeriesBar / Line / Area
// carriers into one native definition and hosts it with the native `motion()` entrance. The adapter calls it at the phases the shell ran
// that work in (as react/kit/cartesian/cartesian-chart.tsx does): `prepare` while rendering, `update` after every commit (layout), `attach` /
// `detach` at mount (layout) once the carriers nested in custom children have registered, `committed` after every commit's paint (passive);
// the reveal arms from <RevealArm>'s two passive commits. It renders the host, the surface, the tooltip leaf and the custom children; hover
// never re-renders it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { propsFor } from "../core/carriers/table";
import { warnOnce } from "../core/carriers/registry";
import { createComposedController } from "../core/composed/controller";
import type { ComposedController } from "../core/composed/controller";
import { erase } from "../core/erased-types";
import { toCamel } from "../core/style";
import { RevealArm } from "../kit/entrance/reveal-arm";
import { useRenderStart } from "../kit/entrance/entrance-align";
import { LegendHostSync } from "../kit/cartesian/hover-host";
import { useChartConfig, useStaticChartPreview } from "../kit/cartesian/chart-config";
import { FocusLayer } from "../kit/cartesian/focus-layer";
import type { ChartContextValue } from "../kit/cartesian/chart-context";
import { useChildTable } from "../kit/stable-children";
import { BklitTooltipBody, bklitTooltipOptions } from "../kit/tooltip/tooltip-body";
import { useHydratingAttrs } from "../kit/use-hydrating";
import { useSanitizedId } from "../kit/use-sanitized-id";
import { renderMarkup } from "../runtime/markup";
import { ControllerSurface } from "../runtime/surface";
import type { ComposedChartProps } from "./types";

/** The hook <FocusLayer> calls: the controller's public context, at the size the draw published and the focused row. */
const contextHookOf = (controller: ComposedController) =>
  function useContextValue(): ChartContextValue {
    return useSyncExternalStore(controller.context.subscribe, controller.context.get, controller.context.get);
  };

/** A chart that combines bar, line and area series on one shared x axis and y scale. Add `SeriesBar`, `Line` and `Area` children. */
export const ComposedChart = /* @__PURE__ */ Object.assign(function ComposedChart(props: Readonly<ComposedChartProps>): ReactElement {
  const { className, children } = props;
  const uid = `c${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  const { table, custom, ready } = useChildTable(children);
  const input = { props, table };
  const [controller] = useState(() => createComposedController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  // A data change adjusts the data step in this render (react.dev "adjusting state on a prop change"), so its build draws the new step.
  controller.prepare(input);
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const [useContextValue] = useState(() => contextHookOf(controller));
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
  // Stable callback (the surface never re-renders on hover); reads the latest options at tooltip time.
  const tooltipOptions = bklitTooltipOptions(propsFor<Parameters<typeof bklitTooltipOptions>[0] & object>(view.table, "tooltip")[0], view.data, view.tooltipBase);
  const tooltipOptionsRef = useRef(tooltipOptions);
  tooltipOptionsRef.current = tooltipOptions;
  const renderTooltipBody = useCallback(
    ({ points }: ChartTooltipBodyRenderContext) => <BklitTooltipBody points={erase(points)} options={tooltipOptionsRef.current} />,
    [],
  );
  return (
    <div
      ref={hostRef}
      className={className}
      {...view.hostAttrs}
      {...hydratingAttrs}
      // SAFETY: the core's style objects hold CSS properties and `--bkm-*` custom properties only.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      style={toCamel(view.hostStyle) as CSSProperties}
    >
      {renderMarkup(view.resources)}
      <LegendHostSync hostRef={hostRef} />
      <RevealArm hostRef={hostRef} onArm={controller.arm} />
      {ready ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={renderTooltipBody} /> : null}
      <FocusLayer store={controller.focus} useContextValue={useContextValue}>
        {custom}
      </FocusLayer>
    </div>
  );
}, { displayName: "ComposedChart" });
