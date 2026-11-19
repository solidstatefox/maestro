import type { ChartPoint } from "@tanstack/charts";
import { refreshTickVars, syncPillHost } from "../cartesian/date-pill";
import type { FocusedRow } from "../cartesian/context";
import { HoverOverlay } from "../cartesian/hover-overlay";
import { toDate } from "../cartesian/series";
import { writeFocusHost } from "../host-write";
import { createFocusMarks } from "../hover/focus-marks";
import { createFocusStore } from "../hover/focus-store";
import type { FocusStore } from "../hover/focus-store";
import { candleRectsAt } from "./definition";
import type { Candle } from "./definition";
import type { CandlestickFocusInput, CandlestickPlacement } from "./pass";

interface CandlestickHover {
  /** The focused candle. */
  readonly focus: FocusStore<FocusedRow>;
  /** Appends the hover indicator to `host`; returns its removal. */
  attach(host: HTMLElement): () => void;
  /** Rebuilds the indicator for a draw's plot (a draw is a resize or a data change, never a hover move); the focus replays without motion. */
  place(placement: CandlestickPlacement): void;
  /** The native `onFocusChange` (keyboard hold first), read against a pass's rows and pill ticks (pass.ts `focus`). */
  focusChange(point: ChartPoint<Candle, Date, number> | null, input: CandlestickFocusInput): void;
  /** After every render: the redraw dropped the focused candle's marks (hover/focus-marks.ts). */
  rendered(): void;
}

/** The hover of the chart on `host` (read at each report); `hold` is its keyboard focus hold (core/interaction/keyboard-hold.ts). */
export function createCandlestickHover(host: () => HTMLElement | null, hold: (point: ChartPoint<Candle, Date, number> | null) => void): CandlestickHover {
  const focus = createFocusStore<FocusedRow>();
  const overlay = new HoverOverlay();
  const marks = createFocusMarks();
  return {
    focus,
    attach(el) {
      el.append(overlay.root);
      return (): void => { overlay.root.remove(); };
    },
    place({ model, plot, margin, pillFade }) {
      overlay.update(model, plot, margin, pillFade);
    },
    focusChange(point, { rows, rowIndex, xDataKey, pillTicks, innerWidth, fadeOn }) {
      hold(point);
      const index = point ? (rowIndex.get(point.datum) ?? point.datumIndex ?? -1) : -1;
      const row: Candle | undefined = rows[index];
      focus.set(index < 0 ? null : { row, index });
      overlay.focus(index < 0 ? null : toDate(row?.[xDataKey]).getTime(), index < 0 || row === undefined ? null : row);
      // The dim is static CSS keyed on the host's `data-bkm-hover`; the focused candle's rects (every key ends `:<time>`) carry the mark that keeps them lit.
      const el = host();
      if (el) {
        const time = index < 0 ? null : toDate(row?.[xDataKey]).getTime();
        syncPillHost(el, pillTicks.times, pillTicks.spanMs, innerWidth, time);
        // A move inside one candle re-emits the same focus: the attributes and marks are written only when they change.
        writeFocusHost(el, { focused: index >= 0, hovered: point !== null && index >= 0 && fadeOn });
        marks.set(el, time === null || !Number.isFinite(time) ? null : candleRectsAt(time));
      }
    },
    rendered() {
      marks.refresh();
      // The render dropped the x tick labels' fade inputs (date-pill.ts `writeTickVar`).
      refreshTickVars(host());
    },
  };
}
