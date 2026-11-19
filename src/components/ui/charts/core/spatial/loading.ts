import { createMark } from "@tanstack/charts";
import type { ChartBounds, SceneNode, SceneStyle } from "@tanstack/charts";
import { geoContains } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import { curveCatmullRomClosed, line } from "d3-shape";
import type { FeatureCollection } from "geojson";
import { erase } from "../erased-types";
import { clearAttribute, raiseAttribute } from "../host-write";
import type { AnyMark } from "../erased-types";
import { loadingLabelTree } from "../markup/loading-label";
import { el } from "../markup/node";
import type { MarkupNode } from "../markup/node";
import { CLS, isMotionNode, keyIs } from "../renderer-dom";

/** How a skeleton layer pulses: `shimmer` each element on its own seeded loop, `breathe` one swell passed from element to element. */
export type SpatialSkeletonPulse = "shimmer" | "breathe";

/** One skeleton layer: its mark (in the definition) and how its elements pulse. */
export interface SpatialSkeletonLayer {
  readonly markId: string;
  readonly pulse: SpatialSkeletonPulse;
  /** The opacity range the pulse moves in (the elements' own fill and stroke opacities under it). */
  readonly low: number;
  readonly high: number;
  /** `breathe`: delay between one element's swell and the next's (ms). */
  readonly stagger?: number;
}

/** A skeleton's pulse options (`spatialSkeleton`). */
export interface SpatialSkeletonOptions {
  readonly pulse?: SpatialSkeletonPulse;
  readonly low?: number;
  readonly high?: number;
  readonly stagger?: number;
}

/** The shapes of one skeleton layer for the plot `chart` (the chart svg's pixels). */
export type SpatialSkeletonDraw = (chart: ChartBounds) => readonly SceneNode[];

/** The skeletons' paint: the kit's token for skeletons and faded marks. */
export const SKELETON_FILL = "var(--chart-foreground-muted)";

/** Every skeleton mark's id starts so: css.ts tells the skeleton's groups from the data's by it. */
export const SKELETON_PREFIX = "skeleton-";

/** A skeleton layer, its id `skeleton-<name>`: a custom mark drawing `draw`'s shapes (no points: nothing to focus; no motion: it enters
 * at once), and how it pulses. The family puts `mark` in its definition's marks and `layer` in its build's `skeleton`. */
export const spatialSkeleton = (id: `${typeof SKELETON_PREFIX}${string}`, draw: SpatialSkeletonDraw, options: SpatialSkeletonOptions = {}): { readonly mark: AnyMark; readonly layer: SpatialSkeletonLayer } => ({
  // One group keyed by the layer's id, as the native marks draw theirs (`g[data-ts-key="<id>"]` in `.ts-chart__marks`).
  mark: erase(createMark(() => ({ id, channels: {}, resolveLayout: ({ chart }: { readonly chart: ChartBounds }) => ({ render: () => ({ nodes: [{ kind: "group", key: id, ariaHidden: true, children: draw(chart) }], points: [] }) }) }), erase(false))),
  layer: { markId: id, pulse: options.pulse ?? "shimmer", low: options.low ?? 0.25, high: options.high ?? 1, stagger: options.stagger },
});

// --- The shapes' helpers (the families' skeleton geometry) ------------------------------------------------------------------------

/** A coordinate rounded for a path's markup (hundredths of a pixel). */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A filled path. */
export const skeletonArea = (key: string, d: string, style: SceneStyle = {}): SceneNode => ({ kind: "area", key, points: [], path: d, style: { fill: SKELETON_FILL, ...style } });

/** A stroked path (no fill). */
export const skeletonStroke = (key: string, d: string, style: SceneStyle = {}): SceneNode =>
  ({ kind: "polyline", key, points: [], path: d, style: { fill: "none", stroke: SKELETON_FILL, strokeWidth: 1.5, lineCap: "round", lineJoin: "round", ...style } });

