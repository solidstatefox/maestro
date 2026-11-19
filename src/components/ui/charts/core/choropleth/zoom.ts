import type { ProjectionHolder } from "./focus";
import type { TransformMatrix } from "../types/choropleth";

interface Point {
  readonly x: number;
  readonly y: number;
}

export const identityMatrix = (): TransformMatrix => ({ scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, translateX: 0, translateY: 0 });

/** Screen = scene * k + (x, y). */
export interface ZoomTransform {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

const toMatrix = (t: ZoomTransform): TransformMatrix => ({
  scaleX: t.k, scaleY: t.k, skewX: 0, skewY: 0, translateX: t.x, translateY: t.y,
});

export const fromMatrix = (m: Readonly<TransformMatrix>): ZoomTransform => ({ k: m.scaleX, x: m.translateX, y: m.translateY });

/** A chart's projection holder (focus.ts) at its initial zoom; the definition's first draw builds the projection. Its transform is the
 * composed one (the camera's view after this zoom), kept by the controller. */
export const createProjectionHolder = (initial: Readonly<TransformMatrix>): ProjectionHolder => ({ projection: undefined, transform: fromMatrix(initial) });

const invertPoint = (t: ZoomTransform, p: Point): Point => ({ x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k });

/** What `useChoroplethZoom()` returns: `{ zoom }`, null unless `zoomEnabled` is set on the chart. */
export interface ChoroplethZoomContextValue {
  readonly zoom: ChoroplethZoomInstance | null;
}

/** bklit-compatible zoom facade (subset of visx ProvidedZoom + state). */
interface ChoroplethZoomInstance {
  readonly transformMatrix: TransformMatrix;
  readonly initialTransformMatrix: TransformMatrix;
  readonly isDragging: boolean;
  readonly scale: (s: { scaleX: number; scaleY?: number; point?: Point }) => void;
  readonly translate: (t: { translateX: number; translateY: number }) => void;
  readonly translateTo: (point: Point) => void;
  readonly setTransformMatrix: (matrix: TransformMatrix) => void;
  readonly reset: () => void;
  readonly center: () => void;
  readonly clear: () => void;
  readonly applyToPoint: (point: Point) => Point;
  readonly applyInverseToPoint: (point: Point) => Point;
  readonly toString: () => string;
}

// bklit wheel step: 5% per tick.
const WHEEL_IN = 1.05;
const WHEEL_OUT = 0.95;
// A wheel gesture stays active this long after its last tick (d3-zoom/src/zoom.js:68, the engine the migration used before): ticks inside it are always swallowed.
const WHEEL_IDLE_MS = 150;
// bklit pinch (visx defaultPinchDelta): every pinch event steps the scale by 1.1 (spreading, or no change) or 0.9 (closing) about the
// touch midpoint. use-gesture emits the pinch start event, one event per touchmove (two on the second) and one when the gesture ends.
const PINCH_IN = 1.1;
const PINCH_OUT = 0.9;
const PINCH_DOUBLE_MOVE = 2;

interface Spread {
  readonly distance: number;
  readonly mid: Point;
}

const swallow = (event: Event): void => {
  event.preventDefault();
  event.stopImmediatePropagation();
};

/** Programmatic transform ops of the bound gesture layer; deltas and points are in scene units, like d3-zoom's scaleBy / translateBy / translateTo. */
export interface ZoomControl {
  /** Sets the transform; `silent` keeps it from the owner (the camera folds a reset into its own flight, camera.ts). */
  readonly set: (t: ZoomTransform, silent?: boolean) => void;
  readonly scaleBy: (factor: number, point?: Point) => void;
  readonly translateBy: (dx: number, dy: number) => void;
  readonly translateTo: (point: Point) => void;
}

/** Maps a client point into the zoom's space (the chart box before the camera, the tilted plane taken back out). */
export type ClientMapper = (clientX: number, clientY: number) => Point;

interface GeoZoomOptions {
  readonly min: number;
  readonly max: number;
  /** The transform the layer starts from (applied at once). */
  readonly initial: TransformMatrix;
  /** A gesture starts: the mapper its points go through, the host's box read once here. */
  readonly gesture: () => ClientMapper;
  /** The chart's centre in the zoom's space (programmatic `scaleBy` and `translateTo`). */
  readonly centre: () => Point;
  /** A wheel tick zoomed the map; receives the wheel event's client position (the pointer rests there). Runs before `onTransform`. */
  readonly onWheelZoom: (clientX: number, clientY: number) => void;
  /** Every transform the layer applies, the initial one included; `smooth` when bklit's 0.18s ease-out follows it (a wheel step, a pinch
   * step, a programmatic change), not a drag's move. */
  readonly onTransform: (t: ZoomTransform, smooth: boolean) => void;
  /** A mouse drag or a one-finger pan started (true) or ended (false). */
  readonly onDragging: (dragging: boolean) => void;
}

/** The gesture layer on `host`, the initial transform applied; `detach` removes every listener and timer (a drag still held included). */
export function attachGeoZoom(host: HTMLElement, options: GeoZoomOptions): { readonly control: ZoomControl; readonly detach: () => void } {
  const { min, max, initial, gesture, centre, onWheelZoom, onTransform, onDragging } = options;
  let dragAnchorPending = false;
  let current: ZoomTransform = fromMatrix(initial);
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  // The wheel gesture's mapper: one box read for every tick of it.
  let wheelLocal: ClientMapper | null = null;
  let releaseDrag: (() => void) | null = null;
  const commit = (t: ZoomTransform, smooth: boolean, afterApply?: () => void): void => {
    current = t;
    afterApply?.();
    onTransform(t, smooth);
  };
  const clampK = (k: number): number => Math.max(min, Math.min(max, k));
  const scaleAbout = (t: ZoomTransform, k: number, p: Point): ZoomTransform => {
    const anchor = invertPoint(t, p);
    return { k, x: p.x - anchor.x * k, y: p.y - anchor.y * k };
  };
  const isControl = (target: EventTarget | null): boolean => target instanceof Element && target.closest("button, a, input, select, textarea") !== null;

  // Mouse: wheel zooms about the pointer, a drag pans (touch is handled below, following bklit's use-gesture).
  const onWheel = (event: WheelEvent): void => {
    if (isControl(event.target)) {return;}
    const k = clampK(current.k * (event.deltaY > 0 ? WHEEL_OUT : WHEEL_IN));
    if (wheelTimer === undefined && k === current.k) {return;}
    swallow(event);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelTimer = undefined; wheelLocal = null; }, WHEEL_IDLE_MS);
    wheelLocal ??= gesture();
    commit(scaleAbout(current, k, wheelLocal(event.clientX, event.clientY)), true, () => { onWheelZoom(event.clientX, event.clientY); });
  };
  const onMouseDown = (event: MouseEvent): void => {
    // A mouse event with no view (dispatched, or fired while the document tears down) has no window to track the drag on.
    const view = event.view;
    if (view === null || event.ctrlKey || isControl(event.target)) {return;}
    event.stopImmediatePropagation();
    releaseDrag?.();
    const local = gesture();
    const anchor = invertPoint(current, local(event.clientX, event.clientY));
    let moved = false;
    const onMove = (move: MouseEvent): void => {
      swallow(move);
      moved ||= move.clientX !== event.clientX || move.clientY !== event.clientY;
      // bklit's visx/use-gesture drag anchors on the first move event, so that first delta never pans.
      if (dragAnchorPending) {
        dragAnchorPending = false;
        return;
      }
      const p = local(move.clientX, move.clientY);
      commit({ k: current.k, x: p.x - anchor.x * current.k, y: p.y - anchor.y * current.k }, false);
    };
    const onUp = (up: MouseEvent): void => {
      release();
      swallow(up);
      if (moved) {
        // The click that ends a drag must not reach the map; the capture guard lasts one task (d3-drag/src/nodrag.js:20).
        view.addEventListener("click", swallow, { capture: true });
        setTimeout(() => { view.removeEventListener("click", swallow, { capture: true }); }, 0);
      }
      onDragging(false);
    };
    const release = (): void => {
      view.removeEventListener("mousemove", onMove, { capture: true });
      view.removeEventListener("mouseup", onUp, { capture: true });
      view.removeEventListener("dragstart", swallow, { capture: true });
      view.removeEventListener("selectstart", swallow, { capture: true });
      releaseDrag = null;
    };
    releaseDrag = release;
    view.addEventListener("mousemove", onMove, { capture: true });
    view.addEventListener("mouseup", onUp, { capture: true });
    view.addEventListener("dragstart", swallow, { capture: true });
    view.addEventListener("selectstart", swallow, { capture: true });
    onDragging(true);
    dragAnchorPending = true;
  };
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("mousedown", onMouseDown);
  // A pinch or one-finger pan maps through the box read when its touches started.
  let touchLocal: ClientMapper | null = null;
  const control: ZoomControl = {
    scaleBy: (factor, point = centre()) => { commit(scaleAbout(current, clampK(current.k * factor), point), true); },
    set: (t, silent = false) => {
      if (silent) { current = t; return; }
      commit(t, true);
    },
    translateBy: (dx, dy) => { commit({ k: current.k, x: current.x + current.k * dx, y: current.y + current.k * dy }, true); },
    translateTo: ({ x, y }) => { const c = centre(); commit({ k: current.k, x: c.x - x * current.k, y: c.y - y * current.k }, true); },
  };
  commit(fromMatrix(initial), false);

  // Touch: one finger pans (first move anchors, like the mouse), two fingers pinch in fixed 1.1 / 0.9 steps about their midpoint.
  let panLast: Point | null = null;
  let pinchStart = 0;
  let pinchMoves = 0;
  let pinchFactor = PINCH_IN;
  const touchPoint = (touch: Touch): Point => {
    touchLocal ??= gesture();
    return touchLocal(touch.clientX, touch.clientY);
  };
  const spread = (touches: TouchList): Spread => {
    // Both touches exist: the handler is entered only with two touches.
    const a = touchPoint(touches[0]);
    const b = touchPoint(touches[1]);
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  let pinchMid: Point = { x: 0, y: 0 };
  const pinchStep = (steps: number): void => {
    for (let i = 0; i < steps; i += 1) {
      const k = current.k * pinchFactor;
      if (k < min || k > max) {return;}
      control.scaleBy(pinchFactor, pinchMid);
    }
  };
  const pinchTo = (touches: TouchList, steps: number): void => {
    const { distance, mid } = spread(touches);
    pinchFactor = distance < pinchStart ? PINCH_OUT : PINCH_IN;
    pinchMid = mid;
    pinchStep(steps);
  };
  const onTouchStart = (event: TouchEvent): void => {
    if (isControl(event.target)) {return;}
    touchLocal = gesture();
    if (event.touches.length === 1) {
      onDragging(true);
      dragAnchorPending = true;
      panLast = touchPoint(event.touches[0]);
      return;
    }
    if (event.touches.length === 2) {
      panLast = null;
      dragAnchorPending = false;
      onDragging(false);
      pinchStart = spread(event.touches).distance;
      pinchMoves = 0;
      pinchTo(event.touches, 1);
    }
  };
  const onTouchMove = (event: TouchEvent): void => {
    if (event.cancelable) {event.preventDefault();}
    if (event.touches.length === 2) {
      pinchMoves += 1;
      pinchTo(event.touches, pinchMoves === PINCH_DOUBLE_MOVE ? 2 : 1);
      return;
    }
    if (event.touches.length === 1 && panLast !== null) {
      const point = touchPoint(event.touches[0]);
      if (dragAnchorPending) {
        dragAnchorPending = false;
      } else {
        // A pan follows the finger: no ease.
        commit({ k: current.k, x: current.x + (point.x - panLast.x), y: current.y + (point.y - panLast.y) }, false);
      }
      panLast = point;
    }
  };
  const onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length < 2 && pinchStart > 0) {
      pinchStart = 0;
      pinchStep(1);
    }
    if (event.touches.length === 0) {touchLocal = null;}
    panLast = null;
    dragAnchorPending = false;
    onDragging(false);
  };
  host.addEventListener("touchstart", onTouchStart, { passive: true });
  host.addEventListener("touchmove", onTouchMove, { passive: false });
  host.addEventListener("touchend", onTouchEnd);
  host.addEventListener("touchcancel", onTouchEnd);
  const detach = (): void => {
    host.removeEventListener("wheel", onWheel);
    host.removeEventListener("mousedown", onMouseDown);
    clearTimeout(wheelTimer);
    // A drag still held at unmount would leave its window listeners behind; their mouseup would run against a dead chart.
    releaseDrag?.();
    host.removeEventListener("touchstart", onTouchStart);
    host.removeEventListener("touchmove", onTouchMove);
    host.removeEventListener("touchend", onTouchEnd);
    host.removeEventListener("touchcancel", onTouchEnd);
  };
  return { control, detach };
}

