import type { ScaleLinear, ScaleTime } from "d3-scale";
import type { ChildTable } from "../carriers/table";
import { createBridgedContext, focusRowOf, referenceAreasKey, referenceAreasOfKey, timeScale, valueScale } from "../cartesian/context";
import type { ChartContext, ContainerRef, FocusedRow, RowPixel } from "../cartesian/context";
import { ZERO_SIZE } from "../cartesian/plot-size";
import type { PlotSnapshot } from "../cartesian/plot-size";
import { DEFAULT_Y_AXIS_ID, lineConfigOf } from "../cartesian/series";
import type { ResolvedSeries, Row } from "../cartesian/series";
import type { AnyInteraction } from "../erased-types";
import { shortDateFmt } from "../format";
import { memoCell } from "../memo";
import type { ChartMargin } from "../theme";
import type { LineConfig, ReferenceAreaConfig } from "../types/context";
import type { SeriesBarSpec } from "./bars";
import { dateValue } from "./narrow";

export interface ComposedContextInput {
  /** The plot the latest draw published, null before the first. */
  readonly snapshot: PlotSnapshot | null;
  /** The chart's ready gate flag. */
  readonly isLoaded: boolean;
  readonly focused: FocusedRow | null;
  readonly containerRef: ContainerRef;
  /** The interaction controller the context's setters focus through. */
  readonly interaction: { readonly current: AnyInteraction | null };
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly margin: Readonly<ChartMargin>;
  readonly series: readonly ResolvedSeries[];
  readonly bars: readonly SeriesBarSpec[];
  readonly duration: number;
  readonly barSize?: number;
  readonly maxBarSize?: number;
  readonly barGap: number;
  readonly stacked: boolean;
  readonly stackGap: number;
  readonly table: ChildTable;
}

type Extras = Partial<ChartContext>;

const NO_DOMAINS: { readonly x: readonly [Date, Date]; readonly y: Readonly<Record<string, readonly [number, number]>> } = { x: [/* @__PURE__ */ new Date(0), /* @__PURE__ */ new Date(1)], y: {} };

/** The composed context: derived from the native focus and the domains and size the draw published. */
export function createComposedContext(): (input: ComposedContextInput) => ChartContext {
  const xScaleCell = memoCell<ScaleTime<number, number>>();
  const yScalesCell = memoCell<Record<string, ScaleLinear<number, number>>>();
  const xAccessorCell = memoCell<(d: Row) => Date>();
  const dateLabelsCell = memoCell<string[]>();
  const linesCell = memoCell<LineConfig[]>();
  const extrasCell = memoCell<Extras>();
  const bandsCell = memoCell<ReferenceAreaConfig[]>();
  const pixelOfCell = memoCell<RowPixel>();
  const focusRowCell = memoCell<(index: number | null) => void>();
  const barExtrasCell = memoCell<Extras>();
  const bridged = createBridgedContext();
  return (input) => {
    const { snapshot, isLoaded, focused, containerRef, interaction, data: rows, xDataKey, margin, series, bars, duration, barSize, maxBarSize, barGap, stacked, stackGap, table } = input;
    const size = snapshot?.size ?? ZERO_SIZE;
    const domains = snapshot?.built.domains ?? NO_DOMAINS;
    const innerHeight = Math.max(0, size.innerHeight);
    const xScale = xScaleCell([domains.x, size.innerWidth], () => timeScale(domains.x, size.innerWidth));
    const yScales = yScalesCell(
      [domains.y, innerHeight],
      () => Object.fromEntries(Object.entries(domains.y).map(([id, domain]) => [id, valueScale(domain, innerHeight)])),
    );
    const xAccessor = xAccessorCell([xDataKey], () => (d: Row): Date => dateValue(d[xDataKey]));
    const dateLabels = dateLabelsCell([rows, xAccessor], () => rows.map((row) => shortDateFmt.format(xAccessor(row))));
    const lines = linesCell([series, bars], () => [
      ...series.map(lineConfigOf),
      ...bars.map((b) => ({ dataKey: b.dataKey, ...(b.label === undefined ? null : { label: b.label }), stroke: b.dotColor, strokeWidth: 0, yAxisId: DEFAULT_Y_AXIS_ID })),
    ]);
    const extras = extrasCell([bars, barSize, maxBarSize, barGap, stacked, stackGap], () => ({
      composedBarDataKeys: bars.map((b) => b.dataKey),
      composedBarSize: barSize,
      composedMaxBarSize: maxBarSize,
      composedBarGap: barGap,
      composedStacked: stacked,
      composedStackGap: stackGap,
    }));
    // `ReferenceArea` bands (bklit `extractReferenceAreaConfigs`), stable per content.
    const bandsKey = referenceAreasKey(table);
    const referenceAreas = bandsCell([bandsKey], () => referenceAreasOfKey(bandsKey));
    // Rows are focused at their data x on the plot's middle line; the group-x strategy snaps like a pointer move.
    const pixelOf = pixelOfCell(
      [rows, margin, xScale, xAccessor, innerHeight],
      () => (index: number) => (index >= 0 && index < rows.length ? { x: margin.left + xScale(xAccessor(rows[index])), y: margin.top + innerHeight / 2 } : null),
    );
    const focusRow = focusRowCell([containerRef, interaction, pixelOf], () => focusRowOf(containerRef, interaction, pixelOf));
    const barExtras = barExtrasCell([bars.length, extras, focusRow], () => (bars.length > 0 ? { ...extras, setHoveredBarIndex: focusRow } : extras));
    return bridged({ data: rows, margin, size, containerRef, isLoaded, xScale, yScales, lines, animationDuration: duration, xAccessor, dateLabels, focusRow, referenceAreas, focused, extras: barExtras });
  };
}
