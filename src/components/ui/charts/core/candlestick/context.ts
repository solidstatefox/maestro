import { createBridgedContext, focusRowOf } from "../cartesian/context";
import type { ChartContext, ContainerRef, FocusedRow } from "../cartesian/context";
import type { AnyInteraction } from "../erased-types";
import { memoCell } from "../memo";
import type { CandlestickPass } from "./pass";

export interface CandlestickContextInput {
  /** The chart's latest pass. */
  readonly pass: CandlestickPass;
  readonly containerRef: ContainerRef;
  /** The interaction controller the context's setters focus through (the renderer's, captured from `onRender`). */
  readonly interaction: { readonly current: AnyInteraction | null };
  /** The ready gate's flag. */
  readonly isLoaded: boolean;
  /** The focused candle (hover.ts `focus`). */
  readonly focused: FocusedRow | null;
}

/** The context builder: one per subscriber, fed on every render; a field keeps its object while its content holds. */
export function createCandlestickContext(): (input: CandlestickContextInput) => ChartContext {
  const build = createBridgedContext();
  const focusRowCell = memoCell<(index: number | null) => void>();
  const extrasCell = memoCell<Partial<ChartContext>>();
  return ({ pass, containerRef, interaction, isLoaded, focused }) => {
    // `setTooltipData` / `setHoveredCandleIndex` focus a row at pass.ts `pixelOf`, as a pointer there would.
    const focusRow = focusRowCell([containerRef, interaction, pass.pixelOf], () => focusRowOf(containerRef, interaction, pass.pixelOf));
    const { columnWidth, bandWidth } = pass.slots;
    const hoveredCandleIndex = focused?.index ?? null;
    const extras = extrasCell([columnWidth, bandWidth, hoveredCandleIndex, focusRow], () => ({ columnWidth, bandWidth, hoveredCandleIndex, setHoveredCandleIndex: focusRow }));
    return build({
      data: pass.data,
      margin: pass.margin,
      size: pass.size,
      containerRef,
      isLoaded,
      xScale: pass.xScale,
      yScales: pass.yScales,
      lines: pass.lines,
      animationDuration: pass.animationDuration,
      xAccessor: pass.xAccessor,
      dateLabels: pass.dateLabels,
      focused,
      focusRow,
      referenceAreas: pass.referenceAreas,
      extras,
    });
  };
}
