"use client";

// bklit-compatible radar context: lets custom children read geometry and drive hover (bklit exports these hooks publicly). The values are
// core/radar/context.ts's; this file provides and reads them.
import { createContext, useContext, useMemo, useState } from "react";
import { useHoverIndex } from "../kit/polar/polar-hover";
import type { HoverSource } from "../core/polar/hover";
import type { ReactElement, ReactNode } from "react";
import { RADAR_HOVER_MISSING, RADAR_STABLE_MISSING, createRadarProviderValue, radarContextValue, radarHoverValue } from "../core/radar/context";
import type { RadarHoverHandle, RadarProviderValue } from "../core/radar/context";
import type { RadarContextValue, RadarHoverContextValue, RadarStableContextValue } from "../core/types/radar";

export { radarCssVars } from "../core/radar/context";

const StableContext = /* @__PURE__ */ createContext<RadarStableContextValue | null>(null);
const HoverContext = /* @__PURE__ */ createContext<RadarHoverHandle | null>(null);

/** @internal */
export const RadarProvider = ({ children, value, source }: { children: ReactNode; value: RadarProviderValue; source: HoverSource }): ReactElement => {
  // Nothing here reads the hovered index: the provider value only holds the store reference, so a hover never re-renders
  // this component or anything wrapped by it. The hook consumers (leaves) subscribe through useHoverIndex.
  const [valuesOf] = useState(createRadarProviderValue);
  const { stable, hover } = valuesOf(value, source);
  return (
    <StableContext.Provider value={stable}>
      <HoverContext.Provider value={hover}>{children}</HoverContext.Provider>
    </StableContext.Provider>
  );
};

/**
 * Returns the radar geometry and data without the hovered index. Use it in custom children that should not re-render on hover. Must be used inside a `RadarChart`.
 */
export const useRadarStable = (): RadarStableContextValue => {
  const context = useContext(StableContext);
  if (!context) { throw new Error(RADAR_STABLE_MISSING); }
  return context;
};

/**
 * Returns the hovered series index (or `null`) and a setter. Re-renders whenever the hovered series changes. Must be used inside a `RadarChart`.
 */
export const useRadarHover = (): RadarHoverContextValue => {
  const context = useContext(HoverContext);
  if (!context) { throw new Error(RADAR_HOVER_MISSING); }
  const hoveredIndex = useHoverIndex(context.source);
  return useMemo(() => radarHoverValue(hoveredIndex, context.setHoveredIndex), [hoveredIndex, context.setHoveredIndex]);
};

/**
 * Returns the radar geometry and data together with the hovered series index and its setter. Must be used inside a `RadarChart`.
 */
export const useRadar = (): RadarContextValue => {
  const stable = useRadarStable();
  const hover = useRadarHover();
  return useMemo(() => radarContextValue(stable, hover), [stable, hover]);
};
