import { HEATMAP_MONTHS_ONE_YEAR, HEATMAP_MONTHS_SIX, getHeatmapCalendarRangeStart, getHeatmapWeekStartAlignedToRange } from "./calendar";
import type { HeatmapWeekStartDay } from "./day-labels";

/** One day cell of a week column. */
export interface HeatmapBin {
  /** Activity level of the cell. Values of `0` or less map to level 0 (empty), `1` to `3` to levels 1 to 3, and `4` or more to level 4. */
  readonly count: number;
  /** Row index of the cell in its column (`0` to `6` for the days of a Sunday-first week). */
  readonly bin: number;
  /** Date of the cell. Must be a `Date` object. */
  readonly date: Readonly<Date>;
}

/** One week (or category) column of the heatmap, holding its day bins. */
export interface HeatmapColumn {
  /** Column index (the week number). */
  readonly bin: number;
  /** The day cells of the column, in Sunday-first order (seven for a week). */
  readonly bins: HeatmapBin[];
}

/** Rotates Sun-first column bins so display row 0 starts on `weekStartDay`; `0` returns `columns` unchanged.
 * `columns` stays mutable: a `readonly` param would make that unchanged-return path a type error or force a copy on a hot render path. */
export const rotateHeatmapColumnBins = (columns: HeatmapColumn[], weekStartDay: HeatmapWeekStartDay = 0): HeatmapColumn[] => {
  if (weekStartDay === 0) {return columns;}
  return columns.map((column: Readonly<HeatmapColumn>) => ({
    ...column,
    bins: [...column.bins.slice(weekStartDay), ...column.bins.slice(0, weekStartDay)],
  }));
}

/**
 * Month label anchor for a week column: the 1st, else the 1st of the first bin's month; `undefined` when `column.bins` is empty.
 * @internal
 */
export const getHeatmapColumnMonthAnchor = (column: HeatmapColumn): Date | null => {
  for (const bin of column.bins) {
    if (bin.date.getDate() === 1) {return bin.date;}
  }
  // First bin via array destructuring; the empty-bins guard below stays load-bearing.
  // Empty bins arrays are a real runtime case this function must handle.
  if (column.bins.length === 0) {return null;}
  const [firstBin] = column.bins;
  const firstDate = firstBin.date;
  return new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
}

/** Internal (not re-exported from the barrel), so it returns `undefined` rather than `null`: the first bin's date, or `undefined` when `column.bins` is empty. */
export const getHeatmapColumnStartDate = (column: Readonly<HeatmapColumn>): Date | undefined => column.bins[0]?.date;


/** Internal like `getHeatmapColumnStartDate` (returns `undefined`, not `null`): the last bin's date, or `undefined` when `column.bins` is empty. */
export const getHeatmapColumnEndDate = (column: Readonly<HeatmapColumn>): Date | undefined => {
  const lastBin = column.bins.at(-1);
  return lastBin?.date;
}

/** The last column's end date, or `undefined` when `columns` is empty or dates are unavailable. */
 // Last bin date across all columns; undefined when no column has bins.
const readHeatmapLastColumnEnd = (columns: readonly HeatmapColumn[]): Date | undefined => {
  const lastColumn = columns.at(-1);
  if (!lastColumn) { return undefined; }
  return getHeatmapColumnEndDate(lastColumn);
}

/** @internal */
export const getHeatmapTimeExtent = (columns: HeatmapColumn[]): [Date, Date] | null => {
  if (columns.length === 0) {return null;}
  // Non-empty per the length check above, so destructuring always yields a column.
  const [firstColumn] = columns;
  const start = getHeatmapColumnStartDate(firstColumn);
  const end = readHeatmapLastColumnEnd(columns);
  if (!(start && end)) {return null;}
  return [start, end];
}



/** Week columns overlapping `xDomain` (all when omitted). `columns` stays mutable: it is public barrel API and the no-domain path returns it unchanged,
 * so `readonly` would change the signature or copy on a hot render path. */
