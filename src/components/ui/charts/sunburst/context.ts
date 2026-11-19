"use client";

// React's providers and hooks over the sunburst's contexts (core/sunburst/context.ts builds their values).
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { sunburstHoverValue } from "../core/sunburst/context";
import type { SunburstHoverContextValue, SunburstHoverStore, SunburstStableContextValue } from "../core/sunburst/context";

const SunburstStableContext = /* @__PURE__ */ createContext<SunburstStableContextValue | null>(null);
const SunburstHoverContext = /* @__PURE__ */ createContext<SunburstHoverStore | null>(null);

export const SunburstStableProvider = /* @__PURE__ */ (() => SunburstStableContext.Provider)();
export const SunburstHoverProvider = /* @__PURE__ */ (() => SunburstHoverContext.Provider)();

/** Returns the chart's arcs, focus and `zoomTo`. Call it inside `SunburstChart`; it throws otherwise. */
export const useSunburstStable = (): SunburstStableContextValue => {
  const ctx = useContext(SunburstStableContext);
  if (ctx === null) {
    throw new Error("useSunburstStable must be used within SunburstChart");
  }
  return ctx;
};

/** Returns the hovered arc and setters to change it. Call it inside `SunburstChart`; it throws otherwise. */
export const useSunburstHover = (): SunburstHoverContextValue => {
  const store = useContext(SunburstHoverContext);
  if (store === null) {
    throw new Error("useSunburstHover must be used within SunburstChart");
  }
  const hoveredArcIndex = useSyncExternalStore(store.subscribe, store.get, store.get);
  return useMemo(() => sunburstHoverValue(store, hoveredArcIndex), [hoveredArcIndex, store]);
};
