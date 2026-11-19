"use client";
// React's providers and hooks over the heatmap's context and hover coordinator (core/heatmap/context.ts builds the value and the coordinator).
import { createContext, useCallback, useContext, useMemo } from "react";
import type { CSSProperties, ReactElement, ReactNode, RefObject } from "react";
import { createHeatmapHoverCoordinator, leaveHeatmapBoundary, resolveHeatmapCoordinator } from "../core/heatmap/context";
import type { HeatmapContextValue as CoreHeatmapContextValue, HeatmapHoverCoordinator, HeatmapTooltipConfig as CoreHeatmapTooltipConfig } from "../core/types/heatmap";

/** Config published by a `<HeatmapTooltip>` child (read by scanning the chart's children). */
interface HeatmapTooltipConfig extends CoreHeatmapTooltipConfig<CSSProperties> {}

/** Values the chart shares with its sub-components, as returned by `useHeatmap`. */
interface HeatmapContextValue extends CoreHeatmapContextValue<RefObject<HTMLDivElement | null>, CSSProperties> {}

const HeatmapContext = /* @__PURE__ */ createContext<HeatmapContextValue | undefined>(undefined);

/** Reads the chart's layout, scales and settings. Must be called inside `HeatmapChart`; it throws otherwise. */
const useHeatmap = (): HeatmapContextValue => {
  const ctx = useContext(HeatmapContext);
  if (!ctx) {throw new Error("Heatmap.* components must be rendered inside <HeatmapChart>.");}
  return ctx;
};

const HeatmapInteractionContext = /* @__PURE__ */ createContext<HeatmapHoverCoordinator | null>(null);

const useHeatmapCoordinatorOptional = (): HeatmapHoverCoordinator | null => useContext(HeatmapInteractionContext);

const useHeatmapCoordinator = (): HeatmapHoverCoordinator => {
  const coordinator = useHeatmapCoordinatorOptional();
  if (!coordinator) {
    throw new Error("Heatmap interaction components must be rendered inside <HeatmapInteractionProvider> (HeatmapChart provides one automatically).");
  }
  return coordinator;
};

interface HeatmapInteractionProviderProps {
  readonly children: ReactNode;
  readonly coordinator?: HeatmapHoverCoordinator;
}

/**
 * Shares hover state between a `HeatmapChart` and a `HeatmapLegend` rendered outside it, so hovering a legend level dims the cells of that level.
 * `HeatmapChart` provides one on its own when none surrounds it; add this only to link a separate legend.
 */
const HeatmapInteractionProvider = ({ children, coordinator }: Readonly<HeatmapInteractionProviderProps>): ReactElement => {
  const ownCoordinator = useMemo(() => createHeatmapHoverCoordinator(), []);
  const resolved = resolveHeatmapCoordinator(coordinator ?? null, ownCoordinator);
  return <HeatmapInteractionContext.Provider value={resolved}>{children}</HeatmapInteractionContext.Provider>;
};

interface HeatmapInteractionBoundaryProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * Wrapper element that clears the legend hover when the pointer leaves it. Place it inside `HeatmapInteractionProvider` around the chart and the legend.
 */
// The leave clears only the legend level (core/heatmap/context.ts `leaveHeatmapBoundary`).
const HeatmapInteractionBoundary = ({ children, className, style }: Readonly<HeatmapInteractionBoundaryProps>): ReactElement => {
  const coordinator = useHeatmapCoordinator();
  const handlePointerLeave = useCallback((): void => { leaveHeatmapBoundary(coordinator); }, [coordinator]);
  return (
    <div className={className} style={style} onPointerLeave={handlePointerLeave}>
      {children}
    </div>
  );
};

/** @internal */
const HeatmapProvider = ({ children, value }: { readonly children: ReactNode; readonly value: HeatmapContextValue }): ReactElement => (
  <HeatmapContext.Provider value={value}>{children}</HeatmapContext.Provider>
);

export {
  HeatmapContext,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  HeatmapProvider,
  useHeatmap,
  useHeatmapCoordinatorOptional,
};
export type { HeatmapContextValue, HeatmapTooltipConfig };