/** A filled circle. */
export const skeletonDot = (key: string, x: number, y: number, radius: number, style: SceneStyle = {}): SceneNode => ({ kind: "dot", key, x, y, radius, style: { fill: SKELETON_FILL, ...style } });

// Park-Miller over a murmur3-mixed seed (neighbouring seeds would draw correlated first values).
const MODULUS = 2_147_483_647;
const mix = (seed: number): number => {
  let hash = Math.imul(seed + 271_829, 0x85_eb_ca_6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2_b2_ae_35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % MODULUS || 1;
};

/** A seeded generator of values in [0, 1): the skeletons are the same on every render, server and client. */
export const skeletonRandom = (seed: number): (() => number) => {
  let state = mix(seed);
  return () => {
    state = (state * 16_807) % MODULUS;
    return (state - 1) / (MODULUS - 1);
  };
};

/** A closed, softly wobbling blob around (cx, cy) with radii rx, ry: `wobble` is the share its radius strays by. */
export const blobPath = (cx: number, cy: number, rx: number, ry: number, random: () => number, wobble = 0.14): string => {
  const count = 9;
  const phase = random() * Math.PI * 2;
  const lobes = random() * Math.PI * 2;
  const points: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const k = 1 + wobble * (Math.sin(2 * angle + phase) * 0.7 + Math.sin(3 * angle + lobes) * 0.3);
    points.push([round2(cx + Math.cos(angle) * rx * k), round2(cy + Math.sin(angle) * ry * k)]);
  }
  return line().curve(curveCatmullRomClosed)(points) ?? "";
};

const ROUND_TRIP_PX = 1;
/** The latitudes skeleton places keep to (where a map's data lives: not the poles). */
const PLACE_LATITUDES = [-45, 65] as const;
const placesCache = /* @__PURE__ */ new WeakMap<GeoProjection, { readonly key: string; readonly places: readonly (readonly [number, number])[] }>();

/** Up to `count` places on the map's land (anywhere on the drawn world without a geography), in a seeded order: a jittered grid over the
 * plot, each cell's point kept when the projection maps it back to itself (it is on the world, not in a corner past it), it is on land
 * and away from the poles. Kept per projection: a resize projects again. */
export const skeletonPlaces = (chart: ChartBounds, projection: GeoProjection, geography: FeatureCollection | undefined, count: number, seed: number): readonly (readonly [number, number])[] => {
  const key = `${chart.x}|${chart.y}|${chart.width}|${chart.height}|${count}|${seed}|${geography === undefined ? 0 : geography.features.length}`;
  const cached = placesCache.get(projection);
  if (cached?.key === key) {
    return cached.places;
  }
  const random = skeletonRandom(seed);
  const columns = 10;
  const rows = Math.max(3, Math.round((columns * chart.height) / Math.max(1, chart.width)));
  const cellW = chart.width / columns;
  const cellH = chart.height / rows;
  const candidates: { readonly at: readonly [number, number]; readonly order: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = chart.x + (column + 0.2 + random() * 0.6) * cellW;
      const y = chart.y + (row + 0.2 + random() * 0.6) * cellH;
      candidates.push({ at: [x, y], order: random() });
    }
  }
  candidates.sort((a, b) => a.order - b.order);
  const places: (readonly [number, number])[] = [];
  for (const { at } of candidates) {
    if (places.length >= count) {
      break;
    }
    const lonLat = projection.invert?.([at[0], at[1]]);
    const back = lonLat === null || lonLat === undefined ? null : projection(lonLat);
    if (lonLat === null || lonLat === undefined || back === null || !Number.isFinite(back[0]) || Math.hypot(back[0] - at[0], back[1] - at[1]) > ROUND_TRIP_PX) {
      continue;
    }
    if (lonLat[1] < PLACE_LATITUDES[0] || lonLat[1] > PLACE_LATITUDES[1]) {
      continue;
    }
    if (geography === undefined || geoContains(geography, lonLat)) {
      places.push(at);
    }
  }
  placesCache.set(projection, { key, places });
  return places;
};

