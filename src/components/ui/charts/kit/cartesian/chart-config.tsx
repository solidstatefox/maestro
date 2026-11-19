"use client";
// bklit's chart config + static-preview contexts: plain React contexts whose spring numbers composed children can read (bklit drove motion/react with them);
// the native charts animate with `motion()` tweens and do not consume the springs.
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { DEFAULT_CHART_CONFIG } from "../../core/cartesian/chart-config";
import type { ChartConfigProviderProps as CoreChartConfigProviderProps, ChartConfigValue } from "../../core/types/context";

const ChartConfigContext = /* @__PURE__ */ createContext<ChartConfigValue | null>(null);

/** Props of `ChartConfigProvider`. */
export interface ChartConfigProviderProps extends CoreChartConfigProviderProps<ReactNode> {}

/** Provides spring settings to the charts below it. Values you leave out keep their defaults. */
export function ChartConfigProvider({ value, children }: Readonly<ChartConfigProviderProps>): ReactNode {
  const merged = useMemo<ChartConfigValue>(() => ({ ...DEFAULT_CHART_CONFIG, ...value }), [value]);
  return <ChartConfigContext.Provider value={merged}>{children}</ChartConfigContext.Provider>;
}

/** Returns the spring settings from the nearest `ChartConfigProvider`, or the defaults when there is none. */
export function useChartConfig(): ChartConfigValue {
  return useContext(ChartConfigContext) ?? DEFAULT_CHART_CONFIG;
}

const StaticChartPreviewContext = /* @__PURE__ */ createContext(false);

/**
 * Disables the entrance animation for static docs previews.
 * @internal
 */
export function StaticChartPreviewProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return <StaticChartPreviewContext.Provider value>{children}</StaticChartPreviewContext.Provider>;
}

/** @internal */
export function useStaticChartPreview(): boolean {
  return useContext(StaticChartPreviewContext);
}
