import { REST_PX, springOf } from "../motion/spring-curve";
import { CROSSHAIR_FOLLOW, CROSSHAIR_SPRING } from "../motion/springs";
import type { Frame, RollClock, RowLayout } from "./live-frame";
import { rollEase, rollYAt } from "./live-frame";
import { clearAttribute, clearVar, raiseAttribute, writeVar } from "../host-write";

/** bklit's crosshair spring: rule, dot and time pill follow the pointer on a `useSpring` of `tooltipSpring` (bklit 300/30; CROSSHAIR_SPRING, the snappy hover spring, here) (chart-config-context.tsx:20; tooltip-indicator.tsx:110-118, tooltip-dot.tsx:58-62, live-x-axis.tsx:12,92),
 * velocity-carrying, rest thresholds motion's for px (motion-dom 12.27.0 spring/defaults.mjs). The renderer's guide motion cannot carry it: each roll frame restarts its tween at elapsed 0 (charts-core motion.ts:1088-1104, 3990), UPSTREAM-GAPS #43. */
const CROSSHAIR_GLIDE = /* @__PURE__ */ springOf(CROSSHAIR_SPRING, REST_PX);
interface GlideAxis {
  from: number;
  to: number;
  velocity: number;
  start: number;
}
function glideAt(a: GlideAxis, time: number): ReturnType<typeof CROSSHAIR_GLIDE.sample> {
  return CROSSHAIR_GLIDE.sample(time - a.start, { from: a.from, to: a.to, velocity: a.velocity });
}
function retarget(a: GlideAxis, to: number, time: number): void {
  const now = glideAt(a, time);
  a.from = now.value;
  a.velocity = now.velocity;
  a.to = to;
  a.start = time;
}
/** The drawn line's y at plot x (svg px) at frame time `time`, the target bklit's dot springs to (live-line-chart.tsx:229-269): the frame's rows at rest moved by what is left of the roll's transform (Frame.roll).
 * It is the chord between samples, used only as a difference: the marker's offset is the spring's lag behind it, 0 on the renderer's own marker. */
function lineYAt(f: Frame, r: RollClock | null, time: number, layout: { left: number; x0: number; pxPerMs: number }, top: number, height: number, x: number): number {
  const e = rollEase(r, time);
  const tAt = layout.x0 + (x - (r ? r.x * (1 - e) : 0) - layout.left) / (layout.pxPerMs || 1);
  const pts = f.rows.filter((row) => !row.pad);
  if (f.tip) {
    pts.push({ key: "tip", t: f.tip.t, v: f.tip.v, pad: false });
  }
  let v = pts[0]?.v ?? 0;
  let lo = 0;
  let hi = pts.length - 1;
  if (pts.length > 1 && tAt > (pts[0]?.t ?? 0)) {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if ((pts[mid]?.t ?? 0) <= tAt) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const a = pts.at(lo);
    const b = pts.at(hi);
    if (a !== undefined && b !== undefined) {
      v = tAt >= b.t ? b.v : a.v + ((b.v - a.v) * (tAt - a.t)) / (b.t - a.t || 1);
    }
  }
  const [y0, y1] = f.yDomain;
  const ry = rollYAt(r, time);
  return ry.s * (top + ((y1 - v) * height) / (y1 - y0 || 1)) + ry.t;
}

/** What the glide reads of the chart each frame: the frame on screen and the plot's top and height (svg px). */
export interface GlideView {
  readonly frame: Frame | null;
  readonly top: number;
  readonly height: number;
}

/** The cells the glide reads at each call and frame: the host it marks, the element its lag vars go on, the view, the roll the path runs and the row layout. */
export interface CrosshairGlideSource {
  /** Carries `data-bkm-pglide` (liveline.css keys the offset rules on it). */
  readonly host: { readonly current: HTMLElement | null };
  /** Takes `--bkm-pgx` / `--bkm-pgy`: the line's surface, under the y labels' layer and the host's other children (live-focus.ts). */
  readonly vars: { readonly current: HTMLElement | null };
  readonly view: { readonly current: GlideView };
  readonly state: { readonly current: { readonly roll: RollClock | null } };
  readonly layout: { readonly current: RowLayout };
}