// --- The pulse ---------------------------------------------------------------------------------------------------------------------

/** Each skeleton element fades in from nothing over this before its pulse. */
const INTRO_MS = 400;
const INTRO_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Ready -> loading: the skeleton waits this long for the drawn marks to fade out (the renderer's exit tween, the heatmap's conceal). */
const CONCEAL_MS = 450;
/** Loading -> ready: how long the renderer's own fade-in of the data's marks is held off (its tween is 450 ms; css.ts `data-bkm-entering`),
 * so they enter as on a first mount, by the family's entrance alone. */
const ENTER_HOLD_MS = 600;
const ENTERING_ATTR = "data-bkm-entering";
const PULSE_EASE = "cubic-bezier(0.45, 0, 0.55, 1)";
// The heatmap's shimmer per element (heatmap-cells.tsx:313-348 via motion.ts): tween to a random level over 0.35-1.2 s, hold 80-500 ms,
// a few times, then back to the floor; the cycle loops natively.
const SHIMMER_PULSES = 5;
const RAMP_MIN_MS = 350;
const RAMP_SPAN_MS = 850;
const HOLD_MIN_MS = 80;
const HOLD_SPAN_MS = 420;
/** One `breathe` swell, floor to top and back. */
const BREATHE_MS = 2400;
const DEFAULT_STAGGER_MS = 160;

interface Loop {
  readonly keyframes: Keyframe[];
  readonly duration: number;
}

const shimmerLoop = (index: number, low: number, high: number): Loop => {
  const random = skeletonRandom(index);
  const stops: { at: number; value: number; ramp: boolean }[] = [{ at: 0, ramp: true, value: low }];
  let at = 0;
  for (let pulse = 0; pulse <= SHIMMER_PULSES; pulse += 1) {
    const value = pulse === SHIMMER_PULSES ? low : low + random() * (high - low);
    at += RAMP_MIN_MS + random() * RAMP_SPAN_MS;
    stops.push({ at, ramp: false, value });
    at += HOLD_MIN_MS + random() * HOLD_SPAN_MS;
    stops.push({ at, ramp: true, value });
  }
  return { duration: at, keyframes: stops.map((stop) => ({ easing: stop.ramp ? PULSE_EASE : "linear", offset: stop.at / at, opacity: stop.value })) };
};

const breatheLoop = (low: number, high: number): Loop => ({
  duration: BREATHE_MS,
  keyframes: [{ easing: PULSE_EASE, offset: 0, opacity: low }, { easing: PULSE_EASE, offset: 0.5, opacity: high }, { offset: 1, opacity: low }],
});

const canAnimate = (element: Element): boolean => typeof element.animate === "function";

/** Starts one element's pulse after `delay`: the loop first (holding its floor until it starts), then the fade-in over it. */
const pulse = (element: Element, index: number, layer: SpatialSkeletonLayer, delay: number): void => {
  const breathe = layer.pulse === "breathe";
  const loop = breathe ? breatheLoop(layer.low, layer.high) : shimmerLoop(index, layer.low, layer.high);
  const stagger = breathe ? index * (layer.stagger ?? DEFAULT_STAGGER_MS) : 0;
  element.animate(loop.keyframes, { delay: delay + INTRO_MS + stagger, duration: loop.duration, fill: "backwards", iterations: Number.POSITIVE_INFINITY });
  element.animate([{ opacity: 0 }, { opacity: layer.low }], { delay, duration: INTRO_MS, easing: INTRO_EASE, fill: "backwards" });
};

// --- The layer ---------------------------------------------------------------------------------------------------------------------

const MARK_GROUPS = `${CLS.marks}>g[data-ts-key]`;

/** What the layer reads from the latest pass. */
export interface SpatialLoadingInput {
  readonly loading: boolean;
  /** The skeleton pulses and a flip is timed (`animate`, without reduced motion). */
  readonly motion: boolean;
  readonly skeleton: readonly SpatialSkeletonLayer[];
}

