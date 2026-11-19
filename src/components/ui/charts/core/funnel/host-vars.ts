import type { StyleObject } from "../style";
import { range } from "../range";

/** funnel.css carries one index rule per stage up to this count. */
const MAX_STAGES = 24;
const MAX_LAYERS = 8;

/** Per-layer resting transform of a hot ring (`--bkm-hot<layer>`): the scale on the pop axis, precomputed so no hover rule evaluates a calc. */
const funnelHoverVars = (
  layers: number,
  horizontal: boolean,
  pop: (layer: number, layers: number) => number,
): StyleObject => {
  const vars: [string, string][] = [];
  for (const layer of range(Math.min(layers, MAX_LAYERS))) {
    const scale = 1 + pop(layer, layers);
    vars.push([`--bkm-hot${layer}`, horizontal ? `scale(1, ${scale})` : `scale(${scale}, 1)`]);
  }
  return Object.fromEntries<string>(vars);
};

interface FunnelEntranceInput {
  readonly horizontal: boolean;
  readonly staggerDelaySec: number;
  /** The stage grow's duration and CSS easing (motion/enter-transition.ts `enterCssCurve`: a tween, or a spring as `linear()`). */
  readonly curve: { readonly durationMs: number; readonly ease: string };
}

/** Entrance duration, easing, grow origin and stage stagger (the stage index is `--bkm-fi` in funnel.css). */
const funnelEntranceVars = (input: Readonly<FunnelEntranceInput>): StyleObject => Object.fromEntries<string>([
  ["--bkm-e-dur", `${Math.round(input.curve.durationMs)}ms`],
  ["--bkm-e-ease", input.curve.ease],
  ["--bkm-e-origin", input.horizontal ? "0% 50%" : "50% 0%"],
  ["--bkm-e-stagger", `${Math.round(input.staggerDelaySec * 1000)}ms`],
]);

export { funnelEntranceVars, funnelHoverVars, MAX_STAGES };
