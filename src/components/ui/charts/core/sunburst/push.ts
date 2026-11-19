import { hoverGrowForPathSegment, hubScale, ID_SEP, ringOptions } from "./arcs";
import type { ArcDatum } from "./arcs";

const FIT_STEPS = 6;
const NORMAL_EQUATIONS = 3;
const F3 = 1000;

/** Affine fit of one unit radial field: displacement = slide * u + (stretchU * x) u + (stretchV * y) v in the bisector frame. */
interface FieldFit {
  readonly slide: number;
  readonly stretchU: number;
  readonly stretchV: number;
}

export interface SectorPush {
  /** Sector bisector, radians clockwise from 12 o'clock. */
  readonly bisector: number;
  /** Label direction (the sector centroid angle), radians clockwise from 12 o'clock. */
  readonly labelAngle: number;
  /** Radial thickness of the ring in px. */
  readonly thickness: number;
  /** Radial and angular extent at rest (angles clockwise from 12 o'clock, `halfSweep` either side of the bisector). */
  readonly minR: number;
  readonly maxR: number;
  readonly halfSweep: number;
  /** Whole sector moved radially by 1 (per unit of ancestor push). */
  readonly shift: FieldFit;
  /** Outer edge moved by 1 while the inner edge stays (per unit of own grow); linear in the radius. */
  readonly grow: FieldFit;
}

export interface SectorExtent {
  readonly minR: number;
  readonly maxR: number;
  /** Angular extent relative to the sector's reference angle. */
  readonly minD: number;
  readonly maxD: number;
}

const subtractRow = (m: number[][], row: number, col: number, factor: number): void => {
  for (let k = col; k <= NORMAL_EQUATIONS; k += 1) {
    (m[row])[k] = (m[row]?.[k] ?? 0) - factor * (m[col]?.[k] ?? 0);
  }
};

const eliminate = (m: number[][], col: number, lead: number): void => {
  for (let row = 0; row < NORMAL_EQUATIONS; row += 1) {
    const factor = (m[row]?.[col] ?? 0) / lead;
    if (row !== col && factor !== 0) {
      subtractRow(m, row, col, factor);
    }
  }
};

const solve3 = (a: number[][], b: number[]): number[] => {
  const n = NORMAL_EQUATIONS;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) {
        pivot = row;
      }
    }
    const swap = m[col] ?? [];
    m[col] = m[pivot] ?? [];
    m[pivot] = swap;
    const lead = m[col]?.[col] ?? 0;
    const singular = Math.abs(lead) < 1e-12;
    if (!singular) {
      eliminate(m, col, lead);
    }
  }
  return m.map((row, i) => {
    const diagonal = row[i] ?? 0;
    return diagonal === 0 ? 0 : (row[n] ?? 0) / diagonal;
  });
};

/** Least-squares fits of bklit's two radial fields over an annular sector: a whole-sector shift (weight 1) and the outer-edge grow
 * (weight 0 inner, 1 outer). Both share the normal matrix (it depends on the sample grid only), so it is built once. Exact on the bisector; the residual grows with angular width. */
export const fitSectorPush = (extent: SectorExtent, reference: number, labelAngle: number): SectorPush => {
  const thickness = extent.maxR - extent.minR;
  const half = (extent.maxD - extent.minD) / 2;
  // Basis columns (du, dv) are [1, 0], [x, 0], [0, y] for [slide, stretchU, stretchV]: the normal matrix is [[n, sx, 0], [sx, sxx, 0], [0, 0, syy]].
  let count = 0;
  let sx = 0;
  let sxx = 0;
  let syy = 0;
  const shiftRhs = [0, 0, 0];
  const growRhs = [0, 0, 0];
  for (let i = 0; i <= FIT_STEPS; i += 1) {
    for (let j = 0; j <= FIT_STEPS; j += 1) {
      const r = extent.minR + ((extent.maxR - extent.minR) * i) / FIT_STEPS;
      const f = -half + (2 * half * j) / FIT_STEPS;
      const x = r * Math.cos(f);
      const y = r * Math.sin(f);
      const weight = thickness > 0 ? (r - extent.minR) / thickness : 0;
      const cos = Math.cos(f);
      const sin = Math.sin(f);
      count += 1;
      sx += x;
      sxx += x * x;
      syy += y * y;
      shiftRhs[0] = (shiftRhs[0] ?? 0) + cos;
      shiftRhs[1] = (shiftRhs[1] ?? 0) + x * cos;
      shiftRhs[2] = (shiftRhs[2] ?? 0) + y * sin;
      growRhs[0] = (growRhs[0] ?? 0) + weight * cos;
      growRhs[1] = (growRhs[1] ?? 0) + x * (weight * cos);
      growRhs[2] = (growRhs[2] ?? 0) + y * (weight * sin);
    }
  }
  const normal = (): number[][] => [[count, sx, 0], [sx, sxx, 0], [0, 0, syy]];
  const fit = (rhs: number[]): FieldFit => {
    const [slide = 0, stretchU = 0, stretchV = 0] = solve3(normal(), rhs);
    return { slide, stretchU, stretchV };
  };
  return {
    bisector: reference + (extent.maxD + extent.minD) / 2,
    labelAngle,
    thickness,
    minR: extent.minR,
    maxR: extent.maxR,
    halfSweep: half,
    shift: fit(shiftRhs),
    grow: fit(growRhs),
  };
};

