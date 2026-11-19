import { getHeatmapColumnEndDate, getHeatmapColumnStartDate, getHeatmapTimeExtent, inferHeatmapCalendarRangeStart, resolveHeatmapDisplayRange } from "./columns";
import type { HeatmapColumn } from "./columns";

export type HeatmapSeparatorGroupBy = "every" | "quarter";

export interface HeatmapSeparatorParsedConfig {
  readonly groupBy: HeatmapSeparatorGroupBy;
  readonly every?: number;
  readonly spacing: number;
}

interface HeatmapSeparatorGroup {
  readonly startColumnIndex: number;
  readonly quarter: number;
  readonly year: number;
  readonly startDate: Readonly<Date>;
  readonly label: string;
}

export interface HeatmapSeparatorLayout {
  readonly spacing: number;
  readonly atColumns: readonly number[];
  readonly groups: readonly HeatmapSeparatorGroup[];
}

export interface HeatmapColumnSeparatorsConfig {
  readonly every?: number;
  readonly groupBy?: HeatmapSeparatorGroupBy;
  readonly spacing?: number;
}

/** The parsed separator config, or `null` when `config` is absent or invalid. */
export const normalizeHeatmapSeparatorConfig = (config: Readonly<HeatmapColumnSeparatorsConfig> | undefined): HeatmapSeparatorParsedConfig | null => {
  if (!config) {return null;}
  const groupBy = config.groupBy ?? "every";
  if (groupBy === "quarter") {return { groupBy: "quarter", spacing: config.spacing ?? 0 };}
  if ((config.every ?? 0) <= 0) {return null;}
  return { every: config.every, groupBy: "every", spacing: config.spacing ?? 0 };
}

/**
 * Column indices (0-based) where a vertical separator is drawn (fixed interval).
 * @internal
 */
export const getHeatmapSeparatorColumnIndices = (columnCount: number, every: number): number[] => {
  if (every <= 0 || columnCount <= every) {return [];}
  const indices: number[] = [];
  for (let columnIndex = every; columnIndex < columnCount; columnIndex += every) {
    indices.push(columnIndex);
  }
  return indices;
}

const MONTHS_PER_QUARTER = 3;

/** Calendar quarter (1-4) for Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec. */
const getCalendarQuarter = (date: Readonly<Date>): number => Math.floor(date.getMonth() / MONTHS_PER_QUARTER) + 1;


const QUARTER_1_START_MONTH = 0;
const QUARTER_2_START_MONTH = MONTHS_PER_QUARTER;
const QUARTER_3_START_MONTH = QUARTER_2_START_MONTH + MONTHS_PER_QUARTER;
const QUARTER_4_START_MONTH = QUARTER_3_START_MONTH + MONTHS_PER_QUARTER;
const CALENDAR_QUARTER_START_MONTHS = [QUARTER_1_START_MONTH, QUARTER_2_START_MONTH, QUARTER_3_START_MONTH, QUARTER_4_START_MONTH] as const;

/** Quarter starts for one calendar year inside a millisecond window `(startTime, endTime]`. */
// Quarter starts for one calendar year inside `(gridStart, gridEnd]`.
const collectQuarterStartDatesForYear = (year: number, startTime: number, endTime: number): Date[] => {
  const dates: Date[] = [];
  for (const month of CALENDAR_QUARTER_START_MONTHS) {
    const date = new Date(year, month, 1);
    date.setHours(0, 0, 0, 0);
    if (date.getTime() > startTime && date.getTime() <= endTime) {dates.push(date);}
  }
  return dates;
}

const getCalendarQuarterStartDatesBetween = (gridStart: Readonly<Date>, gridEnd: Readonly<Date>): Date[] => {
  const startTime = gridStart.getTime();
  const endTime = gridEnd.getTime();
  const dates: Date[] = [];

  for (let year = gridStart.getFullYear(); year <= gridEnd.getFullYear(); year += 1) {
    dates.push(...collectQuarterStartDatesForYear(year, startTime, endTime));
  }

  return dates;
}

/** Week column index whose Sun-Sat span contains `date`; `undefined` when none does. */
const findHeatmapColumnIndexForDate = (columns: readonly HeatmapColumn[], date: Readonly<Date>): number | undefined => {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const targetTime = target.getTime();

  const columnIndex = columns.findIndex((column: Readonly<HeatmapColumn>) => {
    const weekStart = getHeatmapColumnStartDate(column);
    const weekEnd = getHeatmapColumnEndDate(column);
    if (!(weekStart && weekEnd)) {return false;}

    weekStart.setHours(0, 0, 0, 0);
    weekEnd.setHours(0, 0, 0, 0);
    return targetTime >= weekStart.getTime() && targetTime <= weekEnd.getTime();
  });

  return columnIndex === -1 ? undefined : columnIndex;
}

