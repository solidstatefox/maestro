import { geoArea, geoPath } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import type { Feature, Geometry, Polygon } from "geojson";
import { cubicBezier } from "../motion/easing";
import { writable } from "../store";
import type { Readable } from "../store";
import type { ChoroplethCameraApi, ChoroplethFeature, ChoroplethPerspective, ChoroplethViewSide, ChoroplethZoomTransition } from "../types/choropleth";
import type { CameraView, ViewTransform } from "./camera-math";
import { mixTransform, mixView } from "./camera-math";

export const DEFAULT_CHOROPLETH_ZOOM_EASE = [0.83, 0, 0.17, 1] as const;
const DEFAULT_ZOOM_MS = 700;
const DEFAULT_YAW = 18;
const DEFAULT_DEPTH = 1600;
const MAX_EDGE_FADE = 45;
const POINTER_STIFFNESS = 90;
const POINTER_DAMPING = 20;
const POINTER_REST = 0.01;
const DRAG_CLICK_TOLERANCE = 5;
const POINT_FOCUS_ZOOM = 4;
const FRAME_CAP_S = 1 / 30;

/** The camera's props from the chart (its defaults applied here). */
export interface CameraInput {
  readonly clickToZoom: boolean;
  readonly focusMaxZoom: number;
  readonly zoomTransition: ChoroplethZoomTransition | undefined;
  readonly perspective: ChoroplethPerspective | undefined;
}

/** What one frame writes: the camera's view (null at the overview), a zoom the flight carries in place of the live one, and the angles. */
export interface CameraFrame {
  readonly view: CameraView | null;
  readonly zoom: ViewTransform | null;
  readonly yaw: number;
  readonly tilt: number;
  readonly depth: number;
  readonly perspective: boolean;
}

interface CameraDeps {
  /** The chart's size (the map's box). */
  readonly size: () => { readonly width: number; readonly height: number };
  /** The base projection (identity zoom), undefined before the first draw. */
  readonly projection: () => GeoProjection | undefined;
  readonly features: () => readonly ChoroplethFeature[];
  /** The pan / zoom before a focus: its live transform, and its reset (applied to the gesture layer silently; null without zoom). */
  readonly zoom: () => ViewTransform;
  readonly resetZoom: () => ViewTransform | null;
  /** Writes a frame; `inFrame` when the camera's own animation frame writes it (the tooltip can follow in the same frame). */
  readonly write: (frame: CameraFrame, inFrame: boolean) => void;
  /** A flight landed (the map stopped moving under a resting pointer). */
  readonly settled: () => void;
  /** The focused key changed (the host's `data-bkm-cam-focus`, the edge fade). */
  readonly onFocus: (key: string | null) => void;
  readonly reducedMotion: () => boolean;
}

/** A tween of one number, or of the view and zoom. */
interface Tween<T> {
  readonly from: T;
  readonly to: T;
  readonly start: number;
  readonly duration: number;
}

export interface Camera {
  readonly api: Readable<ChoroplethCameraApi>;
  /** The chart's props, each pass: settles on the overview's angles when they change. */
  readonly configure: (input: CameraInput) => void;
  /** The size the map is drawn at changed: the projection is rebuilt, so the camera starts over (bklit's size effect). */
  readonly resize: () => void;
  /** The current frame (for a write that isn't the camera's: a zoom step, a render). */
  readonly frame: () => CameraFrame;
  /** A user pan / zoom took over: the flight stops carrying the zoom. */
  readonly releaseZoom: () => void;
  readonly onPointerDown: (event: PointerEvent) => void;
  /** `x01`: the pointer's position across the chart, 0 at its left edge. */
  readonly onPointerMove: (event: PointerEvent, x01: () => number) => void;
  readonly onPointerLeave: () => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  readonly dispose: () => void;
}

