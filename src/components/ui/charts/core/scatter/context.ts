import type { ScaleLinear, ScaleTime } from "d3-scale";
import { createBridgedContext, focusRowOf, timeScale, valueScale } from "../cartesian/context";
import type { ChartContext, ContainerRef, FocusedRow } from "../cartesian/context";
import type { AnyInteraction } from "../erased-types";
import { memoCell } from "../memo";
import { innerSize } from "./pass";
import type { ScatterPass } from "./pass";

interface ScatterContextInput {
  readonly pass: ScatterPass;
  /** The plot size TanStack measured (the pass's size store). */
  readonly size: { readonly width: number; readonly height: number };
  /** The chart's ready gate flag. */
  readonly isLoaded: boolean;
  readonly focused: FocusedRow | null;
  readonly containerRef: ContainerRef;
  /** The renderer's interaction controller the setters focus through. */
  readonly interaction: { readonly current: AnyInteraction | null };
}

/** One builder per chart, fed whenever its context is read. */
export function createScatterContext(): (input: ScatterContextInput) => ChartContext {
  const bridged = createBridgedContext();
  const xScaleCell = memoCell<ScaleTime<number, number>>();
  const yScalesCell = memoCell<Record<string, ScaleLinear<number, number>>>();
  const focusRowCell = memoCell<(index: number | null) => void>();
  return ({ pass, size, isLoaded, focused, containerRef, interaction }) => {
    const { innerWidth, innerHeight } = innerSize(size, pass.margin);
    const { domains } = pass.built;
    const xScale = xScaleCell([domains, size.width, innerWidth], () => timeScale(domains.x(size.width), innerWidth));
    const yScales = yScalesCell([domains, innerHeight], () => Object.fromEntries(Object.entries(domains.y).map(([id, domain]) => [id, valueScale(domain, innerHeight)])));
    const focusRow = focusRowCell([containerRef, interaction, pass.pixelOf], () => focusRowOf(containerRef, interaction, pass.pixelOf));
    return bridged({
      data: pass.rows,
      margin: pass.margin,
      size,
      containerRef,
      isLoaded,
      xScale,
      yScales,
      lines: pass.lines,
      animationDuration: pass.animationDuration,
      xAccessor: pass.xAccessor,
      dateLabels: pass.dateLabels,
      focusRow,
      referenceAreas: pass.referenceAreas,
      focused,
    });
  };
}
