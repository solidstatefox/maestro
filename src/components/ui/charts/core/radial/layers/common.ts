import type { Arc } from "d3-shape";
import { radialArc } from "@tanstack/charts/polar";
import { REST_GRANULAR } from "../../motion/spring-curve";
import { springCurve } from "../../motion/spring-curve";
import type { RadialSpringOptions } from "../../types/radial";
import type { AnyPolarMark, LayerEnterEnv } from "./types";

/** The id of a layer's mark. */
export const markId = (layer: number, name: string): string => `rd${layer}:${name}`;

/** The legend dim class of a layer's series `series` (`"x"`: not a chart series, dimmed whenever a series is hovered). */
export const dimClass = (layer: number, series: number | "x"): string => `bkm-rd-d${layer}-${series}`;

/** The classes of a layer's marks whose children dim while another bin is hovered (the transition's, and the layer's for its dim). */
export const hotClass = (layer: number): string => `bkm-rd-hotable bkm-rd-h${layer}`;

const scope = (uid: string): string => `[data-bkm-kit="${uid}"]`;

/** The legend dim of one series' marks: `opacity` while another series is hovered in the legend. */
export const dimCss = (uid: string, layer: number, series: number | "x", opacity: number): string =>
  series === "x"
    ? `${scope(uid)}[data-rd-series] .${dimClass(layer, series)}{opacity:${opacity}}`
    : `${scope(uid)}[data-rd-series]:not([data-rd-series="${series}"]) .${dimClass(layer, series)}{opacity:${opacity}}`;

/** The bin dim of a layer: while a bin is hovered, the other bins' elements fade to `opacity`. */
export const hotCss = (uid: string, layer: number, opacity: number): string =>
  `${scope(uid)}[data-rd-hover] .bkm-rd-h${layer}>:not([data-rd-hot]){opacity:${opacity}}`;

/** A resource id of the chart's (gradients, patterns, masks): ids live in the document, so they carry the chart's. */
export const resourceId = (uid: string, layer: number, name: string): string => `${uid}-rd${layer}-${name}`;

/** The bin a per-bin element stands for: its key (`b12`, `r3`) ends its `data-ts-key`. */
export const binOfElement = (element: Element): number | null => {
  const key = element.getAttribute("data-ts-key") ?? "";
  const bin = Number.parseInt(key.slice(key.lastIndexOf(":") + 2), 10);
  return Number.isFinite(bin) ? bin : null;
};

/** A row of `pathMark`: its SVG path (in the chart's centred coordinates) and its key. */
export interface PathRow {
  readonly d: string;
  readonly key: string;
}

/** A d3 `arc`-shaped generator that returns each row's own path: radialArc draws any centred path with it (circles, open arcs, wedges). */
const pathGenerator = (): Arc<unknown, PathRow> => {
  let context: unknown = null;
  const zero = (): number => 0;
  const generator = Object.assign(
    (row: PathRow): string | null => {
      if (context !== null) {
        // TanStack traces the arc's boundary into a context for its focus geometry: these paths own no focus.
        // SAFETY: the context TanStack hands a generator implements moveTo.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
        (context as { moveTo: (x: number, y: number) => void }).moveTo(0, 0);
        return null;
      }
      return row.d;
    },
    {
      centroid: (): [number, number] => [0, 0],
      context(...next: unknown[]) {
        if (next.length === 0) {
          return context;
        }
        context = next[0] ?? null;
        return generator;
      },
      endAngle: () => zero,
      innerRadius: () => zero,
      outerRadius: () => zero,
      startAngle: () => zero,
    },
  );
  // SAFETY: radialArc reads only the members above off its generator (dist/polar.js radialArc and polar-sector-internal.js).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  return generator as unknown as Arc<unknown, PathRow>;
};

/** Style of a `pathMark`. */
export interface PathMarkStyle {
  readonly className: string;
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeOpacity?: number;
  readonly strokeWidth?: number;
  readonly strokeDasharray?: string;
}

/** A native polar mark drawing each row's path (radialArc with a path generator). */
export const pathMark = (id: string, rows: readonly PathRow[], style: Readonly<PathMarkStyle>): AnyPolarMark =>
  radialArc<PathRow>(rows, {
    className: style.className,
    fill: style.fill ?? "none",
    fillOpacity: style.fillOpacity,
    generator: pathGenerator,
    id,
    key: (row) => row.key,
    motion: false,
    stroke: style.stroke,
    strokeDasharray: style.strokeDasharray,
    strokeOpacity: style.strokeOpacity,
    strokeWidth: style.strokeWidth,
  });

// --- Entrances --------------------------------------------------------------------------------------------------------------------

/** bklit-ui's default chart enter tween (animation.ts): 1.1 s on [0.85, 0, 0.15, 1]. */
export const ENTER_MS = 1100;
export const ENTER_BEZIER = [0.85, 0, 0.15, 1] as const;
export const ENTER_EASE = `cubic-bezier(${ENTER_BEZIER.join(",")})`;

const curves = /* @__PURE__ */ new Map<string, { durationMs: number; ease: string }>();

/** A motion spring (unit travel) as a CSS `linear()` easing over its settle time (cached). */
export const springEase = (spring: Readonly<RadialSpringOptions>): { durationMs: number; ease: string } => {
  const full = { damping: spring.damping ?? 10, mass: spring.mass ?? 1, stiffness: spring.stiffness ?? 100 };
  const key = `${full.stiffness}/${full.damping}/${full.mass}`;
  let curve = curves.get(key);
  if (curve === undefined) {
    curve = springCurve(full, { decimals: 4, limitMs: 4000, rest: REST_GRANULAR, samples: 40, stepMs: 10 });
    curves.set(key, curve);
  }
  return curve;
};

/** Starts a Web Animation on `element` (held at its first keyframe through the delay); skipped where Web Animations are missing. One
 * keyframe is the start (it animates to the element's own value): Web Animations would read a lone keyframe as the end. */
export const animate = (env: LayerEnterEnv, element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null => {
  if (typeof element.animate !== "function") {
    return null;
  }
  const frames = keyframes.length === 1 ? [{ ...keyframes[0], offset: 0 }] : keyframes;
  const animation = element.animate(frames, { fill: "backwards", ...options });
  env.onCancel(() => {
    animation.cancel();
  });
  return animation;
};

/** The children of a mark's group, in data order. */
export const childrenOf = (env: LayerEnterEnv, id: string): Element[] => {
  const group = env.group(id);
  return group === null ? [] : [...group.children];
};
