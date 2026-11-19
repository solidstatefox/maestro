const e10 = /* @__PURE__ */ Math.sqrt(50);
const e5 = /* @__PURE__ */ Math.sqrt(10);
const e2 = /* @__PURE__ */ Math.sqrt(2);

function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(step));
  const error = step / 10 ** power;
  const factor = error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1;
  let i1: number;
  let i2: number;
  let inc: number;
  if (power < 0) {
    inc = 10 ** -power / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = 10 ** power * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && count >= 0.5 && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

export function ticks(start: number, stop: number, count: number): number[] {
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const reverse = stop < start;
  const [i1, i2, inc] = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const out = new Array<number>(i2 - i1 + 1);
  for (let i = 0; i < out.length; ++i) {
    const k = reverse ? i2 - i : i1 + i;
    out[i] = inc < 0 ? k / -inc : k * inc;
  }
  return out;
}

export const tickIncrement = (start: number, stop: number, count: number): number => tickSpec(+start, +stop, +count)[2];

function tickStep(start: number, stop: number, count: number): number {
  const reverse = stop < start;
  const inc = reverse ? tickIncrement(stop, start, count) : tickIncrement(start, stop, count);
  return (reverse ? -1 : 1) * (inc < 0 ? 1 / -inc : inc);
}

const SECOND = 1e3;
const MINUTE = 6e4;
const HOUR = 36e5;
const DAY = 864e5;
const WEEK = 6048e5;
const MONTH = 2592e6;
const YEAR = 31536e6;

/** A d3-time interval on epoch milliseconds: `floor` snaps down, `offset` steps by whole intervals (callers pass an already floored time). */
export interface TimeInterval {
  floor: (t: number) => number;
  offset: (t: number, step: number) => number;
  ceil: (t: number) => number;
}

const make = (floor: (t: number) => number, offset: (t: number, step: number) => number): TimeInterval => ({
  floor,
  offset,
  ceil: (t) => floor(offset(floor(t - 1), 1)),
});

// d3-time `interval.filter(test)`: the same grid, kept only where `test` holds.
const filtered = ({ floor, offset }: TimeInterval, test: (t: number) => boolean): TimeInterval =>
  make(
    (t) => {
      if (t >= t) while (((t = floor(t)), !test(t))) t -= 1;
      return t;
    },
    (t, step) => {
      if (t >= t) {
        if (step < 0) while (++step <= 0) while (((t = offset(t, -1)), !test(t)));
        else while (--step >= 0) while (((t = offset(t, 1)), !test(t)));
      }
      return t;
    }
  );

// d3-time `interval.range(start, stop)`.
const range = (interval: TimeInterval, start: number, stop: number): Date[] => {
  const out: Date[] = [];
  start = interval.ceil(start);
  if (!(start < stop)) return out;
  let previous: number;
  do {
    out.push(new Date((previous = start)));
    start = interval.floor(interval.offset(start, 1));
  } while (previous < start && start < stop);
  return out;
};

function families(utc: boolean) {
  const U = utc ? "UTC" : "";
  const get = (t: number, name: string): number => (new Date(t) as unknown as Record<string, () => number>)[`get${U}${name}`]();
  const edit = (t: number, change: (d: Date) => void): number => {
    const d = new Date(t);
    change(d);
    return +d;
  };
  const set = (d: Date, name: string, ...args: number[]) => (d as unknown as Record<string, (...a: number[]) => void>)[`set${U}${name}`](...args);
  const clock = (parts: number) => (t: number) => {
    // d3-time floors second/minute/hour as subtractions of the finer fields (local) or as `setUTC*` (UTC); the results coincide on a whole-second offset.
    let r = t - get(t, "Milliseconds");
    if (parts > 1) r -= get(t, "Seconds") * SECOND;
    if (parts > 2) r -= get(t, "Minutes") * MINUTE;
    return r;
  };
  const step = (unit: number) => (t: number, n: number) => t + n * unit;
  const day = (t: number) => edit(t, (d) => set(d, "Hours", 0, 0, 0, 0));
  const dayOffset = (t: number, n: number) => edit(t, (d) => set(d, "Date", get(t, "Date") + n));
  const plain = {
    second: make(clock(1), step(SECOND)),
    minute: make(clock(2), step(MINUTE)),
    hour: make(clock(3), step(HOUR)),
    day: make(day, dayOffset),
    week: make(
      (t) => day(edit(t, (d) => set(d, "Date", get(t, "Date") - ((get(t, "Day") + 7) % 7)))),
      (t, n) => edit(t, (d) => set(d, "Date", get(t, "Date") + n * 7))
    ),
    month: make(
      (t) => edit(t, (d) => (set(d, "Date", 1), set(d, "Hours", 0, 0, 0, 0))),
      (t, n) => edit(t, (d) => set(d, "Month", get(t, "Month") + n))
    ),
  };
  const field = (name: string) => (t: number) => get(t, name);
  const every = (interval: TimeInterval, fieldOf: (t: number) => number, k: number) => (k > 1 ? filtered(interval, (t) => fieldOf(t) % k === 0) : interval);
  const dayField = utc ? (t: number) => Math.floor(t / DAY) : (t: number) => get(t, "Date") - 1;
  const yearEvery = (k: number): TimeInterval | null => {
    k = Math.floor(k);
    if (!isFinite(k) || !(k > 0)) return null;
    return make(
      (t) => edit(t, (d) => (set(d, "FullYear", Math.floor(get(t, "FullYear") / k) * k), set(d, "Month", 0, 1), set(d, "Hours", 0, 0, 0, 0))),
      (t, n) => edit(t, (d) => set(d, "FullYear", get(t, "FullYear") + n * k))
    );
  };
  const millisecondEvery = (k: number): TimeInterval | null => {
    k = Math.floor(k);
    if (!isFinite(k) || !(k > 0)) return null;
    return k > 1 ? make((t) => Math.floor(t / k) * k, (t, n) => t + n * k) : make((t) => t, (t, n) => t + n);
  };
  const grid: [number, () => TimeInterval][] = [
    [SECOND, () => plain.second],
    [5 * SECOND, () => every(plain.second, field("Seconds"), 5)],
    [15 * SECOND, () => every(plain.second, field("Seconds"), 15)],
    [30 * SECOND, () => every(plain.second, field("Seconds"), 30)],
    [MINUTE, () => plain.minute],
    [5 * MINUTE, () => every(plain.minute, field("Minutes"), 5)],
    [15 * MINUTE, () => every(plain.minute, field("Minutes"), 15)],
    [30 * MINUTE, () => every(plain.minute, field("Minutes"), 30)],
    [HOUR, () => plain.hour],
    [3 * HOUR, () => every(plain.hour, field("Hours"), 3)],
    [6 * HOUR, () => every(plain.hour, field("Hours"), 6)],
    [12 * HOUR, () => every(plain.hour, field("Hours"), 12)],
    [DAY, () => plain.day],
    [2 * DAY, () => every(plain.day, dayField, 2)],
    [WEEK, () => plain.week],
    [MONTH, () => plain.month],
    [3 * MONTH, () => every(plain.month, field("Month"), 3)],
    [YEAR, () => yearEvery(1)!],
  ];
  // d3-time `tickInterval`: the coarsest listed step whose duration is at most the target, snapping to the nearer of the two neighbours.
  const tickInterval = (start: number, stop: number, count: number): TimeInterval | null => {
    const target = Math.abs(stop - start) / count;
    let i = 0;
    while (i < grid.length && grid[i][0] <= target) i++;
    if (i === grid.length) return yearEvery(tickStep(start / YEAR, stop / YEAR, count));
    if (i === 0) return millisecondEvery(Math.max(tickStep(start, stop, count), 1));
    return grid[target / grid[i - 1][0] < grid[i][0] / target ? i - 1 : i][1]();
  };
  return tickInterval;
}

const intervalOf = [/* @__PURE__ */ families(false), /* @__PURE__ */ families(true)];

/** d3-time `timeTickInterval` / `utcTickInterval` on epoch milliseconds. */
export const timeTickInterval = (utc: boolean, start: number, stop: number, count: number): TimeInterval | null => intervalOf[+utc](start, stop, count);

/** d3-time `timeTicks` / `utcTicks`. */
export function timeTicks(utc: boolean, startDate: Date, stopDate: Date, count: number): Date[] {
  let start = +startDate;
  let stop = +stopDate;
  const reverse = stop < start;
  if (reverse) [start, stop] = [stop, start];
  const interval = timeTickInterval(utc, start, stop, count);
  const out = interval ? range(interval, start, stop + 1) : [];
  return reverse ? out.reverse() : out;
}
