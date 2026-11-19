import type { ScaleLinear, ScaleTime } from "d3-scale";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { AnyInteraction } from "../erased-types";
import { shortDateFmt } from "../format";
import { memoCell, structuralCell } from "../memo";
import { scaleLinear, scaleUtc } from "../scales";
import type { ChartMargin } from "../theme";
import type { ChartSelection } from "../types/cartesian";
import type { ChartHoverContextValue, ChartStableContextValue, LineConfig, Margin, ReferenceAreaConfig, TooltipData } from "../types/context";
import { strictRows } from "./domains";
import type { PlotSnapshot } from "./plot-size";
import { ZERO_SIZE } from "./plot-size";
import { DEFAULT_Y_AXIS_ID, lineConfigOf, toDate } from "./series";
import type { ResolvedSeries, Row } from "./series";

/** The chart's container ref as the context hands it out: the framework's own ref (React's `RefObject`), read as `{ current }`. */
export interface ContainerRef {
  current: HTMLDivElement | null;
}

/** `setTooltipData`: a value, or an updater, which sees `null` (the focus lives in the renderer, not in framework state). */
export type TooltipDataSetter = (next: TooltipData | null | ((previous: TooltipData | null) => TooltipData | null)) => void;

/** Everything `useChart()` returns. */
export type ChartContext = ChartStableContextValue<ContainerRef> & ChartHoverContextValue<TooltipDataSetter>;

type StableContext = Omit<ChartContext, "tooltipData" | "setTooltipData" | "selection" | "clearSelection">;

type YDomains = Readonly<Record<string, readonly [number, number]>>;

/** A focused data row. */
export interface FocusedRow {
  readonly row: Row;
  readonly index: number;
}

/** The line / area shell's focused row, with its x (ms). */
export interface CartesianFocus extends FocusedRow {
  readonly time: number;
}

// --- Focus setters ---------------------------------------------------------------------------
// Context setters (`setTooltipData`, `setHoveredBarIndex`, ...) drive the native focus through the public interaction controller:
// the row's plot position is resolved like a pointer (`resolvePointer`) and painted with `setControlledFocus`.

/** Host-relative pixel (scene coordinates) of data row `index`, or null when the row has no position. */
export type RowPixel = (index: number) => { readonly x: number; readonly y: number } | null;

/** Focuses data row `index` (null clears). */
export const focusRowOf =
  (host: { readonly current: HTMLElement | null }, interaction: { readonly current: AnyInteraction | null } | undefined, pixelOf: RowPixel) =>
  (index: number | null): void => {
    const controller = interaction?.current;
    if (!controller) {
      return;
    }
    if (index === null) {
      controller.setControlledFocus(null, { source: "pointer" });
      return;
    }
    const at = pixelOf(index);
    const rect = host.current?.getBoundingClientRect();
    if (at && rect) {
      controller.setControlledFocus(controller.resolvePointer(rect.left + at.x, rect.top + at.y), { source: "pointer" });
    }
  };

/** bklit's `setTooltipData` over a row focus; an updater function sees `null` (the focus lives in the renderer, not framework state). */
export const tooltipSetter =
  (focusRow: (index: number | null) => void): TooltipDataSetter =>
  (next) => {
    const value = typeof next === "function" ? next(null) : next;
    focusRow(value ? value.index : null);
  };

// --- Scales and bands ------------------------------------------------------------------------

export const timeScale = (domain: readonly [Date, Date], innerWidth: number): ScaleTime<number, number> =>
  scaleUtc().domain([...domain]).range([0, innerWidth]);

export const valueScale = (domain: readonly [number, number], innerHeight: number, nice = false): ScaleLinear<number, number> => {
  const scale = scaleLinear().domain([...domain]).range([innerHeight, 0]);
  return nice ? scale.nice() : scale;
};

