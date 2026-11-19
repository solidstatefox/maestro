import { erase } from "../erased-types";
import { geoCentroid, geoClipRectangle, geoPath } from "d3-geo";
import type { GeoPermissibleObjects, GeoProjection } from "d3-geo";
import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts";
import type { Plane } from "./camera-math";

// The projection is the fixed base (identity zoom); pan/zoom lives in `transform`, applied by CSS to the marks layer, so hit testing
// maps the pointer back into base space instead of rebuilding paths.
interface ZoomTransformState {
  k: number;
  x: number;
  y: number;
}

interface ProjectionHolder {
  projection: GeoProjection | undefined;
  /** While the camera is focused only its feature reacts to the pointer (bklit's `isHoverable`); unset, every feature does. */
  hoverable?: (index: number) => boolean;
  /** The scene point under the pointer while the map is tilted (the renderer's own reading flattens the 3D transform); null when flat. */
  pointer?: () => { readonly x: number; readonly y: number } | null;
  /** The tilted plane's projection of a scene point into the chart box (camera-math.ts `createPlane`); null when flat. */
  plane?: Plane | null;
  /** `ChoroplethTooltip`'s `hideDelay` (ms): a pointer that leaves a feature for nothing keeps it this long, so a border gap doesn't drop the
   * tooltip (0: none). */
  hideDelay?: number;
  /** Ends a grace that ran out with the pointer still on no feature (the controller clears the focus). */
  graceEnded?: () => void;
  /** Chart area and options the projection was built for. */
  projectionKey?: string;
  /** Chart area of the last projection build (scene px), the visible window the zoom transform maps into. */
  chart?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  transform: ZoomTransformState;
  /** Points of the last rendered scene (set in onRender): the settled geoShape points, which the presented points lack while the fade enters. */
  renderedPoints?: readonly ChartPoint<unknown, number, number>[];
}

const STROKE_HIT_WIDTH = 0.5;

/** Axis-aligned box `[x0, y0, x1, y1]` in base (unzoomed) projection space. */
type Box = readonly [number, number, number, number];

const centroids = /* @__PURE__ */ new WeakMap<object, readonly [number, number]>();
const centroidOf = (datum: GeoPermissibleObjects): readonly [number, number] => {
  let found = centroids.get(datum);
  if (found === undefined) {
    found = geoCentroid(datum);
    centroids.set(datum, found);
  }
  return found;
};
const westToEast = (left: GeoPermissibleObjects, right: GeoPermissibleObjects): number => {
  const [leftLon, leftLat] = centroidOf(left);
  const [rightLon, rightLat] = centroidOf(right);
  return leftLon - rightLon || rightLat - leftLat;
};

// A piece counts as visible when the feature's drawn shape, clipped to the visible area, spans at least this many screen px each way
// (a sliver at the edge is no country a sighted user can see or hover).
const MIN_VISIBLE_PX = 2;
/** Whether two boxes overlap by at least `min` in both directions. */
const overlaps = (ring: Box, area: Box, min: number): boolean =>
  Math.min(ring[2], area[2]) - Math.max(ring[0], area[0]) >= min && Math.min(ring[3], area[3]) - Math.max(ring[1], area[1]) >= min;

interface BoxContext {
  readonly arc: () => void;
  readonly closePath: () => void;
  readonly lineTo: (x: number, y: number) => void;
  readonly moveTo: (x: number, y: number) => void;
}

// Projected path events reduced to one box per ring (moveTo starts a ring).
const boxContext = (boxes: [number, number, number, number][]): BoxContext => {
  let box: [number, number, number, number] | undefined = undefined;
  return {
    arc: (): void => undefined,
    closePath: (): void => undefined,
    lineTo: (x: number, y: number): void => {
      if (box === undefined) {return;}
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    },
    moveTo: (x: number, y: number): void => {
      box = [x, y, x, y];
      boxes.push(box);
    },
  };
};

// One stream pass per feature: the projected outline goes straight into a Path2D (hit tests) and one box per ring is kept, taken after d3's
// antimeridian clipping (Russia's Chukotka, Fiji, the Aleutians yield separate boxes per map edge instead of one spanning the whole map).
const projectOnce = (projection: GeoProjection, datum: GeoPermissibleObjects): { readonly path: Path2D | null; readonly rings: Box[] } => {
  const boxes: [number, number, number, number][] = [];
  // A server render has no Path2D (hit tests only run on the client): the stream still yields the ring boxes.
  const path = typeof Path2D === "undefined" ? null : new Path2D();
  const rings = boxContext(boxes);
  geoPath(projection, erase({
    arc: (x: number, y: number, r: number, start: number, end: number): void => { path?.arc(x, y, r, start, end); },
    closePath: (): void => { path?.closePath(); },
    lineTo: (x: number, y: number): void => { path?.lineTo(x, y); rings.lineTo(x, y); },
    moveTo: (x: number, y: number): void => { path?.moveTo(x, y); rings.moveTo(x, y); },
  }))(datum);
  return { path: boxes.length === 0 ? null : path, rings: boxes.filter((ring) => ring.every(Number.isFinite)) };
};