/** What the facade reads: the owner's zoom state and the bound layer's control (null while none is attached; read at call time). */
interface ZoomInstanceState {
  readonly enabled: boolean;
  readonly initial: TransformMatrix;
  readonly isDragging: boolean;
  readonly transform: ZoomTransform;
  readonly control: () => ZoomControl | null;
}

/** The `useChoroplethZoom()` facade over the current state; null unless zoom is enabled. */
export const zoomInstance = ({ enabled, initial, isDragging, transform, control }: ZoomInstanceState): ChoroplethZoomInstance | null => {
  if (!enabled) {return null;}
  const run = (fn: (c: ZoomControl) => void): void => {
    const bound = control();
    if (bound !== null) {fn(bound);}
  };
  const setMatrix = (m: TransformMatrix): void => { run((c) => { c.set(fromMatrix(m)); }); };
  return {
    applyInverseToPoint: (p) => invertPoint(transform, p),
    applyToPoint: ({ x, y }) => ({ x: x * transform.k + transform.x, y: y * transform.k + transform.y }),
    center: () => { setMatrix(identityMatrix()); },
    clear: () => { setMatrix(identityMatrix()); },
    initialTransformMatrix: initial,
    isDragging,
    reset: () => { setMatrix(initial); },
    scale: ({ scaleX, point }) => { run((c) => { c.scaleBy(scaleX, point); }); },
    setTransformMatrix: setMatrix,
    toString: () => `matrix(${transform.k}, 0, 0, ${transform.k}, ${transform.x}, ${transform.y})`,
    transformMatrix: toMatrix(transform),
    translate: ({ translateX, translateY }) => { run((c) => { c.translateBy(translateX / transform.k, translateY / transform.k); }); },
    translateTo: (p) => { run((c) => { c.translateTo(p); }); },
  };
};
