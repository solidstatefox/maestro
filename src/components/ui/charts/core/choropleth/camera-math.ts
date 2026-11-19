export interface ViewTransform {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

/** The camera: the base-space point at the chart's centre, and its scale. */
export interface CameraView {
  readonly cx: number;
  readonly cy: number;
  readonly k: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const IDENTITY: ViewTransform = { k: 1, x: 0, y: 0 };

/** The camera's own transform at a `width` × `height` chart: its centre point moved to the chart's centre, scaled by `k` (bklit's `applyView`). */
export const cameraTransform = (view: CameraView | null, width: number, height: number): ViewTransform =>
  view === null ? IDENTITY : { k: view.k, x: width / 2 - view.k * view.cx, y: height / 2 - view.k * view.cy };

/** `outer` after `inner`: what bklit's camera group draws around its zoom group. */
export const compose = (outer: ViewTransform, inner: ViewTransform): ViewTransform => ({
  k: outer.k * inner.k,
  x: inner.x * outer.k + outer.x,
  y: inner.y * outer.k + outer.y,
});

export const apply = (t: ViewTransform, p: Point): Point => ({ x: p.x * t.k + t.x, y: p.y * t.k + t.y });

export const invert = (t: ViewTransform, p: Point): Point => ({ x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k });

export const sameTransform = (a: ViewTransform, b: ViewTransform): boolean => a.k === b.k && a.x === b.x && a.y === b.y;

/** The CSS transform of a map layer (`transform-origin` 0 0); "" at identity, so a flat map at rest carries none. */
export const transformCss = (t: ViewTransform): string => (t.k === 1 && t.x === 0 && t.y === 0 ? "" : `translate(${t.x}px, ${t.y}px) scale(${t.k})`);

/** Center linear, scale geometric (bklit's flight: one steady camera move instead of a swoop that overshoots on the way in). */
export const mixView = (from: CameraView, to: CameraView, t: number): CameraView => ({
  cx: from.cx + (to.cx - from.cx) * t,
  cy: from.cy + (to.cy - from.cy) * t,
  k: Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * t),
});

export const mixTransform = (from: ViewTransform, to: ViewTransform, t: number): ViewTransform => ({
  k: Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * t),
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

// --- The 3D plane ----------------------------------------------------------------------------------------------------------------
// bklit: a clip box with `perspective: depth`, around a plane with `transform-origin: 50% 60%` and `rotateX(tilt) rotateY(yaw)`. Here each
// plane element (the renderer's svg, the owned overlay svg: the same box) carries the whole thing itself, origin 0 0:
//   translate(50%, 50%) perspective(d) translate(0, 10%) rotateX(tilt) rotateY(yaw) translate(-50%, -60%)
// which is T(c) P(d) T(-c) T(o) R T(-o) with c the box centre (the perspective origin) and o the transform origin.

/** The plane's angles and depth. */
export interface PlaneAngles {
  readonly yaw: number;
  readonly tilt: number;
  readonly depth: number;
}

/** The plane's CSS transform; "" when flat. */
export const planeCss = ({ yaw, tilt, depth }: PlaneAngles): string =>
  yaw === 0 && tilt === 0 ? "" : `translate(50%, 50%) perspective(${depth}px) translate(0, 10%) rotateX(${tilt}deg) rotateY(${yaw}deg) translate(-50%, -60%)`;

type Matrix = readonly number[]; // 4x4, row-major, acting on column vectors

const multiply = (a: Matrix, b: Matrix): number[] => {
  const out: number[] = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      let sum = 0;
      for (let i = 0; i < 4; i += 1) { sum += (a[r * 4 + i] ?? 0) * (b[i * 4 + c] ?? 0); }
      out.push(sum);
    }
  }
  return out;
};

const translate3 = (x: number, y: number): Matrix => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1];
const perspective = (d: number): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / d, 1];
const rotateX = (deg: number): Matrix => {
  const a = (deg * Math.PI) / 180;
  return [1, 0, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, 0, Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
};
const rotateY = (deg: number): Matrix => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
};

/** The plane's homography on a `width` × `height` box: `project` takes a point of the map's plane to the box, `unproject` back; null when flat. */
export interface Plane {
  readonly project: (p: Point) => Point;
  readonly unproject: (p: Point) => Point | null;
}

export const createPlane = (angles: PlaneAngles, width: number, height: number): Plane | null => {
  if (angles.yaw === 0 && angles.tilt === 0) {return null;}
  const m = [translate3(width / 2, height / 2), perspective(angles.depth), translate3(0, height * 0.1), rotateX(angles.tilt), rotateY(angles.yaw), translate3(-width / 2, -height * 0.6)]
    .reduce<Matrix>((acc, next) => multiply(acc, next), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const at = (r: number, c: number): number => m[r * 4 + c] ?? 0;
  return {
    project: ({ x, y }) => {
      const w = at(3, 0) * x + at(3, 1) * y + at(3, 3);
      return { x: (at(0, 0) * x + at(0, 1) * y + at(0, 3)) / w, y: (at(1, 0) * x + at(1, 1) * y + at(1, 3)) / w };
    },
    unproject: ({ x: sx, y: sy }) => {
      // (m00 - sx m30) x + (m01 - sx m31) y = sx m33 - m03, and the same for y: one 2x2 solve.
      const a = at(0, 0) - sx * at(3, 0);
      const b = at(0, 1) - sx * at(3, 1);
      const c = at(1, 0) - sy * at(3, 0);
      const d = at(1, 1) - sy * at(3, 1);
      const e = sx * at(3, 3) - at(0, 3);
      const f = sy * at(3, 3) - at(1, 3);
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-9) {return null;}
      return { x: (e * d - b * f) / det, y: (a * f - e * c) / det };
    },
  };
};
