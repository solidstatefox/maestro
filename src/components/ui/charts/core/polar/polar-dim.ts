import { springDriver } from "../motion/spring-animate";
import { HOVER_SPRING, HOVER_TRANSITION_CSS } from "../motion/springs";
import { NOT_MOTION, isMotionNode } from "../renderer-dom";
import { range } from "../range";

const MAX_INDEX = 32;
const RING_HOVER_SCALE = 1.03;
const RING_PUSHED_SCALE = 1.02;

// The dim: bklit 150ms cubic-bezier(0,0,.58,1); the snappy variant: the hover profile.
const baseCss = (host: string, fade: number): string =>
  `${host} g.bkm-pie-arc${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS}}`
  + `${host}[data-hover] g.bkm-pie-arc{opacity:${fade}}`;

const PIE_HOST = '[data-bkm-chart="pie"]';

interface PieHoverVars {
  readonly vars: Record<string, string>;
  readonly grow: string;
}

const buildPieCss = (fade: number, count: number): string => {
  let css = baseCss(PIE_HOST, fade);
  css += `${PIE_HOST} g.bkm-pie-arc{transform-origin:0 0}`;
  for (const index of range(Math.min(count, MAX_INDEX))) {
    // radialArc `className` (reference/marks/polar.md)
    const slice = `g.bkm-pie-s${index}`;
    // `--bkm-pg<i>` is set on the host only for a `showGlow` slice: elsewhere the filter is invalid at computed time, so none.
    css += `${PIE_HOST}[data-hover="${index}"] ${slice}{opacity:1;transform:var(--bkm-tf${index});filter:var(--bkm-pg${index})}`;
    // Donut grow: the outer radius alone moves, so the hot slice swaps to its precomputed grown outline (CSS `d`).
    css += `${PIE_HOST}[data-hover="${index}"][data-bkm-grow~="${index}"] ${slice} path{d:var(--bkm-gd${index})}`;
  }
  return css;
};

interface PieHoverRow {
  readonly sliceIndex: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly effect: string;
  readonly offset: number;
  /** A `showGlow` slice's glow colour (its PieSlice `color`, else its data colour or the palette's). */
  readonly glow?: string;
}

/** bklit pie-slice.tsx's hover glow: `drop-shadow(0 0 12px <color>)` on the hovered slice. */
const GLOW_BLUR_PX = 12;
interface PieGrowGeometry<TRow extends PieHoverRow> {
  /** Resting outer radius (px) of the polar mark. */
  readonly outerRadius: number;
  /** Builds a slice outline at a given outer radius. */
  readonly pathAt: (row: TRow, outerRadius: number) => string;
  readonly isDonut: boolean;
}

/** Per-slice hover geometry, set once on the host: `--bkm-tf<i>` is the whole hover transform (translate along the mid-angle, or a uniform scale for a pie `grow`),
 * `--bkm-gd<i>` the grown donut outline, `--bkm-pg<i>` a `showGlow` slice's glow. Returns the vars plus the `data-bkm-grow` index list that scopes the donut `d` rule. */
const pieHoverVars = <TRow extends PieHoverRow>(rows: readonly TRow[], geometry: Readonly<PieGrowGeometry<TRow>>): PieHoverVars => {
  const vars: Record<string, string> = {};
  const grow: number[] = [];
  for (const row of rows) {
    if (row.glow !== undefined && row.sliceIndex < MAX_INDEX) { vars[`--bkm-pg${row.sliceIndex}`] = `drop-shadow(0 0 ${GLOW_BLUR_PX}px ${row.glow})`; }
  }
  for (const row of rows.filter((candidate) => candidate.offset !== 0 && candidate.sliceIndex < MAX_INDEX)) {
    switch (row.effect) {
      case "translate": {
        const mid = (row.startAngle + row.endAngle) / 2;
        vars[`--bkm-tf${row.sliceIndex}`] = `translate(${Math.sin(mid) * row.offset}px,${-Math.cos(mid) * row.offset}px)`;
        break;
      }
      case "grow": {
        if (geometry.isDonut) {
          grow.push(row.sliceIndex);
          vars[`--bkm-gd${row.sliceIndex}`] = `path("${geometry.pathAt(row, geometry.outerRadius + row.offset)}")`;
        } else {
          vars[`--bkm-tf${row.sliceIndex}`] = `scale(${(geometry.outerRadius + row.offset) / geometry.outerRadius})`;
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  return { grow: grow.join(" "), vars };
};

/** The hover springs of a pie: on a hover change the previous and the new slice each retarget from their live position and velocity
 * (translate px, pie-grow scale, donut-grow outer radius); rest/hot values are the static rules above. */
const createPieHoverSprings = <TRow extends PieHoverRow>(rows: readonly TRow[], geometry: Readonly<PieGrowGeometry<TRow>>): ((host: HTMLElement, previous: number | null, next: number | null) => void) => {
  const byIndex = new Map<number, TRow>();
  for (const row of rows) { if (row.offset !== 0 && row.sliceIndex < MAX_INDEX && (row.effect === "translate" || row.effect === "grow")) { byIndex.set(row.sliceIndex, row); } }
  // Slice groups resolved by our own className once, then reused while still mounted (the renderer swaps nodes on a scene change).
  const groups = new Map<number, Element>();
  const groupOf = (host: HTMLElement, index: number): Element | null => {
    const cached = groups.get(index);
    if (cached?.isConnected === true) { return cached; }
    const found = host.querySelector(`g.bkm-pie-s${index}`);
    if (found === null) { groups.delete(index); } else { groups.set(index, found); }
    return found;
  };
  const retarget = (host: HTMLElement, index: number, hovered: number | null, previous: number | null): void => {
    const row = byIndex.get(index);
    const group = groupOf(host, index);
    // Groups are found by our own `className` (gaps #20/#36: no transform channel in `states`); a mid-tween node keeps its tween (#50).
    if (row === undefined || group === null || isMotionNode(group)) { return; }
    const hot = (state: number | null): boolean => state === index;
    if (row.effect === "translate") {
      const mid = (row.startAngle + row.endAngle) / 2;
      const dx = Math.sin(mid);
      const dy = -Math.cos(mid);
      springDriver.play({ affine: true, el: group, frames: true, frame: (value) => ({ transform: `translate(${dx * value}px,${dy * value}px)` }), rest: hot(previous) ? row.offset : 0, spring: HOVER_SPRING, target: hot(hovered) ? row.offset : 0 });
    } else if (geometry.isDonut) {
      const radius = geometry.outerRadius;
      for (const path of group.querySelectorAll("path")) {
        springDriver.play({ el: path, frame: (value) => ({ d: `path("${geometry.pathAt(row, value)}")` }), rest: hot(previous) ? radius + row.offset : radius, spring: HOVER_SPRING, target: hot(hovered) ? radius + row.offset : radius });
      }
    } else {
      const scale = (geometry.outerRadius + row.offset) / geometry.outerRadius;
      springDriver.play({ affine: true, el: group, frames: true, frame: (value) => ({ transform: `scale(${value})` }), rest: hot(previous) ? scale : 1, spring: HOVER_SPRING, target: hot(hovered) ? scale : 1 });
    }
  };
  return (host, previous, next) => {
    for (const index of new Set([previous, next])) {
      if (index !== null) { retarget(host, index, next, previous); }
    }
  };
};

export { buildPieCss, createPieHoverSprings, MAX_INDEX, pieHoverVars, RING_HOVER_SCALE, RING_PUSHED_SCALE };
