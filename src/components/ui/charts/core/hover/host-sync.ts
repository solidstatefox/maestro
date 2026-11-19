import { writePillFocusX, writePillSameLabel } from "../cartesian/date-pill";
import { springBand } from "../motion/band-spring";
import { clearAttribute, raiseAttribute, writeAttribute, writeVar } from "../host-write";
import type { LegendHover } from "../legend/store";

/** Plot layout the focus x / highlight band are derived from (svg px = left + fraction of the domain * innerWidth). */
export interface HoverHostGeom {
  /** Row x values (ms), ascending: `built.hover.times`. */
  readonly times: readonly number[];
  /** Left plot margin in svg px. */
  readonly left: number;
  /** x domain start (ms) and span (ms). */
  readonly xStart: number;
  readonly xSpan: number;
  readonly innerWidth: number;
  /** `built.hover.plSigns` (aligned with `times`); drives `data-bkm-plf`, the focused point's profit/loss sign. */
  readonly signs?: readonly (0 | 1 | null)[];
  /** False when there is no highlight band to spring (no highlight marks, no segment marks): the hover then skips that. Default true. */
  readonly hasBand?: boolean;
  /** Wider highlight spans (`highlight.span` > 1) than the default one row either side: each springs its own band (`data-bkm-band="s<n>"`). */
  readonly spans?: readonly number[];
  /** Date-pill tick times (`built.pillTicks.times`) when the chart has a pill: ticks reading like the focused date hide with it. */
  readonly pillTicks?: readonly number[];
}

/** The `data-bkm-band` key of a highlight span (core/markup/band-clip.ts): `""` for the default one row either side. */
export const bandKey = (span: number): string => (span <= 1 ? "" : `s${span}`);

const HOVER_ATTR = "data-bkm-hover";
const DRAG_ATTR = "data-bkm-drag";
const PRESS_ATTR = "data-bkm-press";
const SETTLE_ATTR = "data-bkm-settle";

const EMPTY_GEOM: HoverHostGeom = { times: [], left: 0, xStart: 0, xSpan: 0, innerWidth: 0 };

/** Focus -> host: sets `data-bkm-hover`, `--bkm-hx` (the date pill tick fade's focus x, on the x tick labels), the band spring and `data-bkm-settle` (bklit's band `jump`s on inactive -> active, springs
 * on later changes, use-highlight-segment.ts:48-57), written in the same task as the edges. Call `sync(focusTimeMs | null)` from `onFocusChange`; assign `geom.current` from each draw. */
export interface HoverHostSync {
  readonly geom: { current: HoverHostGeom };
  readonly sync: (time: number | null) => void;
  readonly drag: (edges: readonly [number, number] | null) => void;
  readonly press: (on: boolean) => void;
}

const isIdleHover = (el: HTMLElement): boolean => el.hasAttribute(HOVER_ATTR) && !el.hasAttribute(DRAG_ATTR) && !el.hasAttribute(PRESS_ATTR);

