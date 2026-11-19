import type { ChartDefinition, ChartTextMeasurer } from "@tanstack/charts";
import { memoCell } from "../memo";
import type { ChartMargin } from "../theme";
import { buildLiveYAxisDefinition } from "./definition";
import type { LiveRow } from "./definition";
import { COMMIT_MS } from "./head-ease";
import { pickStep, rollYAt, shownDomain, stepRaw } from "./live-frame";
import type { Frame, RollClock, StepPick } from "./live-frame";
import { yTickValues } from "./live-yaxis";

/** Gap between y labels and the plot, and the advance of one 12px mono glyph (bklit's font-mono text-xs). */
export const Y_LABEL_GAP = 8;
const Y_LABEL_CHAR_PX = 7.2;

/**
 * The y labels' text measure, by their glyphs' advance: they are 12px mono (styles/live-line.css), so their width is their length. Their
 * chart lays out on explicit margins and draws every label (`thin: false`), so the bounds steer nothing; measuring them on a canvas only
 * cost the mount a canvas, a font read (a forced style recalc) and a first canvas measure, all before the first paint.
 */
export const measureYLabel: ChartTextMeasurer = (text, { fontSize, fontScale, anchor, baseline, direction }) => {
  const size = fontSize * (fontScale > 0 ? fontScale : 1);
  const width = text.length * Y_LABEL_CHAR_PX * (size / 12);
  const x = anchor === "middle" ? -width / 2 : (anchor === "start") === (direction !== "rtl") ? 0 : -width;
  const y = baseline === "middle" ? -size / 2 : baseline === "hanging" ? 0 : -size * 0.8;
  return { x, y, width, height: size };
};

/** A label step and the domain the labels are laid out on. */
export interface YLabelPick {
  readonly interval: number;
  readonly domain: readonly [number, number];
}

/** A pick the re-pick loop committed, for the frame it was made on. */
export interface ShownYLabels extends YLabelPick {
  readonly frame: Frame;
}

/** Where a frame's labels start, before the loop's first pick on it. */
export interface YLabelStart {
  /** The intro, and the frame after it, follow the domain on screen; later frames keep their own. */
  readonly follow: boolean;
  readonly start: YLabelPick;
}

export interface YLabelRepickInput extends YLabelStart {
  readonly frame: Frame;
  /** The frame builder's rolling state (its `roll` is the path's clock). */
  readonly roll: { readonly roll: RollClock | null };
  readonly pick: StepPick;
  readonly top: number;
  readonly innerHeight: number;
  readonly minGap: number;
  readonly lerp: number;
}

export interface YLabelDefinitionInput extends YLabelStart {
  readonly frame: Frame;
  /** The loop's latest commit (null before its first). */
  readonly shown: ShownYLabels | null;
  readonly margin: ChartMargin;
  readonly innerHeight: number;
  readonly allowDecimals: boolean;
  readonly position: "left" | "right";
  readonly format: (v: number) => string;
  /** bklit's label box width (the margin minus its 8px gap). */
  readonly labelBox: number;
  readonly labelShift: number;
}

export interface LiveYLabels {
  /** Per render: whether `frame` follows the domain on screen, and the pick its labels start on. */
  readonly start: (frame: Frame, top: number, innerHeight: number) => YLabelStart;
  /** After the commit that shows `frame` (React: a passive effect): the re-pick loop, reporting each new pick to `onShown`. Returns its cancel. */
  readonly repick: (input: YLabelRepickInput, onShown: (shown: ShownYLabels) => void) => () => void;
  /** Per render: the labels' chart definition. */
  readonly definition: (input: YLabelDefinitionInput) => ChartDefinition<LiveRow, Date, number>;
}

/** The y labels as their own chart over the line's, as bklit's LiveYAxis is its own layer (live-y-axis.tsx:188-191) re-reading the domain each 32ms commit (live-line-chart.tsx:275-284: step with hysteresis :120-129, labels :135-157, slots :160-176, spring :198-205).
 * In 1.0 a tick set lives in the scene, so a new step on the line's chart re-planned and snapped the path (charts-core motion.ts:985, motion-path.ts:94); here only this chart renders. Re-picks the on-screen domain (rollYAt) each display frame past COMMIT_MS until the first pick after settle. */
