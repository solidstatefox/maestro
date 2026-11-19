import { isFiniteNumber } from "../guards";
import { TAU } from "../polar/tau";

/** A node of the hierarchy passed to `SunburstChart` as `data`. */
export interface SunburstNode {
  /** Display name of the node. Names are joined with `" / "` to form node ids, so siblings should have unique names. */
  name: string;
  /** Value of a leaf. Parent values are summed from their children; negative or non-finite leaves take no angle. */
  value?: number;
  /**
   * Color of the node and its descendants.
   * @default one of the `--chart-1` to `--chart-5` variables, by top-level branch
   */
  color?: string;
  /** Fill override for the node: a color, or a pattern or gradient as `url(#id)` (a `PatternLines`… or `LinearGradient` child of the chart). */
  fill?: string;
  /** Child nodes. A node with children is a branch you can zoom into. */
  children?: SunburstNode[];
}

/** @internal */
export interface ArcDatum {
  id: string;
  name: string;
  depth: number;
  value: number;
  categoryIndex: number;
  hasChildren: boolean;
  trail: string[];
  parentId: string | null;
  a0: number;
  a1: number;
  arcIndex: number;
  color?: string;
  fill?: string;
}

/** @internal */
export interface Focus {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
  categoryIndex: number;
  a0: number;
  a1: number;
}

const TOP = -Math.PI / 2;
export const ID_SEP = " / ";

const nodeId = (parentId: string | null, name: string): string => (parentId === null ? name : `${parentId}${ID_SEP}${name}`);

/** @internal */
export const sumValues = (node: SunburstNode): number => {
  if (node.children !== undefined && node.children.length > 0) {
    return node.children.reduce((sum, child) => sum + sumValues(child), 0);
  }
  // A leaf that is negative or not a finite number (bklit lays NaN angles out and draws nothing) takes no angle; the native
  // sunburst throws on it.
  return isFiniteNumber(node.value) && node.value > 0 ? node.value : 0;
};

interface BuildContext {
  arcs: ArcDatum[];
  focusById: Map<string, Focus>;
  maxDepth: number;
  arcIndex: number;
}

interface LayoutParams {
  readonly node: SunburstNode;
  readonly id: string;
  readonly depth: number;
  readonly a0: number;
  readonly a1: number;
  readonly parentId: string | null;
  readonly categoryIndex: number;
  readonly trail: readonly string[];
}

const layoutNode = (params: Readonly<LayoutParams>, ctx: BuildContext): void => {
  const { node, id, depth, a0, a1, parentId, categoryIndex, trail } = params;
  const value = sumValues(node);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;

  if (depth > 0) {
    ctx.arcs.push({
      a0,
      a1,
      arcIndex: ctx.arcIndex,
      categoryIndex,
      color: node.color,
      depth,
      fill: node.fill,
      hasChildren,
      id,
      name: node.name,
      parentId,
      trail: [...trail, node.name],
      value,
    });
    ctx.arcIndex += 1;
  }
  ctx.focusById.set(id, { a0, a1, categoryIndex, depth, id, name: node.name, parentId });
  ctx.maxDepth = Math.max(ctx.maxDepth, depth);

  const span = a1 - a0;
  let cursor = a0;
  for (const [index, child] of children.entries()) {
    const childSpan = value > 0 ? (sumValues(child) / value) * span : 0;
    layoutNode(
      {
        a0: cursor,
        a1: cursor + childSpan,
        categoryIndex: depth === 0 ? index : categoryIndex,
        depth: depth + 1,
        id: nodeId(id, child.name),
        node: child,
        parentId: id,
        // Divergence from bklit, whose children get `depth === 0 ? [node.name] : trail`: the trail then skipped every ancestor between the
        // root and the arc ("Revenue › Implementation" for Revenue / Services / Consulting / Implementation). The full path is passed down.
        trail: [...trail, node.name],
      },
      ctx,
    );
    cursor += childSpan;
  }
};

const toRadians = (normalized: number): number => TOP + normalized * TAU;

export interface SunburstModel {
  readonly arcs: ArcDatum[];
  readonly maxDepth: number;
  readonly total: number;
  readonly focusById: Map<string, Focus>;
  readonly rootId: string;
}

/** @internal */
export const buildArcs = (data: SunburstNode): SunburstModel => {
  const ctx: BuildContext = { arcIndex: 0, arcs: [], focusById: new Map(), maxDepth: 0 };
  layoutNode({ a0: 0, a1: 1, categoryIndex: 0, depth: 0, id: data.name, node: data, parentId: null, trail: [] }, ctx);
  for (const arc of ctx.arcs) {
    arc.a0 = toRadians(arc.a0);
    arc.a1 = toRadians(arc.a1);
  }
  for (const focus of ctx.focusById.values()) {
    focus.a0 = toRadians(focus.a0);
    focus.a1 = toRadians(focus.a1);
  }
  return { arcs: ctx.arcs, focusById: ctx.focusById, maxDepth: ctx.maxDepth, rootId: data.name, total: sumValues(data) };
};

