import { memoCell } from "../memo";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import type {
  HeatmapContextValue,
  HeatmapHoverCoordinator,
  HeatmapHoveredCell,
  HeatmapInteractionState,
  HeatmapMargin,
  HeatmapSeparatorStyle,
  HeatmapTooltipConfig,
  HeatmapTooltipData,
  HeatmapYAxisConfig,
} from "../types/heatmap";
import type { HeatmapLevelStyles } from "./colors";
import { getHeatmapTimeExtent } from "./columns";
import type { HeatmapColumn } from "./columns";
import type { HeatmapWeekStartDay } from "./day-labels";
import { columnStartX } from "./definition";
import type { HeatmapEnterTransition } from "./motion";
import { linearScale, timeScale } from "./scales";
import type { HeatmapLinearScale, HeatmapTimeScale } from "./scales";
import type { HeatmapSeparatorLayout } from "./separators";

export const DEFAULT_MARGIN: HeatmapMargin = { bottom: 0, left: 40, right: 16, top: 28 };

export const HEATMAP_INACTIVE_OPACITY = 0.3;
/** The legend swatches' hover fade: bklit 0.22s cubic-bezier(0.4, 0, 0.2, 1); the snappy variant: the hover profile. */
export const HEATMAP_INACTIVE_TRANSITION_CSS = HOVER_TRANSITION_CSS;

const EMPTY_INTERACTION: HeatmapInteractionState = { hoveredCell: null, hoveredLegendLevel: null, tooltipData: null };

const sameGridPosition = (prev: HeatmapHoveredCell, next: HeatmapHoveredCell): boolean => prev.column === next.column && prev.row === next.row;

const sameCell = (prev: HeatmapHoveredCell | null, next: HeatmapHoveredCell | null): boolean =>
  prev === next || (prev !== null && next !== null && sameGridPosition(prev, next));

const sameTooltipData = (prev: HeatmapTooltipData, next: HeatmapTooltipData): boolean => sameGridPosition(prev, next) && prev.count === next.count;

const sameTooltip = (prev: HeatmapTooltipData | null, next: HeatmapTooltipData | null): boolean =>
  prev === next || (prev !== null && next !== null && sameTooltipData(prev, next));

const isBlank = (state: HeatmapInteractionState): boolean => state.hoveredCell === null && state.hoveredLegendLevel === null && state.tooltipData === null;

