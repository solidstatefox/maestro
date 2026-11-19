"use client";
// Bklit PieChart: React's adapter over the pie controller (core/pie/controller.ts), which builds the native radialArc slices inside polar() from
// the props and the PieSlice children and hosts them with motion()'s staggered entrance, the fluid width, the hover and the focus listeners.
// The adapter calls it at the phases the shell ran that work in: `prepare` while rendering, `connect` as the host's ref, `update` after every
// commit (layout), `attach` / `detach` around the chart's surface (layout, while the view has one), `committed` after every commit's paint
// (passive). It renders the host, the owned <style>, the surface, the reader's defs and the centre overlay; hover never re-renders it.
import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createPieController } from "./core/pie/controller";
import type { PieController } from "./core/pie/controller";
import { PIE_SLICE_ROLE } from "./core/pie/view";
import { warnOnce } from "./core/carriers/registry";
import type { ChildTable } from "./core/carriers/table";
import { CENTER_OVERLAY_STYLE } from "./core/polar/layout";
import { toCamel } from "./core/style";
import type { PieChartProps as CorePieChartProps } from "./core/types/pie";
export type { PieSliceHoverEffect } from "./core/types/pie";
import { ControllerSurface } from "./runtime/surface";
import { renderMarkup } from "./runtime/markup";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { ResourceHost, scopeResourceIds } from "./kit/resource-host";
import { useSanitizedId } from "./kit/use-sanitized-id";
import { PieHoverCoordinatorContext, PieStableContext } from "./pie/model";
import { classifyPolarChildren } from "./kit/polar/polar-hover";
import { displayNameOf, readChildren, roleOfType } from "./kit/read-children";
import { useIsClient } from "./kit/size/use-is-client";

export { DEFAULT_HOVER_OFFSET } from "./core/pie/model";

const CENTER_OVERLAY: CSSProperties = /* @__PURE__ */ toCamel(CENTER_OVERLAY_STYLE);

const isPieCenterElement = (child: Readonly<ReactNode>): boolean => isValidElement(child) && displayNameOf(child.type) === "PieCenter";
/** A PieSlice's props are a plain record of its options, which the controller reads back as PieSliceProps (`propsFor`). */
type SliceRecord = Readonly<Record<string, unknown>>;

const isPieSliceElement = (child: Readonly<ReactNode>): child is ReactElement<SliceRecord> => isValidElement(child) && displayNameOf(child.type) === "PieSlice";
/** A pattern (or another resource component) for the defs host. A gradient carrier (LinearGradient, RadialGradient, a preset) is read into the
 * table instead: the definition draws it (core/pie/definition.ts `gradients`), and its element renders nothing. */
const isDefsComponent = (child: Readonly<ReactElement>): boolean => {
  const name = displayNameOf(child.type) ?? "";
  return (name.includes("Gradient") && roleOfType(child.type) === undefined) || name.includes("Pattern");
};

/** The pie draws no tooltip (its centre reports values). */
const noTooltipBody = (): null => null;

/** Re-renders on a change from inside (a measured width) on the default lane, as useFluidWidth's state copy did (ParentSize's own setState),
 * where a `useSyncExternalStore` read would commit synchronously. The render reads the view after `prepare`. */
const useViewCommits = (controller: PieController): void => {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => controller.view.subscribe(() => { setVersion((version) => version + 1); }), [controller]);
};

/** Props for `PieChart`. */
interface PieChartProps extends CorePieChartProps<ReactNode, CSSProperties> {}

/**
 * Pie or donut chart. Add one `PieSlice` per data item as children to configure slices, and a `PieCenter` (donut only) to show the total.
 * Hovering or keyboard-focusing a slice pops it out, dims the others and shows that slice's label and value in the centre instead of a tooltip.
 * The pie is drawn on the client after mount; on the server it renders an empty, correctly sized shell.
 */
const PieChart = /* @__PURE__ */ Object.assign(function PieChart(props: Readonly<PieChartProps>): ReactElement {
  const { className, style, children } = props;
  const client = useIsClient();
  const uid = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  // The table follows the children's identity, as the shell's classification did: a parent's render hands the chart new PieSlice props.
  const { centerChildren, defsChildren, configs } = useMemo(() => classifyPolarChildren<SliceRecord>(children, {
    configOf: (child): SliceRecord | undefined => (isPieSliceElement(child) ? child.props : undefined),
    isCenter: isPieCenterElement,
    isDefs: isDefsComponent,
  }), [children]);
  const table = useMemo((): ChildTable => new Map([...readChildren(children), [PIE_SLICE_ROLE, configs]]), [children, configs]);
  const input = { props: { ...props, client }, table };
  const [controller] = useState(() => createPieController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input);
  useViewCommits(controller);
  const view = controller.view.get();
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The host's ref: the controller takes it when React attaches it (a fluid pie measures it before the chart mounts).
  const connect = useCallback((host: HTMLDivElement | null): void => {
    hostRef.current = host;
    controller.connect(host);
  }, [controller]);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const shown = view.surfaceStyle !== null;
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did, and re-attaches the width follow.
  useLayoutEffect(() => { controller.update(input); });
  // The renderer mounts with the surface (on the client, once measured, not collapsed) and is destroyed with it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!shown || !host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface });
    return () => { controller.detach(); };
  }, [controller, shown]);
  useEffect(() => { controller.committed(); });
  const hostStyle = useMemo((): CSSProperties => ({ ...toCamel(view.hostStyle), ...style }), [view.hostStyle, style]);

  if (view.collapsed) {
    return <div className={className} {...view.hostAttrs} ref={connect} style={hostStyle} />;
  }

  return (
    <div className={className} {...view.hostAttrs} ref={connect} style={hostStyle}>
      {renderMarkup(view.ownedStyle)}
      <PieStableContext.Provider value={controller.stable.get()}>
        <PieHoverCoordinatorContext.Provider value={controller.hover}>
          {view.surfaceStyle ? <ControllerSurface prerender={controller.prerender} renderTooltipBody={noTooltipBody} style={view.surfaceStyle} surfaceRef={surfaceRef} tooltip={controller.tooltip} /> : null}
          <ResourceHost idPrefix={uid} resources={scopeResourceIds(defsChildren, uid)} />
          {centerChildren.length === 0 ? null : <div style={CENTER_OVERLAY}>{centerChildren}</div>}
        </PieHoverCoordinatorContext.Provider>
      </PieStableContext.Provider>
    </div>
  );
}, { displayName: "PieChart" });

export { PieChart };
export type { PieChartProps };
