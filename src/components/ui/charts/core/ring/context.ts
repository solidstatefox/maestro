import { memoCell } from "../memo";
import type { EnterTransition } from "../motion/phase";
import type { PolarHoverValue } from "../types/polar";
import type { RingData, RingStableValue } from "../types/ring";

export const RING_MISSING = "Ring components must be used within <RingChart>. Make sure <Ring>/<RingCenter> are children of a <RingChart>.";

interface RingContextInput<Ref> {
  readonly data: RingData[];
  readonly size: number;
  /** The design values, before the fit. */
  readonly strokeWidth: number;
  readonly ringGap: number;
  readonly baseInnerRadius: number;
  readonly fit: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly enterTransition: EnterTransition | undefined;
  readonly enterStaggerScale: number;
  readonly geometryScrubbing: boolean;
  readonly containerRef: Ref;
  readonly totalValue: number;
  readonly getColor: (index: number) => string;
  readonly getRingRadii: (index: number) => { innerRadius: number; outerRadius: number };
}

/** RingChart's stable context: one builder per chart, fed on every input. */
export function createRingContext<Ref>(): (input: Readonly<RingContextInput<Ref>>) => RingStableValue<Ref> {
  const cell = memoCell<RingStableValue<Ref>>();
  return (input) => {
    const { data, size, strokeWidth, ringGap, baseInnerRadius, fit, startAngle, endAngle, enterTransition, enterStaggerScale, geometryScrubbing, containerRef, totalValue, getColor, getRingRadii } = input;
    return cell([baseInnerRadius, fit, size, data, endAngle, enterStaggerScale, enterTransition, geometryScrubbing, getColor, getRingRadii, ringGap, startAngle, strokeWidth, totalValue, containerRef], () => ({
      animationKey: 0, baseInnerRadius: baseInnerRadius * fit, center: size / 2, containerRef, data, endAngle,
      enterStaggerScale, enterTransition, geometryScrubbing, getColor, getRingRadii, isLoaded: true,
      ringGap: ringGap * fit, scrubRingLayers: null, size, startAngle, strokeWidth: strokeWidth * fit, totalValue,
    }));
  };
}

/** RingProvider's stable half of a caller's full value: rebuilt only when the ring geometry changes (data, size, radii, gap, total); the other
 * fields (refs, getters) change identity every render and must not churn the consumers. */
export function createRingProviderStable<Ref>(): (value: Readonly<RingStableValue<Ref> & PolarHoverValue>) => RingStableValue<Ref> {
  const cell = memoCell<RingStableValue<Ref>>();
  return (value) => cell([value.data, value.size, value.baseInnerRadius, value.strokeWidth, value.ringGap, value.totalValue], () => {
    const { hoveredIndex: _hoveredIndex, setHoveredIndex: _setHoveredIndex, ...stable } = value;
    return { ...stable, scrubRingLayers: undefined };
  });
}

/** Everything `useRing()` returns: the stable half with the hover's. */
export const ringContextValue = <Ref>(stable: RingStableValue<Ref>, hover: PolarHoverValue): RingStableValue<Ref> & PolarHoverValue => ({ ...stable, ...hover });
