"use client";
// Pie public model: the config carrier (PieSlice), shared contexts and hooks over core/pie/context.ts.
// bklit-compatible names; PieChart provides the contexts, PieCenter and custom children read them.
import { createContext, memo, useState } from "react";
import type { NamedExoticComponent, ReactElement, ReactNode, RefObject } from "react";
import { useBridgedCoordinator, useHoverValue, useRequiredContext } from "../kit/polar/hover-context";
import type { PolarHoverValue } from "../core/types/polar";
import { PIE_MISSING, createPieProviderStable, pieContextValue } from "../core/pie/context";
import type { HoverSource } from "../core/polar/hover";
import type { PieSliceProps, PieStableValue as CorePieStableValue } from "../core/types/pie";

export { defaultPieColors } from "../core/pie/model";

interface PieStableValue extends CorePieStableValue<RefObject<HTMLDivElement | null>> {}

/** Hover state shared by pie components: the hovered slice index (or `null`) and a setter. */
type PieHoverValue = PolarHoverValue;

/** Everything `usePie` returns: the chart geometry and data, plus the hovered slice index and a setter for it. */
type PieContextValue = PieStableValue & PieHoverValue;

const PieSliceCarrier = (_props: Readonly<PieSliceProps>): null => null;
/**
 * Configures one slice of a `PieChart`. Render one per data item as a child of the chart; it draws nothing itself and only supplies per-slice options such as `hoverEffect`, `fill` and `animate`.
 */
const PieSlice: NamedExoticComponent<Readonly<PieSliceProps>> = /* @__PURE__ */ Object.assign(/* @__PURE__ */ memo(PieSliceCarrier), { displayName: "PieSlice" });

const PieStableContext = /* @__PURE__ */ createContext<PieStableValue | null>(null);
const PieHoverCoordinatorContext = /* @__PURE__ */ createContext<HoverSource | null>(null);

/**
 * Returns the pie geometry and data without the hovered index. Use it in custom children that should not re-render on hover. Must be used inside a `PieChart`.
 */
const usePieStable = (): PieStableValue => useRequiredContext(PieStableContext, PIE_MISSING);

const usePieHoverCoordinator = (): HoverSource => useRequiredContext(PieHoverCoordinatorContext, PIE_MISSING);

/**
 * Returns the hovered slice index (or `null`) and a setter. Re-renders whenever the hovered slice changes. Must be used inside a `PieChart`.
 */
const usePieHover = (): PieHoverValue => useHoverValue(usePieHoverCoordinator());

/**
 * Returns the pie geometry and data together with the hovered slice index and its setter. Must be used inside a `PieChart`.
 */
const usePie = (): PieContextValue => pieContextValue(usePieStable(), usePieHover());

/**
 * Re-provides pie context to a subtree (custom charts reusing PieCenter and friends).
 * @internal
 */
const PieProvider = ({ children, value }: { readonly children: ReactNode; readonly value: PieContextValue }): ReactElement => {
  const [stableOf] = useState(createPieProviderStable<RefObject<HTMLDivElement | null>>);
  const stable = stableOf(value);
  const coordinator = useBridgedCoordinator(value.hoveredIndex, value.setHoveredIndex);
  return (
    <PieStableContext.Provider value={stable}>
      <PieHoverCoordinatorContext.Provider value={coordinator}>{children}</PieHoverCoordinatorContext.Provider>
    </PieStableContext.Provider>
  );
};

export { PieHoverCoordinatorContext, PieProvider, PieSlice, PieStableContext, usePie, usePieHover, usePieHoverCoordinator, usePieStable };
export type { PieContextValue, PieStableValue };