export interface SpatialLoadingLayer {
  /** Whether the last draw `drawn` saw was a loading one: a ready chart that never loaded skips the layer on every draw and focus change. */
  wasLoading(): boolean;
  /** The renderer's `onRender` (before the paint) while loading or on the draw after: on a status flip, waits the skeleton out while the
   * renderer fades the drawn marks (ready -> loading) or holds off its fade-in of the marks it adds (loading -> ready); starts the
   * skeleton's pulse. */
  drawn(svg: SVGSVGElement, input: SpatialLoadingInput): void;
  /** The marks the last loading draw kept besides its skeleton (the chrome: land, graticule), until `entered`; null after a ready mount. */
  kept(): ReadonlySet<string> | null;
  /** The entrance after loading has played: the next one plays every mark. */
  entered(): void;
  detach(): void;
}

const keyOf = (element: Element): string => element.getAttribute("data-ts-key") ?? "";

export function createSpatialLoadingLayer(): SpatialLoadingLayer {
  let drawnLoading = false;
  let kept: Set<string> | null = null;
  let entering: { readonly host: HTMLElement; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  const pulsing = new WeakSet<Element>();

  const stopEntering = (): void => {
    if (entering !== null) {
      clearTimeout(entering.timer);
      clearAttribute(entering.host, ENTERING_ATTR);
      entering = null;
    }
  };

  return {
    wasLoading: () => drawnLoading,
    drawn(svg, input) {
      const flipped = drawnLoading !== input.loading;
      drawnLoading = input.loading;
      if (!flipped && !input.loading) {
        return;
      }
      const groups = [...svg.querySelectorAll(MARK_GROUPS)];
      // The renderer fades a mark the draw removed out itself (its group's `opacity` on a 450 ms tween), and fades in one it adds unless
      // the mark has no motion (the skeleton, the land): meanwhile the group carries `data-ts-motion-role`.
      const tweening = new Set(groups.filter(isMotionNode).map(keyOf));
      let delay = 0;
      if (flipped && input.motion) {
        stopEntering();
        const host = svg.closest("[data-bkm-chart]");
        if (input.loading) {
          // Ready -> loading: the skeleton waits for the drawn marks to fade out.
          delay = tweening.size > 0 ? CONCEAL_MS : 0;
        } else if (host instanceof HTMLElement) {
          // Loading -> ready: the marks the renderer adds would fade in as a group over their entrance (a first mount has none); held
          // off until its tween is over, while the skeleton fades out.
          raiseAttribute(host, ENTERING_ATTR);
          entering = { host, timer: setTimeout(stopEntering, ENTER_HOLD_MS) };
        }
      }
      if (!input.loading) {
        return;
      }
      const skeletonIds = new Set(input.skeleton.map((layer) => layer.markId));
      kept = new Set(groups.map(keyOf).filter((key) => !skeletonIds.has(key) && !tweening.has(key)));
      if (!input.motion) {
        return;
      }
      for (const layer of input.skeleton) {
        const group = svg.querySelector(`${CLS.marks}>g${keyIs(layer.markId)}`);
        if (group === null) {
          continue;
        }
        for (const [index, element] of [...group.children].entries()) {
          if (!pulsing.has(element) && canAnimate(element)) {
            pulsing.add(element);
            pulse(element, index, layer, delay);
          }
        }
      }
    },
    kept: () => kept,
    entered() {
      kept = null;
    },
    detach() {
      stopEntering();
      drawnLoading = false;
      kept = null;
    },
  };
}

// --- The label ---------------------------------------------------------------------------------------------------------------------

/** The loading label over the plot (`loadingLabel`, while loading): bklit's shimmering label in a box the surface's size. Null for no
 * text. */
export const spatialLoadingLabel = (text: string | undefined, aspectRatio: number): MarkupNode | null => {
  const label = loadingLabelTree({ text: text ?? "" });
  return label === null ? null : el("div", { class: "bkm-sp-loading" }, [label], { style: { "aspect-ratio": String(aspectRatio) } });
};
