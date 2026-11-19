const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

type Unit = "ms" | "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

/** d3-time's tick intervals (`utcTicks`): a unit, its step and the duration it stands for. */
const INTERVALS: readonly (readonly [Unit, number, number])[] = [
  ["second", 1, SECOND], ["second", 5, 5 * SECOND], ["second", 15, 15 * SECOND], ["second", 30, 30 * SECOND],
  ["minute", 1, MINUTE], ["minute", 5, 5 * MINUTE], ["minute", 15, 15 * MINUTE], ["minute", 30, 30 * MINUTE],
  ["hour", 1, HOUR], ["hour", 3, 3 * HOUR], ["hour", 6, 6 * HOUR], ["hour", 12, 12 * HOUR],
  ["day", 1, DAY], ["day", 2, 2 * DAY], ["week", 1, WEEK], ["month", 1, MONTH], ["month", 3, 3 * MONTH], ["year", 1, YEAR],
];

/** A "nice" step (1, 2, 5 × 10ⁿ) near `span / count`, for milliseconds and years. */
const niceStep = (span: number, count: number): number => {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const error = raw / power;
  if (error >= 7.07) {
    return 10 * power;
  }
  if (error >= 3.16) {
    return 5 * power;
  }
  return error >= 1.41 ? 2 * power : power;
};

/** The first tick at or after `t` on `unit` every `step` (UTC). */
const floorTo = (t: number, unit: Unit, step: number): Date => {
  const d = new Date(t);
  switch (unit) {
    case "year":
      return new Date(Date.UTC(Math.floor(d.getUTCFullYear() / step) * step, 0, 1));
    case "month":
      return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / step) * step, 1));
    case "week":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()));
    case "day":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDate() - 1) % step)));
    default: {
      const size = unit === "hour" ? HOUR : unit === "minute" ? MINUTE : unit === "second" ? SECOND : 1;
      return new Date(Math.floor(t / (size * step)) * size * step);
    }
  }
};

const advance = (d: Date, unit: Unit, step: number): Date => {
  const next = new Date(d.getTime());
  switch (unit) {
    case "year":
      next.setUTCFullYear(next.getUTCFullYear() + step);
      break;
    case "month":
      next.setUTCMonth(next.getUTCMonth() + step);
      break;
    case "week":
      next.setUTCDate(next.getUTCDate() + 7 * step);
      break;
    case "day": {
      next.setUTCDate(next.getUTCDate() + step);
      // d3's `utcDay.every(step)` restarts on each month's first day.
      if (step > 1 && next.getUTCMonth() !== d.getUTCMonth()) {
        next.setUTCDate(1);
      }
      break;
    }
    default:
      next.setTime(next.getTime() + (unit === "hour" ? HOUR : unit === "minute" ? MINUTE : unit === "second" ? SECOND : 1) * step);
  }
  return next;
};

/** About `count` round UTC times from `start` to `stop` (ms), as d3's `utcTicks`. */
export const radialUtcTicks = (start: number, stop: number, count: number): number[] => {
  const lo = Math.min(start, stop);
  const hi = Math.max(start, stop);
  const target = (hi - lo) / Math.max(1, count);
  let unit: Unit = "ms";
  let step = 1;
  const index = INTERVALS.findIndex(([, , duration]) => duration >= target);
  if (index === -1) {
    unit = "year";
    step = niceStep((hi - lo) / YEAR, count);
  } else if (index === 0) {
    step = Math.max(1, niceStep(hi - lo, count));
  } else {
    // The interval whose duration is nearer the target (d3 bisects by ratio).
    const [u0, s0, d0] = INTERVALS[index - 1] ?? INTERVALS[0];
    const [u1, s1, d1] = INTERVALS[index] ?? INTERVALS[0];
    [unit, step] = target / d0 < d1 / target ? [u0, s0] : [u1, s1];
  }
  const ticks: number[] = [];
  let at = floorTo(lo, unit, step);
  if (at.getTime() < lo) {
    at = advance(at, unit, step);
  }
  for (let guard = 0; at.getTime() <= hi && guard < 10_000; guard += 1) {
    ticks.push(at.getTime());
    at = advance(at, unit, step);
  }
  return start > stop ? ticks.reverse() : ticks;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** d3's multi-scale UTC tick format (`scaleUtc().tickFormat()`): by the finest unit the date isn't at the start of. */
export const radialUtcTickFormat = (date: Date): string => {
  const hours = date.getUTCHours();
  const hour12 = pad2(hours % 12 === 0 ? 12 : hours % 12);
  if (date.getUTCMilliseconds() !== 0) {
    return `.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
  }
  if (date.getUTCSeconds() !== 0) {
    return `:${pad2(date.getUTCSeconds())}`;
  }
  if (date.getUTCMinutes() !== 0) {
    return `${hour12}:${pad2(date.getUTCMinutes())}`;
  }
  if (hours !== 0) {
    return `${hour12} ${hours < 12 ? "AM" : "PM"}`;
  }
  if (date.getUTCDate() !== 1) {
    return date.getUTCDay() === 0 ? `${MONTHS[date.getUTCMonth()]} ${pad2(date.getUTCDate())}` : `${WEEKDAYS[date.getUTCDay()]} ${pad2(date.getUTCDate())}`;
  }
  return date.getUTCMonth() === 0 ? String(date.getUTCFullYear()) : (MONTH_NAMES[date.getUTCMonth()] ?? "");
};