export const filterHeatmapColumns = (columns: HeatmapColumn[], xDomain?: [Date, Date]): HeatmapColumn[] => {
  if (!xDomain) {return columns;}
  const start = Math.min(xDomain[0].getTime(), xDomain[1].getTime());
  const end = Math.max(xDomain[0].getTime(), xDomain[1].getTime());
  return columns.filter((column: Readonly<HeatmapColumn>) => {
    const weekStartDate = getHeatmapColumnStartDate(column);
    const weekEndDate = getHeatmapColumnEndDate(column);
    if (!weekStartDate || !weekEndDate) {return false;}
    const weekStart = weekStartDate.getTime();
    const weekEnd = weekEndDate.getTime();
    return weekEnd >= start && weekStart <= end;
  });
}

export interface HeatmapDisplayRange {
  readonly start: Readonly<Date> | null;
  readonly end: Readonly<Date> | null;
}

/** Whether a bin falls outside the contribution display window (not merely inactive). */
export const isHeatmapGhostBin = (bin: Readonly<HeatmapBin>, range: Readonly<HeatmapDisplayRange>): boolean => {
  const time = bin.date.getTime();
  if (range.end && time > range.end.getTime()) {return true;}
  if (range.start && time < range.start.getTime()) {return true;}
  return false;
}

/** Resolves the calendar range start whose aligned week start matches `gridStart`; `undefined` when the grid shape isn't recognized. */
 // Scans the recognized calendar shapes for one whose aligned start matches the grid.
const matchHeatmapCalendarRangeStart = (gridStart: Readonly<Date>, today: Readonly<Date>): Date | undefined => {
  for (const months of [HEATMAP_MONTHS_SIX, HEATMAP_MONTHS_ONE_YEAR]) {
    const rangeStart = getHeatmapCalendarRangeStart(today, months);
    const alignedStart = getHeatmapWeekStartAlignedToRange(rangeStart);
    if (gridStart.getTime() === alignedStart.getTime()) {return rangeStart;}
  }
  return undefined;
}

/**
 * Today at midnight, or null on the server: a server render reads no clock (Next's prerender refuses `new Date()` in
 * a client component under Cache Components, create-next-app's default), so it draws every bin, no calendar window;
 * the client, hydrating, draws the window from its own today.
 */
const heatmapToday = (): Date | null => {
  if (typeof document === "undefined") {return null;}
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// Destructuring types `firstColumn` as always-defined without `noUncheckedIndexedAccess`.
// Exported callers give no guarantee `columns` is non-empty, so the guard stays.
/** @internal */
export const inferHeatmapCalendarRangeStart = (columns: HeatmapColumn[]): Date | null => {
  if (columns.length === 0) {return null;}
  const [firstColumn] = columns;

  const gridStart = getHeatmapColumnStartDate(firstColumn);
  const today = heatmapToday();
  if (!(gridStart && today)) {return null;}

  return matchHeatmapCalendarRangeStart(gridStart, today) ?? null;
}

/** Grid base values shared by display-range resolution; `undefined` when the grid has no usable dates. */
// Grid base values shared by display-range resolution; undefined when the grid has no usable dates.
const readHeatmapDisplayGridBase = (columns: HeatmapColumn[]): { extent: [Date, Date]; today: Date; gridStart: Date } | undefined => {
  const extent = getHeatmapTimeExtent(columns);
  const today = heatmapToday();
  if (!(extent && today)) {return undefined;}

  // Non-empty per the `columns.length === 0` check above.
  const [firstColumn] = columns;

  const gridStart = getHeatmapColumnStartDate(firstColumn);
  if (!gridStart) {return undefined;}

  return { extent, gridStart, today };
}

// GitHub-style window for a recognized calendar grid; undefined bounds (show all) otherwise.
const resolveInferredHeatmapDisplayRange = (inferredStart: Readonly<Date> | undefined, extentEnd: Readonly<Date>, today: Readonly<Date>): HeatmapDisplayRange => {
  if (inferredStart && extentEnd.getTime() >= today.getTime()) {
    return { end: today, start: inferredStart };
  }
  return { end: null, start: null };
}

export const resolveHeatmapDisplayRange = (columns: HeatmapColumn[]): HeatmapDisplayRange => {
  if (columns.length === 0) {return { end: null, start: null };}

  const base = readHeatmapDisplayGridBase(columns);
  if (!base) {return { end: null, start: null };}

  const inferredStart = inferHeatmapCalendarRangeStart(columns);
  return resolveInferredHeatmapDisplayRange(inferredStart ?? undefined, base.extent[1], base.today);
}
