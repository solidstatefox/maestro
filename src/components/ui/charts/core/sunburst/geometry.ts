import { arc as d3Arc } from "d3-shape";

/** [startAngle, endAngle, innerRadius, outerRadius] of one sector, angles clockwise from 12 o'clock. */
export type ArcValues = readonly [start: number, end: number, inner: number, outer: number];

const TURN = 2 * Math.PI;
const DEG = 180 / Math.PI;
const QUARTER_TURN_DEG = 90;
/** The leading-edge sliver every sector grows from (bklit's enter arc at progress 0). */
const SEED_SPAN = 0.002;
const PIN_RATIO = 0.12;
// Same thresholds as bklit sunburst-labels.tsx: arc length at centroid and ring thickness, in px.
const MIN_ARC_LENGTH_PX = 26;
const MIN_RING_THICKNESS_PX = 16;

export interface SectorLayout {
  /** Angular extent of the view's root: a node's share of the circle is its extent over this. */
  readonly rootStart: number;
  readonly rootEnd: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly inner: number;
  readonly outer: number;
  /** Rings below the view's root (the native `ringCount`). */
  readonly rings: number;
}

/** The native sunburst's partition: the node's share of the root's span, on ring `depth` (1 = first ring below the root). */
export const sectorArc = (layout: Readonly<SectorLayout>, a0: number, a1: number, depth: number): ArcValues => {
  const span = layout.endAngle - layout.startAngle;
  const rootSpan = layout.rootEnd - layout.rootStart;
  const ring = (layout.outer - layout.inner) / layout.rings;
  const inner = layout.inner + (depth - 1) * ring;
  return [layout.startAngle + ((a0 - layout.rootStart) / rootSpan) * span, layout.startAngle + ((a1 - layout.rootStart) / rootSpan) * span, inner, inner + ring];
};

export const seedArc = ([start, , inner, outer]: ArcValues): ArcValues => [start, start + SEED_SPAN, inner, outer];

// bklit's exiting sector collapses to a point (pointGeometry, sunburst.ts:259-264, 284-285).
export const collapsedArc = ([start, end, inner, outer]: ArcValues): ArcValues => {
  const mid = (start + end) / 2;
  const pin = Math.max(0, Math.min(((inner + outer) / 2) * PIN_RATIO, inner));
  return [mid, mid, pin, pin];
};

export const lerpArc = (from: ArcValues, to: ArcValues, t: number): ArcValues => [
  from[0] + (to[0] - from[0]) * t,
  from[1] + (to[1] - from[1]) * t,
  from[2] + (to[2] - from[2]) * t,
  from[3] + (to[3] - from[3]) * t,
];

export const sameArc = (a: ArcValues, b: ArcValues): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

// bklit lerps a zoomed arc's mid angle the short way round (sunburst.ts:227-258, lerpGeometry/lerpAngle): shift whole turns so the target sits within half a turn of where it tweens from.
export const unwrapArc = (to: ArcValues, from: ArcValues): ArcValues => {
  const turns = Math.round(((from[0] + from[1]) / 2 - (to[0] + to[1]) / 2) / TURN);
  return turns === 0 ? to : [to[0] + turns * TURN, to[1] + turns * TURN, to[2], to[3]];
};

// bklit sunburst-labels.tsx:80-86: a label shows only while its arc, at the centroid radius, and its ring are wide enough for text.
// `scale` is the px-per-size-unit ratio: bklit measures both thresholds in its size-unit viewBox.
export const labelFits = ([start, end, inner, outer]: ArcValues, scale: number): boolean => ((end - start) * ((inner + outer) / 2)) / scale >= MIN_ARC_LENGTH_PX && (outer - inner) / scale >= MIN_RING_THICKNESS_PX;

export interface LabelPose {
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
}

// bklit sunburst-labels.tsx:91-100: centred on the arc's centroid, along the radius, flipped so it never reads upside down.
export const poseOf = ([start, end, inner, outer]: ArcValues): LabelPose => {
  const mid = (start + end) / 2;
  const radius = (inner + outer) / 2;
  let rotate = (((mid % TURN) + TURN) % TURN) * DEG - QUARTER_TURN_DEG;
  if (rotate > QUARTER_TURN_DEG) {
    rotate -= 2 * QUARTER_TURN_DEG;
  }
  if (rotate < -QUARTER_TURN_DEG) {
    rotate += 2 * QUARTER_TURN_DEG;
  }
  return { rotate, x: Math.sin(mid) * radius, y: -Math.cos(mid) * radius };
};

const generator = /* @__PURE__ */ d3Arc<ArcValues>()
  .startAngle((values) => values[0])
  .endAngle((values) => values[1])
  .innerRadius((values) => values[2])
  .outerRadius((values) => values[3])
  .cornerRadius(0);

/** The sector path the native sunburst draws (same d3 arc, no corner radius). */
export const sectorPath = (values: ArcValues): string => generator(values) ?? "";
