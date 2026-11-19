import { restOf, springOf } from "./spring-curve";
import { HIGHLIGHT_SPRING } from "./springs";

interface Axis {
  target: number;
  /** Displacement from `target` and velocity (px/s) at `t0`. */
  x0: number;
  v0: number;
  t0: number;
}

interface Band {
  readonly x: Axis;
  readonly w: Axis;
  frame: number;
  /** The rects this band moves: the clipPath's, and a soft-ended (`fadeLength`) highlight's mask's of the same span. */
  rects: readonly SVGRectElement[];
  /** Their `data-bkm-band` value: `""` for the one-row span, `s<n>` for a wider `highlight.span`. */
  readonly key: string;
}

interface AxisSample {
  readonly value: number;
  readonly velocity: number;
  readonly rest: boolean;
}

const bands = /* @__PURE__ */ new WeakMap<HTMLElement, Map<string, Band>>();

const read = (axis: Axis, now: number): AxisSample => {
  const sample = springOf(HIGHLIGHT_SPRING, restOf(axis.x0)).sample(now - axis.t0, { from: axis.x0, to: 0, velocity: axis.v0 });
  return { rest: sample.done, value: axis.target + sample.value, velocity: sample.velocity };
};

const retarget = (axis: Axis, target: number, now: number, jump: boolean): void => {
  const live = jump ? { value: target, velocity: 0 } : read(axis, now);
  axis.x0 = live.value - target;
  axis.v0 = live.velocity;
  axis.target = target;
  axis.t0 = now;
};

/** Sets `name` unless the rect already holds `value`: an identical attribute write still invalidates the clip and the paths it clips (the band's width holds while its x springs). */
const setIfChanged = (rect: SVGRectElement, name: string, value: string): void => {
  if (rect.getAttribute(name) !== value) {
    rect.setAttribute(name, value);
  }
};

const write = (host: HTMLElement, band: Band, lo: number, hi: number): void => {
  if (band.rects.length === 0 || !band.rects.every((rect) => rect.isConnected)) {
    band.rects = [...host.querySelectorAll<SVGRectElement>(`[data-bkm-band="${band.key}"]`)];
  }
  const x = lo.toFixed(2);
  const width = (hi - lo).toFixed(2);
  for (const rect of band.rects) {
    setIfChanged(rect, "x", x);
    setIfChanged(rect, "width", width);
  }
};

const tick = (host: HTMLElement, band: Band, now: number): void => {
  band.frame = 0;
  if (!host.isConnected) { return; }
  const x = read(band.x, now);
  const w = read(band.w, now);
  if (x.rest && w.rest) {
    write(host, band, band.x.target, band.x.target + band.w.target);
    return;
  }
  write(host, band, x.value, x.value + w.value);
  // Frame loop standing in for bklit's motion springs (use-highlight-segment.ts:44-57); runs only while one is in flight.
  band.frame = requestAnimationFrame((next) => {
    tick(host, band, next);
  });
};

/** Springs the host's highlight band `key` (`data-bkm-band`) to [`lo`, `hi`] (svg px); `jump` places it there at once (the hover just entered). */
const springBand = (host: HTMLElement, lo: number, hi: number, jumpRequested: boolean, key = ""): void => {
  const now = performance.now();
  let byKey = bands.get(host);
  if (byKey === undefined) {
    byKey = new Map();
    bands.set(host, byKey);
  }
  let band = byKey.get(key);
  const jump = jumpRequested || band === undefined;
  if (band === undefined) {
    band = { frame: 0, key, rects: [], w: { t0: now, target: 0, v0: 0, x0: 0 }, x: { t0: now, target: 0, v0: 0, x0: 0 } };
    byKey.set(key, band);
  }
  retarget(band.x, lo, now, jump);
  retarget(band.w, hi - lo, now, jump);
  if (jump) {
    if (band.frame !== 0) { cancelAnimationFrame(band.frame); band.frame = 0; }
    write(host, band, lo, hi);
    return;
  }
  if (band.frame === 0) {
    const live = band;
    // Frame loop standing in for bklit's motion springs (use-highlight-segment.ts:44-57); runs only while one is in flight.
    live.frame = requestAnimationFrame((frameNow) => {
      tick(host, live, frameNow);
    });
  }
};

export { springBand };
