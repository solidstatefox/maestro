import { afterPaint } from "../lifecycle/after-paint";
import { alignEntranceStart } from "./entrance-origin";

/** CSS entrances that start with the release, aligned from the moment that releases it (see entrance-origin.ts).
 * The series markers' fade (SeriesPointMarker) is WAAPI, mounted by the reveal (frame origin). */
const REVEAL_ORIGINS = { "bkm-mk-in": "frame", "bkm-wipe-o": "frame", "bkm-wipe-i": "frame" } as const;

const EVT_ORIGINS = { "bkm-evt-in": "motion", "bkm-evt-fade": "frame" } as const;

/** One passive moment of the reveal trigger at `stage` (0: the mount's). Stage 0 aligns the event markers and returns true: step again
 * at the next passive moment with `stage + 1`. A later stage calls `onArm` (the native wipe opens, the composed bars start to grow) and
 * aligns the released entrances. */
export function revealArmStep(stage: number, host: HTMLElement | null, onArm?: () => void): boolean {
  if (stage < 1) {
    // bklit's MarkerGroup entrance is created by the mount effect (the first commit), not by the reveal.
    if (stage === 0 && host) { alignEntranceStart(host, EVT_ORIGINS); }
    return true;
  }
  onArm?.();
  // Not cancelled by a later step: the two frames it waits for must run once.
  if (host) { alignEntranceStart(host, REVEAL_ORIGINS); }
  return false;
}

/** The reveal trigger for a port, called from `mounted()` (its first post-paint moment): stage 0 at once, the arm after the next paint.
 * Returns the cancel function. */
export function armReveal(host: () => HTMLElement | null, onArm?: () => void): () => void {
  let cancel = (): void => undefined;
  const step = (stage: number): void => {
    if (revealArmStep(stage, host(), onArm)) {
      cancel = afterPaint(() => { step(stage + 1); });
    }
  };
  step(0);
  return () => { cancel(); };
}
