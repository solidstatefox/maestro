import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts";
import { readHoverIndex, writeHoverIndex } from "../host-write";
import { writable } from "../store";
import type { PolarHoverValue } from "../types/polar";
import { TAU } from "./tau";

/** Pub/sub hover index consumed by the center stats and the public hover hooks. */
export interface HoverSource {
  readonly getHovered: () => number | null;
  readonly setHovered: (index: number | null) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export type HoverReader = Readonly<Pick<HoverSource, "getHovered" | "subscribe">>;

/** A hover source holding `initial`; `setHovered` notifies only on a change. */
export const createHoverSource = (initial: number | null = null): HoverSource => {
  const store = writable(initial);
  return { getHovered: store.get, setHovered: store.set, subscribe: store.subscribe };
};

/** The public `{ hoveredIndex, setHoveredIndex }` over a source (`hoveredIndex` its current value). */
export const polarHoverValue = (source: HoverSource, hoveredIndex: number | null): PolarHoverValue => ({
  hoveredIndex,
  setHoveredIndex: (index: number | null) => { source.setHovered(index); },
});

/** Mirrors the source's index onto `host` as `data-hover` (static CSS keys off it), now and on every change; `null` while disabled and for an
 * index at or past `maxIndex`. `onChange` runs right after the write (same task, before paint) so a spring driver can retarget from live state.
 * Returns the unsubscribe. */
// oxlint-disable-next-line max-params -- the pie and ring charts' positional hook signature, carried through
export function watchHostHover(
  source: HoverReader,
  host: () => HTMLElement | null,
  enabled: boolean,
  maxIndex: number,
  onChange?: (host: HTMLElement, previous: number | null, next: number | null) => void,
): () => void {
  let last: number | null = null;
  const apply = (): void => {
    const el = host();
    if (!el) { return; }
    const raw = enabled ? source.getHovered() : null;
    const index = raw === null || raw >= maxIndex ? null : raw;
    if (index === last) { return; }
    const previous = readHoverIndex(el);
    last = index;
    writeHoverIndex(el, index);
    onChange?.(el, previous, index);
  };
  apply();
  return source.subscribe(apply);
}

/** A source no hover ever reaches (PieCenterShell's centre). */
export const INERT_HOVER: HoverSource = { getHovered: () => null, setHovered: () => undefined, subscribe: () => () => undefined };

/** The hover props of a pie or ring chart. */
export interface PolarHoverProps {
  /** Defined: the hover is controlled, and the source shows this index. */
  readonly hoveredIndex?: number | null;
  readonly onHoverChange?: (index: number | null) => void;
}

/** A pie's or ring's hover: the source its centre and hooks read, a controlled `hoveredIndex` and the native focus report. The native focus
 * engine is the single source (pointer and keyboard); a controlled index overrides the store. Owned by the pie and ring controllers. */
export interface PolarHover<TDatum> {
  readonly source: HoverSource;
  /** The chart's latest hover props, on every input (React: each render, as a callback's closure held them). */
  readonly update: (props: Readonly<PolarHoverProps>) => void;
  /** A controlled `hoveredIndex` into the source; `undefined` leaves it to the focus engine (React: a passive effect on the prop's change). */
  readonly control: (hoveredIndex: number | null | undefined) => void;
  /** The native `onFocusChange`: an uncontrolled source follows it, and `onHoverChange` hears it either way. */
  readonly focusChange: (point: ChartPoint<TDatum, number, number> | null) => void;
}

export const createPolarHover = <TDatum>(indexOf: (datum: TDatum) => number): PolarHover<TDatum> => {
  const source = createHoverSource();
  let props: Readonly<PolarHoverProps> = {};
  return {
    source,
    update: (next) => { props = next; },
    control: (hoveredIndex) => {
      if (hoveredIndex !== undefined) { source.setHovered(hoveredIndex); }
    },
    focusChange: (point) => {
      const next = point === null ? null : indexOf(point.datum);
      if (props.hoveredIndex === undefined) { source.setHovered(next); }
      props.onHoverChange?.(next);
    },
  };
};

/** A provider's source bridged to its caller's hover state (PieProvider, RingProvider re-providing a context): `sync` takes the caller's index
 * in, `listen` reports the source's changes back out. React: react/kit/polar/hover-context.ts `useBridgedCoordinator`, each in a passive effect. */
interface BridgedHover {
  readonly source: HoverSource;
  readonly sync: (index: number | null) => void;
  /** Returns the unsubscribe. */
  readonly listen: (setHovered: (index: number | null) => void) => () => void;
}

export const createBridgedHover = (initial: number | null): BridgedHover => {
  const source = createHoverSource(initial);
  return {
    source,
    sync: (index) => { source.setHovered(index); },
    listen: (setHovered) => source.subscribe(() => { setHovered(source.getHovered()); }),
  };
};

// Annulus focus: the nearest-point resolution drops focus for thin rings or pop-outs, so the static sectors are hit-tested instead.
export interface AnnulusTarget {
  readonly index: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

interface AnnularFocusOptions<TDatum> {
  readonly center: number;
  readonly targets: readonly AnnulusTarget[];
  readonly indexOf: (datum: TDatum) => number;
  /** Points that take part in focus (excludes underlay marks). */
  readonly focusable: (point: ChartPoint<TDatum, number, number>) => boolean;
  /** Points keyboard navigation steps through (one per index). */
  readonly navigable: (point: ChartPoint<TDatum, number, number>) => boolean;
  /** Hover-scale of a target while `hovered` is the focused index (the painted ring scales about the centre, so its hit area does too). */
  readonly scaleOf?: (index: number, hovered: number | null) => number;
  readonly hovered?: () => number | null;
}

const EDGE_EPSILON = 1e-9;

const insideSector = (target: Readonly<AnnulusTarget>, radius: number, angle: number): boolean => {
  if (radius < target.innerRadius || radius > target.outerRadius) { return false; }
  // The apex belongs to every sector (each painted path runs through it); the angle there is undefined.
  if (radius < EDGE_EPSILON) { return true; }
  const sweep = target.endAngle - target.startAngle;
  if (sweep >= TAU) { return true; }
  const wrapped = (((angle - target.startAngle) % TAU) + TAU) % TAU;
  // A pointer on a shared edge counts as inside both neighbours (SVG fill hit-testing is edge-inclusive); float noise must not decide.
  const offset = wrapped > TAU - EDGE_EPSILON ? 0 : wrapped;
  return offset <= sweep + EDGE_EPSILON;
};

export const createAnnularFocus = <TDatum>(options: Readonly<AnnularFocusOptions<TDatum>>): ChartFocusStrategy<TDatum, number, number> => {
  const { center, targets, indexOf, focusable, navigable, scaleOf, hovered } = options;
  type Point = ChartPoint<TDatum, number, number>;
  // The engine passes the same `points` array until the scene changes: bucket once per array, so a move does not filter every point.
  let bucketed: readonly Point[] | null = null;
  let buckets = new Map<number, Point[]>();
  const ofIndex = (points: readonly Point[], index: number): Point[] => {
    if (bucketed !== points) {
      buckets = new Map();
      for (const point of points) {
        if (!focusable(point)) { continue; }
        const key = indexOf(point.datum);
        const bucket = buckets.get(key);
        if (bucket) { bucket.push(point); } else { buckets.set(key, [point]); }
      }
      bucketed = points;
    }
    return buckets.get(index)?.slice() ?? [];
  };
  // Later targets paint on top; test them first.
  const reversed = targets.toReversed();
  return {
    group: (points, { point }) => ofIndex(points, indexOf(point.datum)),
    navigation: (points) => points.filter(navigable).toSorted((left, right) => indexOf(left.datum) - indexOf(right.datum)),
    resolve: (points, { x, y }) => {
      const dx = x - center;
      const dy = y - center;
      const radius = Math.hypot(dx, dy);
      const angle = Math.atan2(dx, -dy);
      const current = hovered?.() ?? null;
      for (const target of reversed) {
        const scale = scaleOf ? scaleOf(target.index, current) : 1;
        const scaled = scale === 1 ? target : { ...target, innerRadius: target.innerRadius * scale, outerRadius: target.outerRadius * scale };
        if (insideSector(scaled, radius, angle)) { return ofIndex(points, target.index); }
      }
      return [];
    },
  };
};