const boundsOf = (rings: readonly Box[]): Box => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    x0 = Math.min(x0, ring[0]);
    y0 = Math.min(y0, ring[1]);
    x1 = Math.max(x1, ring[2]);
    y1 = Math.max(y1, ring[3]);
  }
  return [x0, y0, x1, y1];
};

// The drawn pieces inside `area`: the projected polygon clipped to the rectangle by d3's own geoClipRectangle, one box per clipped ring.
// A ring box can overlap the area while the shape itself misses it (Venezuela's box corner in the Europe view), so boxes only pre-filter.
const clippedBoxes = (projection: GeoProjection, area: Box, datum: GeoPermissibleObjects): Box[] => {
  const clip = geoClipRectangle(area[0], area[1], area[2], area[3]);
  const boxes: [number, number, number, number][] = [];
  geoPath({ stream: (output) => projection.stream(clip(output)) }, erase(boxContext(boxes)))(datum);
  return boxes.filter((ring) => ring.every(Number.isFinite));
};

interface FeatureGeometry {
  readonly bounds: Box;
  readonly rings: readonly Box[];
  /** The projected outline as a canvas path for hit tests (null when the feature projects to nothing). */
  readonly path: Path2D | null;
}

/** Per-feature projected geometry, computed once per base projection (rebuilt on resize, never on pan/zoom or keypress); shared by the focus strategy and the tooltip anchor. */
interface GeoGeometry {
  /** Feature geometry in base projection space, or undefined before the first projection build. */
  readonly of: (datum: GeoPermissibleObjects) => FeatureGeometry | undefined;
  /** Computes every feature's geometry for the current projection once the page is idle (never in the mount's task: the renderer has just
   * projected every feature itself), so the first hover sweep does no lazy per-feature work. A hover before then computes what it touches. */
  readonly warm: (data: readonly GeoPermissibleObjects[]) => void;
  /** Visible chart area mapped back into base projection space (the whole chart area when unzoomed). */
  readonly view: () => Box | undefined;
  /** Whether the feature's drawn shape, clipped to the visible area, spans at least MIN_VISIBLE_PX screen px each way. */
  readonly visible: (datum: GeoPermissibleObjects) => boolean;
  /** Centre of the box of the feature's largest visible piece (its shape clipped to the visible area), in base projection space. */
  readonly visibleCenter: (datum: GeoPermissibleObjects) => readonly [number, number] | undefined;
}

const createGeoGeometry = (holder: Readonly<ProjectionHolder>): GeoGeometry => {
  let cachedFor: GeoProjection | undefined = undefined;
  const cache = new Map<GeoPermissibleObjects, FeatureGeometry>();
  const of = (datum: GeoPermissibleObjects): FeatureGeometry | undefined => {
    const { projection } = holder;
    if (!projection) {return undefined;}
    if (cachedFor !== projection) {
      cache.clear();
      cachedFor = projection;
    }
    let found = cache.get(datum);
    if (found === undefined) {
      const { path, rings } = projectOnce(projection, datum);
      found = { bounds: boundsOf(rings), path, rings };
      cache.set(datum, found);
    }
    return found;
  };
  const view = (): Box | undefined => {
    const { chart, transform: { k, x, y } } = holder;
    if (!chart) {return undefined;}
    return [(chart.x - x) / k, (chart.y - y) / k, (chart.x + chart.width - x) / k, (chart.y + chart.height - y) / k];
  };
  // Clipped pieces per feature for the current view, recomputed when the projection or the zoom transform changes (a keypress walks
  // every feature once per view; a held focus re-checks one feature per zoom frame).
  let piecesFor = "";
  let piecesProjection: GeoProjection | undefined = undefined;
  const pieceCache = new Map<GeoPermissibleObjects, readonly Box[]>();
  const pieces = (datum: GeoPermissibleObjects): readonly Box[] => {
    const geometry = of(datum);
    const area = view();
    const { projection, transform: { k } } = holder;
    if (!geometry || !area || !projection) {return [];}
    const key = area.join(",");
    if (piecesFor !== key || piecesProjection !== projection) {
      pieceCache.clear();
      piecesFor = key;
      piecesProjection = projection;
    }
    let found = pieceCache.get(datum);
    if (found === undefined) {
      const min = MIN_VISIBLE_PX / k;
      found = geometry.rings.some((ring) => overlaps(ring, area, min))
        ? clippedBoxes(projection, area, datum).filter((piece) => piece[2] - piece[0] >= min && piece[3] - piece[1] >= min)
        : [];
      pieceCache.set(datum, found);
    }
    return found;
  };
  const visible = (datum: GeoPermissibleObjects): boolean => pieces(datum).length > 0;
  const visibleCenter = (datum: GeoPermissibleObjects): readonly [number, number] | undefined => {
    let best: readonly [number, number] | undefined = undefined;
    let bestArea = -1;
    for (const [x0, y0, x1, y1] of pieces(datum)) {
      const size = (x1 - x0) * (y1 - y0);
      if (size > bestArea) {
        bestArea = size;
        best = [(x0 + x1) / 2, (y0 + y1) / 2];
      }
    }
    return best;
  };
  let warmJob = 0;
  const warm = (data: readonly GeoPermissibleObjects[]): void => {
    if (typeof window === "undefined") {return;}
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    cancel(warmJob);
    let next = 0;
    // In slices, each within the idle period it was given (a slice always does at least one feature).
    const slice = (deadline?: IdleDeadline): void => {
      do {
        const datum = data[next];
        if (datum === undefined) {return;}
        of(datum);
        next += 1;
      } while (deadline === undefined || deadline.timeRemaining() > 1);
      warmJob = idle(slice, { timeout: 1000 });
    };
    warmJob = idle(slice, { timeout: 1000 });
  };
  return { of, view, visible, visibleCenter, warm };
};

