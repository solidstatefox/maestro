import { createMark } from "@tanstack/charts";
import type { ChartMark, SceneNode } from "@tanstack/charts";

export interface LiveTailOptions {
  readonly id: string;
  /** Sample N-1 (end of the rolling path) and its final tangent in value per ms. */
  readonly aT: number;
  readonly aV: number;
  readonly aSlope: number;
  /** Newest sample N. */
  readonly bT: number;
  readonly bV: number;
  /** Lerped display value when N arrived (where the dot is at the start of this tick). */
  readonly dispV: number;
  /** The dot's clock time. */
  readonly tipT: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
  readonly areaFloor: number;
  /** The fill colour; undefined hides it. Pieces are painted opaque in one path inside a group carrying the area's `fillOpacity` and bklit's vertical fade (svg-space mask, liveline.css), so overlapping pieces composite as one surface;
   * the path is outlined in its own colour by half the line width to close sub-pixel joins. Under A and the rolling path's last stretch (`lead`); under B a wedge plus the block below the lower end, whose top follows the dot. */
  readonly fill?: string;
  readonly fillOpacity: number;
  /** The rolling path's points just before sample N-1 (time, value), ending at N-1. */
  readonly lead: readonly (readonly [number, number])[];
  /** Still (seed frame): drawn as laid out, no motion. */
  readonly still: boolean;
  /** Where the mark hands its geometry for the head clock (the latest render's). */
  readonly sink: { tail: TailGeometry | null };
}

type Point = readonly [number, number];

/** The tail laid out at the end of the roll (svg px), before any of its motion. */
export interface TailGeometry {
  /** A's left end (N-1), N, the dot's x; N's y; the area floor's y. */
  readonly xa: number;
  readonly xd: number;
  readonly yb: number;
  readonly yf: number;
  readonly a: readonly Point[];
  readonly b: readonly Point[];
  /** B goes down from N (svg y grows). */
  readonly down: boolean;
  /** The fills (none without one): the path's last stretch (`lead`), A's, B's wedge (none when B is flat) and the block under B. */
  readonly fill: {
    readonly lead: readonly Point[] | null;
    readonly a: readonly Point[];
    readonly wedge: readonly Point[] | null;
    readonly block: readonly Point[];
  } | null;
  readonly still: boolean;
}

/** Where a tick's motion stands: the roll's eased progress and the head settle's (0..1 each), and the frame's start transform (Frame.roll). */
export interface TailMotion {
  readonly roll: number;
  readonly settle: number;
  /** The roll's x shift, A's x stretch and left end, B's start width, the y reprojection's scale and offset, the block's resting height. */
  readonly ax: number;
  readonly ak: number;
  readonly xa: number;
  readonly b0: number;
  readonly s: number;
  readonly t: number;
  readonly k: number;
}

