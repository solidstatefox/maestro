import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { erase } from "../erase";
import type { AnyInteraction } from "../erased-types";
import { isNumber } from "../guards";
import type { KeyboardFocusHold } from "../interaction/keyboard-hold";
import type { HeatmapHoverCoordinator } from "../types/heatmap";
import type { CellDatum } from "./definition";
import type { HeatmapScene } from "./focus";

type CellPoint = ChartPoint<Readonly<CellDatum>, number | string, string>;

// 2-D grid steps (UPSTREAM-GAPS #34): ArrowLeft/Right move one week column on the same weekday, ArrowUp/Down one day in the column.
const GRID_STEPS: ReadonlyMap<string, readonly [number, number]> = /* @__PURE__ */ new Map([
  ["ArrowDown", [0, 1]], ["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]], ["ArrowUp", [0, -1]],
]);

/** Next focusable cell from `from` along `step`, skipping ghost/missing bins; the current cell when the edge is reached (clamp). */
const gridTarget = (points: ReadonlyMap<string, CellPoint>, from: Readonly<CellDatum>, step: readonly [number, number], columnCount: number, rowCount: number): CellPoint | undefined => {
  let column = from.column + step[0];
  let row = from.row + step[1];
  while (column >= 0 && column < columnCount && row >= 0 && row < rowCount) {
    const point = points.get(`${column}-${row}`);
    if (point !== undefined) {return point;}
    column += step[0];
    row += step[1];
  }
  return points.get(`${from.column}-${from.row}`);
};

const partialDatum = (point: CellPoint): Partial<CellDatum> | undefined => erase(point.datum);

/** Focusable cell points of a scene by grid position (the `heatmap-cells-*` level groups; decorative and loading marks excluded). */
const cellPointsByGrid = (points: readonly CellPoint[]): Map<string, CellPoint> => {
  const byGrid = new Map<string, CellPoint>();
  for (const point of points) {
    // A point's datum is a CellDatum, partial while a cell is still being created.
    const datum = partialDatum(point);
    if (point.markId.startsWith("heatmap-cells-") && isNumber(datum?.column) && isNumber(datum.row)) {
      byGrid.set(`${datum.column}-${datum.row}`, point);
    }
  }
  return byGrid;
};

interface HeatmapGridLatest {
  readonly coordinator: HeatmapHoverCoordinator;
  readonly columnCount: number;
  readonly rowCount: number;
  readonly interactive: boolean;
  /** The chart's keyboard focus hold (core/interaction/keyboard-hold.ts). */
  readonly hold: KeyboardFocusHold;
}

interface HeatmapGridFocusDeps {
  /** Keeps the renderer's interaction controller (touch-focus.ts `createInteractionHandle().onRender`). */
  readonly capture: (context: ChartRendererRenderContext<never, never, never>) => void;
  /** The mounted chart's interaction controller, null before the first draw. */
  readonly interaction: () => AnyInteraction | null;
}

export interface HeatmapGridFocus {
  /** Records the latest pass's grid, coordinator and hold; applies nothing. */
  latest(input: HeatmapGridLatest): void;
  /** The last rendered scene: grid arrows read its points, the focus strategy hit-tests it (see `focus.ts`). */
  readonly getScene: () => HeatmapScene | null;
  /** The renderer's `onRender`: keeps its controller and scene. */
  readonly onRender: (context: ChartRendererRenderContext<never, never, never>) => void;
  /** The renderer's `onFocusChange`: the keyboard hold, then the hovered cell and tooltip data (interactive charts only). */
  readonly focusChange: (point: CellPoint | null) => void;
  /** The host's capture keydown, installed before the keyboard hold's: a grid arrow moves the focus one column or row and is stopped. */
  readonly keyDown: (event: KeyboardEvent) => void;
  /** The host's focusout, installed after the keyboard hold's: clears a grid-arrow focus once focus leaves the host. */
  readonly blur: (event: FocusEvent) => void;
  /** The host's pointer move: the focus is the pointer's again. */
  readonly release: () => void;
  /** Releases the cell focus whenever the legend publishes a level; returns the unsubscribe. */
  readonly watchLegend: (coordinator: HeatmapHoverCoordinator) => () => void;
}

const NO_HOLD: KeyboardFocusHold = /* @__PURE__ */ Object.assign((): void => undefined, {
  isHeld: (): boolean => false,
  markKeyboard: (): void => undefined,
  setKeyboardFocus: (): void => undefined,
});

export function createHeatmapGridFocus({ capture, interaction }: HeatmapGridFocusDeps): HeatmapGridFocus {
  let scene: HeatmapScene | null = null;
  // Grid arrows run through the public controller: the scene's points come from `onRender`, the current cell from
  // `onFocusChange` (pointer or keyboard, so hover→arrow continues from the hovered cell).
  let focused: CellPoint | null = null;
  let grid: { points: readonly CellPoint[] | null; byGrid: Map<string, CellPoint> } = { byGrid: new Map(), points: null };
  let gridFocus = false;
  let current: HeatmapGridLatest | null = null;
  const hold = (): KeyboardFocusHold => current?.hold ?? NO_HOLD;
  return {
    latest(input) {
      current = input;
    },
    getScene: () => scene,
    onRender(context) {
      capture(context);
      ({ scene } = context);
    },
    focusChange(point) {
      hold()(erase(point));
      focused = point;
      const pass = current;
      if (pass === null || !pass.interactive) {return;}
      const { coordinator } = pass;
      if (point === null) {
        coordinator.setHoveredCell(null);
        coordinator.setTooltipData(null);
        return;
      }
      const { datum } = point;
      coordinator.setHoveredLegendLevel(null);
      coordinator.setHoveredCell({ column: datum.column, row: datum.row });
      coordinator.setTooltipData({ column: datum.column, count: datum.count, date: datum.date, row: datum.row, x: point.x, y: point.y });
    },
    // Capture phase on the host (an ancestor of the renderer's container): a grid arrow is handled here and stopped, so the
    // renderer's 1-D keydown step never runs, nor the keyboard hold's own capture listener on the host (React handled it from its root's
    // capture listener, above the host, hence `markKeyboard`). Tab-in, Home/End and Enter keep the native `focus.navigation` path.
    keyDown(event) {
      const step = GRID_STEPS.get(event.key);
      const pass = current;
      const from = focused;
      const controller = interaction();
      const shown = scene;
      const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
      const blocked = modified || pass === null || !pass.interactive || step === undefined;
      const missing = from === null || controller === null || shown === null;
      if (blocked || missing) {return;}
      if (grid.points !== shown.points) {grid = { byGrid: cellPointsByGrid(shown.points), points: shown.points };}
      const target = gridTarget(grid.byGrid, from.datum, step, pass.columnCount, pass.rowCount);
      if (target === undefined) {return;}
      event.preventDefault();
      event.stopImmediatePropagation();
      gridFocus = true;
      hold().markKeyboard();
      controller.setControlledFocus(erase(target));
    },
    // Controlled focus is not keyboard-owned, so the renderer's focusout clear skips it: blur clears it here.
    blur(event) {
      const host = event.currentTarget;
      if (!gridFocus || (event.relatedTarget instanceof Node && host instanceof Node && host.contains(event.relatedTarget))) {return;}
      gridFocus = false;
      interaction()?.setControlledFocus(null);
    },
    release() {
      gridFocus = false;
    },
    // bklit's legend enter clears the hovered cell and its tooltip (heatmap-legend.tsx handleLegendEnter). The cell is the renderer's focus (keyboard-held included), so a published
    // legend level releases it via the public controller and `focusChange(null)` clears highlight and tooltip. Only the legend publishes a non-null level.
    watchLegend: (coordinator) => coordinator.subscribe(() => {
      if (focused !== null && coordinator.getHoveredLegendLevel() !== null) {interaction()?.setControlledFocus(null);}
    }),
  };
}
