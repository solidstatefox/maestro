import type { ChartLayerRenderer, SceneArea, SceneNode } from "@tanstack/charts";
import { createSvgLayer, paintKeyed, setOrRemove, STYLE_PROPERTIES, SVG_NS, translateOf } from "../layer/svg-layer";
import { prefersReducedMotion } from "../loading/reduced-motion";
import { DEFAULT_ENTER_MS, DEFAULT_ENTER_SPRING, toEaseFn } from "../motion/enter-transition";
import type { EnterTransition } from "../motion/phase";
import type { RingArcRow } from "./arc";
import { MS_PER_SECOND } from "../theme";
import { REST_NEVER, springOf } from "../motion/spring-curve";
import { resolveEntranceOrigins } from "../entrance/entrance-origin";

const TRACK_STAGGER_MS = 80;
const PROGRESS_STAGGER_MS = 100;
const PROGRESS_OFFSET_MS = 600;
/** bklit draws nothing until the swept angle exceeds 0.01 rad. */
const MIN_SWEEP_RAD = 0.01;
const SPRING_MAX_MS = 4000;
const UNIT_MOVE = { from: 0, to: 1, velocity: 0 };
const NOOP = (): void => undefined;

interface ProgressLayerOptions {
  readonly rows: readonly RingArcRow[];
  /** The ring arc generator's path for a row (`null` when degenerate). */
  readonly arc: (row: Readonly<RingArcRow>) => string | null;
  readonly enterTransition: EnterTransition | undefined;
  readonly enterStaggerScale: number;
  /** `performance.now()` at the start of the commit that mounts the entrance (`useRenderStart`); motion's creation clock. */
  readonly renderStart: { readonly current: number | null };
  /** Shared by the definitions of one chart: the first layer to mount owns the entrance sweep, so a rebuilt definition (resize, data) snaps. */
  readonly claim: { current: object | null };
}

const isSpring = (transition: EnterTransition | undefined): boolean => transition?.type === "spring";
const tweenMs = (transition: EnterTransition | undefined): number => (transition?.duration ?? DEFAULT_ENTER_MS / MS_PER_SECOND) * MS_PER_SECOND;
const progressDelayMs = (row: Readonly<RingArcRow>, stagger: number): number => (PROGRESS_OFFSET_MS + row.ringIndex * PROGRESS_STAGGER_MS) * stagger;
/** When a ring's sweep stops: its delay plus the tween, or the time a spring needs to settle. */
const sweepEndMs = (row: Readonly<RingArcRow>, transition: EnterTransition | undefined, stagger: number): number =>
  progressDelayMs(row, stagger) + (isSpring(transition) ? SPRING_MAX_MS : tweenMs(transition));

/** Unit curve (0 -> 1) of the enter transition, `sinceDelayMs` after the sweep's delay. */
const unitCurve = (enterTransition: EnterTransition | undefined): ((sinceDelayMs: number) => number) => {
  if (enterTransition?.type === "spring") {
    const spring = springOf({ damping: enterTransition.damping ?? DEFAULT_ENTER_SPRING.damping, mass: enterTransition.mass ?? DEFAULT_ENTER_SPRING.mass, stiffness: enterTransition.stiffness ?? DEFAULT_ENTER_SPRING.stiffness }, REST_NEVER);
    return (sinceDelayMs): number => spring.sample(sinceDelayMs, UNIT_MOVE).value;
  }
  const bezier = toEaseFn(enterTransition?.ease);
  const durationMs = tweenMs(enterTransition);
  return (sinceDelayMs): number => bezier(sinceDelayMs / durationMs);
};

/** Progress (0 -> 1, bklit's `v`) of a ring's sweep `elapsed` ms after mount. */
const createSweepCurve = (row: Readonly<RingArcRow>, enterTransition: EnterTransition | undefined, enterStaggerScale: number): ((elapsed: number) => number) => {
  const progressDelay = progressDelayMs(row, enterStaggerScale);
  // The arc only shows once its track has finished expanding (the track's CSS entrance: the same duration, or the spring window).
  const expandEnd = row.ringIndex * TRACK_STAGGER_MS * enterStaggerScale + (isSpring(enterTransition) ? DEFAULT_ENTER_MS : tweenMs(enterTransition));
  const curve = unitCurve(enterTransition);
  const range = row.endAngle - row.startAngle;
  return (elapsed) => {
    if (elapsed < expandEnd) { return 0; }
    const eased = curve(elapsed - progressDelay);
    return eased * range <= MIN_SWEEP_RAD ? 0 : eased;
  };
};


interface ArcTarget {
  readonly path: SVGPathElement;
  full: string;
  readonly row: RingArcRow | undefined;
}

interface SweepTarget {
  readonly row: RingArcRow;
  readonly path: SVGPathElement;
  readonly curve: (elapsed: number) => number;
  readonly endMs: number;
}

const endOf = (target: Readonly<SweepTarget>): number => target.endMs;

/** What one surface has painted, keyed by the scene path of each node, so a repaint reuses its elements. */
interface PaintState {
  readonly groups: Map<string, SVGGElement>;
  readonly arcs: Map<string, ArcTarget>;
  readonly rowsByKey: ReadonlyMap<string, RingArcRow>;
  readonly seen: Set<string>;
}

