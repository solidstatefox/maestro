import type { StyleObject } from "../style";
import { stepEase } from "./head-ease";
import type { Frame } from "./live-frame";

interface LiveHostVarsArgs {
  readonly frame: Frame | null;
  readonly pad: number;
  readonly bklitWidth: number;
  readonly plotRight: number;
  readonly plotLeft: number;
  readonly clipExt: number;
  readonly introEaseCss: string;
  readonly fillRamp: { readonly top: number; readonly bottom: number };
}

/** The custom properties `liveHostVars` writes on the host each tick. Registered non-inheriting (LIVE_VARS_CSS): an inherited host var restyled the whole chart on every
 * tick (190 elements, the y labels' chart and the badge pools among them); now only the elements on the way to their readers recompute them. */
export const LIVE_HOST_VARS = [
  "--bkm-live-roll",
  "--bkm-live-pad",
  "--bkm-live-ax",
  "--bkm-live-ry-s",
  "--bkm-live-ry-t",
  "--bkm-live-roll-ease",
  "--bkm-live-ext",
  "--bkm-live-fade-x0",
  "--bkm-live-fade",
  "--bkm-live-fill-top",
  "--bkm-live-fill-bottom",
  "--bkm-live-cut",
  "--bkm-live-shift",
] as const;

const LIVE = '[data-bkm-chart="liveline"]';
const SVG = `${LIVE} > .ts-chart-host > .ts-chart-surface > svg.ts-chart`;
const MARKS = `${SVG} > g.ts-chart__marks`;
/** The readers of the host's vars and the nodes on the way to them, and nothing else: the line's box, surface, svg and marks layer; the clip (`--bkm-live-ext`); the line and area
 * groups and paths (cut, fades, slide); the tail's fill group (its cut and fade); the grid's and the reference bands' rolling groups. A node off this path (the tip, the tail's
 * paths, the x labels, the y labels' chart, the grid rules) never recomputes them; a node on it does whenever its parent restyles, so the path stays out of the nodes an
 * animation restyles every frame (the rolling groups' children are themselves animated readers). */
const VAR_PATH = [
  `${LIVE} > .ts-chart-host`,
  `${LIVE} > .ts-chart-host > .ts-chart-surface`,
  SVG,
  MARKS,
  `${MARKS} > :is(defs, g.ts-chart__area, g.ts-chart__line, g.bkm-live-tail, g.bkm-live-grid)`,
  `${MARKS} > defs > clipPath`,
  `${MARKS} > defs > clipPath > rect`,
  `${MARKS} > :is(g.ts-chart__area, g.ts-chart__line) > path`,
  `${MARKS} > g.bkm-live-tail > g.bkm-live-fill`,
  `${MARKS} > g.bkm-live-grid > g`,
  `${MARKS} > g.bkm-live-grid > g > g.bkm-live-rp`,
  `${MARKS} > g.bkm-live-refs`,
  `${MARKS} > g.bkm-live-refs > g.bkm-live-rp`,
].join(",");

/** The host vars as non-inheriting registered properties, inherited explicitly along VAR_PATH. Unregistered, every tick's write restyled every node under the host. */
export const LIVE_VARS_CSS = /* @__PURE__ */ (() =>
  LIVE_HOST_VARS.map((name) => `@property ${name}{syntax:"*";inherits:false}`).join("") + `${VAR_PATH}{${LIVE_HOST_VARS.map((name) => `${name}:inherit`).join(";")}}`)();

/** The roll's parameters the host hands liveline.css and live-css.ts as custom properties (rounded to what the eye can tell); the tail and the tip
 * take theirs from the head clock (live-head.ts). */
export const liveHostVars = ({ frame, pad, bklitWidth, plotRight, plotLeft, clipExt, introEaseCss, fillRamp }: LiveHostVarsArgs): StyleObject => ({
  "--bkm-live-roll": `${frame?.rollMs ?? 600}ms`,
  "--bkm-live-pad": `${pad}px`,
  "--bkm-live-ax": `${Math.round((frame?.roll.x ?? 0) * 100) / 100}px`,
  "--bkm-live-ry-s": Math.round((frame?.roll.s ?? 1) * 1e5) / 1e5,
  "--bkm-live-ry-t": `${Math.round((frame?.roll.t ?? 0) * 100) / 100}px`,
  "--bkm-live-roll-ease": frame?.intro === true ? introEaseCss : stepEase(frame?.rollMs ?? 600),
  "--bkm-live-ext": `${Math.round(clipExt * 100) / 100}px`,
  "--bkm-live-fade-x0": `${plotLeft}px`,
  "--bkm-live-fade": `${Math.round(bklitWidth * 0.04 * 10) / 10}px`,
  "--bkm-live-fill-top": `${fillRamp.top}px`,
  "--bkm-live-fill-bottom": `${fillRamp.bottom}px`,
  "--bkm-live-cut": `${Math.floor(frame?.roll.xa ?? plotRight)}px`,
  "--bkm-live-shift": Math.round((frame?.roll.x ?? 0) * 100) / 100,
});
