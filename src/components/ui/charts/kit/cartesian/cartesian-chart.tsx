import { RevealArm } from "../entrance/reveal-arm";
import { useRenderStart } from "../entrance/entrance-align";
import { useHydratingAttrs } from "../use-hydrating";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { ControllerSurface } from "../../runtime/surface";
import { renderMarkup } from "../../runtime/markup";
import { createCartesianController } from "../../core/cartesian/controller";
import type { CartesianController, CartesianProps } from "../../core/cartesian/controller";
import { brushPanesShown } from "../../core/cartesian/view";
import type { MarkupNode } from "../../core/markup/node";
import { markerListsFor } from "../../core/cartesian/features";
import { propsFor } from "../../core/carriers/table";
import type { ChildTable } from "../../core/carriers/table";
import { warnOnce } from "../../core/carriers/registry";
import type { PlotStore } from "../../core/cartesian/plot-size";
import { erase } from "../../core/erased-types";
import { toCamel } from "../../core/style";
import { LegendHostSync } from "./hover-host";
import { LoadingLabel } from "../loading-label";
import { LoadingSweepOverlays } from "./loading-sweep-overlays";
import { useSanitizedId } from "../use-sanitized-id";
import { useChartConfig, useStaticChartPreview } from "./chart-config";
import { FocusLayer } from "./focus-layer";
import { useChildTable } from "../stable-children";
import { usePlotSnapshot } from "./plot-size";
import { BklitTooltipBody, bklitTooltipOptions } from "../tooltip/tooltip-body";
import type { ChartMarker } from "../types";
import type { ChartContextValue } from "./chart-context";

interface CartesianChartProps extends CartesianProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/** The event markers of the ChartMarkers / MarkerGroup children, for the tooltip's marker rows. */
// SAFETY: the table holds the props React's carriers were given, so their markers are React's (`icon` and `content` are React nodes).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
const reactMarkers = (table: ChildTable): readonly ChartMarker[] => markerListsFor(table).flat() as readonly ChartMarker[];

/** The brush strip's panes (core/cartesian/view.ts `brushPanes`), mounted with the size the draw published. */
const BrushPanes = ({ panes, store }: Readonly<{ panes: readonly MarkupNode[]; store: PlotStore }>): ReactNode => (brushPanesShown(usePlotSnapshot(store)) ? renderMarkup(panes) : null);

/** The hook <FocusLayer> calls: the controller's public context, at the size the draw published and the focused row. */
const contextHookOf = (controller: CartesianController) =>
  function useContextValue(): ChartContextValue {
    return useSyncExternalStore(controller.context.subscribe, controller.context.get, controller.context.get);
  };

export function CartesianChart(props: Readonly<CartesianChartProps>): ReactElement {
  const { className, style, children } = props;
  const uid = `c${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  const { table, custom, ready } = useChildTable(children);
  const input = { props, table };
  const [controller] = useState(() => createCartesianController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  // A status or data change adjusts the phase and the data step in this render (react.dev "adjusting state on a prop change"), so no stale phase commits.
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
  const tooltipOptions = bklitTooltipOptions(propsFor<Parameters<typeof bklitTooltipOptions>[0] & object>(view.table, "tooltip")[0], view.data, { ...view.tooltipBase, markers: reactMarkers(view.table) });
  const tooltipOptionsRef = useRef(tooltipOptions);
  tooltipOptionsRef.current = tooltipOptions;
  const renderTooltipBody = useCallback(
    ({ points, pinned, dismiss }: ChartTooltipBodyRenderContext) => <BklitTooltipBody points={erase(points)} options={tooltipOptionsRef.current} pinned={pinned} dismiss={dismiss} />,
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
      style={{ ...toCamel(view.hostStyle), ...style, ...(view.hostLoadingStyle ? toCamel(view.hostLoadingStyle) : null) } as CSSProperties}
    >
      {renderMarkup(view.resources)}
      <LegendHostSync hostRef={hostRef} />
      <RevealArm hostRef={hostRef} onArm={controller.arm} />
      {ready ? <ControllerSurface surfaceRef={surfaceRef} style={view.surfaceStyle} prerender={controller.prerender} tooltip={controller.tooltip} renderTooltipBody={renderTooltipBody} /> : null}
      {view.sweep ? <LoadingSweepOverlays series={view.sweep.series} exiting={view.sweep.exiting} margin={view.sweep.margin} store={controller.plot} /> : null}
      {view.loadingLabel ? <LoadingLabel text={view.loadingLabel.text} exiting={view.loadingLabel.exiting} /> : null}
      {view.brushPanes ? <BrushPanes panes={view.brushPanes} store={controller.plot} /> : null}
      <FocusLayer store={controller.focus} useContextValue={useContextValue}>
        {custom}
      </FocusLayer>
    </div>
  );
}