const round3 = (value: number): number => Math.round(value * F3) / F3;

interface PushValues {
  readonly translate: string;
  readonly transform: string;
}

/** CSS `translate` and `transform` values for a sector moved outward by `p` px with its outer edge grown by `g` px. */
const sectorPushValues = (push: SectorPush, p: number, g: number): PushValues => {
  const slide = p * push.shift.slide + g * push.grow.slide;
  const frame = push.bisector - Math.PI / 2;
  const scaleU = 1 + p * push.shift.stretchU + g * push.grow.stretchU;
  const scaleV = 1 + p * push.shift.stretchV + g * push.grow.stretchV;
  return {
    transform: `rotate(${round3(frame)}rad) scale(${round3(scaleU)},${round3(scaleV)}) rotate(${round3(-frame)}rad)`,
    translate: `${round3(Math.sin(push.bisector) * slide)}px ${round3(-Math.cos(push.bisector) * slide)}px`,
  };
};

/** Id of the sector under a point given relative to the chart centre (null over the hub, the gaps and outside the ring). */
export const sectorAtPoint = (sectors: ReadonlyMap<string, SectorPush>, dx: number, dy: number): string | null => {
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dx, -dy);
  for (const [id, sector] of sectors) {
    const delta = Math.atan2(Math.sin(angle - sector.bisector), Math.cos(angle - sector.bisector));
    if (r >= sector.minR && r <= sector.maxR && Math.abs(delta) <= sector.halfSweep) {
      return id;
    }
  }
  return null;
};

const onPath = (arc: ArcDatum, hovered: ArcDatum): boolean => arc.id === hovered.id || hovered.id.startsWith(`${arc.id}${ID_SEP}`);

interface PushInput {
  readonly arcs: readonly ArcDatum[];
  readonly sectors: ReadonlyMap<string, SectorPush>;
  readonly hovered: ArcDatum | null;
  readonly focusDepth: number;
  readonly maxDepth: number;
  readonly popOut: number;
}

/** bklit's per-arc grow for the hovered path (buildHoverGrowTargets): one segment grow for the visible path length,
 * capped at one expanded first-level ring (maxHoverSegmentThickness). */
const growTargets = ({ arcs, sectors, hovered, focusDepth, maxDepth, popOut }: Readonly<PushInput & { readonly hovered: ArcDatum }>): Map<string, number> => {
  const targets = new Map<string, number>();
  const ringWidth = sectors.get(hovered.id)?.thickness ?? 0;
  if (ringWidth <= 0) {
    return targets;
  }
  const radius = (ringWidth * Math.max(1, maxDepth - focusDepth)) / (1 - hubScale(focusDepth) / Math.max(1, maxDepth));
  const reference = ringOptions(1, maxDepth, radius).ringWidth;
  const maxExpanded = reference + hoverGrowForPathSegment(popOut, reference, 1);
  const segmentGrow = hoverGrowForPathSegment(popOut, ringWidth, Math.max(1, hovered.depth - focusDepth));
  for (const arc of arcs) {
    const sector = sectors.get(arc.id);
    if (sector !== undefined && arc.depth > focusDepth && onPath(arc, hovered)) {
      targets.set(arc.id, sector.thickness >= maxExpanded ? 0 : Math.min(segmentGrow, maxExpanded - sector.thickness));
    }
  }
  return targets;
};

// The vars and flags live on the elements that read them: one written on the host restyles its whole subtree (about 1 ms for 140 nodes), on an element only that element.
// An element is addressed by its arc class (`bk-sb-a<i>` sectors, `bk-sb-p<i>` overlays, `bk-sb-l-<i>` labels); the static rules in sunburst.css read the fixed names.
export type ArcKind = "a" | "p" | "l";
const classOf = (kind: ArcKind, index: number): string => (kind === "l" ? `bk-sb-l-${index}` : `bk-sb-${kind}${index}`);