export function createLiveYLabels(): LiveYLabels {
  // The intro, and the frame after it (a sample that lands mid-intro carries what is left of that roll, motion.ts:1918-1923), follow the
  // domain on screen; later frames keep their own.
  let prior: { frame: Frame | null; intro: boolean } = { frame: null, intro: false };
  const startCell = memoCell<YLabelPick>();
  // A label leaving the set stays, fading to 0, for the rest of the frame (bklit: AnimatePresence opacity spring, live-y-axis.tsx:191-205). The native
  // exit is cancelled by each render (charts-core motion.ts:985, `cancel: cleanup`), so a kept label's opacity is an update track the next render resumes.
  // A leaving label also keeps where it stood (plot px from the top, under the pick that last showed it): bklit's exit animates opacity only
  // (live-y-axis.tsx:205), so it fades in place instead of gliding to the plot's edge, where an intro's many leaving labels would pile up.
  let kept: {
    frame: Frame | null;
    values: readonly number[];
    leaving: readonly number[];
    domain: readonly [number, number] | null;
    height: number;
    frozen: ReadonlyMap<number, number>;
  } = { frame: null, values: [], leaving: [], domain: null, height: 0, frozen: new Map() };
  const definitionCell = memoCell<ChartDefinition<LiveRow, Date, number>>();
  return {
    start: (frame, top, innerHeight) => {
      if (prior.frame !== frame) {
        prior = { frame, intro: frame.intro || (prior.frame?.intro ?? false) };
      }
      const follow = prior.intro;
      // Before this frame's first pick: those labels start where the line does (the roll's start transform), the rest on the frame's domain.
      const start = startCell([frame, follow, top, innerHeight], () => ({ interval: frame.interval, domain: follow ? shownDomain(frame.yDomain, frame.roll, top, innerHeight) : frame.yDomain }));
      return { follow, start };
    },
    repick: ({ frame, roll, pick, top, innerHeight, minGap, lerp, follow, start }, onShown) => {
      let last: YLabelPick = start;
      let raf = 0;
      const tick = (time: number): void => {
        const r = roll.roll;
        const p = pick;
        // bklit's raw domain steps once per rAF tick (live-line-chart.tsx:105-127, :383-431), whether or not the tick commits.
        const raw = stepRaw(p, frame.yTarget, lerp);
        // bklit's commit clock is performance.now() read inside the tick, not the rAF timestamp (live-line-chart.tsx:399, :281), so a late tick
        // (a long mount frame) shifts every later commit with it.
        const now = performance.now();
        if (now - p.commit >= COMMIT_MS) {
          p.commit = now;
          const onScreen = shownDomain(frame.yDomain, rollYAt(r, time), top, innerHeight);
          const interval = pickStep(p, raw, innerHeight, minGap);
          const domain = follow ? onScreen : frame.yDomain;
          // The seed frame only advances the latch (bklit's first tick already steps and picks, live-line-chart.tsx:383-431); its labels are the frame's own.
          if (frame.seed) {
            raf = requestAnimationFrame(tick);
            return;
          }
          if (interval !== last.interval || domain[0] !== last.domain[0] || domain[1] !== last.domain[1]) {
            last = { interval, domain };
            onShown({ frame, interval, domain });
          }
          if (!r || (r.at !== null && time - r.at >= r.dur)) {
            return;
          }
        }
        // Next re-pick frame (live-line-chart.tsx:383-431).
        raf = requestAnimationFrame(tick);
      };
      // Labels re-pick per lerp frame like bklit (live-line-chart.tsx:383-431, live-y-axis.tsx:191-205).
      raf = requestAnimationFrame(tick);
      return (): void => { cancelAnimationFrame(raf); };
    },
    definition: ({ frame, shown, start, follow, margin, innerHeight, allowDecimals, position, format, labelBox, labelShift }) => {
      const now = shown?.frame === frame ? shown : start;
      return definitionCell([frame, now.domain, now.interval, innerHeight, allowDecimals, format, margin, position, labelShift, labelBox], () => {
        const ticks = yTickValues(now.domain, now.interval, innerHeight, allowDecimals);
        const continued = kept.frame === frame || (follow && kept.frame !== null);
        const was = continued ? [...kept.values, ...kept.leaving] : [];
        const tickSet = new Set(ticks);
        const leaving = [...new Set(was.filter((v) => !tickSet.has(v)))];
        const frozen = new Map<number, number>();
        for (const v of leaving) {
          const held = kept.frozen.get(v);
          if (held !== undefined) {
            frozen.set(v, held);
          } else if (continued && kept.domain && kept.domain[1] > kept.domain[0]) {
            // Where it stood under the last pick, within bklit's keep band (live-y-axis.tsx:182).
            const [lo, hi] = kept.domain;
            frozen.set(v, ((hi - v) / (hi - lo)) * kept.height);
          }
        }
        kept = { frame, values: ticks, leaving, domain: now.domain, height: innerHeight, frozen };
        // bklit's label box is the margin minus an 8px gap, text right-aligned inside it; a label wider than that box overflows
        // towards the plot edge rather than past the container. Native anchors at the axis, so shrink the gap.
        const widest = Math.max(0, ...ticks.map((v) => format(v).length)) * Y_LABEL_CHAR_PX;
        return buildLiveYAxisDefinition({
          xDomain: frame.xDomain,
          yDomain: now.domain,
          margin,
          formatValue: format,
          yPosition: position,
          yTicks: [...ticks, ...leaving].sort((a, b) => a - b),
          yLeaving: leaving,
          yFrozen: frozen,
          yLabelPad: Y_LABEL_GAP + labelShift - Math.max(0, widest - labelBox),
          plotHeight: innerHeight,
        });
      });
    },
  };
}
