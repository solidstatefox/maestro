import { memoCell } from "../memo";
import type { PieArcData, PieData, PieEnterTransition, PieStableValue } from "../types/pie";
import type { PolarHoverValue } from "../types/polar";

export const PIE_MISSING = "Pie components must be used within <PieChart>.";

interface PieContextInput<Ref> {
  readonly data: PieData[];
  readonly arcs: PieArcData[];
  readonly size: number;
  readonly innerRadius: number;
  readonly padAngle: number;
  readonly cornerRadius: number;
  readonly hoverOffset: number;
  readonly enterTransition: PieEnterTransition | undefined;
  readonly enterStaggerScale: number;
  readonly geometryScrubbing: boolean;
  readonly containerRef: Ref;
  readonly totalValue: number;
  readonly getColor: (index: number) => string;
  readonly getFill: (index: number) => string;
  /** Mounted and measured in the browser. */
  readonly isLoaded: boolean;
}

/** PieChart's stable context: one builder per chart, fed on every input. */
export function createPieContext<Ref>(): (input: Readonly<PieContextInput<Ref>>) => PieStableValue<Ref> {
  const cell = memoCell<PieStableValue<Ref>>();
  return (input) => {
    const { data, arcs, size, innerRadius, padAngle, cornerRadius, hoverOffset, enterTransition, enterStaggerScale, geometryScrubbing, containerRef, totalValue, getColor, getFill, isLoaded } = input;
    const center = size / 2;
    return cell([isLoaded, arcs, center, containerRef, cornerRadius, data, enterStaggerScale, enterTransition, geometryScrubbing, getColor, getFill, hoverOffset, innerRadius, padAngle, size, totalValue], () => ({
      animationKey: 0, arcs, center, containerRef, cornerRadius, data, enterStaggerScale, enterTransition, geometryScrubbing,
      getColor, getFill, hoverOffset, innerRadius, outerRadius: center - hoverOffset, padAngle,
      isLoaded, scrubSlicePaths: null, size, totalValue,
    }));
  };
}

/** PieProvider's stable half of a caller's full value: rebuilt only when the geometry changes (data, arcs, size, inner radius, total), since the
 * getters and refs a caller passes are new on every render and must not churn the consumers. */
export function createPieProviderStable<Ref>(): (value: Readonly<PieStableValue<Ref> & PolarHoverValue>) => PieStableValue<Ref> {
  const cell = memoCell<PieStableValue<Ref>>();
  return (value) => cell([value.data, value.arcs, value.size, value.innerRadius, value.totalValue], () => {
    const { hoveredIndex: _hoveredIndex, setHoveredIndex: _setHoveredIndex, ...stable } = value;
    return stable;
  });
}

/** Everything `usePie()` returns: the stable half with the hover's. */
export const pieContextValue = <Ref>(stable: PieStableValue<Ref>, hover: PolarHoverValue): PieStableValue<Ref> & PolarHoverValue => ({ ...stable, ...hover });