const desired = /* @__PURE__ */ new WeakMap<HTMLElement, Map<string, string>>();
const KEY_SEP = " ";

const writeOn = (element: SVGElement, name: string, value: string | undefined): void => {
  if (name.startsWith("--")) {
    if (value === undefined) { element.style.removeProperty(name); } else { element.style.setProperty(name, value); }
  } else if (value === undefined) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
};

const applyOn = (host: HTMLElement, cls: string, name: string, value: string | undefined): void => {
  for (const element of host.querySelectorAll<SVGElement>(`.${cls}`)) { writeOn(element, name, value); }
};

/** Re-applies the wanted vars and flags after the sector layer painted: its elements are created by the scene, not by hover. */
export const reapplyPush = (host: HTMLElement | null): void => {
  const wanted = host === null ? undefined : desired.get(host);
  if (host !== null && wanted !== undefined) {
    for (const [key, value] of wanted) {
      const [kind = "a", index = "0", name = ""] = key.split(KEY_SEP);
      applyOn(host, classOf(kind as ArcKind, Number(index)), name, value);
    }
  }
};

const setOn = (host: HTMLElement, kind: ArcKind, index: number, name: string, value: string | null): void => {
  const wanted = desired.get(host) ?? new Map<string, string>();
  desired.set(host, wanted);
  const key = [kind, index, name].join(KEY_SEP);
  if (wanted.get(key) === (value ?? undefined)) { return; }
  if (value === null) { wanted.delete(key); } else { wanted.set(key, value); }
  applyOn(host, classOf(kind, index), name, value ?? undefined);
};

/** Makes the elements of `indexes` (arc indexes of one kind) the only ones carrying the attribute `name`. */
export const setFlag = (host: HTMLElement, kind: ArcKind, name: string, indexes: Iterable<number>): void => {
  const wanted = new Set(indexes);
  for (const key of [...(desired.get(host)?.keys() ?? [])]) {
    const [keyKind, index = "0", keyName] = key.split(KEY_SEP);
    if (keyKind === kind && keyName === name && !wanted.has(Number(index))) { setOn(host, kind, Number(index), name, null); }
  }
  for (const index of wanted) { setOn(host, kind, index, name, ""); }
};

const setPair = (host: HTMLElement, kind: ArcKind, values: PushValues | null, index: number): void => {
  setOn(host, kind, index, "--bkm-sb-t", values === null ? null : values.translate);
  setOn(host, kind, index, "--bkm-sb-m", values === null ? null : values.transform);
};

/** Sum of the grow targets of an arc's ancestors. */
const ancestorPush = (arc: ArcDatum, byId: ReadonlyMap<string, ArcDatum>, targets: ReadonlyMap<string, number>): number => {
  let push = 0;
  let parent = arc.parentId === null ? undefined : byId.get(arc.parentId);
  while (parent !== undefined) {
    push += targets.get(parent.id) ?? 0;
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
  }
  return push;
};

const writeArcPush = (host: HTMLElement, index: number, sector: SectorPush | undefined, push: number, own: number | undefined): void => {
  // Sector: moves with its grown ancestors. Overlay (the on-path copy at full opacity): also grows its own outer edge.
  setPair(host, "a", sector === undefined || push === 0 ? null : sectorPushValues(sector, push, 0), index);
  setPair(host, "p", sector === undefined || own === undefined ? null : sectorPushValues(sector, push, own), index);
  // bklit centres the label on the pushed (and, on the hovered path, grown) sector.
  const shift = push + (own ?? 0) / 2;
  setOn(host, "l", index, "--bkm-sb-t", sector === undefined || shift === 0 ? null : `${round3(Math.sin(sector.labelAngle) * shift)}px ${round3(-Math.cos(sector.labelAngle) * shift)}px`);
};

/** Writes (or clears) the push vars for the hovered arc on `host`. Reads only the published sector table; never touches the chart definition. */
export const writePush = (host: HTMLElement, input: Readonly<PushInput>): void => {
  const { arcs, sectors, hovered } = input;
  const targets = hovered === null ? new Map<string, number>() : growTargets({ ...input, hovered });
  const byId = new Map(arcs.map((arc) => [arc.id, arc]));
  for (const arc of arcs) {
    writeArcPush(host, arc.arcIndex, sectors.get(arc.id), ancestorPush(arc, byId, targets), targets.get(arc.id));
  }
};
