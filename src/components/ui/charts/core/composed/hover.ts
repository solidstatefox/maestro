import type { ChartPoint } from "@tanstack/charts";
import type { FocusedRow } from "../cartesian/context";
import { pillFadeHalf, refreshTickVars, syncPillHost } from "../cartesian/date-pill";
import { HoverOverlay, overlayPlotOf } from "../cartesian/hover-overlay";
import { createCrosshairSlot } from "../cartesian/features";
import type { ChildTable } from "../carriers/table";
import { createPlotStore } from "../cartesian/plot-size";
import type { PlotSnapshot, PlotStore } from "../cartesian/plot-size";
import type { ResolvedSeries, Row } from "../cartesian/series";
import { writePresence } from "../host-write";
import { createFocusMarks } from "../hover/focus-marks";
import { createFocusStore } from "../hover/focus-store";
import type { FocusStore } from "../hover/focus-store";
import { createHoverHostSync } from "../hover/host-sync";
import type { HoverHostSync } from "../hover/host-sync";
import type { DragGeom } from "../interaction/drag-select";
import { memoCell } from "../memo";
import type { ChartMargin } from "../theme";
import { withBarGuides } from "./bar-guides";
import type { SeriesBarSpec } from "./bars";
import type { ComposedCandleSpec, ComposedScatterSpec } from "./extras";
import { dateValue } from "./narrow";
import { composedStaticCss, rowNodesAt } from "./static-css";

/** The inputs of the latest pass a draw and a focus read. */
export interface ComposedHoverPass {
  readonly uid: string;
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly margin: ChartMargin;
  readonly series: readonly ResolvedSeries[];
  readonly bars: readonly SeriesBarSpec[];
  readonly candle: ComposedCandleSpec | null;
  readonly scatters: readonly ComposedScatterSpec[];
  readonly order: readonly string[];
  readonly stacked: boolean;
  readonly barGap: number;
  /** The carriers (the ChartCrosshair child's props). */
  readonly table?: ChildTable;
}

export interface ComposedHover {
  /** The plot the latest draw published (null before the first). */
  readonly plot: PlotStore;
  /** The focused row: only the custom children's leaf subscribes. */
  readonly focus: FocusStore<FocusedRow>;
  /** Focus and drag on the host: the drag selection draws through its `drag` / `press`. */
  readonly hostSync: HoverHostSync;
  /** The plot geometry the drag listeners read, assigned by every draw. */
  readonly dragGeom: { current: DragGeom };
  /** The latest pass's inputs (React: every render). */
  update(pass: ComposedHoverPass): void;
  /** A draw's build (the definition's `onBuilt`): the plot store, the overlay, the hover and drag geometry, the owned style's text. */
  readonly publish: (snapshot: PlotSnapshot) => void;
  /** The renderer's focus (`onFocusChange`), after the keyboard hold has seen it. */
  readonly focusPoint: (point: ChartPoint<Row, Date, number> | null) => void;
  /** Appends the hover overlay to `host`; returns its removal. */
  attach(host: HTMLElement): () => void;
  /** After every render: the redraw dropped the focused row's bar marks (hover/focus-marks.ts) and the x tick labels' fade inputs (date-pill.ts `writeTickVar`). */
  rendered(): void;
}

const timesOf = (data: readonly Row[], xDataKey: string): readonly number[] => data.map((row) => dateValue(row[xDataKey]).getTime());