/** The `ReferenceArea` bands of a chart's child table (bklit `extractReferenceAreaConfigs`) as a key: equal bands, equal key. */
export const referenceAreasKey = (table: ChildTable): string => {
  const rows = propsFor<{ yAxisId?: string | number; y1?: number; y2?: number; axisLabelColor?: string }>(table, "referenceArea");
  return JSON.stringify(rows.map((r) => [r.yAxisId, r.y1, r.y2, r.axisLabelColor]));
};

/** The bands a `referenceAreasKey` names, in tree order. */
export const referenceAreasOfKey = (key: string): ReferenceAreaConfig[] =>
  // SAFETY: key is JSON.stringify of the tuples `referenceAreasKey` maps from the table's rows.
  (JSON.parse(key) as [string | number | undefined, number | undefined, number | undefined, string | undefined][]).map(
    ([yAxisId, y1, y2, axisLabelColor]): ReferenceAreaConfig => ({ yAxisId: String(yAxisId ?? DEFAULT_Y_AXIS_ID), y1, y2, axisLabelColor }),
  );

const tooltipDataOf = (
  focused: FocusedRow,
  lines: readonly LineConfig[],
  yScales: Readonly<Record<string, ScaleLinear<number, number>>>,
  yScale: ScaleLinear<number, number>,
  x: number,
): TooltipData => {
  const yPositions: Record<string, number> = {};
  for (const line of lines) {
    const value = focused.row[line.dataKey];
    if (typeof value === "number") {
      yPositions[line.dataKey] = (yScales[String(line.yAxisId ?? DEFAULT_Y_AXIS_ID)] ?? yScale)(value);
    }
  }
  return { point: focused.row, index: focused.index, x, yPositions };
};

// --- The line / area shell's context -----------------------------------------------------------

export interface CartesianContextInput {
  /** The plot the latest draw published, null before the first: the context follows the size the draw measured. */
  readonly snapshot: PlotSnapshot | null;
  /** The chart's ready gate flag. */
  readonly isLoaded: boolean;
  readonly series: readonly ResolvedSeries[];
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly table: ChildTable;
  readonly containerRef: ContainerRef;
  /** The interaction controller the context's setters focus through. */
  readonly dragInteraction: { readonly current: AnyInteraction | null };
  readonly resolvedMargin: ChartMargin;
  readonly animationDuration: number;
  readonly xDomain: [Date, Date] | undefined;
  readonly xDomainSlotCount: number | undefined;
  /** The drag selection in raw plot pixels. */
  readonly selection: { startX: number; endX: number } | null;
  /** Row x values (ms), ascending. */
  readonly times: readonly number[];
  readonly clearSelection: () => void;
  readonly focused: CartesianFocus | null;
}

const NO_X: readonly [Date, Date] = [/* @__PURE__ */ new Date(0), /* @__PURE__ */ new Date(0)];
const NO_Y: YDomains = {};

