import { COMMIT_MS, commitSteps, headEasing, settleFrames, FRAME_MS } from "./head-ease";
import type { LabelTrack } from "./live-steps";
import { labelWalk } from "./live-steps";
import type { TailGeometry, TailMotion } from "./live-tail";
import { tailPaths } from "./live-tail";

/** bklit's ring (live-line.tsx:250-275): r from dotSize to dotSize * 3.5 and opacity 0.5 -> 0 over 1.5 s, linear, again and again. */
const RING_MS = 1500;
const RING_REACH = 3.5;
const RING_OPACITY = 0.5;

/** One tick: when the renderer drew it, the nodes the clock writes and where their motion starts (Frame.roll and the head's offsets). */
export interface HeadTick {
  /** performance.now() when the renderer drew the tick: its rolling tween's start, and this clock's. */
  readonly origin: number;
  /** The roll: its length and ease (the path's tween's). */
  readonly rollMs: number;
  readonly rollEase: (progress: number) => number;
  /** The roll eases continuously (the intro's): the head is written on every frame the path moves on, not on the commit steps. */
  readonly continuous: boolean;
  /** The head's motion; none on the seed frame, which is drawn at rest. */
  readonly head: {
    /** The tip group (none during the intro, whose tip follows the chart's own tween). */
    readonly tip: SVGElement | null;
    /** The tail's fill path and its two stretches (A, B), and their geometry at rest; none without a tail. */
    readonly tail: { readonly geometry: TailGeometry; readonly fill: Element | null; readonly a: Element; readonly b: Element } | null;
    readonly motion: Omit<TailMotion, "roll" | "settle">;
    /** The tip's start offsets (px): where bklit's display lerp stands (Frame.dy) and the y reprojection's at the tip (Frame.roll.d). */
    readonly dy: number;
    readonly d: number;
    /** bklit's lerp speed: the settle's length and ease. */
    readonly lerp: number;
  } | null;
  readonly labels: readonly LabelTrack[];
  /** The area's path, which rides the line's rolling transform (definition.ts liveArea): copied from the line's path whenever the renderer
   * moves it; none without a fill. */
  readonly follow: { readonly line: Element; readonly area: Element } | null;
  /** The pulse ring under the dot, and the dot's radius. */
  readonly ring: { readonly node: SVGElement; readonly dotSize: number } | null;
}

export interface HeadClock {
  readonly start: (tick: HeadTick) => void;
  /** Writes the step on screen again (the renderer drew the same tick again, at rest). */
  readonly refresh: () => void;
  readonly stop: () => void;
}

interface Settle {
  readonly ms: number;
  readonly ease: (p: number) => number;
}

/** The head settle: bklit's per-frame lerp over `settleFrames(lerp)` frames, held for each commit step (live-css.ts ran it as a CSS `linear()` stair). */
const settleOf = (lerp: number): Settle => {
  const ms = Math.round(settleFrames(lerp) * FRAME_MS);
  const ease = headEasing(lerp);
  const n = commitSteps(ms);
  return { ms, ease: (p) => (p >= 1 ? 1 : Number(ease(Math.floor(Math.max(0, p) * n) / n).toFixed(4))) };
};

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

export function createHeadClock(): HeadClock {
  let tick: HeadTick | null = null;
  let walk: ReturnType<typeof labelWalk> | null = null;
  let frame = 0;
  /** The grid step on screen (-1: none). */
  let shown = -1;
  let settle: Settle = settleOf(0.08);
  let settleLerp = 0.08;
  /** The step period: the path's (rollMs over its commit steps). */
  let period = COMMIT_MS;
  /** The line's transform the area last took (undefined: none yet). */
  let followed: string | null | undefined;

  /** The area takes the line's rolling transform as the renderer wrote it this frame (its tick runs before this one); true while there is one. */
  const follow = (t: HeadTick): boolean => {
    const f = t.follow;
    if (!f) {
      return false;
    }
    const transform = f.line.getAttribute("transform");
    if (transform !== followed) {
      followed = transform;
      if (transform === null) {
        f.area.removeAttribute("transform");
      } else {
        f.area.setAttribute("transform", transform);
      }
    }
    return transform !== null;
  };

  /** Writes the head, the labels and the ring `elapsed` ms into the tick; true while any of them has more to show. */
  const write = (t: HeadTick, elapsed: number): boolean => {
    let pending = false;
    const head = t.head;
    if (head) {
      const er = t.rollEase(Math.min(1, elapsed / (t.rollMs || 1)));
      const es = settle.ease(elapsed / (settle.ms || 1));
      if (head.tip) {
        const y = head.dy * (1 - es) + head.d * (1 - er);
        head.tip.style.transform = y === 0 ? "" : `translate(0px,${fmt(y)}px)`;
      }
      if (head.tail) {
        const paths = tailPaths(head.tail.geometry, { ...head.motion, roll: er, settle: es });
        head.tail.fill?.setAttribute("d", paths.fill);
        head.tail.a.setAttribute("d", paths.a);
        head.tail.b.setAttribute("d", paths.b);
      }
      pending ||= er < 1 || es < 1;
    }
    if (walk) {
      pending = walk.apply(Math.floor(elapsed / COMMIT_MS)) || pending;
    }
    if (t.ring) {
      // The ring's phase runs on the page's clock, so a tick never restarts its cycle.
      const phase = ((t.origin + elapsed) % RING_MS) / RING_MS;
      t.ring.node.setAttribute("r", fmt(t.ring.dotSize * (1 + (RING_REACH - 1) * phase)));
      t.ring.node.style.opacity = String(Math.round(RING_OPACITY * (1 - phase) * 1000) / 1000);
      pending = true;
    }
    return pending;
  };

  const step = (time: number): void => {
    frame = 0;
    const t = tick;
    if (!t) {
      return;
    }
    const rolling = follow(t);
    const elapsed = Math.max(0, time - t.origin);
    const k = Math.floor(elapsed / period);
    let pending = true;
    if (t.continuous) {
      shown = k;
      pending = write(t, elapsed);
    } else if (k !== shown) {
      shown = k;
      pending = write(t, k * period);
    }
    if (pending || rolling) {
      frame = requestAnimationFrame(step);
    }
  };

  const stop = (): void => {
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    tick = null;
    walk = null;
    shown = -1;
  };

  return {
    start: (next) => {
      stop();
      tick = next;
      walk = next.labels.length > 0 ? labelWalk(next.labels) : null;
      if (next.head && next.head.lerp !== settleLerp) {
        settleLerp = next.head.lerp;
        settle = settleOf(next.head.lerp);
      }
      period = next.rollMs / commitSteps(next.rollMs);
      followed = undefined;
      const rolling = follow(next);
      // Step 0 now: the renderer has just drawn the tick at rest, and the frame that shows it must show the motion's start.
      shown = 0;
      if (write(next, 0) || rolling) {
        frame = requestAnimationFrame(step);
      }
    },
    refresh: () => {
      const t = tick;
      if (!t || shown < 0) {
        return;
      }
      walk = t.labels.length > 0 ? labelWalk(t.labels) : null;
      followed = undefined;
      const rolling = follow(t);
      if ((write(t, shown * period) || rolling) && frame === 0) {
        frame = requestAnimationFrame(step);
      }
    },
    stop,
  };
}
