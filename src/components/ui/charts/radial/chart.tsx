"use client";
// Bklit RadialChart: React's adapter over the radial controller (core/radial/controller.ts), which folds the layer carriers into one native
// polar definition on TanStack's svg renderer and runs the stage's measure, the overlay, the entrance, the hover and the context. The adapter
// renders the host, the stage and its surface (the controller draws into it), a custom layer's SVG (children that aren't the kit's, drawn
// centred on the chart), and RadialCenter / RadialLegend under the chart's context; hover never re-renders it.
import { Children, Fragment, isValidElement, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createCarrierRegistry, warnOnce } from "../core/carriers/registry";
import { CHART_ROLE } from "../core/carriers/roles";
import type { ChartClock } from "../core/chart/controller";
import { cn } from "../core/cn";
import { createRadialController } from "../core/radial/controller";
import type { RadialControllerProps } from "../core/radial/controller";
import { toCamel } from "../core/style";
import type { RadialChartProps as CoreRadialChartProps } from "../core/types/radial";
import { useChartConfig, useStaticChartPreview } from "../kit/cartesian/chart-config";
import { displayNameOf, readChildren } from "../kit/read-children";
import { useSanitizedId } from "../kit/use-sanitized-id";
import { RadialControllerContext, useRadialChart, useReadable } from "./context";

/** Props of `RadialChart`. */
interface RadialChartProps extends CoreRadialChartProps<ReactNode> {}

/** The kit's views that render as HTML around the chart (the centre over the hole, the legend below), not in the custom layer's SVG. */
const HTML_VIEWS: ReadonlySet<string> = /* @__PURE__ */ new Set(["RadialCenter", "RadialLegend"]);

const isCarrier = (type: unknown): boolean => (typeof type === "function" || (typeof type === "object" && type !== null)) && CHART_ROLE in (type as object);

/** The children that are neither carriers nor the kit's HTML views: a custom layer's SVG (bklit-ui draws them in the chart's centred group). */
const splitChildren = (children: ReactNode): { readonly html: ReactNode[]; readonly svg: ReactNode[] } => {
  const html: ReactNode[] = [];
  const svg: ReactNode[] = [];
  const walk = (node: ReactNode): void => {
    Children.forEach(node, (child) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) {
        return;
      }
      if (child.type === Fragment) {
        walk(child.props.children);
        return;
      }
      if (isCarrier(child.type) || HTML_VIEWS.has(displayNameOf(child.type) ?? "")) {
        html.push(child);
      } else {
        svg.push(child);
      }
    });
  };
  walk(children);
  return { html, svg };
};

/** A custom layer's SVG, centred on the chart (over its layers; it takes no pointer events). */
const CustomLayer = ({ children }: { readonly children: ReactNode }): ReactElement | null => {
  const { radius, stage } = useRadialChart();
  if (radius <= 0) {
    return null;
  }
  return (
    <svg aria-hidden="true" className="bkm-rd-custom">
      <g transform={`translate(${stage.cx},${stage.cy})`}>{children}</g>
    </svg>
  );
};

/**
 * A square, responsive radial chart: 24-hour clocks, categories and time series around a circle or a partial arc, and angular ring bars.
 * It owns the shared geometry, the value scale, hover by angle (or by ring, pointer and keyboard), the legend hover and the entrance; its
 * layers (`RadialAxis`, `RadialDotBar`, `RadialBar`, `RadialRingBar`, `RadialLine`, `RadialArea`, `RadialScrubber`) draw in the order
 * written, `RadialCenter` over the hole and `RadialLegend` below. The chart draws on the client once its stage is measured; the server
 * reserves its box.
 */
const RadialChart = /* @__PURE__ */ Object.assign(function RadialChart(props: Readonly<RadialChartProps>): ReactElement {
  const { className, children } = props;
  const uid = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const [registry] = useState(createCarrierRegistry);
  const table = useMemo(() => {
    registry.setStatic(readChildren(children));
    return registry.table();
  }, [registry, children]);
  const { html, svg } = useMemo(() => splitChildren(children), [children]);
  const controllerProps = useMemo((): RadialControllerProps => {
    const { children: _children, className: _className, ...rest } = props;
    return rest;
  }, [props]);
  const input = useMemo(() => ({ props: controllerProps, table }), [controllerProps, table]);
  const [controller] = useState(() => createRadialController({ uid, staticPreview, config, warn: warnOnce }, input));
  const view = useReadable(controller.view);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [clock] = useState((): ChartClock => ({ renderStart: typeof performance === "undefined" ? 0 : performance.now() }));
  useLayoutEffect(() => {
    controller.update(input);
  }, [controller, input]);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, clock);
    return () => {
      controller.detach();
    };
  }, [controller, clock]);
  const hostStyle = useMemo((): CSSProperties => toCamel(view.hostStyle), [view.hostStyle]);
  const stageStyle = useMemo((): CSSProperties => toCamel(view.stageStyle), [view.stageStyle]);
  return (
    <RadialControllerContext.Provider value={controller}>
      <div className={cn("bkm-rd", className)} {...view.hostAttrs} ref={hostRef} style={hostStyle}>
        <div className="bkm-rd-stage" style={stageStyle}>
          <div className="bkm-rd-surface" ref={surfaceRef} />
          {svg.length > 0 ? <CustomLayer>{svg}</CustomLayer> : null}
        </div>
        {html}
      </div>
    </RadialControllerContext.Provider>
  );
}, { displayName: "RadialChart" });

export { RadialChart };
export type { RadialChartProps };
