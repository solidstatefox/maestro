"use client";
// Ring public model: the config carrier (Ring), shared contexts and hooks over core/ring/context.ts, and the child classification.
// bklit-compatible names; RingChart provides the contexts, RingCenter and custom children read them.
import { Children, createContext, isValidElement, memo, useState } from "react";
import type { NamedExoticComponent, ReactElement, ReactNode, RefObject } from "react";
import { useBridgedCoordinator, useHoverValue, useRequiredContext } from "../kit/polar/hover-context";
import type { PolarHoverValue } from "../core/types/polar";
import { CARRIER_ENABLE } from "../core/carriers/roles";
import { RING_MISSING, createRingProviderStable, ringContextValue } from "../core/ring/context";
import { enableRingDecor } from "../core/ring/enable-decor";
import { classifyPolarChildren } from "../kit/polar/polar-hover";
import { displayNameOf } from "../kit/read-children";
import type { HoverSource } from "../core/polar/hover";
import type { RingGridProps, RingLabelsProps, RingProps, RingStableValue as CoreRingStableValue } from "../core/types/ring";

export { defaultRingColors } from "../core/ring/model";

interface RingStableValue extends CoreRingStableValue<RefObject<HTMLDivElement | null>> {}

/** Hover state shared by ring components: the hovered ring index (or `null`) and a setter. */
type RingHoverValue = PolarHoverValue;

/** Everything `useRing` returns: the chart geometry and data, plus the hovered ring index and a setter for it. */
type RingContextValue = RingStableValue & RingHoverValue;

const RingStableContext = /* @__PURE__ */ createContext<RingStableValue | undefined>(undefined);
const RingHoverCoordinatorContext = /* @__PURE__ */ createContext<HoverSource | undefined>(undefined);

/**
 * Returns the ring geometry and data without the hovered index. Use it in custom children that should not re-render on hover. Must be used inside a `RingChart`.
 */
const useRingStable = (): RingStableValue => useRequiredContext(RingStableContext, RING_MISSING);

const useRingHoverCoordinator = (): HoverSource => useRequiredContext(RingHoverCoordinatorContext, RING_MISSING);

/**
 * Returns the hovered ring index (or `null`) and a setter. Re-renders whenever the hovered ring changes. Must be used inside a `RingChart`.
 */
const useRingHover = (): RingHoverValue => useHoverValue(useRingHoverCoordinator());

/**
 * Returns the ring geometry and data together with the hovered ring index and its setter. Must be used inside a `RingChart`.
 */
const useRing = (): RingContextValue => ringContextValue(useRingStable(), useRingHover());

/**
 * Re-provides ring context to a subtree (custom charts reusing RingCenter and friends).
 * @internal
 */
const RingProvider = ({ children, value }: { readonly children: ReactNode; readonly value: RingContextValue }): ReactElement => {
  // Rebuilt only when the ring geometry changes (core/ring/context.ts): the other fields (refs, getters) change identity every render and must not churn consumers.
  const [stableOf] = useState(createRingProviderStable<RefObject<HTMLDivElement | null>>);
  const stable = stableOf(value);
  const coordinator = useBridgedCoordinator(value.hoveredIndex, value.setHoveredIndex);
  return (
    <RingStableContext.Provider value={stable}>
      <RingHoverCoordinatorContext.Provider value={coordinator}>{children}</RingHoverCoordinatorContext.Provider>
    </RingStableContext.Provider>
  );
};

const RingConfig = (_props: Readonly<RingProps>): null => null;
const RingGridConfig = (_props: Readonly<RingGridProps>): null => null;
const RingLabelsConfig = (_props: Readonly<RingLabelsProps>): null => null;

/**
 * A circular grid for a `RingChart` (bklit ring-grid.tsx): spokes across the rings at progress ticks (fractions of each ring's
 * `maxValue`) with tick labels around the outer edge. The chart draws it under the rings and keeps room for its labels (`padding`
 * 32). Enters like the radar grid: the spokes extend outward one after another, then the labels fade in while sliding out from the
 * centre.
 */
// An IIFE, not a bare pure call: a computed key in the call's arguments keeps Bun from dropping an unused one (and its feature with it).
const RingGrid: NamedExoticComponent<Readonly<RingGridProps>> = /* @__PURE__ */ (() => Object.assign(memo(RingGridConfig), { [CARRIER_ENABLE]: enableRingDecor, displayName: "RingGrid" }))();

/**
 * Each ring's label for a `RingChart` (bklit ring-labels.tsx), just before the ring's start and in line with it: beside the start in
 * the open quadrant of a 270° arc, upright along the start edge when the arc starts at 3 or 9 o'clock. Best on partial arcs. A label
 * fades in as its ring starts filling and dims with the rings on hover.
 */
const RingLabels: NamedExoticComponent<Readonly<RingLabelsProps>> = /* @__PURE__ */ (() => Object.assign(memo(RingLabelsConfig), { [CARRIER_ENABLE]: enableRingDecor, displayName: "RingLabels" }))();
/**
 * Configures one ring of a `RingChart`. Render one per data item as a child of the chart; it draws nothing itself and only supplies per-ring options such as `color`, `lineCap` and `animate`.
 */
const Ring: NamedExoticComponent<Readonly<RingProps>> = /* @__PURE__ */ Object.assign(/* @__PURE__ */ memo(RingConfig), { displayName: "Ring" });

interface RingClassification {
  readonly centerChildren: ReactNode[];
  /** The Ring carriers' props, in tree order, as the carrier table holds them (core/ring/controller.ts reads them as `RingProps`). */
  readonly rings: Record<string, unknown>[];
  /** The RingGrid and RingLabels carriers' props, in tree order. */
  readonly grids: Record<string, unknown>[];
  readonly labels: Record<string, unknown>[];
}

/** The props of the children named `name`, each one's feature handed to the core first (core/carriers/roles.ts `CARRIER_ENABLE`). */
const propsOfNamed = (children: ReactNode, name: string): Record<string, unknown>[] =>
  Children.toArray(children).flatMap((child) => {
    if (!(isValidElement<Record<string, unknown>>(child) && displayNameOf(child.type) === name)) {
      return [];
    }
    (child.type as { readonly [CARRIER_ENABLE]?: () => void })[CARRIER_ENABLE]?.();
    return [child.props];
  });

const classifyRingChildren = (children: ReactNode): RingClassification => {
  const { centerChildren, configs } = classifyPolarChildren<Record<string, unknown>>(children, {
    configOf: (child) => (displayNameOf(child.type) === "Ring" && isValidElement<Record<string, unknown>>(child) ? child.props : undefined),
    isCenter: (child) => displayNameOf(child.type) === "RingCenter",
  });
  return { centerChildren, grids: propsOfNamed(children, "RingGrid"), labels: propsOfNamed(children, "RingLabels"), rings: configs };
};

export { Ring, RingGrid, RingLabels, RingHoverCoordinatorContext, RingProvider, RingStableContext, classifyRingChildren, useRing, useRingHover, useRingHoverCoordinator, useRingStable };
export type { RingContextValue, RingStableValue };
