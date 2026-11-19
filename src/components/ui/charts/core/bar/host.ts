import { scaleBand } from "d3-scale";
import type { FocusedRow } from "../cartesian/context";
import { HoverOverlay } from "../cartesian/hover-overlay";
import { clearAttribute, clearVar, raiseAttribute, writeHoverIndex, writeVar } from "../host-write";
import type { Readable } from "../store";
import type { ChartMargin } from "../theme";
import type { BarDefinition } from "./definition";
import type { PlotRect } from "./focus";
import { FOCUS_X_VAR, MAX_INDEX } from "./hover";
import type { Row } from "./model";

const HOVER_ON_ATTR = "data-bkm-on";

/** A draw's plot rect, as the renderer reports it (`scene.chart`). */
interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The band layout the focused category's centre is read from. */
export interface BarFocusGeom {
  readonly horizontal: boolean;
  readonly categories: readonly string[];
  readonly barGap: number;
  /** The left plot margin in svg px. */
  readonly left: number;
}

export interface BarHost {
  /** The plot rect of the latest draw (zero before the first). Stable. */
  readonly plot: () => PlotRect;
  /** Appends the hover indicator to `host`; returns its removal. */
  mount(host: HTMLElement | null): () => void;
  /** One draw: records the plot rect and re-places the indicator when the model or the plot rect changed (a draw that moved nothing, an
   * entrance frame, leaves it alone). */
  draw(chart: SceneRect, built: Pick<BarDefinition, "overlay" | "valueDomain">, margin: ChartMargin, horizontal: boolean): void;
  /** Mirrors `focus` onto `host` and the indicator, now and on every change; returns the unsubscribe. */
  follow(host: HTMLElement, focus: Readable<FocusedRow | null>, geom: BarFocusGeom): () => void;
}

export function createBarHost(): BarHost {
  const overlay = new HoverOverlay();
  let plotRect: PlotRect = { left: 0, top: 0, width: 0, height: 0 };
  let placed: { readonly model: unknown; readonly key: string } = { key: "", model: null };
  return {
    plot: () => plotRect,
    mount(host) {
      host?.append(overlay.root);
      return () => { overlay.root.remove(); };
    },
    draw(chart, built, margin, horizontal) {
      plotRect = { left: chart.x, top: chart.y, width: chart.width, height: chart.height };
      const key = `${chart.x},${chart.y},${chart.width},${chart.height}`;
      if (placed.model !== built.overlay || placed.key !== key) {
        placed = { key, model: built.overlay };
        const value = built.valueDomain;
        overlay.update(
          built.overlay,
          { height: chart.y + chart.height + margin.bottom, innerWidth: chart.width, innerHeight: chart.height, xDomain: [0, 1], yDomains: horizontal ? {} : { y: value } },
          margin,
          // No bar rule reads the pill's live x: the tick fade keys on the focused band (`FOCUS_X_VAR`).
          null,
        );
      }
    },
    follow(host, focus, { horizontal, categories, barGap, left }) {
      // Pointer moves inside one category re-emit the same focus: nothing to write then, so a crossing is the only style invalidation.
      // `data-hover` alone selects the dim, the tick label and the pill's tick (positions are looked up in the stylesheet).
      let applied = Number.NaN;
      const apply = (): void => {
        const f = focus.get();
        const index = f === null ? -1 : f.index;
        if (index === applied) { return; }
        applied = index;
        if (f === null) {
          clearAttribute(host, HOVER_ON_ATTR);
          overlay.focus(null, null);
          writeHoverIndex(host, null);
          clearVar(host, FOCUS_X_VAR);
          return;
        }
        overlay.focus(index, f.row);
        if (!host.hasAttribute(HOVER_ON_ATTR)) {
          raiseAttribute(host, HOVER_ON_ATTR);
        }
        writeHoverIndex(host, index >= MAX_INDEX ? null : index);
        if (horizontal) { clearVar(host, FOCUS_X_VAR); }
        else {
          const band = scaleBand().domain(categories).range([0, plotRect.width]).padding(barGap);
          writeVar(host, FOCUS_X_VAR, ((band(categories[index] ?? "") ?? 0) + band.bandwidth() / 2 + left).toFixed(2));
        }
      };
      apply();
      return focus.subscribe(apply);
    },
  };
}

/** The row a native focus change focuses, null for none. */
export const barFocusedRow = (point: { readonly datum: unknown } | null): FocusedRow | null => {
  // SAFETY: every datum of this chart is a BarDatum ({ index, source }), set by buildBarData.
  const datum = point?.datum as { index: number; source: Row } | undefined;
  return datum ? { row: datum.source, index: datum.index } : null;
};
