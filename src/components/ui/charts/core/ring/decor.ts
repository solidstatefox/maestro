import { radialRule, radialText } from "@tanstack/charts/polar";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { DEFAULT_ENTER_MS, toCssEase } from "../motion/enter-transition";
import type { EnterTransition } from "../motion/phase";
import { springCurve } from "../motion/spring-curve";
import type { SpringCurve } from "../motion/spring-curve";
import { TAU } from "../polar/tau";
import type { StyleObject } from "../style";
import type { RingData, RingGridProps, RingLabelsProps } from "../types/ring";

/** Named polar scales the decor marks share: angles in radians (d3's convention) and radii in px, both mapped to themselves. */
const ANGLE_SCALE = "ringAngle";
const RADIUS_SCALE = "ringRadius";
/** The labels the entrance CSS staggers and glides one by one (styles.css carries a rule per index below this). */
const MAX_STAGGERED = 16;
/** bklit's grid stagger and spring (animation.ts): spokes 0.05s apart on 80/15, labels 0.08s apart, faded over 0.5s once half the rings have started. */
const SPOKE_STAGGER_MS = 50;
const GRID_RING_STAGGER_MS = 80;
const LABEL_STAGGER_MS = 80;
const LABEL_FADE_MS = 500;
const GRID_SPOKE_SPRING = { damping: 15, mass: 1, stiffness: 80 } as const;
/** RingLabels: a ring's label fades in with its progress sweep (bklit ring.tsx's delay, 0.6s + 0.1s per ring). */
const RING_LABEL_OFFSET_MS = 600;
const RING_LABEL_STAGGER_MS = 100;
/** bklit's width estimate of a mono label: 0.62 em per character. */
const CHAR_WIDTH_EM = 0.62;

/** A tick of the grid: its spoke's angle and its label's text and radius. */
export interface RingTickRow {
  readonly key: string;
  readonly angle: number;
  readonly text: string;
  /** The label's centre, in px from the chart's centre. */
  readonly labelRadius: number;
}

/** One ring's label: where it sits (beside its ring's start) and how it reads. */
export interface RingLabelRow {
  readonly key: string;
  readonly index: number;
  /** The arc's start angle: the label sits a step back from it. */
  readonly angle: number;
  readonly text: string;
  readonly color: string;
  /** The ring's band centre, in px. */
  readonly radius: number;
  /** The step back along the start tangent, in px. */
  readonly dx: number;
  readonly dy: number;
  readonly anchor: "start" | "middle" | "end";
  readonly rotate: number | undefined;
}

const isFullArc = (startAngle: number, endAngle: number): boolean => Math.abs(endAngle - startAngle) >= TAU - 1e-6;

/** The tick fractions: `ticks` equal intervals or the given list, within 0 to 1; on a full circle 100% lands on 0% and is dropped. */
export const resolveRingTicks = (ticks: number | readonly number[], fullCircle: boolean): number[] => {
  const count = typeof ticks === "number" ? Math.max(1, Math.round(ticks)) : 0;
  const list = typeof ticks === "number" ? Array.from({ length: count + 1 }, (_unused, i) => i / count) : [...ticks];
  const clamped = list.filter((tick) => tick >= 0 && tick <= 1);
  return fullCircle && clamped.includes(0) ? clamped.filter((tick) => tick < 1) : clamped;
};

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** The geometry the decor reads: the chart's size, the arc, and the fitted rings. */
export interface RingDecorGeometry {
  readonly size: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly data: readonly RingData[];
  readonly getRingRadii: (index: number) => { innerRadius: number; outerRadius: number };
  readonly getColor: (index: number) => string;
  /** Ring width and gap after the fit (RingLabels' default font size follows their sum). */
  readonly strokeWidth: number;
  readonly ringGap: number;
}

/** The grid as it draws: the spokes' inner and outer radius, the ticks, and the label font size. */
export interface RingGridLayout {
  readonly props: Readonly<RingGridProps>;
  readonly inner: number;
  readonly outer: number;
  readonly fontSize: number;
  readonly ticks: readonly RingTickRow[];
}