/** bklit's `ChartSelection` (px x in the inner plot + data indices) for the Segment drag. */
const chartSelectionOf = (selection: { startX: number; endX: number }, xScale: ScaleTime<number, number>, times: readonly number[]): ChartSelection => {
  // bklit resolveIndexFromX: the nearest data point to the raw pixel.
  const nearest = (x: number): number => {
    const t = xScale.invert(x).getTime();
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (times[mid] < t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const i1 = Math.max(1, lo);
    const d0 = times.at(i1 - 1);
    const d1 = times.at(i1);
    if (d0 === undefined) {
      return 0;
    }
    return d1 !== undefined && t - d0 > d1 - t ? i1 : i1 - 1;
  };
  return { startX: selection.startX, endX: selection.endX, startIndex: nearest(selection.startX), endIndex: nearest(selection.endX), active: true };
};

/** The line / area shell's context: one builder per subscriber, fed on every render. */
export function createCartesianContext(): (input: CartesianContextInput) => ChartContext {
  const xAccessorCell = memoCell<(d: Row) => Date>();
  const yDomainsCell = structuralCell<YDomains>();
  const xScaleCell = memoCell<ScaleTime<number, number>>();
  const yScalesCell = memoCell<Record<string, ScaleLinear<number, number>>>();
  const linesCell = structuralCell<LineConfig[]>();
  const dateLabelsCell = memoCell<string[]>();
  const targetsCell = memoCell<Record<string, [number, number]>>();
  const referenceAreasCell = memoCell<ReferenceAreaConfig[]>();
  const columnWidthCell = memoCell<number>();
  const pixelOfCell = memoCell<RowPixel>();
  const focusRowCell = memoCell<(index: number | null) => void>();
  const setterCell = memoCell<TooltipDataSetter>();
  const stableCell = memoCell<StableContext>();
  const selectionCell = memoCell<ChartSelection | null>();
  const tooltipCell = memoCell<TooltipData | null>();
  const contextCell = memoCell<ChartContext>();
  return (input) => {
    const { snapshot, isLoaded, series, data, xDataKey, table, containerRef, dragInteraction, resolvedMargin, animationDuration, xDomain, xDomainSlotCount, selection, times, clearSelection, focused } = input;
    const size = snapshot?.size ?? ZERO_SIZE;
    const plotWidth = size.width;
    const plotHeight = size.height;
    const innerWidth = size.innerWidth;
    const innerHeight = Math.max(0, size.innerHeight);
    const xAccessor = xAccessorCell([xDataKey], () => (d: Row): Date => toDate(d[xDataKey]));
    // The children (and so `table` / `built`) are new objects on every parent render; key every
    // context field on its primitive content so the published context stays referentially stable.
    const xd = snapshot?.built.domains.x ?? NO_X;
    const xStart = new Date(xd[0]).getTime();
    const xEnd = new Date(xd[1]).getTime();
    const yRaw = snapshot?.built.domains.y ?? NO_Y;
    const yDomains = yDomainsCell(yRaw, JSON.stringify(yRaw));
    const xScale = xScaleCell([xStart, xEnd, innerWidth], () => scaleUtc().domain([new Date(xStart), new Date(xEnd)]).range([0, innerWidth]));
    const yScales = yScalesCell(
      [yDomains, innerHeight],
      () => Object.fromEntries(Object.entries(yDomains).map(([id, domain]) => [id, scaleLinear().domain(domain).range([innerHeight, 0])])),
    );
    const lineRows = series.map(lineConfigOf);
    const lines = linesCell(lineRows, JSON.stringify(lineRows));
    const dateLabels = dateLabelsCell([data, xAccessor], () => data.map((row) => shortDateFmt.format(xAccessor(row))));
    const yDomainTargetByAxis = targetsCell(
      [yDomains],
      () => Object.fromEntries(Object.entries(yDomains).map(([id, [min, max]]): [string, [number, number]] => [id, [min, max]])),
    );
    const bandsKey = referenceAreasKey(table);
    const referenceAreas = referenceAreasCell([bandsKey], () => referenceAreasOfKey(bandsKey));
    // bklit time-series-chart-shell.tsx:323-332: spacing between neighbouring rows of the visible window (0 under two slots).
    const columnWidth = columnWidthCell([data, xDataKey, xDomain, xDomainSlotCount, innerWidth], () => {
      const slots = xDomain && xDomainSlotCount !== undefined ? xDomainSlotCount : (xDomain ? strictRows(data, xDataKey, xDomain) : data).length;
      return slots < 2 ? 0 : innerWidth / (slots - 1);
    });
    // Rows are focused at their data x on the plot's vertical middle: `resolvePointer` snaps to the nearest datum like a pointer move.
    const pixelOf = pixelOfCell([data, resolvedMargin, xScale, xAccessor, innerHeight], () => (index: number) => {
      const row = index < 0 ? undefined : data.at(index);
      return row ? { x: resolvedMargin.left + xScale(xAccessor(row)), y: resolvedMargin.top + innerHeight / 2 } : null;
    });
    const focusRow = focusRowCell([containerRef, dragInteraction, pixelOf], () => focusRowOf(containerRef, dragInteraction, pixelOf));
    const setTooltipData = setterCell([focusRow], () => tooltipSetter(focusRow));
    const stable = stableCell(
      [containerRef, xScale, yScales, innerWidth, innerHeight, data, plotWidth, plotHeight, resolvedMargin, lines, animationDuration, xAccessor, dateLabels, xDomain, xDomainSlotCount, columnWidth, isLoaded, yDomainTargetByAxis, referenceAreas],
      () => {
        const yScale = yScales[DEFAULT_Y_AXIS_ID] ?? scaleLinear().domain([0, 100]).range([innerHeight, 0]);
        const base = {
          // SAFETY: `data` is only read; the context types rows as a mutable array.
          data: data as Row[],
          // SAFETY: `data` is only read; the context types rows as a mutable array.
          renderData: data as Row[],
          xScale,
          yScale,
          yScales,
          isLoaded,
          chartPhase: isLoaded ? ("ready" as const) : ("revealing" as const),
          chartStatus: "ready" as const,
          yDomainTargetByAxis,
          referenceAreas,
          width: plotWidth,
          height: plotHeight,
          innerWidth,
          innerHeight,
          margin: resolvedMargin,
          containerRef,
          lines,
          animationDuration,
          xAccessor,
          dateLabels,
          columnWidth,
        };
        return xDomain ? { ...base, xDomain, xDomainSlotCount } : base;
      },
    );
    const chartSelection = selectionCell([selection, xScale, times], () => (selection ? chartSelectionOf(selection, xScale, times) : null));
    const tooltipData = tooltipCell(
      [focused, stable, xAccessor],
      () => (focused ? tooltipDataOf(focused, stable.lines, stable.yScales, stable.yScale, stable.xScale(xAccessor(focused.row))) : null),
    );
    return contextCell(
      [stable, tooltipData, setTooltipData, chartSelection, clearSelection],
      () => ({ ...stable, tooltipData, setTooltipData, selection: chartSelection, clearSelection }),
    );
  };
}

// --- The bridged context (bar, candlestick, scatter, composed) ---------------------------------

export interface BridgeInput {
  readonly data: readonly Row[];
  readonly margin: Margin;
  readonly size: { readonly width: number; readonly height: number };
  readonly containerRef: ContainerRef;
  /** The chart's ready gate flag. */
  readonly isLoaded: boolean;
  readonly xScale: ScaleTime<number, number>;
  readonly yScales: Record<string, ScaleLinear<number, number>>;
  readonly lines: LineConfig[];
  readonly animationDuration: number;
  readonly xAccessor: (d: Row) => Date;
  readonly dateLabels: string[];
  readonly focused: FocusedRow | null;
  /** Pixel x (inner plot coordinates) of the focused row; defaults to `xScale(xAccessor(row))`. */
  readonly xAt?: (focused: FocusedRow) => number;
  /** Chart-specific fields (hovered indices, band geometry, ...). Memoise array / map values. */
  readonly extras?: Partial<ChartContext>;
  /** Focuses data row `index` (null clears); backs `setTooltipData`. Absent: the setter is a no-op. */
  readonly focusRow?: (index: number | null) => void;
  /** `ReferenceArea` bands in tree order (memoised). */
  readonly referenceAreas?: ReferenceAreaConfig[];
}

const scaleKey = (scale: ScaleLinear<number, number> | ScaleTime<number, number>): string =>
  `${scale.domain().map(Number).join(",")}|${scale.range().join(",")}`;

const NO_BANDS: ReferenceAreaConfig[] = [];
const noFocus = (): void => undefined;

/** The context a non-cartesian chart publishes, derived from the host size, the resolved domains and the native `onFocusChange` row:
 * one builder per subscriber, fed on every render; the hover slice follows `focused`. */
export function createBridgedContext(): (input: BridgeInput) => ChartContext {
  const setterCell = memoCell<TooltipDataSetter>();
  const marginCell = structuralCell<Margin>();
  const xScaleCell = structuralCell<ScaleTime<number, number>>();
  const yScalesCell = structuralCell<Record<string, ScaleLinear<number, number>>>();
  const linesCell = structuralCell<LineConfig[]>();
  const dateLabelsCell = structuralCell<string[]>();
  const targetsCell = memoCell<Record<string, [number, number]>>();
  const fallbackYCell = memoCell<ScaleLinear<number, number>>();
  const tooltipCell = memoCell<TooltipData | null>();
  const contextCell = memoCell<ChartContext>();
  return (input) => {
    const { data, size, containerRef, isLoaded, animationDuration, xAccessor, focused, xAt, extras, focusRow = noFocus, referenceAreas = NO_BANDS } = input;
    const setTooltipData = setterCell([focusRow], () => tooltipSetter(focusRow));
    // Hosts rebuild these from fresh children each render; the published context must stay
    // referentially stable (user effects key on it), so reuse the first object per content.
    const margin = marginCell(input.margin, JSON.stringify(input.margin));
    const xScale = xScaleCell(input.xScale, scaleKey(input.xScale));
    const yScales = yScalesCell(input.yScales, Object.entries(input.yScales).map(([id, sc]) => `${id}:${scaleKey(sc)}`).join(";"));
    const lines = linesCell(input.lines, JSON.stringify(input.lines));
    const dateLabels = dateLabelsCell(input.dateLabels, input.dateLabels.join("|"));
    const innerWidth = Math.max(0, size.width - margin.left - margin.right);
    const innerHeight = Math.max(0, size.height - margin.top - margin.bottom);
    // With no y axis (before a chart's first draw, or no series) the fallback scale is held per height, so the context keeps its object
    // between builds: a framework's store read compares snapshots (React's `getSnapshot` must be cached).
    const yScale =
      new Map(Object.entries(yScales)).get(DEFAULT_Y_AXIS_ID) ??
      Object.values(yScales).at(0) ??
      fallbackYCell([innerHeight], () => scaleLinear().domain([0, 100]).range([innerHeight, 0]));
    const yDomainTargetByAxis = targetsCell(
      [yScales],
      () =>
        Object.fromEntries(
          Object.entries(yScales).map(([id, sc]): [string, [number, number]] => {
            const [min = 0, max = 0] = sc.domain();
            return [id, [min, max]];
          }),
        ),
    );
    const tooltipData = tooltipCell(
      [focused, lines, yScales, yScale, xAt, xScale, xAccessor],
      () => (focused ? tooltipDataOf(focused, lines, yScales, yScale, xAt ? xAt(focused) : xScale(xAccessor(focused.row))) : null),
    );
    return contextCell(
      [isLoaded, yDomainTargetByAxis, referenceAreas, setTooltipData, data, xScale, yScale, yScales, size.width, size.height, innerWidth, innerHeight, margin, containerRef, lines, animationDuration, xAccessor, dateLabels, extras, tooltipData],
      (): ChartContext => ({
        // SAFETY: `data` is only read; the context types rows as a mutable array.
        data: data as Row[],
        // SAFETY: `data` is only read; the context types rows as a mutable array.
        renderData: data as Row[],
        xScale,
        yScale,
        yScales,
        width: size.width,
        height: size.height,
        innerWidth,
        innerHeight,
        margin,
        containerRef,
        lines,
        animationDuration,
        isLoaded,
        chartPhase: isLoaded ? "ready" : "revealing",
        chartStatus: "ready",
        yDomainTargetByAxis,
        referenceAreas,
        xAccessor,
        dateLabels,
        ...extras,
        tooltipData,
        setTooltipData,
      }),
    );
  };
}
