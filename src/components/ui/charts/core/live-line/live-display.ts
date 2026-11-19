import { FRAME_MS } from "./head-ease";

/** The display's frame period (ms): bklit eases once per rAF tick (live-line-chart.tsx:383-431), so its cadence is the display's. Measured once, from the first controller's creation
 * from a short bounded run of rAF timestamps (no loop), 60Hz until then; the shortest gap is taken since jank only lengthens one. */
let displayFrameMs = FRAME_MS;
let displayFrameMeasured = false;
const MEASURE_FRAMES = 8;
const REFRESH_HZ = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
function nearestRefreshMs(gap: number): number {
  let pick = 1000 / REFRESH_HZ[0];
  for (const hz of REFRESH_HZ) {
    const ms = 1000 / hz;
    if (Math.abs(ms - gap) < Math.abs(pick - gap)) {
      pick = ms;
    }
  }
  return pick;
}
export function measureDisplayFrame(): void {
  if (displayFrameMeasured || typeof requestAnimationFrame === "undefined") {
    return;
  }
  displayFrameMeasured = true;
  let prev = -1;
  let best = Number.POSITIVE_INFINITY;
  let left = MEASURE_FRAMES;
  const step = (t: number): void => {
    if (prev >= 0 && t - prev >= 4) {
      best = Math.min(best, t - prev);
    }
    prev = t;
    left -= 1;
    if (left > 0) {
      // Same bounded measuring run as above (live-line-chart.tsx:383-431).
      requestAnimationFrame(step);
    } else if (best <= 50) {
      // rAF timestamps jitter by ~1ms; snap to the nearest common refresh rate.
      displayFrameMs = nearestRefreshMs(best);
    } else {
      // Slower than 20Hz: keep the 60Hz default.
    }
  };
  // One rAF per tick of bklit's per-frame lerp, whose period this measures (live-line-chart.tsx:383-431).
  requestAnimationFrame(step);
}

export const getDisplayFrameMs = (): number => displayFrameMs;