export const createHeatmapHoverCoordinator = (): HeatmapHoverCoordinator => {
  let state = EMPTY_INTERACTION;
  const listeners = new Set<() => void>();
  const commit = (next: HeatmapInteractionState): void => {
    if (next === state) {return;}
    state = next;
    for (const listener of listeners) {listener();}
  };
  return {
    clearInteraction: () => { commit(state === EMPTY_INTERACTION || isBlank(state) ? state : EMPTY_INTERACTION); },
    getHoveredCell: () => state.hoveredCell,
    getHoveredLegendLevel: () => state.hoveredLegendLevel,
    getSnapshot: () => state,
    getTooltipData: () => state.tooltipData,
    setHoveredCell: (cell) => { commit(sameCell(state.hoveredCell, cell) ? state : { ...state, hoveredCell: cell }); },
    setHoveredLegendLevel: (level) => { commit(state.hoveredLegendLevel === level ? state : { ...state, hoveredLegendLevel: level }); },
    setTooltipData: (data) => { commit(sameTooltip(state.tooltipData, data) ? state : { ...state, tooltipData: data }); },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
};

/** The coordinator a chart uses: the one an enclosing interaction provider shares, else its own. */
export const resolveHeatmapCoordinator = (upstream: HeatmapHoverCoordinator | null, own: HeatmapHoverCoordinator): HeatmapHoverCoordinator => upstream ?? own;

// The hovered cell and tooltip mirror the renderer's focus (`onFocusChange`), which drops a pointer-owned
// focus on leave and keeps a keyboard-held one until blur, so leave never clears them here.
// The legend swatches live outside the chart surface, hence the legend level is cleared here.
/** The interaction boundary's pointer leave: clears the legend level a separate `HeatmapLegend` published. */
export const leaveHeatmapBoundary = (coordinator: HeatmapHoverCoordinator): void => {
  coordinator.setHoveredLegendLevel(null);
};

type ChartStatus = HeatmapContextValue<unknown, unknown>["chartStatus"];

/** What a chart's pass hands the context (pass.ts `context`): everything but the container ref. */
export interface HeatmapContextFields<Style> {
  readonly animateCells: boolean;
  readonly animationDuration: number;
  readonly ariaDescription: string | undefined;
  readonly ariaLabel: string | undefined;
  readonly cellSize: number;
  readonly status: ChartStatus;
  readonly colorScale: (count: number | null | undefined) => string;
  /** Whether the chart was handed its own `colorScale`. */
  readonly hasCustomColorScale: boolean;
  readonly columnCount: number;
  /** The week columns drawn (filtered and rotated). */
  readonly columns: HeatmapColumn[];
  readonly enterStaggerScale: number;
  readonly enterTransition: HeatmapEnterTransition | undefined;
  readonly fillScale: (count: number | null | undefined) => string;
  readonly gap: number;
  /** The chart's height (margins included). */
  readonly height: number;
  readonly innerHeight: number;
  readonly innerWidth: number;
  /** Whether the chart is large enough to draw. */
  readonly isRenderable: boolean;
  readonly levelStyles: HeatmapLevelStyles;
  readonly loadingCellMaxOpacity: number;
  readonly loadingCellRandomness: number;
  readonly loadingLabel: string | undefined;
  readonly loadingOpacity: number;
  readonly margin: HeatmapMargin;
  readonly revealEpoch: number;
  readonly rowCount: number;
  readonly separator: HeatmapSeparatorStyle | null;
  readonly separatorLayout: HeatmapSeparatorLayout | null;
  readonly showLoadingCells: boolean;
  readonly tooltip: HeatmapTooltipConfig<Style> | null;
  readonly weekStartDay: HeatmapWeekStartDay;
  /** The chart's width (margins included). */
  readonly width: number;
  readonly yAxis: HeatmapYAxisConfig;
}

export interface HeatmapContextInput<Ref, Style> extends HeatmapContextFields<Style> {
  /** The framework's ref to the chart's host (React's `RefObject`), handed out as is. */
  readonly containerRef: Ref;
}

const NO_TIME_EXTENT: [Date, Date] = [/* @__PURE__ */ new Date(0), /* @__PURE__ */ new Date(0)];

/** One builder per chart, fed on every pass: the overlay scales and the `useHeatmap()` value. */
export function createHeatmapContext<Ref, Style>(): (input: HeatmapContextInput<Ref, Style>) => HeatmapContextValue<Ref, Style> {
  const xScaleCell = memoCell<(column: number) => number>();
  const yScaleCell = memoCell<(row: number) => number>();
  const timeExtentCell = memoCell<[Date, Date] | null>();
  const timeXScaleCell = memoCell<HeatmapTimeScale>();
  const brushYScaleCell = memoCell<HeatmapLinearScale>();
  const valueCell = memoCell<HeatmapContextValue<Ref, Style>>();
  return (input) => {
    const {
      containerRef, animateCells, animationDuration, ariaDescription, ariaLabel, cellSize, status, colorScale, hasCustomColorScale, columnCount, columns,
      enterStaggerScale, enterTransition, fillScale, gap, height, innerHeight, innerWidth, isRenderable, levelStyles, loadingCellMaxOpacity, loadingCellRandomness,
      loadingLabel, loadingOpacity, margin, revealEpoch, rowCount, separator, separatorLayout, showLoadingCells, tooltip, weekStartDay, width, yAxis,
    } = input;
    const xScale = xScaleCell([cellSize, separatorLayout], () => (column: number) => columnStartX(column, cellSize, separatorLayout));
    const yScale = yScaleCell([cellSize], () => (row: number) => row * cellSize);
    const timeExtent = timeExtentCell([columns], () => getHeatmapTimeExtent(columns));
    const timeXScale = timeXScaleCell([timeExtent, innerWidth], () => timeScale(timeExtent ?? NO_TIME_EXTENT, [0, innerWidth]));
    const brushYScale = brushYScaleCell([innerHeight], () => linearScale([0, 1], [innerHeight, 0]));
    return valueCell(
      [
        containerRef, brushYScale, timeXScale, xScale, yScale,
        animateCells, animationDuration, ariaDescription, ariaLabel, cellSize, status, colorScale, hasCustomColorScale, columnCount, columns, enterStaggerScale,
        enterTransition, fillScale, gap, height, innerHeight, innerWidth, isRenderable, levelStyles, loadingCellMaxOpacity, loadingCellRandomness,
        loadingLabel, loadingOpacity, margin, revealEpoch, rowCount, separator, separatorLayout, showLoadingCells, tooltip,
        weekStartDay, width, yAxis,
      ],
      () => ({
        brushYScale, containerRef, timeXScale, xScale, yScale,
        animateCells, animationDuration, ariaDescription, ariaLabel, binHeight: cellSize, binWidth: cellSize,
        chartPhase: status === "loading" ? "loading" : "ready", chartStatus: status, colorScale, columnCount, data: columns, enterStaggerScale, enterTransition,
        fillScale, fixedWidth: undefined, gap, hasCustomColorScale, height, innerHeight, innerWidth,
        isLoaded: status !== "loading", isReady: isRenderable, levelStyles, loadingCellMaxOpacity, loadingCellRandomness, loadingLabel,
        loadingOpacity, margin, revealEpoch, revealMode: null, rowCount, separator, separatorLayout, showLoadingCells,
        showLoadingLabel: (loadingLabel ?? "").trim().length > 0 && status === "loading", tooltip, weekStartDay, width,
        yLabelFormat: yAxis.labelFormat, yRowOpacity: yAxis.rowOpacity, yTickFilter: yAxis.tickFilter,
      }),
    );
  };
}