/** Largest polygon of a feature, so France frames France, not French Guiana. */
const mainland = (feature: ChoroplethFeature): Feature<Geometry> => {
  const geometry = feature.geometry;
  if (geometry?.type !== "MultiPolygon") {
    return feature;
  }
  let best: Polygon | null = null;
  let bestArea = -1;
  for (const coordinates of geometry.coordinates) {
    const polygon: Polygon = { coordinates, type: "Polygon" };
    const area = geoArea(polygon);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return best ? { ...feature, geometry: best } : feature;
};

/** Looking from the east brings the east edge toward the viewer. */
const signedYaw = (side: ChoroplethViewSide, yaw: number): number => {
  if (side === "flat") {return 0;}
  return side === "east" ? -yaw : yaw;
};

const noop = (): void => undefined;

/** The camera of a chart without one (`useChoroplethCamera()` outside a chart, or a chart before its first pass). */
export const CAMERA_API_DEFAULT: ChoroplethCameraApi = {
  enabled: false,
  focusFeature: noop,
  focusPoint: noop,
  focusedFeatureIndex: null,
  focusedKey: null,
  isHoverable: () => true,
  maxZoom: 1,
  reset: noop,
  wasDrag: () => false,
};

export function createCamera(deps: CameraDeps): Camera {
  let input: CameraInput = { clickToZoom: false, focusMaxZoom: 6, perspective: undefined, zoomTransition: undefined };
  let ease = cubicBezier(...DEFAULT_CHOROPLETH_ZOOM_EASE);
  let easeKey = DEFAULT_CHOROPLETH_ZOOM_EASE.join();
  let configured = false;
  let view: CameraView | null = null;
  let focusedKey: string | null = null;
  let yaw = 0;
  let tilt = 0;
  let yawVelocity = 0;
  let yawTarget: number | null = null;
  let flight: (Tween<CameraView> & { readonly end: CameraView | null }) | null = null;
  let zoomFlight: Tween<ViewTransform> | null = null;
  let zoomCarried: ViewTransform | null = null;
  let yawTween: Tween<number> | null = null;
  let tiltTween: Tween<number> | null = null;
  let frameId = 0;
  let lastTick = 0;
  let press: { x: number; y: number; moved: boolean } | null = null;

  // --- Derived options (bklit's camera hook body) --------------------------------------------------------------------------------
  const overview = (): { view: ChoroplethViewSide | "pointer"; yaw: number; tilt: number } => {
    const o = input.perspective?.overview;
    return { tilt: o?.tilt ?? 0, view: o?.view ?? "flat", yaw: o?.yaw ?? DEFAULT_YAW };
  };
  const focusOptions = (): { view: ChoroplethViewSide | "auto" | undefined; yaw: number; tilt: number } => {
    const o = overview();
    const f = input.perspective?.focus;
    return { tilt: f?.tilt ?? o.tilt, view: f?.view, yaw: f?.yaw ?? o.yaw };
  };
  const overviewStaticYaw = (): number => {
    const o = overview();
    return o.view === "pointer" ? 0 : signedYaw(o.view, o.yaw);
  };
  const hasPerspective = (): boolean => {
    if (input.perspective === undefined) {return false;}
    const o = overview();
    const f = focusOptions();
    return o.view !== "flat" || o.tilt !== 0 || (f.view !== undefined && f.view !== "flat") || f.tilt !== 0;
  };
  const durationMs = (): number => (deps.reducedMotion() ? 0 : (input.zoomTransition?.duration ?? DEFAULT_ZOOM_MS));
  const depth = (): number => input.perspective?.depth ?? DEFAULT_DEPTH;
  const followsPointer = (): boolean => input.perspective !== undefined && overview().view === "pointer" && focusedKey === null && !deps.reducedMotion();

  // --- The public API store --------------------------------------------------------------------------------------------------------
  const apiStore = writable<ChoroplethCameraApi>(CAMERA_API_DEFAULT);

  // --- Frames ------------------------------------------------------------------------------------------------------------------------
  const frame = (): CameraFrame => ({ depth: depth(), perspective: hasPerspective(), tilt, view, yaw, zoom: zoomCarried });
  const progress = (tween: Tween<unknown>, now: number): number => (tween.duration <= 0 ? 1 : Math.min(1, (now - tween.start) / tween.duration));
  const tick = (now: number): void => {
    frameId = 0;
    const dt = Math.min(FRAME_CAP_S, Math.max(0, (now - (lastTick || now)) / 1000));
    lastTick = now;
    let landed = false;
    if (flight) {
      const t = progress(flight, now);
      view = mixView(flight.from, flight.to, ease(t));
      if (t >= 1) {
        view = flight.end;
        flight = null;
        landed = true;
      }
    }
    if (zoomFlight) {
      const t = progress(zoomFlight, now);
      zoomCarried = mixTransform(zoomFlight.from, zoomFlight.to, ease(t));
      if (t >= 1) {
        zoomFlight = null;
        zoomCarried = null;
      }
    }
    if (tiltTween) {
      const t = progress(tiltTween, now);
      tilt = tiltTween.from + (tiltTween.to - tiltTween.from) * ease(t);
      if (t >= 1) {tiltTween = null;}
    }
    if (yawTween) {
      const t = progress(yawTween, now);
      yaw = yawTween.from + (yawTween.to - yawTween.from) * ease(t);
      if (t >= 1) {yawTween = null;}
    } else if (yawTarget !== null) {
      // bklit's pointer spring (stiffness 90, damping 20, mass 1), integrated per frame.
      const steps = 2;
      for (let i = 0; i < steps; i += 1) {
        const h = dt / steps;
        yawVelocity += (-POINTER_STIFFNESS * (yaw - yawTarget) - POINTER_DAMPING * yawVelocity) * h;
        yaw += yawVelocity * h;
      }
      if (Math.abs(yaw - yawTarget) < POINTER_REST && Math.abs(yawVelocity) < POINTER_REST) {
        yaw = yawTarget;
        yawVelocity = 0;
        yawTarget = null;
      }
    }
    deps.write(frame(), true);
    if (flight || zoomFlight || tiltTween || yawTween || yawTarget !== null) {schedule();}
    if (landed) {deps.settled();}
  };
  const schedule = (): void => {
    if (frameId === 0) {
      if (lastTick === 0 || performance.now() - lastTick > 100) {lastTick = performance.now();}
      frameId = requestAnimationFrame(tick);
    }
  };

  // --- Moves (bklit's moveAngles, flyTo) ---------------------------------------------------------------------------------------------
  const moveAngles = (nextYaw: number, nextTilt: number): void => {
    yawTarget = null;
    yawVelocity = 0;
    const duration = durationMs();
    if (duration === 0) {
      yawTween = null;
      tiltTween = null;
      yaw = nextYaw;
      tilt = nextTilt;
      deps.write(frame(), false);
      return;
    }
    const start = performance.now();
    yawTween = yaw === nextYaw ? null : { duration, from: yaw, start, to: nextYaw };
    tiltTween = tilt === nextTilt ? null : { duration, from: tilt, start, to: nextTilt };
    schedule();
  };
  const identityView = (): CameraView => {
    const { width, height } = deps.size();
    return { cx: width / 2, cy: height / 2, k: 1 };
  };
  /** `target` null flies back to the overview (the identity view, dropped at the end). */
  const flyTo = (target: CameraView | null, zoomFrom: ViewTransform | null, zoomTo: ViewTransform | null): void => {
    const duration = durationMs();
    const to = target ?? identityView();
    if (duration === 0) {
      flight = null;
      zoomFlight = null;
      zoomCarried = null;
      view = target;
      deps.write(frame(), false);
      return;
    }
    const start = performance.now();
    flight = { duration, end: target, from: view ?? identityView(), start, to };
    zoomFlight = zoomFrom !== null && zoomTo !== null ? { duration, from: zoomFrom, start, to: zoomTo } : null;
    zoomCarried = zoomFlight === null ? null : zoomFrom;
    schedule();
  };
  /** bklit's `onBeforeFocus`: the pan / zoom goes back to its initial transform so the two don't compound; here the flight carries it there. */
  const beforeFocus = (): { from: ViewTransform | null; to: ViewTransform | null } => {
    const from = zoomCarried ?? deps.zoom();
    const to = deps.resetZoom();
    return { from: to === null ? null : from, to };
  };
  const focusAngles = (cx: number): void => {
    if (input.perspective === undefined) {return;}
    const f = focusOptions();
    let side: ChoroplethViewSide;
    if (f.view === "auto") {
      side = cx < deps.size().width / 2 ? "west" : "east";
    } else if (f.view !== undefined) {
      side = f.view;
    } else {
      const o = overview().view;
      side = o === "pointer" ? "flat" : o;
    }
    moveAngles(signedYaw(side, f.yaw), f.tilt);
  };
  const setFocused = (key: string | null): void => {
    if (key === focusedKey) {return;}
    focusedKey = key;
    deps.onFocus(key);
    publish();
  };

  const reset = (): void => {
    setFocused(null);
    const zoom = zoomCarried === null ? null : { from: zoomCarried, to: deps.zoom() };
    flyTo(null, zoom?.from ?? null, zoom?.to ?? null);
    moveAngles(overviewStaticYaw(), overview().tilt);
  };
  const focusFeature = (index: number): void => {
    const key = `feature:${index}`;
    if (focusedKey === key) {
      reset();
      return;
    }
    const feature = deps.features()[index];
    const projection = deps.projection();
    if (!feature || !projection) {return;}
    const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(mainland(feature));
    if (![x0, y0, x1, y1].every(Number.isFinite)) {return;}
    const { width, height } = deps.size();
    const k = Math.min(input.focusMaxZoom, Math.max(1, 0.7 * Math.min(width / (x1 - x0 || 1), height / (y1 - y0 || 1))));
    const cx = (x0 + x1) / 2;
    const zoom = beforeFocus();
    setFocused(key);
    flyTo({ cx, cy: (y0 + y1) / 2, k }, zoom.from, zoom.to);
    focusAngles(cx);
  };
  const focusPoint = (coordinates: [number, number], key: string): void => {
    const pointKey = `point:${key}`;
    if (focusedKey === pointKey) {
      reset();
      return;
    }
    const projected = deps.projection()?.(coordinates);
    if (!projected) {return;}
    const [cx, cy] = projected;
    const zoom = beforeFocus();
    setFocused(pointKey);
    flyTo({ cx, cy, k: Math.min(input.focusMaxZoom, POINT_FOCUS_ZOOM) }, zoom.from, zoom.to);
    focusAngles(cx);
  };
  const isHoverable = (key: string): boolean => focusedKey === null || focusedKey === key;
  const wasDrag = (): boolean => press?.moved ?? false;

  function publish(): void {
    apiStore.set({
      enabled: input.clickToZoom,
      focusFeature,
      focusPoint,
      focusedFeatureIndex: focusedKey?.startsWith("feature:") === true ? Number(focusedKey.slice("feature:".length)) : null,
      focusedKey,
      isHoverable,
      maxZoom: input.focusMaxZoom,
      reset,
      wasDrag,
    });
  }

  let anglesKey = "";
  return {
    api: { get: apiStore.get, subscribe: apiStore.subscribe },
    configure: (next) => {
      const changed = next.clickToZoom !== input.clickToZoom || next.focusMaxZoom !== input.focusMaxZoom;
      input = next;
      const nextEase = (next.zoomTransition?.ease ?? DEFAULT_CHOROPLETH_ZOOM_EASE).join();
      if (nextEase !== easeKey) {
        easeKey = nextEase;
        const [a, b, c, d] = next.zoomTransition?.ease ?? DEFAULT_CHOROPLETH_ZOOM_EASE;
        ease = cubicBezier(a, b, c, d);
      }
      // bklit's effect on the overview's angles: settle on them (animated) when they change while nothing is focused; the first pass sets them.
      const key = `${overviewStaticYaw()}|${overview().tilt}|${hasPerspective()}|${depth()}`;
      if (!configured) {
        configured = true;
        anglesKey = key;
        yaw = overviewStaticYaw();
        tilt = overview().tilt;
        publish();
        return;
      }
      if (key !== anglesKey) {
        anglesKey = key;
        if (focusedKey === null) {moveAngles(overviewStaticYaw(), overview().tilt);}
      }
      if (changed) {publish();}
    },
    dispose: () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
      flight = null;
      zoomFlight = null;
      yawTween = null;
      tiltTween = null;
      yawTarget = null;
    },
    frame,
    onKeyDown: (event) => {
      if (input.clickToZoom && event.key === "Escape" && focusedKey !== null) {reset();}
    },
    onPointerDown: (event) => {
      press = { moved: false, x: event.clientX, y: event.clientY };
    },
    onPointerLeave: () => {
      if (!followsPointer()) {return;}
      yawTween = null;
      yawTarget = 0;
      schedule();
    },
    onPointerMove: (event, x01) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_CLICK_TOLERANCE) {press.moved = true;}
      if (!followsPointer()) {return;}
      const t = Math.min(1, Math.max(0, x01()));
      // Left edge: seen from the west; right edge: from the east.
      const { yaw: overviewYaw } = overview();
      yawTween = null;
      yawTarget = overviewYaw - 2 * overviewYaw * t;
      schedule();
    },
    releaseZoom: () => {
      zoomFlight = null;
      zoomCarried = null;
    },
    resize: () => {
      flight = null;
      zoomFlight = null;
      zoomCarried = null;
      view = null;
      setFocused(null);
      deps.write(frame(), false);
    },
  };
}

/** The viewport edge fade in % per side: 0 without a 3D camera (bklit's `edgeFade`). */
export const edgeFadeOf = (perspective: ChoroplethPerspective | undefined, perspectiveOn: boolean): number =>
  perspectiveOn ? Math.min(MAX_EDGE_FADE, Math.max(0, perspective?.edgeFade ?? 0)) : 0;

/** Whether a perspective has any 3D in it (bklit's `hasPerspective`). */
export const perspectiveOn = (perspective: ChoroplethPerspective | undefined): boolean => {
  if (perspective === undefined) {return false;}
  const o = perspective.overview;
  const f = perspective.focus;
  const overviewTilt = o?.tilt ?? 0;
  return (o?.view ?? "flat") !== "flat" || overviewTilt !== 0 || (f?.view !== undefined && f.view !== "flat") || (f?.tilt ?? overviewTilt) !== 0;
};

/** Whether the edge fade shows (bklit's `edgeFadeActive`): the map is tilted at the overview, or the camera is focused. */
export const edgeFadeActive = (perspective: ChoroplethPerspective | undefined, focused: boolean): boolean =>
  focused || (perspective?.overview?.view ?? "flat") !== "flat" || (perspective?.overview?.tilt ?? 0) !== 0;
