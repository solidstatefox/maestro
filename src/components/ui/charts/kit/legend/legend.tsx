"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";
import { chartLegendHoverValue, NO_LEGEND_HOVER, NO_PROFIT_LOSS_HOVER, profitLossLegendHoverValue } from "../../core/legend/store";
import type { ChartLegendHoverValue, ProfitLossLegendHoverValue } from "../../core/legend/store";

const ChartLegendHoverContext = /* @__PURE__ */ createContext<ChartLegendHoverValue | null>(null);

/** Returns `{ hoveredIndex, setHoveredIndex }` from the nearest `ChartLegendHoverProvider`, or a no-op value outside one. */
export const useChartLegendHover = (): ChartLegendHoverValue =>
  useContext(ChartLegendHoverContext) ?? NO_LEGEND_HOVER;

/**
 * Shares a hovered series index between a legend and the charts below the provider. The chart dims every series except the one at `hoveredIndex` (the position of the series in the chart, matching the legend's item order), or dims nothing for `null`. `onHoverChange` is called when the legend changes the hover.
 */
export const ChartLegendHoverProvider = ({
  hoveredIndex,
  onHoverChange,
  children,
}: {
  hoveredIndex: number | null;
  onHoverChange: (index: number | null) => void;
  children: ReactNode;
}): ReactElement => {
  const value = useMemo(() => chartLegendHoverValue(hoveredIndex, onHoverChange), [hoveredIndex, onHoverChange]);
  return <ChartLegendHoverContext.Provider value={value}>{children}</ChartLegendHoverContext.Provider>;
};

const ProfitLossLegendHoverContext = /* @__PURE__ */ createContext<ProfitLossLegendHoverValue | null>(null);

/**
 * Shares the hovered `ProfitLossLegend` item with a `ProfitLossLine` below the provider: `hoveredIndex` `0` dims the loss segments, `1` dims the profit segments, `null` dims nothing.
 */
export const ProfitLossLegendHoverProvider = ({
  hoveredIndex,
  children,
}: {
  hoveredIndex: number | null;
  children: ReactNode;
}): ReactElement => {
  const value = useMemo(() => profitLossLegendHoverValue(hoveredIndex), [hoveredIndex]);
  return <ProfitLossLegendHoverContext.Provider value={value}>{children}</ProfitLossLegendHoverContext.Provider>;
};

/** Returns `{ hoveredIndex }` from the nearest `ProfitLossLegendHoverProvider`, or `null` outside one. */
export const useProfitLossLegendHover = (): ProfitLossLegendHoverValue =>
  useContext(ProfitLossLegendHoverContext) ?? NO_PROFIT_LOSS_HOVER;
