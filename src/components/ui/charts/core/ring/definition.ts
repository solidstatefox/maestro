import { defineChart } from "@tanstack/charts/scene";
import { polar, radialArc } from "@tanstack/charts/polar";
import type { DomChartDefinition } from "@tanstack/charts";
import { erase } from "../erased-types";
import { CHART_PALETTE } from "../palette";
import { createAnnularFocus } from "../polar/hover";
import type { AnnulusTarget, HoverSource } from "../polar/hover";
import { ringArcGenerator } from "./arc";
import type { RingArcRow } from "./arc";
import type { RingGridLayout, RingLabelRow } from "./decor";
import { ringDecor } from "./features";
import { createProgressLayer } from "./progress-layer";
import type { ProgressLayerOptions } from "./progress-layer";
import { liveRingScale } from "./ring-springs";

export const ringIndexOf = (datum: Readonly<RingArcRow>): number => datum.ringIndex;
/** The polar mark's inset: room for the hovered ring's pop. */
export const RING_INSET_PX = 8;
const HIT_SLACK_PX = 0;

interface RingDefinitionOptions {
  readonly rows: readonly RingArcRow[];
  readonly fit: number;
  readonly size: number;
  /** Read at pointer time only (never rebuilds the definition): the hovered ring and the rings pushed out scale, so their hit areas do too. */
  readonly hoverSource: Pick<HoverSource, "getHovered">;
  readonly hostRef: { readonly current: HTMLElement | null };
  readonly sweep: Omit<ProgressLayerOptions, "arc" | "rows">;
  /** RingGrid's layout (spokes and tick labels under the tracks) and RingLabels' rows (over the arcs), each null without its carrier. */
  readonly decor: {
    readonly grid: RingGridLayout | null;
    readonly labels: { readonly rows: readonly RingLabelRow[]; readonly fontSize: number } | null;
  };
}

export const buildRingDefinition = (options: Readonly<RingDefinitionOptions>): DomChartDefinition<RingArcRow, number, number> => {
  const { rows, fit, size, hoverSource, hostRef, sweep, decor } = options;
  const generator = ringArcGenerator(fit);
  const progressLayer = createProgressLayer({ ...sweep, arc: (row) => generator()(row), rows });
  // One mark per ring layer, tracks first so they share the host's layer: tracks scale in through CSS, progress arcs sweep on their own layer renderer.
  const arcs = [...rows.filter((row) => row.kind === "track"), ...rows.filter((row) => row.kind === "progress")].map((row) => radialArc<RingArcRow>([row], {
    // radialArc `className` (reference/marks/polar.md); hover/entrance CSS keys on it.
    className: `bkm-rg-arc bkm-rg-${row.ringIndex} bkm-rg-${row.kind}`,
    fill: (datum: Readonly<RingArcRow>) => datum.fill,
    generator,
    id: `ring:${row.key}`,
    key: (datum) => `ring:${datum.key}`,
    // No native mark motion: the progress layer redraws the arc path itself (ring/progress-layer.ts), so the leading cap stays rounded.
    motion: false,
    renderer: row.kind === "progress" ? progressLayer : undefined,
  }));
  // bklit hit-tests the painted ring paths exactly (scan: hits end at the painted outer radius), so the targets are the static annuli.
  const targets = rows.flatMap((row): AnnulusTarget[] => row.kind === "track" ? [{
    endAngle: row.endAngle, index: row.ringIndex, innerRadius: row.innerRadius * fit - HIT_SLACK_PX,
    outerRadius: row.outerRadius * fit + HIT_SLACK_PX, startAngle: row.startAngle,
  }] : []);
  // The grid under the tracks, the ring labels over the arcs (bklit: a RingGrid goes before the Rings, RingLabels after). Their marks
  // read other rows and named scales, so the polar is typed as the arcs' alone.
  const feature = decor.grid !== null || decor.labels !== null ? ringDecor() : undefined;
  const ringMark: ReturnType<typeof polar<typeof arcs>> = feature !== undefined
    ? erase(polar(erase({
        id: "ring",
        inset: RING_INSET_PX,
        marks: [...(decor.grid === null ? [] : feature.gridMarks(decor.grid)), ...arcs, ...(decor.labels === null ? [] : feature.labelMarks(decor.labels.rows, decor.labels.fontSize))],
        radiusRatio: 1,
        scales: { angle: null, radius: null, ...feature.scales(size / 2 - RING_INSET_PX) },
      })))
    : polar({ id: "ring", inset: RING_INSET_PX, marks: arcs, radiusRatio: 1, scales: { angle: null, radius: null } });
  return defineChart({
    focus: createAnnularFocus<RingArcRow>({
      center: size / 2,
      focusable: (point) => point.markId.startsWith("ring:ring-"),
      hovered: hoverSource.getHovered,
      indexOf: ringIndexOf,
      navigable: (point) => point.markId.endsWith("-track"),
      // bklit hit-tests its live motion-scaled paths, so the hit annulus follows the painted spring value, not the target.
      // Accepted divergence: the test runs on pointer moves only. bklit's browser re-dispatches mouse boundary events while a ring scales, so a pointer
      // still within ~4 px of a ring's inner edge flickers between hovered and unhovered (the 1.03 pop moves the edge past it); ours holds the hover.
      scaleOf: (index, hovered) => liveRingScale(hostRef.current, index, hovered),
      targets,
    }),
    focusRing: false,
    guides: false,
    marks: [ringMark],
    scales: { x: null, y: null },
    theme: { palette: CHART_PALETTE },
    tooltip: false,
  });
};
