import { isMotionNode } from "../renderer-dom";
import { springDriver } from "../motion/spring-animate";
import { HOVER_SPRING } from "../motion/springs";
import { MAX_INDEX, RING_HOVER_SCALE, RING_PUSHED_SCALE } from "../polar/polar-dim";

/** Scale delta of ring `index` while `hovered` is the focused ring (outer rings, drawn after it, are pushed). */
const ringTarget = (index: number, hovered: number | null): number => {
  if (hovered === null) { return 0; }
  if (index === hovered) { return RING_HOVER_SCALE - 1; }
  return index > hovered ? RING_PUSHED_SCALE - 1 : 0;
};

/** One arc element per ring index of each host, recorded by `springRings`, so the hit test can read the live painted scale without a DOM query. */
const arcsByHost = /* @__PURE__ */ new WeakMap<HTMLElement, Map<number, SVGElement>>();

/** Scale the painted ring `index` has right now (bklit hit-tests its live motion-scaled paths): the spring's analytic value when driven, else the static target for `hovered`. */
const liveRingScale = (host: HTMLElement | null, index: number, hovered: number | null): number => {
  const el = host === null ? undefined : arcsByHost.get(host)?.get(index);
  const value = el?.isConnected === true ? springDriver.value(el) : undefined;
  return 1 + (value ?? ringTarget(index, hovered));
};

/** Hosts whose CSS entrance has finished: the entrance scan (a forced style flush inside the pointer task) is skipped for them until a CSS animation starts again. */
const settledHosts = /* @__PURE__ */ new WeakSet<HTMLElement>();

/** Elements whose CSS entrance keyframes are running now (they own the track's transform); only a CSSAnimation counts, the hover's opacity CSSTransition runs on dimmed tracks. */
const enteringElements = (host: HTMLElement): ReadonlySet<Element | null> => {
  if (settledHosts.has(host)) { return new Set(); }
  // oxlint-disable-next-line no-restricted-properties -- one subtree read per hover change until the entrance ends, not per element after bulk mutations (AGENTS.md exception)
  const running = new Set(host.getAnimations({ subtree: true }).flatMap((animation) => (animation instanceof CSSAnimation && animation.playState === "running" && animation.effect instanceof KeyframeEffect ? [animation.effect.target] : [])));
  if (running.size === 0) {
    settledHosts.add(host);
    host.addEventListener("animationstart", () => { settledHosts.delete(host); }, { once: true });
  }
  return running;
};

/** Retargets the `count` ring arcs of `host` from its live scale and velocity to the delta of the new hovered ring. */
const springRings = (count: number) => (host: HTMLElement, previous: number | null, next: number | null): void => {
  const entering = enteringElements(host);
  const arcs = new Map<number, SVGElement>();
  arcsByHost.set(host, arcs);
  // Groups are addressed by the `bkm-rg-<row index>` className we set (definition.ts), no class read-back; WAAPI because `states` has no transform channel (UPSTREAM-GAPS #20/#36).
  const groups = Array.from({ length: Math.min(count, MAX_INDEX) }, (_, index) => ({ els: host.querySelectorAll<SVGElement>(`g.bkm-rg-arc.bkm-rg-${index}`), index }));
  for (const { els, index } of groups) {
    // A renderer-owned motion node is skipped (isMotionNode, UPSTREAM-GAPS #50).
    for (const el of [...els].filter((node) => !isMotionNode(node))) {
      const isTrack = el.classList.contains("bkm-rg-track");
      if (!arcs.has(index) || isTrack) { arcs.set(index, el); }
      const rest = ringTarget(index, previous);
      const target = ringTarget(index, next);
      if (rest !== target && !(isTrack && entering.has(el))) {
        springDriver.play({ affine: true, el, frame: (value) => ({ transform: `scale(${1 + value})` }), rest, spring: HOVER_SPRING, target });
      }
    }
  }
};

export { liveRingScale, springRings };
