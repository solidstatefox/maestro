import { scaleBand } from "d3-scale";
import type { ScaleBand, ScaleLinear, ScaleTime } from "d3-scale";
import { createBridgedContext, focusRowOf, referenceAreasKey, referenceAreasOfKey, valueScale } from "../cartesian/context";
import type { ChartContext, ContainerRef, FocusedRow, RowPixel } from "../cartesian/context";
import type { ChildTable } from "../carriers/table";
import type { AnyInteraction } from "../erased-types";
import { shortDateFmt } from "../format";
import { memoCell } from "../memo";
import { scaleLinear, scaleUtc } from "../scales";
import type { ChartMargin } from "../theme";
import type { BarOrientation } from "../types/bar";
import type { LineConfig, ReferenceAreaConfig } from "../types/context";
import { numberOrZero } from "./model";
import type { BarSeries, Row } from "./model";

interface Size {
  readonly width: number;
  readonly height: number;
}

/** The plot's size inside a host box of `size`. */
export const barInnerSize = (size: Size, margin: ChartMargin): { readonly innerWidth: number; readonly innerHeight: number } => ({
  innerWidth: Math.max(0, size.width - margin.left - margin.right),
  innerHeight: Math.max(0, size.height - margin.top - margin.bottom),
});

export interface BarContextInput {
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly orientation: BarOrientation;
  readonly stacked: boolean;
  readonly barGap: number;
  readonly series: readonly BarSeries[];
  /** The value axis domain the definition resolved (y when vertical, x when horizontal). */
  readonly valueDomain: readonly [number, number];
  readonly margin: ChartMargin;
  /** The host's content box. */
  readonly size: Size;
  readonly animationDuration: number;
  readonly table: ChildTable;
  readonly containerRef: ContainerRef;
  /** The renderer's interaction controller, which `setTooltipData` / `setHoveredBarIndex` focus through. */
  readonly interaction: { readonly current: AnyInteraction | null };
  /** The chart's ready gate flag. */
  readonly isLoaded: boolean;
  readonly focused: FocusedRow | null;
}

type StackOffsets = Map<number, Map<string, number>>;

