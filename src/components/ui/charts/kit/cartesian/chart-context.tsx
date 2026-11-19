"use client";
// Public bklit chart context (`ChartProvider`, `useChart`, ...) re-expressed over what the native chart reports: data, measured size, margin, resolved domains
// (as d3 scales), series config and the focused row (native `onFocusChange`). Nothing is read from the DOM.
import { createContext, useContext, useMemo } from "react";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type { ScaleLinear } from "d3-scale";
import type { ChartHoverContextValue as CoreChartHoverContextValue, ChartStableContextValue as CoreChartStableContextValue, TooltipData } from "../../core/types/context";
import { DEFAULT_Y_AXIS_ID } from "../../core/cartesian/series";

/** Hover state from `useChartHover()`. It changes whenever the focused row changes. */
export interface ChartHoverContextValue extends CoreChartHoverContextValue<Dispatch<SetStateAction<TooltipData | null>>> {}

/** Chart state from `useChartStable()` that does not change on hover: data, scales, sizes and series. */
export interface ChartStableContextValue extends CoreChartStableContextValue<RefObject<HTMLDivElement | null>> {}

/**
 * Everything from `useChart()`: `ChartStableContextValue` and `ChartHoverContextValue` combined. Prefer the narrower hooks in custom children so they do not re-render on every hover.
 */
export type ChartContextValue = ChartStableContextValue & ChartHoverContextValue;

const StableContext = /* @__PURE__ */ createContext<ChartStableContextValue | null>(null);
const HoverContext = /* @__PURE__ */ createContext<ChartHoverContextValue | null>(null);

const STABLE_KEYS = [
  "data", "renderData", "xScale", "yScale", "yScales", "width", "height", "innerWidth", "innerHeight", "margin", "containerRef",
  "lines", "animationDuration", "isLoaded", "chartPhase", "chartStatus", "yDomainTargetByAxis", "referenceAreas",
  "xAccessor", "dateLabels", "xDomain", "xDomainSlotCount", "columnWidth", "bandWidth", "barScale", "barXAccessor",
  "orientation", "stacked", "stackOffsets", "composedBarDataKeys", "composedBarSize", "composedMaxBarSize", "composedBarGap",
  "composedStacked", "composedStackGap",
] as const satisfies readonly (keyof ChartStableContextValue)[];

/** @internal */
export function ChartProvider({ children, value }: { readonly children: ReactNode; readonly value: ChartContextValue }): ReactNode {
  const { tooltipData, setTooltipData, selection, clearSelection, hoveredBarIndex, setHoveredBarIndex, hoveredCandleIndex, setHoveredCandleIndex, ...rest } = value;
  // The stable slice is rebuilt from field identities, so a focus move does not bust it.
  const stable = useMemo<ChartStableContextValue>(
    () => rest,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    STABLE_KEYS.map((key) => rest[key]),
  );
  const hover = useMemo<ChartHoverContextValue>(
    () => ({ tooltipData, setTooltipData, selection, clearSelection, hoveredBarIndex, setHoveredBarIndex, hoveredCandleIndex, setHoveredCandleIndex }),
    [tooltipData, setTooltipData, selection, clearSelection, hoveredBarIndex, setHoveredBarIndex, hoveredCandleIndex, setHoveredCandleIndex],
  );
  return (
    <StableContext.Provider value={stable}>
      <HoverContext.Provider value={hover}>{children}</HoverContext.Provider>
    </StableContext.Provider>
  );
}

const MISSING =
  " must be used within a ChartProvider. Make sure your component is rendered inside the tooltip content or children of <LineChart> or <AreaChart>.";

export function useChartStable(): ChartStableContextValue {
  const context = useContext(StableContext);
  if (!context) {
    throw new Error(`useChartStable${MISSING}`);
  }
  return context;
}

/** Like `useChartStable`, but `null` outside a chart (standalone loading parts take explicit sizes instead). */
export function useOptionalChartStable(): ChartStableContextValue | null {
  return useContext(StableContext);
}

export function useChartHover(): ChartHoverContextValue {
  const context = useContext(HoverContext);
  if (!context) {
    throw new Error(`useChartHover${MISSING}`);
  }
  return context;
}

/** Merged stable + hover context; re-renders on every focus move. */
export function useChart(): ChartContextValue {
  const stable = useChartStable();
  const hover = useChartHover();
  return useMemo(() => ({ ...stable, ...hover }), [stable, hover]);
}

/** Y-scale for a series axis (`yAxisId` on Line / Area / YAxis). */
export function useYScale(yAxisId?: string | number): ScaleLinear<number, number> {
  const { yScales, yScale } = useChartStable();
  const id = yAxisId == null || yAxisId === "" ? DEFAULT_Y_AXIS_ID : String(yAxisId);
  return yScales[id] ?? yScale;
}