/** Display/inferred/extent fallback chain for the quarter-separator range start. */
// Display/inferred/extent fallback chain for the quarter-separator range start.
const resolveQuarterRangeStart = (columns: HeatmapColumn[], extentStart: Readonly<Date>): Readonly<Date> => {
  const displayRange = resolveHeatmapDisplayRange(columns);
  return displayRange.start ?? inferHeatmapCalendarRangeStart(columns) ?? extentStart;
}

interface QuarterSeparatorSeed {
  readonly groups: HeatmapSeparatorGroup[];
  readonly usedColumns: Set<number>;
}

// First quarter group plus its claimed column; later groups append after it.
// bklit labels it from the range start (heatmap/heatmap-utils.ts buildHeatmapQuarterSeparatorGroups). Divergence: when a quarter begins after
// that start but inside column 0, bklit skips that quarter (column 0 is taken) and the grid opens with the old quarter's label over the new one,
// e.g. "Q4" over January for fixed-date data whose first week runs Sun 28 Dec - Sat 3 Jan (the range start falls back to that Sunday). Here the
// quarter that begins inside column 0 labels it. A range start on the 1st of a month (bklit's today-relative ranges) never has one, so those match bklit.
const createQuarterSeparatorSeed = (columns: readonly HeatmapColumn[], quarterRangeStart: Readonly<Date>): QuarterSeparatorSeed => {
  const firstColumnEnd = columns[0] === undefined ? undefined : getHeatmapColumnEndDate(columns[0]);
  const startDate = (firstColumnEnd === undefined ? undefined : getCalendarQuarterStartDatesBetween(quarterRangeStart, firstColumnEnd).at(-1)) ?? quarterRangeStart;
  const quarter = getCalendarQuarter(startDate);
  const groups: HeatmapSeparatorGroup[] = [
    {
      label: `Q${quarter}`,
      quarter,
      startColumnIndex: 0,
      startDate,
      year: startDate.getFullYear(),
    },
  ];
  return { groups, usedColumns: new Set<number>([0]) };
}

interface AppendQuarterSeparatorGroupParams {
  readonly columns: readonly HeatmapColumn[];
  readonly groups: HeatmapSeparatorGroup[];
  readonly quarterStart: Readonly<Date>;
  readonly usedColumns: Set<number>;
}

// One quarter-start date becomes a group unless its column is taken or is the seed column.
const appendQuarterSeparatorGroup = (params: Readonly<AppendQuarterSeparatorGroupParams>): void => {
  const { columns, groups, quarterStart, usedColumns } = params;
  const columnIndex = findHeatmapColumnIndexForDate(columns, quarterStart);
  if (columnIndex !== undefined && columnIndex !== 0 && !usedColumns.has(columnIndex)) {
    usedColumns.add(columnIndex);
    const quarter = getCalendarQuarter(quarterStart);
    groups.push({
      label: `Q${quarter}`,
      quarter,
      startColumnIndex: columnIndex,
      startDate: quarterStart,
      year: quarterStart.getFullYear(),
    });
  }
}

interface AppendQuarterSeparatorGroupsParams {
  readonly columns: readonly HeatmapColumn[];
  readonly gridEnd: Readonly<Date>;
  readonly groups: HeatmapSeparatorGroup[];
  readonly quarterRangeStart: Readonly<Date>;
  readonly usedColumns: Set<number>;
}

const appendQuarterSeparatorGroups = (params: Readonly<AppendQuarterSeparatorGroupsParams>): void => {
  const { columns, gridEnd, groups, quarterRangeStart, usedColumns } = params;
  const quarterStarts = getCalendarQuarterStartDatesBetween(quarterRangeStart, gridEnd);
  for (const quarterStart of quarterStarts) {
    appendQuarterSeparatorGroup({ columns, groups, quarterStart, usedColumns });
  }
}

const buildHeatmapQuarterSeparatorGroups = (columns: HeatmapColumn[]): HeatmapSeparatorGroup[] => {
  if (columns.length === 0) {return [];}

  const extent = getHeatmapTimeExtent(columns);
  if (!extent) {return [];}

  const quarterRangeStart = resolveQuarterRangeStart(columns, extent[0]);
  const { groups, usedColumns } = createQuarterSeparatorSeed(columns, quarterRangeStart);
  appendQuarterSeparatorGroups({ columns, gridEnd: extent[1], groups, quarterRangeStart, usedColumns });

  groups.sort((groupA: Readonly<HeatmapSeparatorGroup>, groupB: Readonly<HeatmapSeparatorGroup>) => groupA.startColumnIndex - groupB.startColumnIndex);
  return groups;
}