export interface CrosshairGlide {
  /** Springs the crosshair toward the pointer's `x` (a first call starts it at rest there). */
  readonly glideTo: (x: number) => void;
  /** Cancels the spring and clears its host writes. */
  readonly stopGlide: () => void;
}

// The pointer crosshair's spring (CROSSHAIR_SPRING): the surface offsets the renderer's rule, pill and marker by its lag (`--bkm-pgx` / `--bkm-pgy`), stepped on
// animation frames like motion's useSpring (tooltip-indicator.tsx:110); a pointer focus starts at rest where it appears (tooltip-indicator.tsx:75-82).
export function createCrosshairGlide({ host, vars, view, state, layout }: CrosshairGlideSource): CrosshairGlide {
  let glide: { x: GlideAxis; y: GlideAxis; raf: number } | null = null;
  const glideTarget = (x: number, time: number): number | null => {
    const g = view.current;
    return g.frame ? lineYAt(g.frame, state.current.roll, time, layout.current, g.top, g.height, x) : null;
  };
  const stopGlide = (): void => {
    const el = host.current;
    const target = vars.current;
    const g = glide;
    if (g?.raf) {
      cancelAnimationFrame(g.raf);
    }
    glide = null;
    clearAttribute(el, "data-bkm-pglide");
    clearVar(target, "--bkm-pgx");
    clearVar(target, "--bkm-pgy");
  };
  const glideTo = (x: number): void => {
    // The crosshair lands at once (CROSSHAIR_FOLLOW null): the renderer already puts the guide under the pointer, so no lag to add.
    if (CROSSHAIR_FOLLOW === null) {
      return;
    }
    const el = host.current;
    const target = vars.current;
    const time = performance.now();
    const y = glideTarget(x, time);
    if (!el || !target || y === null) {
      return;
    }
    const g = glide;
    if (!g) {
      glide = { x: { from: x, to: x, velocity: 0, start: time }, y: { from: y, to: y, velocity: 0, start: time }, raf: 0 };
      return;
    }
    retarget(g.x, x, time);
    retarget(g.y, y, time);
    // The renderer moves the guide to the pointer in this event's frame: the lag goes with it.
    writeVar(target, "--bkm-pgx", (g.x.from - x).toFixed(2));
    writeVar(target, "--bkm-pgy", (g.y.from - y).toFixed(2));
    raiseAttribute(el, "data-bkm-pglide");
    if (g.raf) {
      return;
    }
    const step = (t: number): void => {
      const cur = glide;
      if (!cur) {
        return;
      }
      const sx = glideAt(cur.x, t);
      const sy = glideAt(cur.y, t);
      if (sx.done && sy.done) {
        cur.x = { from: cur.x.to, to: cur.x.to, velocity: 0, start: t };
        cur.y = { from: cur.y.to, to: cur.y.to, velocity: 0, start: t };
        cur.raf = 0;
        clearAttribute(el, "data-bkm-pglide");
        clearVar(target, "--bkm-pgx");
        clearVar(target, "--bkm-pgy");
        return;
      }
      writeVar(target, "--bkm-pgx", (sx.value - cur.x.to).toFixed(2));
      writeVar(target, "--bkm-pgy", (sy.value - cur.y.to).toFixed(2));
      raiseAttribute(el, "data-bkm-pglide");
      // Next spring frame (live-x-axis.tsx:92; UPSTREAM-GAPS #43).
      cur.raf = requestAnimationFrame(step);
    };
    // bklit's crosshair useSpring ticks per frame (live-x-axis.tsx:92; UPSTREAM-GAPS #43).
    g.raf = requestAnimationFrame(step);
  };
  return { glideTo, stopGlide };
}