/** bklit `RingGrid`'s layout (ring-grid.tsx:106-140): spokes from the innermost ring's inner edge to past the outermost, labels outside. */
export const ringGridLayout = (props: Readonly<RingGridProps>, geometry: Readonly<RingDecorGeometry>): RingGridLayout | null => {
  const { data, size, startAngle, endAngle, getRingRadii } = geometry;
  if (data.length === 0) {
    return null;
  }
  const { ticks = 4, tickFormat = percent, tickLength = 4, labelOffset = 4 } = props;
  const fontSize = props.fontSize ?? Math.min(12, Math.max(9, size / 26));
  const inner = getRingRadii(0).innerRadius;
  const outer = getRingRadii(data.length - 1).outerRadius + tickLength;
  const span = endAngle - startAngle;
  const rows = resolveRingTicks(ticks, isFullArc(startAngle, endAngle)).map((fraction): RingTickRow => {
    const angle = startAngle + span * fraction;
    const text = tickFormat(fraction);
    // outsideArcLabelPoint: the label's box pushed out along the radius by its own half-extent in that direction.
    const extent = Math.abs(Math.sin(angle)) * ((text.length * fontSize * CHAR_WIDTH_EM) / 2) + Math.abs(Math.cos(angle)) * (fontSize / 2);
    return { angle, key: `tick-${fraction}`, labelRadius: outer + labelOffset + extent, text };
  });
  return { fontSize, inner, outer, props, ticks: rows };
};

/** bklit `RingLabels`' layout (ring-labels.tsx, arc-geometry.ts `arcStartLabelLayout`): each label just before its ring's start. */
export const ringLabelRows = (props: Readonly<RingLabelsProps>, geometry: Readonly<RingDecorGeometry>): { readonly rows: readonly RingLabelRow[]; readonly fontSize: number } => {
  const { data, startAngle, endAngle, getRingRadii, getColor, strokeWidth, ringGap } = geometry;
  const { format, colorByRing = false, color = "var(--chart-label)" } = props;
  const fontSize = props.fontSize ?? Math.min(12, Math.max(9, (strokeWidth + ringGap) * 0.6));
  const offset = props.offset ?? fontSize * 0.6;
  const direction = endAngle >= startAngle ? 1 : -1;
  // The arc's tangent at its start, along the sweep: a start near 3 or 9 o'clock stands the text upright along the start edge.
  const tx = Math.cos(startAngle) * direction;
  const ty = Math.sin(startAngle) * direction;
  const vertical = Math.abs(tx) <= 0.3;
  let anchor: RingLabelRow["anchor"] = "middle";
  if (vertical) {
    anchor = ty < 0 ? "end" : "start";
  } else if (tx > 0.3) {
    anchor = "end";
  } else if (tx < -0.3) {
    anchor = "start";
  }
  const rows = data.map((ring, index): RingLabelRow => {
    const { innerRadius, outerRadius } = getRingRadii(index);
    return {
      anchor, angle: startAngle, color: colorByRing ? getColor(index) : color, dx: -tx * offset, dy: -ty * offset, index, key: ring.label,
      radius: (innerRadius + outerRadius) / 2, rotate: vertical ? -90 : undefined, text: format ? format(ring, index) : ring.label,
    };
  });
  return { fontSize, rows };
};

/** The decor's polar scales: radians and px, each mapped to itself (`radius` the polar layout's, the chart's half side less its inset). */
export const ringDecorScales = (radius: number) => ({
  [ANGLE_SCALE]: { channel: "angle", scale: scaleLinear().domain([0, TAU]) },
  [RADIUS_SCALE]: { channel: "radius", scale: scaleLinear().domain([0, Math.max(1, radius)]) },
}) as const;

const angleOf = (row: Readonly<RingTickRow>): number => row.angle;
const tickKey = (row: Readonly<RingTickRow>): string => row.key;

/** The grid's marks, drawn under the tracks: the spokes, then the tick labels. */
export const ringGridMarks = (layout: Readonly<RingGridLayout>) => {
  const { props, ticks, inner, outer, fontSize } = layout;
  const marks = [];
  if (props.showSpokes !== false) {
    marks.push(radialRule(ticks, {
      angle: angleOf, angleScale: ANGLE_SCALE, className: "bkm-ring-spokes", id: "ring:grid-spokes", key: tickKey, motion: false,
      radius1: inner, radius2: outer, radiusScale: RADIUS_SCALE, stroke: props.stroke ?? "var(--chart-foreground)",
      strokeOpacity: props.strokeOpacity ?? 0.2, strokeWidth: 1,
    }));
  }
  if (props.showLabels !== false) {
    marks.push(radialText(ticks, {
      anchor: "middle", angle: angleOf, angleScale: ANGLE_SCALE, baseline: "middle", className: "bkm-ring-ticks",
      fill: props.labelColor ?? "var(--chart-label)", fontSize, id: "ring:grid-labels", key: tickKey, motion: false,
      radius: (row: Readonly<RingTickRow>) => row.labelRadius, radiusScale: RADIUS_SCALE, text: (row: Readonly<RingTickRow>) => row.text,
    }));
  }
  return marks;
};