const applyStyle = (element: SVGElement, style: SceneArea["style"]): void => {
  for (const [key, property] of STYLE_PROPERTIES) {
    const value = style?.[key];
    if (value === undefined) { element.style.removeProperty(property); } else { element.style.setProperty(property, String(value)); }
  }
};

const paintArc = (state: PaintState, node: SceneArea, id: string, groupKey: string): SVGPathElement => {
  const existing = state.arcs.get(id);
  const target = existing ?? { full: "", path: document.createElementNS(SVG_NS, "path"), row: state.rowsByKey.get(groupKey) };
  target.full = node.path ?? "";
  state.arcs.set(id, target);
  applyStyle(target.path, node.style);
  setOrRemove(target.path, "class", node.className);
  return target.path;
};

const paintNode = (state: PaintState, node: SceneNode, id: string, groupKey: string): SVGElement | null => {
  if (node.kind === "area") { return paintArc(state, node, id, groupKey); }
  if (node.kind !== "group") { return null; }
  const group = state.groups.get(id) ?? document.createElementNS(SVG_NS, "g");
  state.groups.set(id, group);
  setOrRemove(group, "class", node.className);
  setOrRemove(group, "transform", translateOf(node));
  // eslint-disable-next-line no-use-before-define -- mutual recursion with paintNodes
  paintNodes(state, node.children, group, id);
  return group;
};

const paintNodes = (state: PaintState, nodes: readonly SceneNode[], parent: SVGElement, path: string): void => {
  paintKeyed(nodes, parent, path, state.seen, (node, id, parentPath) => paintNode(state, node, id, parentPath.slice(parentPath.lastIndexOf("/") + 1)));
};

/** The ring progress layer: a `ChartLayerRenderer` (reference/rendering-and-export.md, "Mark-level renderers") that paints its own SVG, so `d` is ours to animate. */
const createProgressLayer = (options: Readonly<ProgressLayerOptions>): ChartLayerRenderer<RingArcRow, number, number> => {
  const rowsByKey = new Map(options.rows.flatMap((row): [string, RingArcRow][] => row.kind === "progress" ? [[`ring:${row.key}`, row]] : []));
  return createSvgLayer<RingArcRow>("bkm-ring-progress", (svg, layer) => {
    const state: PaintState = { arcs: new Map(), groups: new Map(), rowsByKey, seen: new Set() };
    let started = false;
    let sweeping = false;
    let frame = 0;
    let cancelOrigin = NOOP;
    const settle = (): void => {
      for (const arc of state.arcs.values()) { arc.path.setAttribute("d", arc.full); }
    };
    const stop = (): void => {
      sweeping = false;
      cancelAnimationFrame(frame);
      cancelOrigin();
      cancelOrigin = NOOP;
    };
    const sweepTargets = (): SweepTarget[] => [...state.arcs.values()].flatMap(({ path, row }): SweepTarget[] => row?.animate === true ? [{
      curve: createSweepCurve(row, options.enterTransition, options.enterStaggerScale),
      endMs: sweepEndMs(row, options.enterTransition, options.enterStaggerScale),
      path,
      row,
    }] : []);
    const begin = (): void => {
      const targets = sweepTargets();
      if (targets.length === 0) { return; }
      sweeping = true;
      const lastEndMs = Math.max(...targets.map(endOf));
      const start = performance.now();
      // bklit's sweep is a JS-driven motion value: its clock starts at motion's origin (kit/entrance/entrance-origin.ts), resolved in the first rAF.
      let origin: number | null = null;
      cancelOrigin = resolveEntranceOrigins(options.renderStart.current ?? start, (clocks) => { origin = clocks.motion; });
      const tick = (now: number): void => {
        if (!sweeping) { return; }
        const elapsed = origin === null ? 0 : now - origin;
        for (const { row, path, curve } of targets) {
          const progress = curve(elapsed);
          const d = progress === 0 ? "" : options.arc({ ...row, endAngle: row.startAngle + (row.endAngle - row.startAngle) * progress }) ?? "";
          // bklit's useTransform (ring.tsx:104) re-renders the path only on a changed value: skip a `d` the path already carries.
          if (path.getAttribute("d") !== d) { path.setAttribute("d", d); }
        }
        if (elapsed < lastEndMs) {
          // Next sweep frame (ring.tsx:104).
          frame = requestAnimationFrame(tick);
        } else { stop(); settle(); }
      };
      // bklit drives the sweep per frame through a motion value (ring.tsx:104); the first tick paints frame 0 and schedules the next.
      tick(start);
    };
    const prune = (): void => {
      for (const [id, group] of state.groups) { if (!state.seen.has(id)) { group.remove(); state.groups.delete(id); } }
      for (const [id, arc] of state.arcs) { if (!state.seen.has(id)) { arc.path.remove(); state.arcs.delete(id); } }
      state.seen.clear();
    };
    return {
      destroy: stop,
      render: (scene): void => {
        paintNodes(state, scene.nodes, svg, "");
        prune();
        if (!started) {
          started = true;
          options.claim.current ??= layer;
          if (options.claim.current === layer && !prefersReducedMotion()) { begin(); }
        }
        if (!sweeping) { settle(); }
      },
    };
  });
};

export { createProgressLayer };
export type { ProgressLayerOptions };
