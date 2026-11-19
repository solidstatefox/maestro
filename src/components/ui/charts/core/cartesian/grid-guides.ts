import { ruleX, ruleY } from "@tanstack/charts/rule";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { DEFAULT_GRID_STROKE } from "../theme";

export interface GridGuideProps {
  horizontal?: boolean;
  vertical?: boolean;
  numTicksRows?: number;
  numTicksColumns?: number;
  rowTickValues?: number[];
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  strokeDasharray?: string;
  highlightRowValues?: number[];
  highlightRowStroke?: string;
  highlightRowStrokeOpacity?: number;
  highlightRowStrokeWidth?: number;
  highlightRowStrokeDasharray?: string;
  fadeHorizontal?: boolean;
  fadeVertical?: boolean;
  hideHorizontalEdgeLines?: boolean;
  hideVerticalEdgeLines?: boolean;
  yAxisId?: string | number;
  loadingStroke?: string;
  shimmer?: boolean;
  shimmerStroke?: string;
}

/** bklit `DEFAULT_SHIMMER_STROKE` (grid.tsx:15). */
const DEFAULT_SHIMMER_STROKE = "color-mix(in oklch, var(--bkm-foreground) 68%, transparent)";
/** The grid under the travelling band: dimmed so the band (a host CSS mask, styles.css `data-bkm-loading-shimmer`) reads as the bright part. */
const SHIMMER_BASE_OPACITY = 0.22;

/** The grid of a chart with `status="loading"`: `loadingStroke` (falls back to `stroke`), or with `shimmer` the dimmed band stroke. */
export function loadingGridProps(grid: GridGuideProps | undefined): GridGuideProps | undefined {
  if (!grid) {
    return grid;
  }
  if (grid.shimmer === true) {
    return { ...grid, stroke: grid.shimmerStroke ?? DEFAULT_SHIMMER_STROKE, strokeOpacity: SHIMMER_BASE_OPACITY };
  }
  return grid.loadingStroke === undefined ? grid : { ...grid, stroke: grid.loadingStroke };
}

/** bklit `Grid` defaults: `numTicksRows` 5, `numTicksColumns` 10 (also `YAxis` `numTicks` 5). */
const DEFAULT_ROW_TICKS = 5;
const DEFAULT_COLUMN_TICKS = 10;

interface GridLineStyle {
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  strokeDasharray: string;
}

/** The grid line presentation over bklit's defaults (var(--chart-grid), opacity 1, width 1, dash "4,4"). */
export function gridLineStyle(grid: GridGuideProps): GridLineStyle {
  return {
    stroke: grid.stroke ?? DEFAULT_GRID_STROKE,
    strokeOpacity: grid.strokeOpacity ?? 1,
    strokeWidth: grid.strokeWidth ?? 1,
    strokeDasharray: (grid.strokeDasharray ?? "4,4").replace(",", " "),
  };
}

type GridHostAttrs = { "data-bkm-grid-nofade-h": string | undefined; "data-bkm-grid-fade-v": string | undefined };

/** Host attributes for the static edge-fade rules: bklit fades rows by default and columns only on request. */
export function gridHostAttrs(grid: GridGuideProps | undefined): GridHostAttrs {
  return {
    "data-bkm-grid-nofade-h": grid?.fadeHorizontal === false ? "" : undefined,
    "data-bkm-grid-fade-v": grid?.fadeVertical === true ? "" : undefined,
  };
}

/** bklit `hideEdgeTicks`: the first and last tick go, unless two or fewer remain. */
function withoutEdges<T>(ticks: T[], hide: boolean): T[] {
  return hide && ticks.length > 2 ? ticks.slice(1, -1) : ticks;
}

interface GridRowGuides {
  /** Whether the value scale keeps its native `grid` (the grid ticks equal the axis ticks). */
  readonly native: boolean;
  /** Tick count for the value scale's axis (bklit `YAxis` `numTicks`, default 5; the grid's count when there is no axis). */
  readonly count: number;
  /** Row rules (when not native) and highlight rows, in bklit's draw order: under every series. */
  readonly marks: AnyMark[];
}

/** Horizontal grid for one value scale. `axisTicks` is the `YAxis` `numTicks` of an axis that draws labels (undefined: no axis);
 * `scale.ticks` gives bklit's tick set. */
export function gridRowGuides(grid: GridGuideProps | undefined, scale: { ticks: (count: number) => number[] }, axisLabels: boolean, axisTicks: number | undefined): GridRowGuides {
  const rows = grid?.numTicksRows ?? DEFAULT_ROW_TICKS;
  const count = axisLabels ? (axisTicks ?? DEFAULT_ROW_TICKS) : rows;
  if (!grid || grid.horizontal === false) {
    return { native: false, count, marks: [] };
  }
  const marks: AnyMark[] = [];
  const native = !grid.rowTickValues && !grid.hideHorizontalEdgeLines && rows === count;
  if (!native) {
    const rowValues = withoutEdges(grid.rowTickValues ?? scale.ticks(rows), grid.hideHorizontalEdgeLines === true);
    const rowStyle = gridLineStyle(grid);
    marks.push(
      ruleY(rowValues, erase({
        id: "grid-rows",
        motion: false,
        ...rowStyle,
        y: (value: number) => value,
      })),
    );
  }
  marks.push(...gridHighlightRows(grid));
  return { native, count, marks };
}

/** bklit draws `highlightRowValues` over the grid rows and under the series. */
function gridHighlightRows(grid: GridGuideProps | undefined): AnyMark[] {
  const values = grid?.highlightRowValues;
  if (!grid || grid.horizontal === false || !values || values.length === 0) {
    return [];
  }
  return [
    ruleY(values, erase({
      id: "grid-highlight-rows",
      motion: false,
      stroke: grid.highlightRowStroke ?? "var(--chart-foreground-muted)",
      strokeDasharray: (grid.highlightRowStrokeDasharray ?? "0").replace(",", " "),
      strokeOpacity: grid.highlightRowStrokeOpacity ?? 1,
      strokeWidth: grid.highlightRowStrokeWidth ?? 1,
      y: (value: number) => value,
    })),
  ];
}

/** Vertical grid as marks: bklit's columns are `columnScale.ticks(numTicksColumns)` of its local-time scale (default 10), minus first and last
 * when `hideVerticalEdgeLines`, independent of the x axis labels. Pass a local-time `scaleTime` over the plot's x domain. */
export function gridColumnGuides(grid: GridGuideProps | undefined, scale: { ticks: (count: number) => Date[] }): AnyMark[] {
  if (grid?.vertical !== true) {
    return [];
  }
  return [
    ruleX(withoutEdges(scale.ticks(grid.numTicksColumns ?? DEFAULT_COLUMN_TICKS), grid.hideVerticalEdgeLines === true), erase({
      id: "grid-columns",
      motion: false,
      ...gridLineStyle(grid),
      x: (value: Date) => value,
    })),
  ];
}
