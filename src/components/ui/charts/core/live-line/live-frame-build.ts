import type { LiveRow } from "./definition";
import { FRAME_MS, introEasing, linearEase } from "./head-ease";
import { getDisplayFrameMs } from "./live-display";
import { niceDomain, pickStep, rollEase } from "./live-frame";
import type { Frame, FrameState, LiveSample, RollClock, RollY, StepPick } from "./live-frame";
import { detectMomentum } from "./momentum";
import { memoCell } from "../memo";

const OVERSCAN_ROWS = 4;

/** The sample's value for the chart's dataKey (a sample may carry extra fields beyond time and value). */
function sampleValue(sample: LiveSample & Record<string, unknown>, key: string): number {
  const raw = sample[key];
  return typeof raw === "number" ? raw : sample.value;
}

/** A drawn-domain change this many px beyond what the continuous ease explains is a jump (liveline.css). */
const JUMP_PX = 2;
const MIN_ROLL_MS = 120;
const MAX_ROLL_MS = 2000;

type Domain = [number, number];

/** bklit's target range: raw extent padded by 15% (3% when exaggerated). */
function targetRange(values: readonly number[], exaggerate: boolean): Domain {
  if (values.length === 0) {
    return [0, 100];
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const raw = max - min;
  const pad = raw * (exaggerate ? 0.03 : 0.15) || (exaggerate ? 0.04 : 10);
  return [min - pad, max + pad];
}

export interface LiveFrameInput {
  readonly width: number;
  readonly data: readonly LiveSample[];
  readonly value: number;
  readonly dataKey: string;
  readonly top: number;
  readonly windowSecs: number;
  readonly exaggerate: boolean;
  readonly lerpSpeed: number;
  readonly paused: boolean;
  readonly pxPerMs: number;
  readonly plotWidth: number;
  readonly stepSecs: number;
  readonly innerHeight: number;
  readonly minGap: number;
  readonly plotRight: number;
  readonly rollEdge: number;
}

interface TickArgs extends LiveFrameInput {
  readonly introRun: boolean;
}

/** The window's rows: the real samples right-aligned in a constant slot count, left-padded with the first value. */
function buildRows(real: readonly LiveSample[], key: string, slots: number, interval: number): LiveRow[] {
  const rows: LiveRow[] = [];
  const head = real.at(0);
  const first = head?.time ?? 0;
  const firstCandidate = head === undefined ? 0 : sampleValue(head, key);
  const firstValue = Number.isFinite(firstCandidate) ? firstCandidate : 0;
  for (let k = slots - real.length; k > 0; k -= 1) {
    rows.push({ key: `p${k}`, t: (first - k * interval) * 1000, v: firstValue, pad: true });
  }
  // A sample that is not a finite number (bklit's path then breaks) holds the previous value, so the line never carries NaN.
  let carried = firstValue;
  for (const p of real) {
    const v = sampleValue(p, key);
    carried = Number.isFinite(v) ? v : carried;
    rows.push({ key: `t${Math.round(p.time * 1000)}`, t: p.time * 1000, v: carried, pad: false });
  }
  return rows;
}

/** The dot's time at rest: now for the seed, otherwise the end of this roll, moved only when a new row arrives. */
function stampTip(st: FrameState, seed: boolean, newestKey: string, rollMs: number): number {
  if (seed || st.tipAt === null || newestKey !== st.newest) {
    st.tipAt = Date.now() + (seed ? 0 : rollMs);
  }
  return st.tipAt;
}

/** bklit's display value in closed form: target + (shown - target) * (1 - lerp) ** frames, re-anchored when the target or newest sample changes;
 * the value at a sample's arrival is where the tail's dot end starts (live-tail.ts). */
function advanceDisplay(st: FrameState, newestKey: string, value: number, lerpSpeed: number, now: number): void {
  const first = st.newest === null;
  if (first) {
    st.disp = value;
    st.arrival = value;
  }
  if (!first && (newestKey !== st.newest || value !== st.target)) {
    st.disp = st.target + (st.disp - st.target) * (1 - lerpSpeed) ** (Math.min(now - st.dispStamp, 4000) / FRAME_MS);
    if (newestKey !== st.newest) {
      st.arrival = st.disp;
      st.parity = st.parity === 0 ? 1 : 0;
    }
  }
  st.newest = newestKey;
  st.target = value;
  st.dispStamp = now;
}

interface YStep {
  readonly prev: Domain | null;
  readonly eased: Domain;
  readonly y: Domain;
}

/** The raw y state moved a step `f` toward the target: an edge leaving the domain jumps, one entering it closes `f` of the gap. */
function easedDomain(seeding: boolean, prev: Domain | null, target: Domain, f: number): Domain {
  const [tLo, tHi] = target;
  if (seeding) {
    return [Math.min(0, tLo), Math.max(100, tHi)];
  }
  if (!prev) {
    return [tLo, tHi];
  }
  return [tLo < prev[0] ? tLo : prev[0] + (tLo - prev[0]) * f, tHi > prev[1] ? tHi : prev[1] + (tHi - prev[1]) * f];
}

/** Eases the raw y state onto the target (the seed frame holds 0..100) and returns the drawn nice domain. */
function easeY(st: FrameState, seeding: boolean, target: Domain, lerpSpeed: number, now: number): YStep {
  const f = 1 - (1 - lerpSpeed) ** (Math.min(now - st.stamp, 2000) / getDisplayFrameMs());
  const prev = st.y;
  const eased = easedDomain(seeding, prev, target, f);
  st.stamp = now;
  if (!seeding) {
    st.y = eased;
  }
  // bklit's y scale is `nice: true`: the drawn domain snaps outward to round values while the eased state stays raw.
  return { prev, eased, y: niceDomain(eased) };
}

/** Whether the drawn domain jumped this tick: bklit moves an expanding edge and every nice() step at once; the renderer keeps the rolling transform even under y "fixed"
 * (charts-core motion-path.ts:129-135) and the jump's CSS slide (liveline.css bkm-slide) would add to it. */
function drawnJumped(st: FrameState, step: YStep, target: Domain, ppu: number): boolean {
  const { prev, eased, y } = step;
  const { drawn } = st;
  if (prev === null || drawn === null) {
    return false;
  }
  return [0, 1].some((i) => {
    const edge = i === 0 ? target[0] < prev[0] : target[1] > prev[1];
    const moved = y[i] - drawn[i];
    return moved !== 0 && Math.abs(edge ? moved : moved - (eased[i] - prev[i])) * ppu > JUMP_PX;
  });
}

/** The path's rolling transform maps this tick's y to the previous tick's (linear in s and t over the roll); the same affine as introStart from the previous drawn domain.
 * A jump snaps the path instead, and the intro roll has its own start. */
function rollingRy(st: FrameState, y: Domain, intro: boolean, top: number, innerHeight: number): RollY {
  const a = st.drawn;
  if (!a || st.jump || intro) {
    return { s: 1, t: 0 };
  }
  const span = a[1] - a[0] || 1;
  const s = (y[1] - y[0]) / span;
  return { s, t: top * (1 - s) + (innerHeight * (a[1] - y[1])) / span };
}

/** Area floor stays constant between updates (rolling contract); only moves when the domain leaves it. */
function settleFloor(st: FrameState, floorRef: Domain): number {
  const floorSpan = floorRef[1] - floorRef[0];
  if (st.floor === null || floorRef[0] < st.floor || floorRef[0] - st.floor > 2 * floorSpan) {
    st.floor = floorRef[0] - 0.3 * floorSpan;
  }
  return st.floor;
}

/** Height of the block under the tail's sloped end at rest over its height at the start of the tick (live-tail.ts). */
function tailRatio(dyPx: number, value: number, floor: number, y: Domain, innerHeight: number): number {
  const rest = ((value - floor) * innerHeight) / (y[1] - y[0] || 1);
  return dyPx > 0 && rest - dyPx > 1 ? rest / (rest - dyPx) : 1;
}

/** The path's intro start transform: the final scene seen through the seed's y scale (motion-path.ts fitAffine of the retained points),
 * so the tail can start from the same place and ride the same easing. */
function introStart(st: FrameState, y: Domain, top: number, innerHeight: number): RollY {
  const seedY = st.seedY ?? y;
  const s = (y[1] - y[0]) / (seedY[1] - seedY[0] || 1);
  return { s, t: top * (1 - s) + (innerHeight * (seedY[1] - y[1])) / (seedY[1] - seedY[0] || 1) };
}

interface RollPlan {
  readonly xDomain: Domain;
  readonly pxPerMs: number;
  readonly now: number;
  readonly intro: boolean;
  readonly introY: RollY;
  readonly lerpSpeed: number;
  readonly rollMs: number;
}

/** The path's start transform for this roll (Frame.roll): the renderer composes it with the new plan, sampling the remainder at the latest frame time on the previous roll's clock and easing.
 * A jump snaps the path (fallback "snap"). */
function nextRoll(st: FrameState, p: RollPlan): RollClock {
  const shift = st.x0 === null ? 0 : (p.xDomain[0] - st.x0) * p.pxPerMs;
  const clock = typeof document === "undefined" ? null : document.timeline.currentTime;
  const at = typeof clock === "number" ? clock : p.now;
  const r = st.roll;
  const e = rollEase(r, at);
  const left = r && !st.jump ? { x: r.x * (1 - e), s: 1 + (r.s - 1) * (1 - e), t: r.t * (1 - e) } : { x: 0, s: 1, t: 0 };
  let plan = p.intro ? p.introY : st.ry;
  if (st.jump) {
    plan = { s: 1, t: 0 };
  }
  return { x: left.x + shift, s: left.s * plan.s, t: left.s * plan.t + left.t, dur: p.rollMs, ease: p.intro ? introEasing(p.lerpSpeed, p.rollMs) : linearEase, at: null };
}

interface TailSplit {
  readonly ak: number;
  readonly b0: number;
}

/** A spans N-1 (xa) to N, B spans N to the dot. bklit draws a sample `now - time` left of the dot, capped at it (live-line-chart.tsx:475-490): an on-time sample enters at the dot;
 * an older one (the seed's newest) starts on its clock position, A rigid and B part grown (b0). */
function tailSplit(newestT: number, prevT: number, tipT: number, pxPerMs: number, rollX: number): TailSplit {
  const aw = (newestT - prevT) * pxPerMs;
  const bw = (tipT - newestT) * pxPerMs;
  const b0 = bw > 0.5 ? Math.min(1, Math.max(0, (bw - rollX) / bw)) : 0;
  const ak = aw > 0.5 ? Math.max(0, ((tipT - prevT) * pxPerMs - b0 * bw - rollX) / aw) : 1;
  return { ak, b0 };
}

/** One tick's frame, advancing the rolling state in the order bklit's loop does. */
function buildFrame(a: TickArgs, st: FrameState, yPick: StepPick): Frame {
  const { data, value, dataKey: key, top, innerHeight, pxPerMs, plotRight, rollEdge, lerpSpeed, introRun } = a;
  // Slot count and pad spacing are fixed per window size: the keyed row count must not drift.
  if (st.slots === 0 || st.windowSecs !== a.windowSecs) {
    st.interval = a.stepSecs;
    st.slots = Math.ceil(a.windowSecs / st.interval) + OVERSCAN_ROWS;
    st.windowSecs = a.windowSecs;
  }
  const { interval } = st;
  // The seed frame omits the newest row: the first update then appends it, a keyed roll the native planner can run.
  const seed = !introRun && st.y === null;
  const real = (seed ? data.slice(0, -1) : data).slice(-st.slots);
  const rows = buildRows(real, key, st.slots, interval);
  // bklit's x domain ends at the wall clock: a sample sits `now - time` left of the dot (live-line-chart.tsx:126, :475-490). A frame is that view at
  // the end of its roll (`Date.now() + rollMs`), keyed on sample times so a late sample cannot collapse the tail's N -> dot stretch (getLiveLineSeed).
  const newestT = (real.at(-1)?.time ?? 0) * 1000;
  const rollMs = Math.min(MAX_ROLL_MS, Math.max(MIN_ROLL_MS, interval * 1000));
  const newestKey = rows.at(-1)?.key ?? "";
  const tipT = stampTip(st, seed, newestKey, rollMs);
  const xEnd = tipT - 2 * interval * 1000;
  const xDomain: Domain = [xEnd - a.plotWidth / pxPerMs, xEnd - (plotRight - rollEdge) / pxPerMs];
  // N-1 later than the slack leaves the path short of the renderer's edge, which snaps it: carry x by the jump's CSS slide.
  const prevT = (real.at(-2)?.time ?? real.at(-1)?.time ?? 0) * 1000;
  const xa = plotRight - (xEnd - prevT) * pxPerMs;
  // bklit ranges over every sample it is given (its buffer holds twice the window), not just the rows drawn here.
  const target = targetRange([...data.map((p) => sampleValue(p, key)), value].filter(Number.isFinite), a.exaggerate);
  const now = performance.now();
  const fresh = newestKey !== st.newest;
  advanceDisplay(st, newestKey, value, lerpSpeed, now);
  if (introRun && st.introData === null) {
    st.introData = data;
  }
  const intro = introRun && st.introData === data;
  const step = easeY(st, seed, target, lerpSpeed, now);
  const { y } = step;
  if (fresh && !seed) {
    st.jump = xa < rollEdge - 0.05 || drawnJumped(st, step, target, innerHeight / (y[1] - y[0] || 1));
    st.ry = rollingRy(st, y, intro, top, innerHeight);
  }
  if (seed) {
    st.seedY = y;
  } else {
    st.drawn = y;
  }
  const floor = settleFloor(st, seed ? target : y);
  const dyPx = ((value - st.arrival) * innerHeight) / (y[1] - y[0] || 1);
  const kRatio = tailRatio(dyPx, value, floor, y, innerHeight);
  if (fresh && !seed) {
    st.roll = nextRoll(st, { xDomain, pxPerMs, now, intro, introY: introStart(st, y, top, innerHeight), lerpSpeed, rollMs });
  }
  st.x0 = xDomain[0];
  const c = !seed && st.roll ? st.roll : { x: 0, s: 1, t: 0 };
  const tipY = top + ((y[1] - value) * innerHeight) / (y[1] - y[0] || 1);
  const { ak, b0 } = tailSplit(newestT, prevT, tipT, pxPerMs, c.x);
  const out: Frame = {
    rows,
    xDomain,
    yDomain: y,
    areaFloor: floor,
    tip: { t: tipT, v: value },
    // bklit detects on its context data: the window's samples plus two virtual points at the lerped display value (live-line-chart.tsx:
    // 469-490, live-line.tsx:144-146). The display value settles on `value`; the switch lands at tick start, not mid-lerp.
    momentum: detectMomentum([...real, { [key]: value }, { [key]: value }], key),
    rollMs,
    seed,
    intro,
    disp0: st.arrival,
    parity: st.parity,
    roll: { x: c.x, s: c.s, t: c.t, d: (c.s - 1) * tipY + c.t, ak, xa, b0 },
    jump: st.jump,
    dy: dyPx,
    k: kRatio,
    yTarget: target,
    // bklit's first render picks over its 0..100 domain (live-line-chart.tsx:349-355, live-y-axis.tsx:117-132); later picks are LiveYLabels'.
    interval: yPick.raw === null ? pickStep(yPick, [0, 100], innerHeight, a.minGap) : yPick.interval,
  };
  st.last = out;
  return out;
}


/** One chart's rolling frame state, fed its latest inputs on every render. */
export interface LiveFrameBuilder {
  /** The rolling state, one object for the chart's life: the roll the path runs (read by the focus glide and the y labels). */
  readonly state: FrameState;
  /** bklit's y label step latch, one object for the chart's life (the y labels' re-pick loop advances it). */
  readonly yPick: StepPick;
  /** The frame for these inputs: null before the first width or sample, the last one while paused; rebuilt only when an input changes or the intro starts. */
  frame(input: LiveFrameInput): Frame | null;
  /** After the commit that shows `frame` (React: a passive effect): starts the intro roll once a frame is on screen. True when it did (the owner renders again). */
  startIntro(frame: Frame | null): boolean;
  /** In the commit that shows `frame` (React: a layout effect): stamps its roll's start on the next animation frame. */
  stampRoll(frame: Frame | null): void;
}

/** bklit seeds the y domain at 0..100 then eases onto the data (live-line-chart.tsx:376-431; LIVE_FRAME_COMMIT_MS passes on the first tick); here: seed that domain, then one eased roll.
 * The roll's first sample lands a frame after its commit (charts-core motion.ts:3986-3988, `start ??= time`), so it is committed in the seed's mount effect to start the frame after bklit's first step. */
export function createLiveFrame(): LiveFrameBuilder {
  let introRun = false;
  const state: FrameState = { slots: 0, interval: 1, windowSecs: 0, y: null, floor: null, stamp: 0, introData: null, last: null, drawn: null, jump: false, ry: { s: 1, t: 0 }, x0: null, roll: null, seedY: null, newest: null, disp: 0, target: 0, dispStamp: 0, arrival: 0, parity: 0, tipAt: null };
  const yPick: StepPick = { range: 0, interval: 0, commit: 0, raw: null };
  const frameCell = memoCell<Frame | null>();
  return {
    state,
    yPick,
    frame: (input) => {
      const { width, data, value, dataKey, top, windowSecs, exaggerate, lerpSpeed, paused, pxPerMs, plotWidth, stepSecs, innerHeight, minGap, plotRight, rollEdge } = input;
      return frameCell([width, data, value, dataKey, top, windowSecs, exaggerate, lerpSpeed, paused, pxPerMs, plotWidth, stepSecs, introRun, innerHeight, minGap, plotRight, rollEdge], () => {
        // Nothing mounts before ParentSize's first width (see the timing at the head of controller.ts).
        if (width === 0) {
          return null;
        }
        if (paused && state.last) {
          return state.last;
        }
        if (data.length === 0) {
          return null;
        }
        return buildFrame({ ...input, introRun }, state, yPick);
      });
    },
    startIntro: (frame) => {
      if (introRun || !frame) {
        return false;
      }
      introRun = true;
      return true;
    },
    // The roll's clock: the renderer starts its tween on the first frame after the commit (charts-core motion.ts:3986-3988, `start ??= time`),
    // as do the CSS animations it restarts; the next roll samples what is left of this one from that start (Frame.roll).
    stampRoll: (frame) => {
      const r = state.roll;
      if (!frame || frame.seed || !r || r.at !== null) {
        return;
      }
      // Stamps the roll start on the next frame, the clock bklit eases on (live-line-chart.tsx:383-431); UPSTREAM-GAPS #43.
      requestAnimationFrame((t) => { r.at ??= t; });
    },
  };
}
