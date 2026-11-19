import { defineChart } from "@tanstack/charts/scene";
import { motion } from "@tanstack/charts/motion";
import { polar, radialArc } from "@tanstack/charts/polar";
import type { ChartGradient, ChartMotionTransition, DomChartDefinition } from "@tanstack/charts";
import { CHART_PALETTE } from "../palette";
import { createAnnularFocus } from "../polar/hover";
import type { AnnulusTarget } from "../polar/hover";
import { toEaseFn, toMotionTransition } from "../motion/enter-transition";
import type { PieEnterTransition } from "../types/pie";
import { pieArcGenerator } from "./arc";
import type { PieArcRow } from "./arc";

const STAGGER_EACH_MS = 80;
const STAGGER_OFFSET_MS = 100;
// bklit draws no path until the swept angle exceeds 0.01 rad; a clip wedge thinner than that anti-aliases into a visible hairline.
const MIN_SWEEP_RAD = 0.01;

export const pieIndexOf = (datum: Readonly<PieArcRow>): number => datum.sliceIndex;

// One module-level renderer: the entrance replays on mount, reduced motion is honoured.
export const PIE_RENDERER = /* @__PURE__ */ motion({ initial: "always", respectReducedMotion: true });

// Mark-level `motion` (staggered entrance) is only consulted on a client mount; an SSR-adopted
// chart replays with the renderer default. Mount the chart after hydration so the stagger applies.

interface PieDefinitionOptions {
  readonly rows: readonly PieArcRow[];
  readonly innerRadius: number;
  readonly cornerRadius: number;
  readonly hoverOffset: number;
  readonly enterTransition: PieEnterTransition | undefined;
  readonly enterStaggerScale: number;
  readonly size: number;
  /** The reader's gradients, painted by `fill="url(#id)"` (TanStack scopes their ids with the chart's prefix, as the slices' paints are). */
  readonly gradients: readonly ChartGradient[];
}

/** Entrance tween whose first sliver (under bklit's 0.01 rad threshold) stays invisible. */
const sliceEnterMotion = (row: Readonly<PieArcRow>, enterTransition: PieEnterTransition | undefined): ChartMotionTransition => {
  const base = toMotionTransition(enterTransition);
  const sweep = row.endAngle - row.startAngle;
  if (base.type !== "tween" || sweep <= 0) { return base; }
  const ease = toEaseFn(enterTransition?.ease);
  return { ...base, easing: (progress: number): number => { const eased = ease(progress); return eased * sweep <= MIN_SWEEP_RAD ? 0 : eased; } };
};

export const buildPieDefinition = (options: Readonly<PieDefinitionOptions>): DomChartDefinition<PieArcRow, number, number> => {
  const { rows, innerRadius, cornerRadius, hoverOffset, enterTransition, enterStaggerScale, size, gradients } = options;
  const generator = pieArcGenerator({ cornerRadius, innerRadius });
  // One mark per slice: the native entrance sweeps a whole mark through its own angle, so
  // per-slice marks give each slice bklit's own staggered sweep (a single mark sweeps as one).
  const slices = rows.map((row) => radialArc<PieArcRow>([row], {
    // radialArc `className` (reference/marks/polar.md); the hover CSS selects `bkm-pie-arc`.
    className: `bkm-pie-arc bkm-pie-s${row.sliceIndex}`,
    fill: (datum: Readonly<PieArcRow>) => datum.fill,
    generator,
    id: `pie:slice-${row.sliceIndex}`,
    key: (datum) => `pie:slice-${datum.sliceIndex}`,
    motion: (ctx) => {
      // bklit snaps the slices on a data change; hover pop-out is host-attribute CSS and never reaches the definition.
      if (ctx.phase !== "enter") { return false; }
      if (!row.animate) { return false; }
      return { delay: (STAGGER_OFFSET_MS + row.sliceIndex * STAGGER_EACH_MS) * enterStaggerScale, transition: sliceEnterMotion(row, enterTransition) };
    },
  }));
  // Hit-test the static painted sectors (bklit's invisible hitbox is the base path, outer radius size/2 - hoverOffset), so pointer
  // focus never depends on the animated geometry.
  const targets: AnnulusTarget[] = rows.map((row) => ({
    endAngle: row.endAngle, index: row.sliceIndex, innerRadius, outerRadius: size / 2 - hoverOffset, startAngle: row.startAngle,
  }));
  return defineChart({
    focus: createAnnularFocus<PieArcRow>({
      center: size / 2,
      focusable: (point) => point.markId.startsWith("pie:slice-"),
      indexOf: pieIndexOf,
      navigable: (point) => point.markId.startsWith("pie:slice-"),
      targets,
    }),
    focusRing: false,
    gradients: [...gradients],
    guides: false,
    marks: [polar({ id: "pie", inset: hoverOffset, marks: slices, radiusRatio: 1, scales: { angle: null, radius: null } })],
    scales: { x: null, y: null },
    theme: { palette: CHART_PALETTE },
    tooltip: false,
  });
};
