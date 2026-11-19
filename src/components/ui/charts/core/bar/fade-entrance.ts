import { REVEAL_CSS_EASE } from "../motion/easing";
import { keyEnds, keyStarts } from "../renderer-dom";
import { cssAttr } from "./hover";
import type { BarSeries } from "./model";

/** Most categories that get their own delay; later ones fade with the last delay. */
const MAX_DELAYS = 64;

export interface FadeEntranceInput {
  readonly uid: string;
  readonly series: readonly BarSeries[];
  readonly categoryCount: number;
  readonly animationDuration: number;
  /** The derived stagger in ms (40% of the duration spread across the categories). */
  readonly staggerMs: number;
}

/** The fading series' keys (their bars take no native entrance motion). */
export const fadeSeriesKeys = (series: readonly BarSeries[]): ReadonlySet<string> =>
  new Set(series.flatMap((s) => (s.kind === "bar" && s.bar?.animationType === "fade" && s.bar.animate !== false ? [s.key] : [])));

/** The entrance rules of the fading series, or "" without one. */
export function fadeEntranceCss({ uid, series, categoryCount, animationDuration, staggerMs }: FadeEntranceInput): string {
  const fading = series.filter((s) => s.kind === "bar" && s.bar?.animationType === "fade" && s.bar.animate !== false);
  if (fading.length === 0 || animationDuration <= 0) {
    return "";
  }
  const scope = `[data-bkm-bar="${uid}"]:not([data-bkm-status="loading"])`;
  const rules: string[] = [];
  for (const s of fading) {
    const stagger = s.bar?.staggerDelay === undefined ? staggerMs : s.bar.staggerDelay * 1000;
    const count = Math.min(categoryCount, MAX_DELAYS);
    const rule = (select: string, delay: number): string => `${scope} ${select}{animation:bkm-bar-fade ${animationDuration}ms ${REVEAL_CSS_EASE} ${Math.round(delay)}ms backwards}`;
    // `backwards`: the from-values hold through the delay and nothing stays applied after, so no filter outlives the fade.
    // Past MAX_DELAYS categories, the rest fade with the last delay: a rule for the whole series first, the per-category ones after it win.
    if (categoryCount > count) {
      rules.push(rule(`:is(rect,path)${keyStarts("bars:")}${keyEnds(`:${cssAttr(s.key)}`)}`, (count - 1) * stagger));
    }
    for (let i = 0; i < count; i += 1) {
      rules.push(rule(`:is(rect,path)${keyStarts("bars:")}${keyEnds(`:${i}:${cssAttr(s.key)}`)}`, i * stagger));
    }
  }
  return rules.join("");
}
