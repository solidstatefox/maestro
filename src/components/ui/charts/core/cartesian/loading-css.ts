import type { ResolvedSeries } from "./series";
import { keyStarts } from "../renderer-dom";

const FADE_MASK = "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)";
const EASE = "cubic-bezier(0.85, 0, 0.15, 1)";

/** The loop / exit clip drawn from `--bkm-p` (styles.css `bkm-loading-pulse`): right inset closes as it grows to .5, the left inset opens as it shrinks past .5. */
const PULSE_CLIP = "inset(-10px calc(100% * (1 - min(var(--bkm-p) * 2, 1))) -10px calc(100% * max(var(--bkm-p) * 2 - 1, 0)))";
/** Exit while the phase machine waits (core/loading/phase-machine.ts): the grow half, then the shrink half after it. */
const EXIT_ANIMATION = `bkm-loading-grow var(--bkm-x-grow) ${EASE} forwards, bkm-loading-shrink var(--bkm-x-shrink) ${EASE} var(--bkm-x-grow) forwards`;

const escapeAttr = (value: string): string => value.replaceAll(/["\\\n]/g, String.raw`\$&`);

type Loading = NonNullable<ResolvedSeries["loading"]>;

const animationOf = ({ mode }: Loading): string => {
  // bklit line-loading-timing.ts: 2.2s cycle + 280ms pause (loop); one 1.1s half-cycle per enter/exit.
  if (mode === "enter") {
    return `animation: bkm-loading-enter 1.1s ${EASE} forwards;`;
  }
  if (mode === "exit") {
    return `animation: bkm-loading-exit 1.1s ${EASE} forwards;`;
  }
  return `animation: bkm-loading-pulse 2.48s linear infinite;clip-path: ${PULSE_CLIP};`;
};

export const loadingCss = (scope: string, series: readonly ResolvedSeries[]): string =>
  series
    // The sweep style draws its own silhouette (react/kit/cartesian/loading-sweep-overlays.tsx), so it has no overlay mark to style.
    .flatMap((s) => (s.loading === undefined || s.loading.style === "sweep" ? [] : [{ id: s.id, loading: s.loading }]))
    .map(({ id, loading }) => {
      const key = escapeAttr(`${id}:loading`);
      const sel = `${scope} g${keyStarts(key)}`;
      const mask = `mask-image: ${FADE_MASK}; -webkit-mask-image: ${FADE_MASK};`;
      // The exit rule is for the loop only: an explicit enter / exit mode carries its own animation.
      const exit = loading.mode === "loop" ? `${scope}[data-bkm-exit] g${keyStarts(key)}{animation:${EXIT_ANIMATION}}` : "";
      return `${sel}{opacity:${loading.strokeOpacity};pointer-events:none;${mask}${animationOf(loading)}}${exit}@media (prefers-reduced-motion: reduce){${sel}{animation:none;clip-path:none}}`;
    })
    .join("");