/** The resolved separator layout, or `null` when separators are disabled or have no effect. */
// Quarter-grouped separators; null when separators are disabled or have no effect.
const resolveQuarterSeparatorLayout = (config: Readonly<HeatmapSeparatorParsedConfig>, columns: HeatmapColumn[]): HeatmapSeparatorLayout | null => {
  const groups = buildHeatmapQuarterSeparatorGroups(columns);
  if (groups.length === 0) {return null;}

  const atColumns: number[] = [];
  for (const group of groups) {
    if (group.startColumnIndex > 0) {atColumns.push(group.startColumnIndex);}
  }

  return { atColumns, groups, spacing: config.spacing };
}

export const resolveHeatmapSeparatorLayout = (config: Readonly<HeatmapSeparatorParsedConfig> | null, columns: HeatmapColumn[]): HeatmapSeparatorLayout | null => {
  if (!config) {return null;}

  if (config.groupBy === "quarter") {
    return resolveQuarterSeparatorLayout(config, columns);
  }

  // Bind before the guard so the positive-count narrowing carries to the call below.
  const every = config.every ?? 0;
  if (every <= 0) {return null;}

  const atColumns = getHeatmapSeparatorColumnIndices(columns.length, every);

  return { atColumns, groups: [], spacing: config.spacing };
}

interface HeatmapSeparatorLineYParams {
  readonly innerHeight: number;
  readonly marginTop: number;
  /** Distance from the chart container top to the line start. Default: plot top. */
  readonly startOffset?: number;
  readonly paddingY?: number;
}

interface HeatmapSeparatorLineYSpan {
  readonly y1: number;
  readonly y2: number;
}

/** Vertical span for a separator line in plot coordinates. */
export const getHeatmapSeparatorLineY = ({ innerHeight, marginTop, startOffset, paddingY = 0 }: Readonly<HeatmapSeparatorLineYParams>): HeatmapSeparatorLineYSpan => {
  const y1 = (startOffset ?? marginTop) - marginTop + paddingY;
  return { y1, y2: Math.max(innerHeight - paddingY, y1) };
};

/** Separator line style. */
export type HeatmapSeparatorStrokeStyle = "solid" | "dashed";

const DEFAULT_DASHED_STROKE_DASHARRAY = "4,4";

/** The stroke dasharray for `strokeStyle` (an explicit `strokeDasharray` overrides), or `undefined` for a solid line. */
export const resolveHeatmapSeparatorStrokeDasharray = (strokeStyle: HeatmapSeparatorStrokeStyle = "solid", strokeDasharray?: string): string | undefined => {
  if (strokeStyle !== "dashed") {return undefined;}
  return strokeDasharray ?? DEFAULT_DASHED_STROKE_DASHARRAY;
}

/** Vertical stroke gradient for separator lines (`from` -> optional `via` -> `to`). */
export interface HeatmapSeparatorGradient {
  readonly from: string;
  readonly via?: string;
  readonly to: string;
  readonly fromOpacity?: number;
  readonly viaOpacity?: number;
  readonly toOpacity?: number;
}

interface HeatmapSeparatorGradientStop {
  readonly offset: string;
  readonly color: string;
  readonly opacity: number;
}

const DEFAULT_GRADIENT_STOP_OPACITY = 1;

/** Builds SVG gradient stops for a vertical separator line. */
export const buildHeatmapSeparatorGradientStops = (gradient: Readonly<HeatmapSeparatorGradient>, strokeOpacity = 1): HeatmapSeparatorGradientStop[] => {
  const scaleOpacity = (value: number | undefined, fallback: number = DEFAULT_GRADIENT_STOP_OPACITY): number => (value ?? fallback) * strokeOpacity;

  if (gradient.via !== undefined) {
    return [
      { color: gradient.from, offset: "0%", opacity: scaleOpacity(gradient.fromOpacity) },
      { color: gradient.via, offset: "50%", opacity: scaleOpacity(gradient.viaOpacity) },
      { color: gradient.to, offset: "100%", opacity: scaleOpacity(gradient.toOpacity) },
    ];
  }

  return [
    { color: gradient.from, offset: "0%", opacity: scaleOpacity(gradient.fromOpacity) },
    { color: gradient.to, offset: "100%", opacity: scaleOpacity(gradient.toOpacity) },
  ];
}