/** `host` and `sheet` are read at each write: the chart's host element and its owned <style> (null while unmounted); `initial` is the first pass. */
export function createComposedHover(dom: { readonly host: () => HTMLElement | null; readonly sheet: () => HTMLStyleElement | null }, initial: ComposedHoverPass): ComposedHover {
  // The plot size and domains of the latest draw: bar px widths and the wipe padding are built inside TanStack's draw (`chart({ width, height })`), so no size state exists.
  const plot = createPlotStore();
  const focus = createFocusStore<FocusedRow>();
  // The hover indicator (crosshair, dots, date pill) is an element we own, appended to the host and moved imperatively.
  const overlay = new HoverOverlay();
  // The ChartCrosshair child's view (core/cartesian/crosshair.ts), once the chart has one.
  const crosshair = createCrosshairSlot();
  const hostSync = createHoverHostSync(dom.host);
  // Read by the drag selection's listeners (interaction/drag-select.ts) at event time.
  const dragGeom: { current: DragGeom } = { current: { left: 0, top: 0, innerWidth: 0, innerHeight: 0 } };
  const timesCell = memoCell<readonly number[]>();
  const marks = createFocusMarks();
  let pass = initial;
  // Row x values (ms) of the latest pass, aligned with its data.
  let times = timesCell([initial.data, initial.xDataKey], () => timesOf(initial.data, initial.xDataKey));
  return {
    plot,
    focus,
    hostSync,
    dragGeom,
    update(next) {
      pass = next;
      times = timesCell([next.data, next.xDataKey], () => timesOf(next.data, next.xDataKey));
    },
    publish: (snapshot) => {
      const { built, size } = snapshot;
      const { uid, data, xDataKey, margin, series, bars, candle, scatters, order } = pass;
      plot.set(snapshot);
      overlay.update(withBarGuides({ built, hasBars: bars.length > 0 || candle !== null, rows: data, xKey: xDataKey }), overlayPlotOf(snapshot), margin, built.pillTicks.active ? pillFadeHalf(built.pillTicks.reachPx) : null);
      if (pass.table) {
        crosshair.update(pass.table, { margin, innerWidth: size.innerWidth, innerHeight: Math.max(0, size.innerHeight), yDomains: built.domains.y });
      }
      const xStart = built.domains.x[0].getTime();
      hostSync.geom.current = { times: built.hover.times, left: margin.left, xStart, xSpan: built.domains.x[1].getTime() - xStart, innerWidth: size.innerWidth, signs: built.hover.plSigns, spans: built.hover.spans };
      dragGeom.current = { left: margin.left, top: margin.top, innerWidth: size.innerWidth, innerHeight: Math.max(0, size.innerHeight) };
      const sheet = dom.sheet();
      if (sheet) {
        const css = composedStaticCss({ uid, built, bars, candle, scatters, order, series });
        if (sheet.textContent !== css) { sheet.textContent = css; }
      }
    },
    focusPoint: (point) => {
      const time = point ? point.xValue.getTime() : null;
      const index = time === null ? -1 : times.indexOf(time);
      focus.set(index < 0 ? null : { row: pass.data[index], index });
      overlay.focus(index < 0 ? null : time, index < 0 ? null : pass.data[index]);
      const host = dom.host();
      const snapshot = plot.get();
      if (host && snapshot) {
        const { built, size } = snapshot;
        const xSpanMs = built.domains.x[1].getTime() - built.domains.x[0].getTime();
        syncPillHost(host, built.pillTicks.times, xSpanMs, size.innerWidth, index < 0 ? null : time);
        hostSync.sync(index < 0 ? null : time);
        writePresence(host, "data-bkm-bi", index >= 0);
        crosshair.snap(index < 0 || time === null || xSpanMs <= 0 ? null : ((time - built.domains.x[0].getTime()) / xSpanMs) * size.innerWidth);
        // The focused row's bars keep their opacity (static-css.ts): marked, so a move restyles two rows of bars, not all of them.
        marks.set(host, index < 0 || (pass.bars.length === 0 && pass.candle === null && pass.scatters.length === 0) ? null : rowNodesAt(index));
      }
    },
    rendered() {
      marks.refresh();
      refreshTickVars(dom.host());
    },
    attach(host) {
      host.append(overlay.root);
      crosshair.attach(host);
      return () => {
        overlay.root.remove();
        crosshair.detach();
      };
    },
  };
}