/** Chord error of 8 segments on a 20-40px curve is far below a pixel. */
const STEPS = 8;

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** A polyline as path data. */
const line = (points: readonly Point[]): string => points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`).join("");

/** A closed polygon as path data, wound clockwise (in svg y-down), so overlapping pieces in one path paint their union under nonzero. */
const polygon = (points: readonly Point[]): string => {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, y0] = points[i] ?? [0, 0];
    const [x1, y1] = points[(i + 1) % points.length] ?? [0, 0];
    area += x0 * y1 - x1 * y0;
  }
  return `${line(area < 0 ? [...points].reverse() : points)}Z`;
};

/** The tail's shapes at a point of its motion (live-css.ts kept these as transforms on each piece): A rides the roll's x start with its right
 * end where bklit's clock puts N, B and the block under it grow from the dot on the roll and lose height on the head settle, the lead slides
 * with the path; every piece rides the path's y reprojection. `motion` null: at rest (the end of both). */
export function tailPaths(g: TailGeometry, motion: TailMotion | null): { readonly fill: string; readonly a: string; readonly b: string } {
  if (g.still) {
    const fill = g.fill ? [g.fill.lead, g.fill.a, g.fill.wedge, g.fill.block].flatMap((p) => (p ? [polygon(p)] : [])).join("") : "";
    return { fill, a: line(g.a), b: line(g.b) };
  }
  const er = motion?.roll ?? 1;
  const es = motion?.settle ?? 1;
  const rest = (1 - er);
  const ax = (motion?.ax ?? 0) * rest;
  const ak = (motion?.ak ?? 1) + (1 - (motion?.ak ?? 1)) * er;
  const sx = (motion?.b0 ?? 1) + (1 - (motion?.b0 ?? 1)) * er;
  const ry = (y: number): number => (motion ? motion.t * rest + (motion.s + (1 - motion.s) * er) * y : y);
  // B collapses onto N's level as the dot settles; the block's top follows it down to its resting height.
  const by = 1 - es;
  const kHeight = 1 + ((motion?.k ?? 1) - 1) * es;
  const { xd, yb, yf } = g;
  // A stretches about its left end where the frame put it (Frame.roll.xa: the path's end at rest).
  const xa = motion?.xa ?? g.xa;
  const aPoint = ([x, y]: Point): Point => [xa + ax + ak * (x - xa), ry(y)];
  const bPoint = ([x, y]: Point): Point => [xd + sx * (x - xd), ry(yb + by * (y - yb))];
  const kPoint = ([x, y]: Point): Point => [xd + sx * (x - xd), ry(g.down ? yf + kHeight * (y - yf) : y)];
  const lPoint = ([x, y]: Point): Point => [x + ax, ry(y)];
  let fill = "";
  if (g.fill) {
    const { lead, a, wedge, block } = g.fill;
    fill = [lead?.map(lPoint), a.map(aPoint), wedge?.map(bPoint), block.map(kPoint)].flatMap((p) => (p ? [polygon(p)] : [])).join("");
  }
  return { fill, a: line(g.a.map(aPoint)), b: line(g.b.map(bPoint)) };
}

export function liveTail(options: LiveTailOptions): ChartMark<unknown, Date, number> {
  const { id, aT, aV, aSlope, bT, bV, dispV, tipT, stroke, strokeWidth, strokeOpacity, areaFloor, fill, fillOpacity, lead, still, sink } = options;
  return createMark<unknown, Date, number>(() => ({
    id,
    channels: {},
    render: ({ scales }) => {
      const sx = (t: number): number => scales.x.map(new Date(t));
      const sy = (v: number): number => scales.y.map(v);
      const xa = sx(aT);
      const xb = sx(bT);
      const xd = sx(tipT);
      const ya = sy(aV);
      const yb = sy(bV);
      const yd = sy(dispV);
      const yf = sy(areaFloor);
      if (![xa, xb, xd, ya, yb, yd, yf].every(Number.isFinite) || xb <= xa) {
        sink.tail = null;
        return { nodes: [] };
      }
      const h = bT - aT;
      const curveA: [number, number][] = [];
      for (let i = 0; i <= STEPS; i += 1) {
        const u = i / STEPS;
        const u2 = u * u;
        const u3 = u2 * u;
        const v = (2 * u3 - 3 * u2 + 1) * aV + (u3 - 2 * u2 + u) * h * aSlope + (-2 * u3 + 3 * u2) * bV;
        curveA.push([xa + (xb - xa) * u, sy(v)]);
      }
      const curveB: [number, number][] = [];
      for (let i = 0; i <= STEPS; i += 1) {
        const u = i / STEPS;
        curveB.push([xb + (xd - xb) * u, yb + (yd - yb) * (3 * u * u - 2 * u * u * u)]);
      }
      const down = yd >= yb;
      let fills: TailGeometry["fill"] = null;
      if (fill !== undefined && fill !== "") {
        const leadPx = lead.slice(0, -1).flatMap(([t, v]): [number, number][] => {
          const x = sx(t);
          const y = sy(v);
          return Number.isFinite(x) && Number.isFinite(y) ? [[x, y]] : [];
        });
        const top = Math.max(yb, yd);
        fills = {
          // The path's last stretch only translates with it; A's own piece also stretches (its right end enters at the dot).
          lead: leadPx.length > 0 ? [...leadPx, [xa, sy(aV)], [xa, yf], [leadPx[0]?.[0] ?? xa, yf]] : null,
          a: [...curveA, [xb, yf], [xa, yf]],
          // B's fill: bklit's area follows the curve to the dot. The wedge scales with the line about N's level; the block below
          // has its top edge on the dot, linear in the line's scale.
          wedge: Math.abs(yd - yb) > 0.25 ? [...curveB, down ? [xb, yd] : [xd, yb]] : null,
          block: [[xb, top], [xd, top], [xd, yf], [xb, yf]],
        };
      }
      const geometry: TailGeometry = { xa, xd, yb, yf, a: curveA, b: curveB, down, fill: fills, still };
      sink.tail = geometry;
      const paths = tailPaths(geometry, null);
      const style = { stroke, strokeOpacity, strokeWidth, fill: "none", lineCap: "round", lineJoin: "round" } as const;
      // Unkeyed (matched by position; the mark has no motion): a keyed node costs the renderer a pass over every scene point per update to
      // find its timing context (charts-core motion.ts guideOrMarkTimingContext), the bulk of a tick on a long window.
      const children: SceneNode[] = fills
        ? [{ kind: "group", key: "", className: "bkm-live-fill", style: { opacity: fillOpacity }, children: [
            { kind: "area", key: "", className: "bkm-live-tail-fill", points: [], path: paths.fill, style: { fill, fillOpacity: 1, stroke: fill, strokeWidth, lineJoin: "round" } },
          ] }]
        : [];
      children.push(
        { kind: "polyline", key: "", className: "bkm-live-tail-line", points: [], path: paths.a, style },
        { kind: "polyline", key: "", className: "bkm-live-tail-line", points: [], path: paths.b, style },
      );
      return { nodes: [{ kind: "group", key: "", className: "bkm-live-tail", ariaHidden: true, children }], points: [] };
    },
  }), false);
}
