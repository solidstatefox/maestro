import { radialArc } from "@tanstack/charts/polar";
import type { PolarMark } from "@tanstack/charts/polar";
import { joinClasses } from "../cn";
import { sunburstCssVars } from "./colors";
import type { SunburstNativeNode } from "./sunburst-mark";

export const START_ANGLE = -Math.PI / 2;
export const END_ANGLE = (3 * Math.PI) / 2;
const HUB_GAP_PX = 2;

// The hub's radius at the root, where bklit's disc is gone: the motion renderer tweens a radialArc numerically and d3's arc draws a circle only above its
// epsilon (d3-shape arc.js: `r1 > epsilon`, 1e-12), so a disc this small is not drawn and its radius tweens linearly like bklit's.
const HUB_REST_RADIUS = 1e-6;


export interface HubDatum {
  readonly kind: "hub";
  readonly id: string;
  readonly startAngle: number;
  readonly endAngle: number;
}

/** Datum of any point in the sunburst scene: the centre disc or a sector. */
export type SunburstDatum = HubDatum | SunburstNativeNode;

export const isHub = (datum: unknown): datum is HubDatum => typeof datum === "object" && datum !== null && "kind" in datum;

// bklit's centre disc is one circle whose radius follows the zoom tween (sunburst-center.tsx:17-24,39; zoomT 0.75s [0.22, 1, 0.36, 1], sunburst-chart.tsx:244-247).
// One stable key keeps it one native area across zooms, so the update tween morphs its radius with the sectors' instead of an exit fade.
/** `className`: the `SunburstCenter` className, beside the hub's own on its group. */
export const hubMark = (hubRadius: (radius: number) => number, fill: string, className?: string): PolarMark<HubDatum, number, number, never, never> => {
  const hubData: HubDatum[] = [{ endAngle: END_ANGLE, id: "hub", kind: "hub", startAngle: START_ANGLE }];
  return radialArc(hubData, {
    endAngle: "endAngle",
    className: joinClasses("bk-sunburst-hub", className),
    fill,
    id: "sunburst-hub",
    innerRadius: 0,
    key: "id",
    outerRadius: ({ radius }) => Math.max(hubRadius(radius) - HUB_GAP_PX, HUB_REST_RADIUS),
    startAngle: "startAngle",
    // bklit's centre has no hover or focus style (sunburst-center.tsx:36-49: cursor only). No `states` here: any mark state makes every focus
    // change a scene update (mark-state.ts:107, motion.ts applyStateFocus); the keyboard ring is in sunburst.css instead.
    stroke: sunburstCssVars.ring,
    strokeWidth: 1,
  });
};
