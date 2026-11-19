import type { FocusedRow } from "../cartesian/context";
import { pillFadeHalf, syncPillHost } from "../cartesian/date-pill";
import type { HoverOverlay } from "../cartesian/hover-overlay";
import type { Row } from "../cartesian/series";
import { erase } from "../erased-types";
import type { AnyPoint } from "../erased-types";
import type { FocusStore } from "../hover/focus-store";
import { writeFocusHost } from "../host-write";
import type { ChartMargin } from "../theme";
import type { ScatterBuild, SizeStore } from "./definition";
import { innerSize } from "./pass";
import type { ScatterPass } from "./pass";

/** The point the renderer's `onFocusChange` reports (null: nothing focused). */
export interface ScatterFocusPoint {
  readonly datum: unknown;
  readonly x: number;
  /** The focused dot's mark: a jittered chart's overlay shows only that series' active copy. */
  readonly markId?: string;
}

interface ScatterHoverDeps {
  /** The chart's host (read at each focus). */
  readonly host: () => HTMLElement | null;
  readonly size: SizeStore;
  readonly focus: FocusStore<FocusedRow>;
  readonly overlay: HoverOverlay;
  /** The keyboard focus hold (core/interaction/keyboard-hold.ts), told of every focus. */
  readonly hold: (point: AnyPoint | null) => void;
}

interface ScatterHover {
  /** The renderer's `onFocusChange`, over the pass that built its definition. */
  readonly focusChange: (point: ScatterFocusPoint | null, pass: ScatterPass) => void;
  /** Places the indicator for a build now and at every size the renderer measures later; returns the unsubscribe. */
  readonly follow: (built: ScatterBuild, margin: ChartMargin) => () => void;
}

export function createScatterHover({ host, size, focus, overlay, hold }: ScatterHoverDeps): ScatterHover {
  return {
    focusChange(point, pass) {
      hold(erase(point));
      // SAFETY: focus points carry rows from this chart's data.
      const index = point ? (pass.rowIndex.get(point.datum as Row) ?? -1) : -1;
      const row = index < 0 ? null : (pass.rows.at(index) ?? null);
      const time = row === null ? null : pass.xAccessor(row).getTime();
      focus.set(row === null ? null : { row, index });
      pass.built.noteFocus(point?.markId ?? null);
      overlay.focus(time, row);
      const el = host();
      const pill = pass.built.pillTicks(size.get().width);
      if (el && pill) {
        syncPillHost(el, pill.times, pill.spanMs, pill.plotWidth, time);
      }
      if (el) {
        // The empty-focus rule (pass.ts `ownedCss`) hides the tooltip / focus layers at once when the pointer is in the chart but nothing is focused (bklit unmounts them).
        // A press hides the chrome (core/interaction/touch-focus.ts attachPressGuard) until the next focus, so any non-empty focus lifts it; the dim is keyed on `data-bkm-hover` (SCATTER_HOVER_CSS).
        writeFocusHost(el, { focused: row !== null, hovered: pass.dimOn && row !== null, liftPress: true });
      }
    },
    follow(built, margin) {
      const place = (): void => {
        const measured = size.get();
        const { innerWidth, innerHeight } = innerSize(measured, margin);
        const [x0, x1] = built.domains.x(measured.width);
        // The pill tick rule (pass.ts `pillCss`) exists when `pillTicks` does.
        const pill = built.pillTicks(measured.width);
        overlay.update(built.overlay, { height: measured.height, innerWidth, innerHeight, xDomain: [x0.getTime(), x1.getTime()], yDomains: built.domains.y }, margin, pill ? pillFadeHalf(pill.reachPx) : null);
      };
      place();
      return size.subscribe(place);
    },
  };
}
