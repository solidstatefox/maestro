import { latestTable } from "../carriers/registry";
import type { ChildTable } from "../carriers/table";
import { memoCell } from "../memo";
import { maxOf, minOf } from "../range";
import type { PlotSnapshot } from "./plot-size";
import { toDate } from "./series";
import type { Row } from "./series";

interface BrushRangeValue { start: Date; end: Date }

type BrushChangeType = "preview" | "commit" | "cancel";

interface BrushProps {
  selectionPattern?: { color?: string };
  blurPx?: number;
  fadeOuterEdges?: boolean;
  initialSelection?: BrushRangeValue | null;
  onSelectionChange?: (s: BrushRangeValue | null) => void;
}

/** The strip's definition input; undefined without a Brush child. */
export interface BrushInput {
  readonly range: BrushRangeValue;
  readonly color: string | undefined;
  readonly onChange: (range: BrushRangeValue, type: BrushChangeType) => void;
}

export interface BrushModel {
  readonly brushProps: BrushProps | undefined;
  readonly brush: BrushInput | undefined;
  readonly brushCollapsed: boolean;
  readonly shownRange: BrushRangeValue;
}

export interface Brush {
  /** The brush for the latest table and data (adjusts the ranges when the data's extent changes). */
  model(table: ChildTable, data: readonly Row[], xDataKey: string): BrushModel;
  /** After each commit: reports the initial window once on mount and after a data swap. */
  report(): void;
}

/** `plot` is read when a gesture reports (no size is known before the draw); `changed` is called after a gesture moved a range; `selected`
 * hears every selection reported to `onSelectionChange` (a chart's `syncId` group follows it, link.ts). */
export function createBrush(plot: () => PlotSnapshot | null, changed: () => void, selected?: (range: BrushRangeValue | null, phase: "preview" | "commit") => void): Brush {
  // SAFETY: the child table is keyed by tag and untyped; the "brush" entry carries a Brush's props.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const brushOf = (table: ChildTable): BrushProps | undefined => table.get("brush")?.[0] as BrushProps | undefined;
  let brushProps: BrushProps | undefined;
  // The strip's definition input is the last ACCEPTED range (commit, or the initial/full extent); previews drive only `live` (host vars + reported selection) and never reach the definition (TanStack interactions guide: controlled brush).
  // Last selection committed to the layout (undefined: none yet, the initial selection stands; null: full extent).
  let reported: BrushRangeValue | null | undefined;
  let accepted: BrushRangeValue | null = null;
  let live: BrushRangeValue | null = null;
  let initial: BrushRangeValue | null = null;
  let full: BrushRangeValue | undefined;
  let reportedFull: BrushRangeValue | undefined;
  const fullCell = memoCell<BrushRangeValue>();
  const brushCell = memoCell<BrushInput | undefined>();
  const onBrushChange = (range: BrushRangeValue, type: BrushChangeType): void => {
    const props = brushProps;
    if (!props) {
      return;
    }
    if (type === "cancel") {
      // Escape: back to the accepted range (the native control restores itself), and the main chart back to what it showed before the gesture.
      live = null;
      const back = reported === undefined ? initial : reported;
      props.onSelectionChange?.(back);
      selected?.(back, "commit");
      changed();
      return;
    }
    live = range;
    // bklit boundsToSelection: start == end (a click outside the selection) is null, which resets to the full extent.
    const snapshot = plot();
    const spanMs = snapshot ? new Date(snapshot.built.domains.x[1]).getTime() - new Date(snapshot.built.domains.x[0]).getTime() : 0;
    const innerPx = snapshot?.size.innerWidth ?? 0;
    const widthPx = spanMs > 0 ? ((range.end.getTime() - range.start.getTime()) / spanMs) * innerPx : 0;
    // The controlled range stays raw (no feedback drift); the committed selection is what visx's getDomainFromExtent
    // hands bklit: the dragged rect widened by SAFE_PIXEL (2px) per side, unclamped.
    const padMs = (spanMs / innerPx) * 2;
    const next = widthPx >= 1 ? { start: new Date(range.start.getTime() - padMs), end: new Date(range.end.getTime() + padMs) } : null;
    if (type === "commit") {
      reported = next;
      if (!(accepted && accepted.start.getTime() === range.start.getTime() && accepted.end.getTime() === range.end.getTime())) {
        accepted = range;
      }
    }
    props.onSelectionChange?.(next);
    selected?.(next, type === "commit" ? "commit" : "preview");
    changed();
  };
  return {
    model(table, data, xDataKey) {
      brushProps = brushOf(table);
      const fullRange = fullCell([data, xDataKey], () => {
        const times = data.map((row) => toDate(row[xDataKey]).getTime());
        return { start: new Date(minOf(times)), end: new Date(maxOf(times)) };
      });
      // `initialSelection` is mount-only (visx initialBrushPosition) and excluded from the table identity, so it is read from the latest carriers.
      // SAFETY: as brushOf, narrowed to the one field read.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      const latestInitial = brushProps ? ((latestTable(table).get("brush")?.[0] as { initialSelection?: BrushRangeValue | null } | undefined)?.initialSelection ?? null) : null;
      if (full === undefined) {
        initial = latestInitial;
      } else if (full !== fullRange) {
        // A new extent (data swap) resets the snapshot to the layout's fresh initial selection.
        accepted = null;
        live = null;
        initial = latestInitial;
        reported = undefined;
      } else if (initial === null && accepted === null && reported === undefined && latestInitial !== null) {
        // The ports register their carriers after the chart's first pass: the strip's `initialSelection` arrives with its ChartBrush.
        initial = latestInitial;
      }
      full = fullRange;
      const acceptedRange = accepted ?? initial ?? fullRange;
      const color = brushProps?.selectionPattern?.color;
      const hasBrushChild = brushProps !== undefined;
      // Keyed as it was in React (`initial` is read when one of these changes).
      const brush = brushCell([hasBrushChild, accepted, fullRange, color, onBrushChange], () => (hasBrushChild ? { range: acceptedRange, color, onChange: onBrushChange } : undefined));
      const liveRange = live ?? acceptedRange;
      // A click outside collapses the native range at the click point (so the next drag starts a NEW brush anywhere), while
      // the overlays keep showing bklit's full extent.
      const brushCollapsed = liveRange.end.getTime() - liveRange.start.getTime() <= 0;
      return { brushProps, brush, brushCollapsed, shownRange: brushCollapsed ? fullRange : liveRange };
    },
    report() {
      // bklit's docs start a ChartBrushLayout zoomed by giving the strip's ChartBrush an `initialSelection` (brush.md "Start with a window"): the window is reported
      // once on mount and after a data swap, as its first drag would, so the layout's main chart shows it from the first paint (a layout effect, before paint).
      // The full extent is not reported: a layout shows it until a range is reported.
      const fullRange = full;
      // Nothing to report before the ChartBrush is in the table (a port's carriers register after the chart's first pass).
      if (fullRange === undefined || fullRange === reportedFull || brushProps === undefined) {
        return;
      }
      reportedFull = fullRange;
      if (initial && (initial.start.getTime() !== fullRange.start.getTime() || initial.end.getTime() !== fullRange.end.getTime())) {
        brushProps?.onSelectionChange?.(initial);
        selected?.(initial, "commit");
      }
    },
  };
}