/** The host sync over `host` (read at each write). */
export function createHoverHostSync(host: () => HTMLElement | null): HoverHostSync {
  const geom = { current: EMPTY_GEOM };
  let focus: number | null = null;
  // The focus and geometry the host already shows: a pointer move inside one point re-emits the same time, with nothing left to write.
  let applied: { readonly time: number; readonly geom: HoverHostGeom } | null = null;
  const sync = (time: number | null): void => {
    const el = host();
    if (!el) {
      return;
    }
    focus = time;
    if (time === null) {
      applied = null;
      clearAttribute(el, HOVER_ATTR);
      clearAttribute(el, "data-bkm-plf");
      if (!el.hasAttribute(DRAG_ATTR)) {
        clearAttribute(el, SETTLE_ATTR);
      }
      return;
    }
    const g = geom.current;
    // Unchanged focus: a press (`data-bkm-press`) still lifts below, a drag owns the band, and the entry (`data-bkm-hover` absent) always writes.
    const prior = applied;
    if (prior?.time === time && prior.geom === g && isIdleHover(el)) {
      return;
    }
    applied = { geom: g, time };
    const px = (t: number): number => g.left + (g.xSpan > 0 ? ((t - g.xStart) / g.xSpan) * g.innerWidth : 0);
    let lo = 0;
    let hi = g.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((g.times[mid]) < time) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const last = g.times.length - 1;
    const sign = g.signs?.[Math.min(lo, last)] ?? null;
    if (sign === null) {
      clearAttribute(el, "data-bkm-plf");
    } else {
      writeAttribute(el, "data-bkm-plf", String(sign));
    }
    clearAttribute(el, PRESS_ATTR);
    // bklit `wasActive` (use-highlight-segment.ts:50-58): an enter jumps, a move after it springs.
    if (el.hasAttribute(HOVER_ATTR) || el.hasAttribute(DRAG_ATTR)) {
      raiseAttribute(el, SETTLE_ATTR);
    }
    // The tick fade's inputs go on the x tick labels, which alone read them (a host var restyled the whole re-inherit path down to them); the focus x only until an
    // overlay pill writes its live x, which the rule reads first. A render strips them: the controller re-writes them (date-pill.ts `refreshTickVars`).
    if (g.pillTicks) {
      writePillFocusX(el, "--bkm-hx", px(time));
      writePillSameLabel(el, g.pillTicks, time, px);
    }
    if (g.hasBand !== false && !el.hasAttribute(DRAG_ATTR)) {
      const jump = !el.hasAttribute(HOVER_ATTR);
      springBand(el, px(g.times[Math.max(0, lo - 1)] ?? time), px(g.times[Math.min(last, lo + 1)] ?? time), jump);
      for (const span of g.spans ?? []) {
        springBand(el, px(g.times[Math.max(0, lo - span)] ?? time), px(g.times[Math.min(last, lo + span)] ?? time), jump, bandKey(span));
      }
    }
    if (!el.hasAttribute(HOVER_ATTR)) {
      raiseAttribute(el, HOVER_ATTR);
    }
  };
  /** Drag selection -> host (bklit HighlightSegment: the selection band wins over the hover band, SeriesHoverDim runs on `selection.active`).
   * `edges` are the selection's svg px edges, or null on release, which hands the band back to the focused point. */
  const drag = (edges: readonly [number, number] | null): void => {
    const el = host();
    if (!el) {
      return;
    }
    if (edges === null) {
      if (!el.hasAttribute(DRAG_ATTR)) {
        return;
      }
      clearAttribute(el, DRAG_ATTR);
      clearAttribute(el, "data-bkm-segon");
      applied = null;
      if (focus === null) {
        clearAttribute(el, SETTLE_ATTR);
      } else {
        sync(focus);
      }
      return;
    }
    // bklit `wasActive` (use-highlight-segment.ts:50-58): a drag from a hovered chart springs to the selection, one from an
    // idle chart (touch) jumps to it and springs from the next drag step.
    const active = el.hasAttribute(HOVER_ATTR) || el.hasAttribute(DRAG_ATTR);
    if (active) {
      raiseAttribute(el, SETTLE_ATTR);
    }
    const lo = Math.min(edges[0], edges[1]);
    const hi = Math.max(edges[0], edges[1]);
    writeVar(el, "--bkm-hl0", lo.toFixed(2));
    writeVar(el, "--bkm-hl1", hi.toFixed(2));
    springBand(el, lo, hi, !active);
    for (const span of geom.current.spans ?? []) {
      springBand(el, lo, hi, !active, bandKey(span));
    }
    if (hi - lo > 5) {
      raiseAttribute(el, "data-bkm-segon");
    } else {
      clearAttribute(el, "data-bkm-segon");
    }
    raiseAttribute(el, DRAG_ATTR);
  };
  /** bklit handleMouseDown clears the tooltip, crosshair and pill at once; they stay hidden until the next focus (`sync`). */
  const press = (on: boolean): void => {
    const el = host();
    if (on) {
      if (el) { raiseAttribute(el, PRESS_ATTR); }
    } else {
      clearAttribute(el, PRESS_ATTR);
    }
  };
  return { geom, sync, drag, press };
}

/** Legend hover -> host: `data-bkm-legend` (series index) and `data-bkm-pl` (profit 0 / loss 1), so a legend hover never touches the definition. */
export function writeLegendHover(el: HTMLElement, { legend, profitLoss }: LegendHover): void {
  for (const [name, value] of [["data-bkm-legend", legend], ["data-bkm-pl", profitLoss]] as const) {
    if (value === null) {
      clearAttribute(el, name);
    } else {
      writeAttribute(el, name, String(value));
    }
  }
}
