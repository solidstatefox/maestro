"use client";
// The radial chart's context in React: the chart provides its controller (core/radial/controller.ts); `useRadialChart()` and the views
// (RadialCenter, RadialLegend) subscribe to its stores, so a hover re-renders only them. The angle hooks and RadialHoverDot let a custom
// layer ride the crosshair as the kit's own dots do.
import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, SVGProps } from "react";
import { RADIAL_MISSING } from "../core/radial/context";
import type { RadialChartContextValue } from "../core/radial/context";
import type { RadialController } from "../core/radial/controller";
import { polarToCartesian } from "../core/radial/geometry";
import { RADIAL_CROSSHAIR_SPRING, RADIAL_DOT_SPRING, createRadialAngleSpring } from "../core/radial/spring";
import type { RadialAngleSpringInput } from "../core/radial/spring";
import type { Readable } from "../core/store";
import type { RadialAngleValue, RadialDotMotion, RadialEdgeLookup, RadialSpringOptions } from "../core/types/radial";

export const RadialControllerContext = /* @__PURE__ */ createContext<RadialController | null>(null);

/** The chart's controller (its views read their stores). */
export const useRadialController = (): RadialController => {
  const controller = useContext(RadialControllerContext);
  if (controller === null) {
    throw new Error(RADIAL_MISSING);
  }
  return controller;
};

/** A store's value, followed. */
export const useReadable = <T,>(store: Readable<T>): T => useSyncExternalStore(store.subscribe, store.get, store.get);

/**
 * The radial chart's shared state: its geometry (`radius`, `innerRadius`, `outerRadius`, `centerRadius`, `layout`), angles (`binAngle`,
 * `binStartAngle`, `angleToBin`, `fractionToAngle`, `timeToAngle`), the value scale (`valueDomain`, `valueScale`, `valueToAngle`, `ringBand`),
 * the hover (`hoveredIndex`, `hoveredSeries` and their setters), `futureBins`, `nowIndex`, `totals`, the crosshair and the enter flag
 * (`revealed`). Re-renders on every hover. Must be used inside a `RadialChart`.
 */
export const useRadialChart = (): RadialChartContextValue => useReadable(useRadialController().context);

/**
 * An angle that springs toward `angle`, taking the short way round on full circles. While `hidden` it holds still; leaving hidden jumps
 * straight to the target; `snap` (reduced motion) jumps on every change. Read it with `get()` or follow it with `on("change", …)`.
 */
export function useRadialAngleSpring({ angle, hidden, isFullCircle, snap, spring = RADIAL_CROSSHAIR_SPRING }: RadialAngleSpringInput & { readonly spring?: RadialSpringOptions }): RadialAngleValue {
  const [own] = useState(() => createRadialAngleSpring({ angle, hidden, isFullCircle, snap }, spring));
  // A layout effect: the hover dots read the jump before the first paint.
  useLayoutEffect(() => {
    own.follow({ angle, hidden, isFullCircle, snap });
  }, [own, angle, hidden, isFullCircle, snap]);
  useLayoutEffect(() => () => { own.value.destroy(); }, [own]);
  return own.value;
}

/**
 * The animated angle of a hover dot: `"crosshair"` is the chart's crosshair; `"spring"` and `"none"` run the dot's own spring (`"none"` and
 * reduced motion snap). Must be used inside a `RadialChart`.
 */
export function useRadialDotAngle(motion: RadialDotMotion, spring: RadialSpringOptions = RADIAL_DOT_SPRING): RadialAngleValue {
  const { crosshairAngle, hoveredIndex, binAngle, isFullCircle, reducedMotion } = useRadialChart();
  const own = useRadialAngleSpring({ angle: binAngle(hoveredIndex ?? 0), hidden: hoveredIndex === null || motion === "crosshair", isFullCircle, snap: motion === "none" || reducedMotion, spring });
  return motion === "crosshair" ? crosshairAngle : own;
}

/** Props of `RadialHoverDot`: the animated angle, the edge it rides, and any circle attribute but its position. */
export type RadialHoverDotProps = { readonly angle: RadialAngleValue; readonly lookup: RadialEdgeLookup } & Omit<SVGProps<SVGCircleElement>, "cx" | "cy" | "ref" | "visibility">;

/**
 * A hover dot that rides an edge at an animated angle: its position is written to the DOM as the angle moves (no render per frame), and it
 * hides where the edge has no point (gaps, partial runs). Render it in a `RadialChart` (a custom layer's SVG is drawn centred on the chart).
 */
export function RadialHoverDot({ angle, lookup, ...props }: RadialHoverDotProps): ReactElement {
  const ref = useRef<SVGCircleElement>(null);
  useLayoutEffect(() => {
    const apply = (a: number): void => {
      const el = ref.current;
      if (!el) {
        return;
      }
      const r = lookup(a);
      if (r === null) {
        el.setAttribute("visibility", "hidden");
        return;
      }
      const p = polarToCartesian(a, r);
      el.removeAttribute("visibility");
      el.setAttribute("cx", String(p.x));
      el.setAttribute("cy", String(p.y));
    };
    apply(angle.get());
    return angle.on("change", apply);
  }, [angle, lookup]);
  const r = lookup(angle.get());
  const initial = r === null ? null : polarToCartesian(angle.get(), r);
  return <circle {...props} cx={initial?.x ?? 0} cy={initial?.y ?? 0} ref={ref} visibility={initial ? undefined : "hidden"} />;
}
