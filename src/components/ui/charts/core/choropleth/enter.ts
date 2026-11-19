import type { ChartMotionTiming } from "@tanstack/charts";
import { toEaseFn, toMotionTransition } from "../motion/enter-transition";
import type { EnterTransition } from "../motion/phase";

const ENTER_FADE_MS = 1100;
const UPDATE_MORPH_MS = 180;
const FADE_SAMPLES = 32;

export type EnterMotion = ReturnType<typeof toMotionTransition>;

/** The reveal epoch (the context's `revealEpoch`): 1 on the first `update`, one more each time `animationDuration` or `revealSignature`
 * changes. The controller feeds it each pass's props (React: while rendering, as the state it replaced was adjusted). */
export function createRevealEpoch(): { update(animationDuration: number, revealSignature: string): number } {
  let key: string | undefined = undefined;
  let epoch = 0;
  return {
    update(animationDuration, revealSignature) {
      const next = `${animationDuration}|${revealSignature}`;
      if (next !== key) {
        key = next;
        epoch += 1;
      }
      return epoch;
    },
  };
}

// geoShape has no first-paint motion (UPSTREAM-GAPS #12), so the first paint's fade is CSS; a joining feature fades via this tween, other updates morph briefly.
// Pan/zoom never reach the definition: the zoom layer writes the transform to the host and CSS moves the marks.
/** The tween a joining feature fades in with. */
export const enterMotionOf = (enterTransition: EnterTransition | undefined): EnterMotion => toMotionTransition(enterTransition, { durationMs: ENTER_FADE_MS, keywordEases: true });

/** The fade as CSS values: bklit's curve over its first `animationDuration` ms (the isLoaded cut, choropleth-feature.tsx:381-385, snaps it to 1 when the animation ends), as a `linear()` easing. */
export const computeFadeVars = (animationDuration: number, enterTransition: EnterTransition | undefined): Record<string, string> => {
  if (animationDuration <= 0) {return { "--bkm-choro-fade-ms": "0ms" };}
  const curve = toEaseFn(enterTransition?.ease);
  const total = enterTransition?.duration === undefined ? ENTER_FADE_MS : enterTransition.duration * 1000;
  const span = total > 0 ? Math.min(1, animationDuration / total) : 1;
  const end = curve(span);
  const stops: string[] = [];
  for (let i = 0; i <= FADE_SAMPLES; i += 1) {
    stops.push((end === 0 ? 0 : curve((i / FADE_SAMPLES) * span) / end).toFixed(4));
  }
  return { "--bkm-choro-fade-end": String(end), "--bkm-choro-fade-ease": `linear(${stops.join(",")})`, "--bkm-choro-fade-ms": `${animationDuration}ms` };
};

/** Per-layer `motion` option shared by the features and graticule geoShape layers. */
export const createLayerMotion = (enterMotion: EnterMotion) => (context: { phase: string }): ChartMotionTiming =>
  context.phase === "enter" ? { transition: enterMotion } : { transition: { duration: UPDATE_MORPH_MS, easing: "ease-out", type: "tween" } as const };
