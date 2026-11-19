import type { ChartFocusStrategy, ChartPoint, DomChartDefinition } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { polar, radialDot, radialLine } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { defineChart } from "@tanstack/charts/scene";
import { TAU, cartesianToAngle } from "./geometry";
import type { AnyPolarMark } from "./layers/types";
import type { RadialShell } from "./shell";

/** A row of the focus line: one per bin. */
export interface RadialHitRow {
  readonly bin: number;
  readonly angle: number;
  readonly radius: number;
}

type HitPoint = ChartPoint<RadialHitRow, number, number>;

/** The focus strategy: the pointer → the bin under its angle (or the ring under its radius); arrows step through the bins in order. */
export const createRadialFocus = (shell: RadialShell): ChartFocusStrategy<RadialHitRow, number, number> => {
  const { stage, binCount, orientation, innerRadius, outerRadius, centerRadius, angleToBin } = shell;
  let bucketed: readonly HitPoint[] | null = null;
  let byBin = new Map<number, HitPoint>();
  const pointOf = (points: readonly HitPoint[], bin: number): HitPoint | undefined => {
    if (bucketed !== points) {
      byBin = new Map(points.map((point) => [point.datum.bin, point]));
      bucketed = points;
    }
    return byBin.get(bin);
  };
  return {
    group: (_points, { point }) => [point],
    navigation: (points) => points.toSorted((a, b) => a.datum.bin - b.datum.bin),
    resolve: (points, { x, y }) => {
      if (binCount === 0) {
        return [];
      }
      const dx = x - stage.cx;
      const dy = y - stage.cy;
      const distance = Math.hypot(dx, dy);
      let bin: number | null = null;
      if (orientation === "angular") {
        const ring = Math.floor((distance - innerRadius) / ((outerRadius - innerRadius) / binCount));
        bin = ring >= 0 && ring < binCount ? ring : null;
      } else if (distance >= centerRadius * 0.5) {
        bin = angleToBin(cartesianToAngle(dx, dy));
      }
      const point = bin === null ? undefined : pointOf(points, bin);
      return point ? [point] : [];
    },
  };
};

/** The plot margins that centre a square polar plot on the stage's centre (TanStack centres polar marks on the plot). */
const centeredMargins = (shell: RadialShell): { top: number; right: number; bottom: number; left: number } => {
  const { width, height, cx, cy } = shell.stage;
  return {
    left: Math.max(0, 2 * cx - width),
    right: Math.max(0, width - 2 * cx),
    top: Math.max(0, 2 * cy - height),
    bottom: Math.max(0, height - 2 * cy),
  };
};

/** The chart's definition for the layers' marks over `shell`. */
export const buildRadialDefinition = (shell: RadialShell, marks: readonly AnyPolarMark[]): DomChartDefinition<RadialHitRow, number, number> => {
  const { radius, binCount, orientation, binAngle, innerRadius, outerRadius, startAngle, ringBand } = shell;
  // Radii are in px and angles in radians: both scales are the identity.
  const scales = { angle: { scale: scaleLinear().domain([0, TAU]) }, radius: { scale: scaleLinear().domain([0, radius]), range: [0, radius] as const } };
  const hits: RadialHitRow[] = Array.from({ length: binCount }, (_, bin) =>
    orientation === "angular" ? { bin, angle: startAngle, radius: ringBand(bin).center } : { bin, angle: binAngle(bin), radius: (innerRadius + outerRadius) / 2 });
  const hitLine = radialLine<RadialHitRow>(hits, {
    angle: (row) => row.angle, className: "bkm-rd-hit", id: "radial:hit", key: (row) => `b${row.bin}`, motion: false, radius: (row) => row.radius, stroke: "none",
  });
  return defineChart({
    focus: createRadialFocus(shell),
    focusRing: false,
    guides: false,
    margin: centeredMargins(shell),
    marks: [
      // An empty dot mark claims both scales, which TanStack refuses to configure when no mark of the group reads them.
      decorative(polar({ id: "radial", marks: [...marks, radialDot<RadialHitRow>([], { angle: (row) => row.angle, id: "radial:scales", radius: (row) => row.radius })], scales })),
      polar({ id: "radial-focus", marks: [hitLine], scales }),
    ],
    scales: { x: null, y: null },
    tooltip: false,
  });
};
