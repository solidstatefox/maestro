import { hoverStaticCss } from "../cartesian/definition";
import type { CartesianBuild } from "../cartesian/definition";
import { OWN_PILL_NAMES, pillTickStaticCss } from "../cartesian/date-pill";
import type { ResolvedSeries } from "../cartesian/series";
import { cssAttr } from "../bar/hover";
import type { SeriesBarSpec } from "./bars";
import type { ComposedCandleSpec, ComposedScatterSpec } from "./extras";
import { interactiveGateCss } from "../cartesian/gate-css";
import { FOCUS_MARK } from "../hover/focus-marks";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { NOT_MOTION, keyEnds, keyStarts } from "../renderer-dom";

interface StaticCssInput {
  readonly uid: string;
  readonly built: Pick<CartesianBuild, "hover" | "pillTicks" | "backgroundCss">;
  readonly bars: readonly SeriesBarSpec[];
  readonly candle: ComposedCandleSpec | null;
  readonly scatters: readonly ComposedScatterSpec[];
  readonly order: readonly string[];
  readonly series: readonly ResolvedSeries[];
}

/** The bars, candles and points of row `index` (each key ends `:number:<index>`), marked while that row is focused (hover.ts, hover/focus-marks.ts). */
export const rowNodesAt = (index: number): string =>
  `:is(${keyStarts("bar:")},${keyStarts("candle:")},${keyStarts("scatter:")}):is(rect,circle)${keyEnds(`:number:${index}`)}`;

// Hover / legend emphasis is fixed text keyed on host attributes, so it changes only with the definition; the kit's per-kind
// series indices are re-keyed to bklit's joint JSX-order legend index.
export function composedStaticCss({ uid, built, bars, candle, scatters, order, series }: Readonly<StaticCssInput>): string {
  const scope = `[data-bkm-kit="${uid}"]`;
  const legendOf = (kitIndex: number | undefined): number | undefined => {
    const key = series.find((s) => s.index === kitIndex)?.dataKey;
    const at = key === undefined ? -1 : order.indexOf(key);
    return at < 0 ? undefined : at;
  };
  const hover = { ...built.hover, dim: built.hover.dim.map((rule) => (rule.series === undefined ? rule : { ...rule, series: legendOf(rule.series) })) };
  const pill = built.pillTicks.active ? pillTickStaticCss(scope, built.pillTicks.times, built.pillTicks.reachPx, OWN_PILL_NAMES) : null;
  // bklit fades every bar outside the focused x to its fadedOpacity (120ms) and every bar of another legend row to its fadedOpacity (series-bar.tsx: one opacity tween, 0.12s ease-out;
  // the snappy variant: the hover profile).
  const barRules = bars.map((b) => {
    const select = `${scope} ${keyStarts(`bar:${cssAttr(b.dataKey)}:string:`)}:not(g)`;
    const legend = order.indexOf(b.dataKey);
    const bar = `${keyStarts(`bar:${cssAttr(b.dataKey)}:string:`)}:not(g)`;
    // One rule, not one per focus index: the focused row's bars carry the focus mark (hover.ts), so a focus change restyles the bars of two rows
    // (an inherited focus-x var restyled every bar a move). The fade-out waits 20ms like bklit's, the fade back does not; a focused bar beats the legend dim.
    return [
      `${select}${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS}}`,
      `${scope}[data-bkm-bi] ${bar}:not([${FOCUS_MARK}]){opacity:${b.fadedOpacity}!important;transition-delay:.02s}`,
      `${scope}[data-bkm-bi] ${bar}[${FOCUS_MARK}]{opacity:1!important}`,
      `${scope}[data-bkm-legend]:not([data-bkm-legend="${legend}"]) ${keyStarts(`bar:${cssAttr(b.dataKey)}:string:`)}:not(g){opacity:${b.fadedOpacity}}`,
    ].join("");
  });
  // A candle and a Scatter's points dim like the bars outside the focused row (bklit Candlestick `fadedOpacity` with `showHoverFade`, Scatter
  // `inactiveOpacity` with `fadeOnHover`); a candle wins over a legend dim like a bar does.
  const extraRules = [
    ...(candle !== null && candle.showHoverFade ? [{ select: `${keyStarts("candle:")}:is(rect)`, faded: candle.fadedOpacity }] : []),
    ...scatters.filter((p) => p.fadeOnHover).map((p) => ({ select: `${keyStarts(`scatter:${cssAttr(p.dataKey)}`)}:is(circle)`, faded: p.inactiveOpacity })),
  ].map(({ select, faded }) =>
    [
      `${scope} ${select}${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS}}`,
      `${scope}[data-bkm-bi] ${select}:not([${FOCUS_MARK}]){opacity:${faded}!important;transition-delay:.02s}`,
    ].join(""),
  );
  // The range overlays' scoped rules (Band and Deadline fades, the underlays' fade-in) ride on the build's background CSS.
  return [interactiveGateCss(scope, true), pill, hoverStaticCss(scope, hover), ...barRules, ...extraRules, built.backgroundCss(scope)].filter(Boolean).join("");
}
