import type { StyleObject } from "../style";
import { MAX_INDEX } from "../polar/polar-dim";
import { DEFAULT_ENTER_MS, DEFAULT_ENTER_SPRING, toCssEase } from "../motion/enter-transition";
import type { EnterTransition } from "../motion/phase";
import { REST_NEVER, springCurve } from "../motion/spring-curve";

const TRACK_STAGGER_MS = 80;
const SPRING_MS = 1100;
const SPRING_SAMPLES = 36;

type VarEntry = readonly [string, string];

const timingVars = (transition: EnterTransition | undefined): readonly VarEntry[] => {
  if (transition?.type === "spring") {
    return [
      ["--bkm-re-dur", `${SPRING_MS}ms`],
      ["--bkm-re-ease", springCurve({ damping: transition.damping ?? DEFAULT_ENTER_SPRING.damping, mass: transition.mass ?? DEFAULT_ENTER_SPRING.mass, stiffness: transition.stiffness ?? DEFAULT_ENTER_SPRING.stiffness }, { decimals: 3, durationMs: SPRING_MS, rest: REST_NEVER, samples: SPRING_SAMPLES }).ease],
    ];
  }
  return [
    ["--bkm-re-dur", `${Math.round((transition?.duration ?? DEFAULT_ENTER_MS / 1000) * 1000)}ms`],
    ["--bkm-re-ease", toCssEase(transition?.ease)],
  ];
};

/** Host custom properties for the entrance: duration/ease/stagger from props, plus the animation name for each animating ring. */
const ringEntranceVars = (input: {
  readonly enterTransition: EnterTransition | undefined;
  readonly enterStaggerScale: number;
  readonly animate: readonly boolean[];
}): StyleObject => Object.fromEntries<string>([
  ...timingVars(input.enterTransition),
  ["--bkm-re-stagger", `${TRACK_STAGGER_MS * input.enterStaggerScale}ms`],
  ...input.animate.flatMap((animate, index): VarEntry[] => animate && index < MAX_INDEX ? [[`--bkm-ra${index}`, "bkm-ring-in"]] : []),
]);

export { ringEntranceVars };
