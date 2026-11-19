"use client";
// bklit CandlestickChart on native TanStack Charts: React's adapter over the candlestick controller (core/candlestick/controller.ts), which
// compiles the Candlestick/Grid/XAxis/YAxis/ChartTooltip carriers into one native definition and hosts it with the native `motion()` entrance.
// The adapter calls it at the phases the shell ran that work in: `prepare` while rendering, `update` after every commit (layout), `attach` /
// `detach` at mount (layout) once the carriers nested in custom children have registered, `committed` after every commit's paint (passive),
// `mounted` from the mount's passive effect (the ready gate arms). It renders the host, the surface, the tooltip leaf and the custom
// children's leaf; hover never re-renders it.
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useHydratingAttrs } from "./kit/use-hydrating";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { ControllerSurface } from "./runtime/surface";
import { renderMarkup } from "./runtime/markup";
import { createCandlestickController } from "./core/candlestick/controller";
import type { CandlestickController } from "./core/candlestick/controller";
import { propsFor } from "./core/carriers/table";
import { warnOnce } from "./core/carriers/registry";
import { erase } from "./core/erased-types";
import { toCamel } from "./core/style";
import { useChildTable } from "./kit/stable-children";
import { BklitTooltipBody, bklitTooltipOptions } from "./kit/tooltip/tooltip-body";
import type { BklitTooltipCarrier, TooltipBodyOptions } from "./kit/tooltip/tooltip-body";
import { useChartLegendHover } from "./kit/legend/legend";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { FocusLayer } from "./kit/cartesian/focus-layer";
import type { ChartContextValue } from "./kit/cartesian/chart-context";
import { useSanitizedId } from "./kit/use-sanitized-id";
import type { CandlestickChartProps as CoreCandlestickChartProps } from "./core/types/candlestick";

export interface CandlestickChartProps extends CoreCandlestickChartProps<ReactNode, CSSProperties> {}

/** The hook <FocusLayer> calls: the controller's public context, at the measured size and the focused candle. */
const contextHookOf = (controller: CandlestickController) =>
  function useContextValue(): ChartContextValue {
    return useSyncExternalStore(controller.context.subscribe, controller.context.get, controller.context.get);
  };

const bumpRender = (count: number): number => count + 1;

/** A candlestick (OHLC) chart. Pass rows of `OHLCDataPoint` and a `Candlestick` child, plus optional `Grid`, axes and `ChartTooltip`. */
export const CandlestickChart = /* @__PURE__ */ Object.assign(function CandlestickChart(props: Readonly<CandlestickChartProps>): ReactElement {
  const { revealSignature = "", className, style, children } = props;
  const legendHovered = useChartLegendHover().hoveredIndex;
  const uid = `c${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  // A legend hover re-renders the host with fresh children: keep the previous carrier table so the definition is not rebuilt.
  const { table, custom, ready } = useChildTable(children);
  const input = { props, table };
  const [controller] = useState(() => createCandlestickController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input);
  // The measured box and the ready gate's flag were this shell's state, set from an observer and a timer: the controller's change from inside
  // re-renders it on the default lane, after paint, as those setStates did (a store read would commit before the paint).
  const [, rerender] = useReducer(bumpRender, 0);
  useLayoutEffect(() => controller.view.subscribe(rerender), [controller]);
  const view = controller.view.get();
  const [useContextValue] = useState(() => contextHookOf(controller));
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  // The surface mounts once the custom children's carriers have registered (the first definition waits for them); a new revealSignature
  // remounts the host (its `key`), and the controller moves to it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!ready || !host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, ready, renderStart, revealSignature]);
  useEffect(() => { controller.committed(); });
  useEffect(() => { controller.mounted(); }, [controller]);
  const tooltipProps = propsFor<BklitTooltipCarrier>(view.table, "tooltip").at(0);
  const tooltipOptions = useMemo((): TooltipBodyOptions => bklitTooltipOptions(tooltipProps, view.data, view.tooltipBase), [tooltipProps, view.data, view.tooltipBase]);
  const renderTooltipBody = useCallback(
    ({ points }: ChartTooltipBodyRenderContext) => <BklitTooltipBody points={erase(points)} options={tooltipOptions} />,
    [tooltipOptions],
  );
  return (
    <div
      key={revealSignature}
      ref={hostRef}
      className={className}
      {...view.hostAttrs}
      {...hydratingAttrs}
      data-bkm-legend={legendHovered ?? undefined}
      // SAFETY: the core's style objects hold CSS properties and `--bkm-*` custom properties only.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      style={{ ...toCamel(view.hostStyle), ...style } as CSSProperties}
    >
      {renderMarkup(view.resources)}
      {ready ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={renderTooltipBody} /> : null}
      <FocusLayer store={controller.focus} useContextValue={useContextValue}>
        {custom}
      </FocusLayer>
    </div>
  );
}, { displayName: "CandlestickChart" });