/**
 * Normalized clockwise angle from 12 o'clock (0 to 1).
 * @internal
 */
export const clockwiseFraction = (angle: number): number => {
  let normalized = angle - TOP;
  if (normalized < 0) {
    normalized += TAU;
  }
  return normalized / TAU;
};

// Drill-down hub (the zoom-out disc) is smaller than a ring and shrinks per extra drill level.
const DRILL_CENTER_SCALE = 0.65;
const DRILL_CENTER_DEPTH_SHRINK = 0.08;
const DRILL_CENTER_MIN_SCALE = 0.45;

/** Hub radius as a fraction of one ring width at the root; 0 at the root view. */
export const hubScale = (focusDepth: number): number => {
  if (focusDepth === 0) {
    return 0;
  }
  return Math.max(DRILL_CENTER_MIN_SCALE, DRILL_CENTER_SCALE - Math.max(0, focusDepth - 1) * DRILL_CENTER_DEPTH_SHRINK);
};

export interface RingOptions {
  centerR: number;
  ringWidth: number;
}

/** @internal */
export const ringOptions = (focusDepth: number, maxDepth: number, radius: number): RingOptions => {
  const oneLevel = radius / Math.max(1, maxDepth);
  const centerR = oneLevel * hubScale(focusDepth);
  const visibleRings = Math.max(1, maxDepth - focusDepth);
  return { centerR, ringWidth: (radius - centerR) / visibleRings };
};

const HOVER_GROW_RING_BUDGET = 0.28;
const HOVER_GROW_SEGMENT_CAP = 0.1;

/** bklit: scale hover grow so deep paths and wide drill-down rings stay within budget. */
export const hoverGrowForPathSegment = (hoverPop: number, ringWidth: number, pathLength: number): number =>
  Math.min(hoverPop, ringWidth * HOVER_GROW_SEGMENT_CAP, (ringWidth * HOVER_GROW_RING_BUDGET) / pathLength);

/** bklit: inset reserved around the chart so the hover grow stays inside the view box. */
export const defaultSunburstGrowPadding = (maxDepth = 1, size = 440, hoverPop = 8): number => {
  const rootRingWidth = size / 2 / Math.max(1, maxDepth);
  const pathLength = Math.max(1, maxDepth - 1);
  const segmentGrow = hoverGrowForPathSegment(hoverPop, rootRingWidth, pathLength);
  return Math.ceil(segmentGrow * pathLength + segmentGrow);
};

const ENTER_RING_STEP_MS = 120;
const ENTER_SEGMENT_STEP_MS = 80;
const MIN_STAGGER_SCALE = 0.25;

export interface SunburstEnterDelays {
  readonly delays: ReadonlyMap<string, number>;
  readonly maxDelay: number;
}

/** bklit's ring-then-clockwise enter stagger, in milliseconds. */
export const buildEnterDelays = (arcs: readonly ArcDatum[], staggerScale: number): SunburstEnterDelays => {
  const scale = Math.max(MIN_STAGGER_SCALE, staggerScale);
  const byDepth = new Map<number, ArcDatum[]>();
  for (const arc of arcs) {
    byDepth.set(arc.depth, [...(byDepth.get(arc.depth) ?? []), arc]);
  }
  const delays = new Map<string, number>();
  let maxDelay = 0;
  for (const [depth, ring] of byDepth) {
    const sorted = [...ring].toSorted((a, b) => clockwiseFraction(a.a0) - clockwiseFraction(b.a0));
    for (const [index, arc] of sorted.entries()) {
      const delay = ((depth - 1) * ENTER_RING_STEP_MS + index * ENTER_SEGMENT_STEP_MS) * scale;
      delays.set(arc.id, delay);
      maxDelay = Math.max(maxDelay, delay);
    }
  }
  return { delays, maxDelay };
};

/** Flat parent-reference rows for the native sunburst mark. Leaves carry the value; ids equal bklit ids. */
export interface SunburstRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly value: number;
}

export const buildRows = (model: SunburstModel): SunburstRow[] => {
  const rows: SunburstRow[] = [{ id: model.rootId, parentId: null, value: 0 }];
  for (const arc of model.arcs) {
    rows.push({ id: arc.id, parentId: arc.parentId, value: arc.hasChildren ? 0 : arc.value });
  }
  return rows;
};
