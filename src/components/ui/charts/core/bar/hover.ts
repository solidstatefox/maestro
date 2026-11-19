import { typedAttr } from "../css-hooks";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { NOT_MOTION, keyStarts } from "../renderer-dom";

export interface HoverTarget {
  /** Selector for every leaf node of the mark (relative to the chart root). */
  readonly select: string;
  /** Selector matching the nodes of category `index` (kept at rest opacity), or null to dim the whole mark. */
  readonly keep: ((index: number) => string) | null;
  /** Opacity of the dimmed nodes while any category is focused. */
  readonly dim: number;
  /** True for marks bklit snaps (no opacity fade): the column track. */
  readonly snap?: boolean;
  /** Series index the nodes belong to: a legend hover dims every target of another series. */
  readonly seriesIndex?: number;
  /** Only used by the legend dim (the category hover has its own target for the same nodes). */
  readonly legendOnly?: boolean;
}

export const cssAttr = (value: string): string => value.replaceAll(/["\\\n]/gu, String.raw`\$&`);
/** Class on every node of category `index` for marks we author (squares, track, depth): selectable without the key encoding. */
export const barIndexClass = (index: number): string => `bkm-bi${index}`;

export const MAX_INDEX = 64;

/** One rule per category index (0..min(count, MAX_INDEX)): nodes matched by `select` that are not the focused category's (`keep(i)`) take
 * `declarations` while `[data-hover="i"]` is on the host. */
function indexDimRules(scope: string, count: number, select: string, keep: (index: number) => string, declarations: string): string[] {
  const rules: string[] = [];
  for (let i = 0; i < Math.min(count, MAX_INDEX); i += 1) {
    rules.push(`${scope}[data-hover="${i}"] ${select}:not(${keep(i)}){${declarations}}`);
  }
  return rules;
}

/** Host var: the focused category's centre x (svg px) for the vertical bar tick fade. */
export const FOCUS_X_VAR = "--bkm-bfx";

export interface TickFade {
  readonly prefix: string;
  /** Vertical bars: half-width of the hidden zone around the focused band centre; undefined for the horizontal label highlight. */
  readonly ramp?: number;
  /** Position of each category's tick label among the drawn labels (-1: not drawn). */
  readonly positions: readonly number[];
}

function tickRules(scope: string, tick: TickFade, count: number): string[] {
  // bklit fades the tick 400ms (vertical bars) or 150ms (horizontal), ease-in-out; the snappy variant: the hover profile.
  const rules = [`${scope} text${keyStarts(tick.prefix)}${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS},fill ${HOVER_TRANSITION_CSS}}`];
  if (tick.ramp !== undefined) {
    // bklit bar-x-axis.tsx: a tick within tickerHalfWidth of the focused band centre hides, fading in over the next 20px (`FOCUS_X_VAR` = centre).
    // Typed attr() is Chromium-only (133+): under `@supports` (the unguarded var() is invalid at computed time), other browsers keep the tick visible.
    rules.push(typedAttr(`${scope}[data-hover] text${keyStarts(tick.prefix)}{opacity:clamp(0,calc((abs(attr(x type(<number>)) - var(${FOCUS_X_VAR},-9999)) - ${tick.ramp}) / 20),1)!important}`));
    return rules;
  }
  // bklit bar-y-axis.tsx: the hovered category label goes from 0.7 opacity / label colour to full opacity / foreground; its position is looked up per category.
  for (const [index, pos] of tick.positions.slice(0, Math.min(count, MAX_INDEX)).entries()) {
    if (pos >= 0) {
      rules.push(`${scope}[data-hover="${index}"] text${keyStarts(tick.prefix)}:nth-child(${pos + 1}){opacity:1!important;fill:var(--bkm-foreground)!important}`);
    }
  }
  return rules;
}

/** The bar emphasis stylesheet: one rule per category the data has; depends on targets, category count and ticks, never on focus (host attrs `data-hover`, `data-legend`).
 * The focused category's tick label fades out (the date pill replaces it). */
export function barDimCss(scope: string, targets: readonly HoverTarget[], tick: TickFade | null, count: number): string {
  const rules: string[] = [];
  for (const target of targets) {
    if (target.legendOnly !== true) {
      // bklit fades 150ms, ease-in-out (the bar CSS) or ease-out (motion's tween on squares and depth faces); the snappy variant: the hover profile.
      const transition = target.snap === true ? "none" : `opacity ${HOVER_TRANSITION_CSS}`;
      rules.push(`${scope} ${target.select}${NOT_MOTION}{transition:${transition}}`);
      if (target.keep === null) {
        rules.push(`${scope}[data-hover] ${target.select}{opacity:${target.dim}!important}`);
      } else {
        rules.push(...indexDimRules(scope, count, target.select, target.keep, `opacity:${target.dim}!important`));
      }
    }
    if (target.seriesIndex !== undefined && target.snap !== true) {
      // A focused category owns the emphasis: a keyboard-focused legend row must not stack its stale dim on it (bklit's legend is mouse-only).
      rules.push(`${scope}[data-legend]:not([data-hover]):not([data-legend="${target.seriesIndex}"]) ${target.select}{opacity:${target.dim}!important}`);
    }
  }
  if (tick) {
    rules.push(...tickRules(scope, tick, count));
  }
  return rules.join("");
}
