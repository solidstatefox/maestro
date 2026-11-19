import { MS_PER_SECOND } from "../theme";
/**
 * Calendar months shown in default one-year contribution grids.
 * @internal
 */
export const HEATMAP_MONTHS_ONE_YEAR = 12;

/**
 * Half-year contribution grids (gallery card demos).
 * @internal
 */
export const HEATMAP_MONTHS_SIX = 6;

/**
 * Nominal week count for one year (~52). Default data uses calendar-month math instead.
 * @internal
 */
export const HEATMAP_WEEKS_ONE_YEAR = 52;

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const DAYS_PER_WEEK = 7;
const MS_PER_WEEK = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND * DAYS_PER_WEEK;

/** Default minimum days a lead week must contain on/after `rangeStart` to avoid being skipped. */
const DEFAULT_MIN_DAYS_IN_FIRST_WEEK = 4;

/** @internal */
export const getHeatmapCalendarRangeStart = (today: Readonly<Date>, months: number): Date => {
  const monthOffset = months === HEATMAP_MONTHS_SIX ? months : months - 1;
  const start = new Date(today.getFullYear(), today.getMonth() - monthOffset, 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** @internal */
export const getHeatmapYearStartMonth = (today: Readonly<Date>): Date => getHeatmapCalendarRangeStart(today, HEATMAP_MONTHS_ONE_YEAR);


/** @internal */
export const getHeatmapWeekStartSunday = (date: Readonly<Date>): Date => {
  const sunday = new Date(date);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

/** @internal */
export const getHeatmapWeekCount = (startSunday: Readonly<Date>, endDate: Readonly<Date>): number => {
  const endSunday = getHeatmapWeekStartSunday(endDate);
  return Math.floor((endSunday.getTime() - startSunday.getTime()) / MS_PER_WEEK) + 1;
}

/** Days in a Sun-Sat column on or after `threshold` (for trimming partial lead weeks). */
const countHeatmapWeekDaysOnOrAfter = (weekStart: Readonly<Date>, threshold: Readonly<Date>): number => {
  const day = new Date(weekStart);
  day.setHours(0, 0, 0, 0);
  const cutoff = new Date(threshold);
  cutoff.setHours(0, 0, 0, 0);
  let count = 0;
  for (let i = 0; i < DAYS_PER_WEEK; i += 1) {
    if (day >= cutoff) {count += 1;}
    day.setDate(day.getDate() + 1);
  }
  return count;
}

/**
 * First Sunday week column with enough days on/after `rangeStart`; skips a lead week mostly before the range.
 * @internal
 */
export const getHeatmapWeekStartAlignedToRange = (rangeStart: Readonly<Date>, minDaysInFirstWeek: number = DEFAULT_MIN_DAYS_IN_FIRST_WEEK): Date => {
  const startDate = getHeatmapWeekStartSunday(rangeStart);
  const weekEnd = new Date(startDate);
  weekEnd.setDate(weekEnd.getDate() + (DAYS_PER_WEEK - 1));

  // Keep the Sun-Sat column that contains the 1st (e.g. Jan 1 in a partial lead week).
  if (rangeStart >= startDate && rangeStart <= weekEnd) {
    return startDate;
  }

  while (countHeatmapWeekDaysOnOrAfter(startDate, rangeStart) < minDaysInFirstWeek) {
    startDate.setDate(startDate.getDate() + DAYS_PER_WEEK);
  }

  return startDate;
}

/**
 * A calendar window: its first week start, week count and first in-range day.
 * @internal
 */
export interface HeatmapWeekRange {
  /** Start of the first week of the window. */
  readonly startDate: Date;
  /** Number of week columns in the window. */
  readonly weekCount: number;
  /** First in-range calendar day; bins before this are empty in default year grids. */
  readonly rangeStart: Date | null;
}

/** Rolling-week fallback for a non-default `weeks` window ending at `endDate`. */
// Rolling-week fallback for the non-default `weeks` window.
const resolveRollingHeatmapWeekRange = (endDate: Readonly<Date>, weeks: number): HeatmapWeekRange => {
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (weeks - 1) * DAYS_PER_WEEK);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  startDate.setHours(0, 0, 0, 0);
  return { rangeStart: null, startDate, weekCount: weeks };
}

/** @internal */
export const resolveHeatmapWeekRange = (today: Readonly<Date>, weeks: number = HEATMAP_WEEKS_ONE_YEAR): HeatmapWeekRange => {
  const endDate = new Date(today);
  endDate.setHours(0, 0, 0, 0);

  if (weeks === HEATMAP_WEEKS_ONE_YEAR) {
    const rangeStart = getHeatmapYearStartMonth(endDate);
    const startDate = getHeatmapWeekStartAlignedToRange(rangeStart);
    return { rangeStart, startDate, weekCount: getHeatmapWeekCount(startDate, endDate) };
  }

  return resolveRollingHeatmapWeekRange(endDate, weeks);
}
