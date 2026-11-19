import { HOVER_TRANSITION_CSS } from "../motion/springs";

/** bklit's bar dim (core/bar/model.ts FADED_OPACITY). */
export const PLOT_FADED_OPACITY = 0.3;

/** A mark's group in the marks layer (its `id`; a line with a `z` channel keys its group `id:<z>`), not its focus copy. */
export const markGroup = (id: string): string => `.ts-chart__marks>g:is([data-ts-key="${id}"],[data-ts-key^="${id}:"]):not([data-ts-focus-layer])`;

/** Mark groups a hover dims: `dim` is their opacity while the pointer is on the chart (default bklit's 0.3). `lines` dims each node's
 * stroke instead: for marks of zero-height or zero-width lines (caps, connectors), whose empty bounds make an opacity's offscreen layer
 * paint garbage in Chromium; `dim` then multiplies the stroke's own opacity (`strokeOpacity`, default 1). */
export interface DimGroup {
  readonly id: string;
  readonly dim?: number;
  readonly lines?: { readonly strokeOpacity?: number };
}

/** The hover dims: each group fades to its `dim` while the pointer is on the chart. */
export function hoverDimCss(scope: string, groups: readonly DimGroup[], dim = PLOT_FADED_OPACITY): string {
  if (groups.length === 0) {
    return "";
  }
  const rules: string[] = [];
  const whole = groups.filter((g) => g.lines === undefined);
  if (whole.length > 0) {
    rules.push(`${scope} :is(${whole.map((g) => markGroup(g.id)).join(",")}){transition:opacity ${HOVER_TRANSITION_CSS}}`);
  }
  for (const group of groups) {
    const value = group.dim ?? dim;
    if (group.lines === undefined) {
      rules.push(`${scope}[data-bkm-hover] ${markGroup(group.id)}{opacity:${value}}`);
    } else {
      const nodes = `${markGroup(group.id)}>*`;
      rules.push(`${scope} ${nodes}{transition:stroke-opacity ${HOVER_TRANSITION_CSS}}`, `${scope}[data-bkm-hover] ${nodes}{stroke-opacity:${Math.round(value * (group.lines.strokeOpacity ?? 1) * 1000) / 1000}}`);
    }
  }
  return rules.join("");
}

/** A legend row hovered (and the pointer off the chart): every series' groups but the row's dim. `series[s]` lists series `s`'s mark ids. */
export function legendDimCss(scope: string, series: readonly (readonly string[])[], dim = PLOT_FADED_OPACITY): string {
  const rules: string[] = [];
  for (const [s] of series.entries()) {
    const others = series.flatMap((ids, o) => (o === s ? [] : ids.map(markGroup)));
    if (others.length > 0) {
      rules.push(`${scope}[data-bkm-legend="${s}"]:not([data-bkm-hover]) :is(${others.join(",")}){opacity:${dim}}`);
    }
  }
  return rules.join("");
}

/** `@keyframes bkm-plot-fade`: what a late part (arrows, labels, a status rule) fades in with, after the marks' entrance. */
export const PLOT_FADE_KEYFRAMES = "@keyframes bkm-plot-fade{from{opacity:0}}";

/** Mark groups fading in `delayMs` after the first paint (`backwards`: nothing is held once it has played, so the hover dims stay live). */
export const lateFadeCss = (scope: string, ids: readonly string[], delayMs: number, durationMs = 400): string =>
  ids.length === 0 ? "" : `${scope} :is(${ids.map(markGroup).join(",")}){animation:bkm-plot-fade ${durationMs}ms ease-out ${Math.round(delayMs)}ms backwards}`;

/** `@keyframes bkm-plot-pop`: a dot's entrance (the renderer gives dots none on a first paint): it scales up from its centre as it fades in. */
export const PLOT_POP_KEYFRAMES = "@keyframes bkm-plot-pop{from{opacity:0;transform:scale(0)}}";

/** Each `tag` node of mark `id` pops in at its own delay (`delays[i]` ms for the i-th node, the mark's rows in order), over `durationMs`. */
export function popInCss(scope: string, id: string, tag: string, delays: readonly number[], durationMs = 420): string {
  const nodes = `${scope} ${markGroup(id)}>${tag}`;
  const rules = [`${nodes}{transform-box:fill-box;transform-origin:center}`];
  for (const [i, delay] of delays.entries()) {
    rules.push(`${nodes}:nth-child(${i + 1}){animation:bkm-plot-pop ${durationMs}ms cubic-bezier(.34,1.4,.64,1) ${Math.round(delay)}ms backwards}`);
  }
  return rules.join("");
}

/** `@keyframes bkm-plot-wipe`: bklit's line and area reveal, left to right (its ChartRevealClip), as a clip on the marks' groups. */
export const PLOT_WIPE_KEYFRAMES = "@keyframes bkm-plot-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}";

/** The marks layer revealed left to right over `durationMs` from the first paint, on bklit's reveal ease (one clip for every mark, so
 * series that start or end at different times reveal together). */
export const wipeInCss = (scope: string, durationMs: number): string =>
  `${scope} .ts-chart__marks{animation:bkm-plot-wipe ${Math.round(durationMs)}ms cubic-bezier(.85,0,.15,1) backwards}`;
