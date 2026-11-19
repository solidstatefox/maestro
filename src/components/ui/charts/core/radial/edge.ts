import type { RadialEdgeLookup } from "../types/radial";

const BEZIER_STEPS = 10;

/** The drawing context a d3 generator draws into (the subset d3-shape's curves call). */
interface PathContext {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
  quadraticCurveTo(x1: number, y1: number, x2: number, y2: number): void;
  closePath(): void;
}

/** Flattens what `draw` draws (hand it to a d3 radial generator's `context`) and returns the edge radius at any angle. */
export function createRadialEdgeLookup(draw: (context: CanvasRenderingContext2D) => void): RadialEdgeLookup {
  const segments: number[] = [];
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;
  const push = (nx: number, ny: number): void => {
    segments.push(x, y, nx, ny);
    x = nx;
    y = ny;
  };
  const context: PathContext = {
    moveTo(nx, ny) {
      startX = nx;
      startY = ny;
      x = nx;
      y = ny;
    },
    lineTo: push,
    bezierCurveTo(x1, y1, x2, y2, x3, y3) {
      const x0 = x;
      const y0 = y;
      for (let k = 1; k <= BEZIER_STEPS; k++) {
        const t = k / BEZIER_STEPS;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
      }
    },
    quadraticCurveTo(x1, y1, x2, y2) {
      const x0 = x;
      const y0 = y;
      for (let k = 1; k <= BEZIER_STEPS; k++) {
        const t = k / BEZIER_STEPS;
        const u = 1 - t;
        push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
      }
    },
    closePath() {
      if (x !== startX || y !== startY) {
        push(startX, startY);
      }
    },
  };
  // SAFETY: d3-shape's generators call only the PathContext subset above on their context.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  draw(context as unknown as CanvasRenderingContext2D);
  const flat = Float64Array.from(segments);
  return (angle) => {
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    let best = -1;
    for (let i = 0; i < flat.length; i += 4) {
      const x0 = flat[i] ?? 0;
      const y0 = flat[i + 1] ?? 0;
      const ex = (flat[i + 2] ?? 0) - x0;
      const ey = (flat[i + 3] ?? 0) - y0;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-9) {
        continue;
      }
      // The ray s·d meets the segment P0 + t·e.
      const t = (x0 * dy - y0 * dx) / denom;
      if (t < -1e-6 || t > 1 + 1e-6) {
        continue;
      }
      const s = (x0 * ey - y0 * ex) / denom;
      if (s > best) {
        best = s;
      }
    }
    return best > 0 ? best : null;
  };
}
