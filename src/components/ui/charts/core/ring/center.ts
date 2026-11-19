import type { RingData, RingStableValue } from "../types/ring";

interface RingCenterState {
  /** The hovered ring's data, `undefined` when none is hovered. */
  readonly hoveredData: RingData | undefined;
  readonly innerRadius: number;
  readonly totalValue: number;
}

/** What RingCenter shows for `hoveredIndex`. */
export const ringCenterOf = <Ref>(stable: RingStableValue<Ref>, hoveredIndex: number | null): RingCenterState => ({
  hoveredData: hoveredIndex === null ? undefined : stable.data[hoveredIndex],
  innerRadius: stable.baseInnerRadius,
  totalValue: stable.totalValue,
});
