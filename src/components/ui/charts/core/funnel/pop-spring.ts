import { readHoverIndex } from "../host-write";
import { springDriver as driver } from "../motion/spring-animate";
import { criticalSpring, SNAPPY_HOVER_OMEGA, SNAPPY_HOVER_SPRING } from "../motion/springs";
import type { Spring } from "../motion/springs";
import { range } from "../range";

const MAX_LAYERS = 8;
const MAX_STAGES = 24;
const DIM_PERCENT = 60;
/** bklit's per-stage label overlay: a motion opacity spring (funnel-chart.tsx:1011-1017) both ways. Snappy variant: SNAPPY_HOVER_SPRING (bklit: stiffness 300, damping 24). */
const LABEL_SPRING: Spring = SNAPPY_HOVER_SPRING;

/** bklit HRing: stiffness 300 - 60i, damping 24 - 3i (clamped so the outer rings of a deep funnel stay a valid spring), so each ring lands after the one inside it.
 * Snappy variant: critically damped, ring 0 on SNAPPY_HOVER_SPRING and each outer ring slower by bklit's frequency ratio (sqrt of its stiffness over 300). */
const ringSpring = (layer: number): Spring => criticalSpring(SNAPPY_HOVER_OMEGA * Math.sqrt(Math.max(60, 300 - layer * 60) / 300));

interface FunnelPopOptions {
  readonly horizontal: boolean;
  readonly layers: number;
  /** Rest-to-hot scale delta of a ring (marks.ts popExtra). */
  readonly popOf: (layer: number, layers: number) => number;
}

interface FunnelPop {
  /** The hovered stage changed (null = none): every ring of the previous and the new stage springs to its new target from its live state. */
  readonly to: (stage: number | null) => void;
  /** The stage's rings remount at rest in bklit (enterComplete): a hovered stage springs up from rest again. */
  readonly restart: (stage: number) => void;
  readonly dispose: () => void;
}

/** The stage's group in the funnel mark (marks.ts), by stage order. */
const stageGroup = (host: HTMLElement, stage: number): Element | undefined => host.querySelector(".bkm-stages")?.children[stage];

const ringsOf = (host: HTMLElement, stage: number, layers: number): { readonly el: SVGElement; readonly layer: number }[] => {
  const rings: { el: SVGElement; layer: number }[] = [];
  const group = stageGroup(host, stage);
  for (let layer = 0; layer < Math.min(layers, MAX_LAYERS); layer += 1) {
    for (const el of group?.querySelectorAll<SVGElement>(`.bkm-l${layer}`) ?? []) { rings.push({ el, layer }); }
  }
  return rings;
};

const dimOf = (stage: number, hovered: number | null): number => (hovered !== null && hovered !== stage ? 1 : 0);

const createFunnelPop = (host: HTMLElement, options: Readonly<FunnelPopOptions>): FunnelPop => {
  // Picks up a hover already painted on the host: this pop is rebuilt when `horizontal`/`layers` change, and a fresh `null` would make the
  // next leave a no-op while the rings still sit at the hot value. The shared driver keeps the live state of the elements across the rebuild.
  let current = readHoverIndex(host);
  const targetOf = (stage: number, layer: number, hovered: number | null): number => (stage === hovered ? options.popOf(layer, options.layers) : 0);
  const scaleOf = (value: number): string => (options.horizontal ? `scale(1,${1 + value})` : `scale(${1 + value},1)`);
  const play = (el: SVGElement, layer: number, rest: number, target: number, from?: number): void => {
    driver.play({ affine: true, el, frame: (value) => ({ transform: scaleOf(value) }), from, rest, spring: ringSpring(layer), target });
  };

  // The label layer fades as one element, like bklit's per-stage overlay (the pill's shadow and text dim with it): `dim` 0 = full, 1 = bklit's 0.4.
  const playLabels = (stage: number, previous: number | null, next: number | null): void => {
    const el = stageGroup(host, stage)?.querySelector<SVGElement>(".bkm-fl");
    if (el) { driver.play({ affine: true, el, frame: (value) => ({ opacity: String(1 - (value * DIM_PERCENT) / 100) }), rest: dimOf(stage, previous), spring: LABEL_SPRING, target: dimOf(stage, next) }); }
  };

  return {
    dispose: () => { current = null; },
    restart: (stage) => {
      if (stage !== current) { return; }
      for (const { el, layer } of ringsOf(host, stage, options.layers)) { play(el, layer, 0, targetOf(stage, layer, current), 0); }
    },
    to: (stage) => {
      const previous = current;
      if (stage === previous) { return; }
      current = stage;
      // Every stage's label dims or restores when the hover enters or leaves the chart; otherwise only the two stages involved change.
      const labelled = previous === null || stage === null ? range(MAX_STAGES) : [previous, stage];
      for (const label of labelled) { playLabels(label, previous, stage); }
      for (const touched of new Set([previous, stage])) {
        if (touched !== null) {
          for (const { el, layer } of ringsOf(host, touched, options.layers)) { play(el, layer, targetOf(touched, layer, previous), targetOf(touched, layer, current)); }
        }
      }
    },
  };
};

export { createFunnelPop };
export type { FunnelPop };