/** Each ring's label as its own mark over the arcs, classed with its ring's index so the ring's hover dims it with the ring. */
export const ringLabelMarks = (rows: readonly RingLabelRow[], fontSize: number) => rows.map((row) => radialText([row], {
  anchor: row.anchor, angle: (): number => row.angle, angleScale: ANGLE_SCALE, baseline: "middle",
  className: `bkm-ring-label bkm-rg-${row.index}`, dx: row.dx, dy: row.dy, fill: row.color, fontSize, id: `ring:label-${row.index}`,
  key: (): string => row.key, motion: false, radius: row.radius, radiusScale: RADIUS_SCALE, rotate: row.rotate, text: (): string => row.text,
}));

const round = (n: number): number => Math.round(n * 100) / 100;

/** A spring as a CSS duration and `linear()` easing, its rest thresholds (motion's 0.5px, 2px/s) scaled to `travel` px. */
const travelSpring = (spring: { readonly stiffness: number; readonly damping: number; readonly mass: number }, travel: number): SpringCurve =>
  springCurve(spring, { decimals: 4, limitMs: 4000, rest: { delta: 0.5 / Math.max(1, travel), speed: 2 / Math.max(1, travel) }, samples: 40, stepMs: 8 });

/** A spoke's motion: the reader's enter transition (`enterTransition`), else the grid spring, over the spoke's length. */
const spokeCurve = (transition: EnterTransition | undefined, length: number): SpringCurve => {
  if (transition === undefined) {
    return travelSpring(GRID_SPOKE_SPRING, length);
  }
  if (transition.type === "spring") {
    return travelSpring({ damping: transition.damping ?? 15, mass: transition.mass ?? 1, stiffness: transition.stiffness ?? 80 }, length);
  }
  return { durationMs: (transition.duration ?? DEFAULT_ENTER_MS / 1000) * 1000, ease: toCssEase(transition.ease) };
};

interface RingDecorVarsInput {
  readonly grid: RingGridLayout | null;
  readonly labels: boolean;
  readonly ringCount: number;
  readonly enterTransition: EnterTransition | undefined;
  readonly enterStaggerScale: number;
  /** Scrubbing or no entrance: the decor draws at rest (bklit renders it static then). */
  readonly still: boolean;
}

/** The host custom properties the decor's entrance CSS reads (styles.css "Ring grid and labels"). */
export const ringDecorVars = ({ grid, labels, ringCount, enterTransition, enterStaggerScale, still }: Readonly<RingDecorVarsInput>): StyleObject => {
  if (still || (grid === null && !labels)) {
    return {};
  }
  const vars: Record<string, string> = {};
  if (labels) {
    vars["--bkm-rla"] = "bkm-ring-label-in";
    vars["--bkm-rl0"] = `${round(RING_LABEL_OFFSET_MS * enterStaggerScale)}ms`;
    vars["--bkm-rl-step"] = `${round(RING_LABEL_STAGGER_MS * enterStaggerScale)}ms`;
  }
  if (grid !== null) {
    const length = Math.max(0, grid.outer - grid.inner);
    const spoke = spokeCurve(enterTransition, length);
    vars["--bkm-rsa"] = "bkm-ring-spoke-in";
    vars["--bkm-rs-len"] = `${round(length)}px`;
    // One spoke long, then a gap past its end: the dash covers the whole spoke at rest.
    vars["--bkm-rs-dash"] = `${round(length)}px ${round(length + 4)}px`;
    vars["--bkm-rs-dur"] = `${round(spoke.durationMs)}ms`;
    vars["--bkm-rs-ease"] = spoke.ease;
    vars["--bkm-rs-step"] = `${round(SPOKE_STAGGER_MS * enterStaggerScale)}ms`;
    const glide = travelSpring(GRID_SPOKE_SPRING, Math.max(...grid.ticks.map((tick) => tick.labelRadius), 1));
    vars["--bkm-rta"] = "bkm-ring-tick-in";
    vars["--bkm-rtf"] = "bkm-ring-tick-fade";
    vars["--bkm-rt-glide"] = `${round(glide.durationMs)}ms ${glide.ease}`;
    // gridLabelDelay: the labels start once half the grid rings (one per data ring) have started.
    vars["--bkm-rt0"] = `${round(ringCount * GRID_RING_STAGGER_MS * enterStaggerScale * 0.5)}ms`;
    vars["--bkm-rt-step"] = `${round(LABEL_STAGGER_MS * enterStaggerScale)}ms`;
    vars["--bkm-rt-fade"] = `${LABEL_FADE_MS}ms`;
    // Each label slides out from the centre: it starts translated by minus its own position.
    for (const [index, tick] of grid.ticks.slice(0, MAX_STAGGERED).entries()) {
      vars[`--bkm-rtg${index}`] = `${round(-tick.labelRadius * Math.sin(tick.angle))}px ${round(tick.labelRadius * Math.cos(tick.angle))}px`;
    }
  }
  return vars;
};