/** One builder per chart, fed on each read. */
export function createBarContext(): (input: BarContextInput) => ChartContext {
  const categoryOfCell = memoCell<(d: Row) => string>();
  const categoriesCell = memoCell<string[]>();
  const barScaleCell = memoCell<ScaleBand<string>>();
  const valueAxisCell = memoCell<ScaleLinear<number, number>>();
  const rowIndexCell = memoCell<ReadonlyMap<Row, number>>();
  const xScaleCell = memoCell<ScaleTime<number, number>>();
  const xAccessorCell = memoCell<(d: Row) => Date>();
  const dateLabelsCell = memoCell<string[]>();
  const linesCell = memoCell<LineConfig[]>();
  const yScalesCell = memoCell<Record<string, ScaleLinear<number, number>>>();
  const stackOffsetsCell = memoCell<StackOffsets | undefined>();
  const extrasCell = memoCell<Partial<ChartContext>>();
  const referenceAreasCell = memoCell<ReferenceAreaConfig[]>();
  const pixelOfCell = memoCell<RowPixel>();
  const focusRowCell = memoCell<(index: number | null) => void>();
  const xAtCell = memoCell<(f: FocusedRow) => number>();
  const hoverExtrasCell = memoCell<Partial<ChartContext>>();
  const bridged = createBridgedContext();
  return (input) => {
    const { data, xDataKey, orientation, stacked, barGap, series, valueDomain, margin, size, animationDuration, table, containerRef, interaction, isLoaded, focused } = input;
    const horizontal = orientation === "horizontal";
    const { innerWidth, innerHeight } = barInnerSize(size, margin);
    const categoryOf = categoryOfCell([xDataKey], () => (d: Row): string => String(d[xDataKey]));
    const categories = categoriesCell([data, categoryOf], () => data.map(categoryOf));
    const bandLength = horizontal ? innerHeight : innerWidth;
    const barScale = barScaleCell([categories, bandLength, barGap], () => scaleBand().domain(categories).range([0, bandLength]).padding(barGap));
    const valueAxis = valueAxisCell([valueDomain, horizontal, innerWidth, innerHeight], () => {
      const [lo, hi] = valueDomain;
      return horizontal ? scaleLinear().domain([lo, hi]).range([0, innerWidth]) : valueScale([lo, hi], innerHeight);
    });
    const rowIndex = rowIndexCell([data], () => new Map(data.map((row, i) => [row, i] as const)));
    // bklit exposes a Date-typed x scale for bar charts: row i maps to the centre of band i.
    const xScale = xScaleCell([barScale, categories, data.length, horizontal, innerWidth], () => {
      const centre = (i: number): number => (barScale(categories[i] ?? "") ?? 0) + barScale.bandwidth() / 2;
      return scaleUtc()
        .domain([new Date(0), new Date(Math.max(1, data.length - 1))])
        .range(horizontal || data.length === 0 ? [0, innerWidth] : [centre(0), centre(Math.max(1, data.length - 1))]);
    });
    const xAccessor = xAccessorCell([rowIndex], () => (d: Row): Date => new Date(rowIndex.get(d) ?? 0));
    const dateLabels = dateLabelsCell([data, xDataKey], () => data.map((row) => (row[xDataKey] instanceof Date ? shortDateFmt.format(row[xDataKey]) : String(row[xDataKey]))));
    const lines = linesCell([series], () => series.map((sr) => ({ dataKey: sr.key, stroke: sr.fill, strokeWidth: 2 })));
    const yScales = yScalesCell([valueAxis], () => ({ left: valueAxis }));
    const stackOffsets = stackOffsetsCell([data, lines, stacked], () => {
      if (!stacked) {
        return undefined;
      }
      const offsets: StackOffsets = new Map();
      for (const [i, row] of data.entries()) {
        const point = new Map<string, number>();
        let cumulative = 0;
        for (const line of lines) {
          point.set(line.dataKey, cumulative);
          cumulative += numberOrZero(row[line.dataKey]);
        }
        offsets.set(i, point);
      }
      return offsets;
    });
    const extras = extrasCell([barScale, categoryOf, orientation, stacked, stackOffsets, data.length, bandLength], () => ({
      barScale,
      barXAccessor: categoryOf,
      orientation,
      stacked,
      stackOffsets,
      bandWidth: barScale.bandwidth(),
      columnWidth: data.length > 0 ? bandLength / data.length : 0,
    }));
    const bandsKey = referenceAreasKey(table);
    const referenceAreas = referenceAreasCell([bandsKey], () => referenceAreasOfKey(bandsKey));
    // Rows are focused at their band centre on the plot's middle line; the category strategy snaps like a pointer move.
    const pixelOf = pixelOfCell([barScale, categories, horizontal, margin, innerWidth, innerHeight], () => (index: number) => {
      if (index < 0 || index >= categories.length) {
        return null;
      }
      const centre = (barScale(categories[index]) ?? 0) + barScale.bandwidth() / 2;
      return horizontal ? { x: margin.left + innerWidth / 2, y: margin.top + centre } : { x: margin.left + centre, y: margin.top + innerHeight / 2 };
    });
    const focusRow = focusRowCell([containerRef, interaction, pixelOf], () => focusRowOf(containerRef, interaction, pixelOf));
    const xAt = xAtCell([barScale, categoryOf], () => (f: FocusedRow): number => (barScale(categoryOf(f.row)) ?? 0) + barScale.bandwidth() / 2);
    const hoverExtras = hoverExtrasCell([extras, focused, focusRow], () => ({ ...extras, hoveredBarIndex: focused?.index ?? null, setHoveredBarIndex: focusRow }));
    return bridged({ data, margin, size, containerRef, isLoaded, xScale, yScales, lines, animationDuration, xAccessor, dateLabels, xAt, extras: hoverExtras, focusRow, referenceAreas, focused });
  };
}