const createGeoContainmentFocus = <TDatum extends GeoPermissibleObjects>(
  markId: string,
  holder: Readonly<ProjectionHolder>,
  geometry: GeoGeometry,
): ChartFocusStrategy<TDatum, number, number> => {
  // Hit testing on the projected path (canvas fill/stroke test), matching SVG pointer-events on the painted path.
  const probe = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  // bklit's hide delay: the feature the pointer last left for nothing, and the timer that lets it go.
  let graced: ChartPoint<TDatum, number, number> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const endGrace = (): void => {
    clearTimeout(graceTimer);
    graceTimer = undefined;
  };
  // `resolve` runs on every pointer move over one rendered list, so the filtered list is kept per list.
  const owned = new WeakMap<object, ChartPoint<TDatum, number, number>[]>();
  const own = (points: readonly ChartPoint<TDatum, number, number>[]): ChartPoint<TDatum, number, number>[] => {
    let found = owned.get(points);
    if (found === undefined) {
      found = points.filter((point) => point.markId === markId);
      owned.set(points, found);
    }
    return found;
  };
  return {
    group: (_points, context) => [context.point],
    // Stops: the features with a projected piece inside the visible area (every drawn feature when unzoomed), west to east.
    navigation: (points) => own(points).filter((point) => geometry.visible(point.datum)).toSorted((left, right) => westToEast(left.datum, right.datum)),
    resolve: (points, position) => {
      const { projection, transform, hoverable } = holder;
      const at = holder.pointer?.() ?? position;
      const x = (at.x - transform.x) / transform.k;
      const y = (at.y - transform.y) / transform.k;
      const lonLat = projection?.invert?.([x, y]);
      if (!projection || !lonLat || !Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) {return [];}
      // The rendered scene's points, not the presented ones: a parked pointer must open the tooltip once the entrance ends (choropleth-feature.tsx:201).
      // SAFETY: renderedPoints is the renderer's presented list of this chart's own points.
      const rendered = (): readonly ChartPoint<TDatum, number, number>[] | undefined => erase(holder.renderedPoints);
      const hits = (point: ChartPoint<TDatum, number, number>): boolean => {
        const feature = geometry.of(point.datum);
        if (feature === undefined) {
          return false;
        }
        const [x0, y0, x1, y1] = feature.bounds;
        if (x < x0 || x > x1 || y < y0 || y > y1) {
          return false;
        }
        const { path } = feature;
        if (path === null || probe === null) {
          return false;
        }
        probe.lineWidth = STROKE_HIT_WIDTH;
        return probe.isPointInPath(path, x, y) || probe.isPointInStroke(path, x, y);
      };
      // Topmost first: the last painted feature wins, as the browser picks for overlapping SVG paths.
      const found = own(rendered() ?? points).findLast(hits);
      const hit = found === undefined || (hoverable !== undefined && !hoverable(found.datumIndex)) ? undefined : found;
      if (hit !== undefined) {
        endGrace();
        graced = hit;
        return [hit];
      }
      // Off every feature: the one just left stays for `hideDelay` ms (bklit's delayed tooltip data), then goes unless a feature took over.
      const delay = holder.hideDelay ?? 0;
      if (graced === null || delay <= 0) {return [];}
      if (graceTimer === undefined) {
        graceTimer = setTimeout(() => {
          graceTimer = undefined;
          graced = null;
          holder.graceEnded?.();
        }, delay);
      }
      return [graced];
    },
  };
};

/** The feature under a base-space point (topmost first), or undefined: what a click picks. */
const pickFeature = <TDatum extends GeoPermissibleObjects>(
  points: readonly ChartPoint<TDatum, number, number>[],
  markId: string,
  geometry: GeoGeometry,
  x: number,
  y: number,
  probe: CanvasRenderingContext2D | null,
): ChartPoint<TDatum, number, number> | undefined => {
  if (probe === null) {return undefined;}
  probe.lineWidth = STROKE_HIT_WIDTH;
  return points.findLast((point) => {
    if (point.markId !== markId) {return false;}
    const feature = geometry.of(point.datum);
    if (feature === undefined || feature.path === null) {return false;}
    const [x0, y0, x1, y1] = feature.bounds;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (probe.isPointInPath(feature.path, x, y) || probe.isPointInStroke(feature.path, x, y));
  });
};

export { centroidOf, createGeoContainmentFocus, createGeoGeometry, pickFeature };
export type { GeoGeometry, ProjectionHolder };
