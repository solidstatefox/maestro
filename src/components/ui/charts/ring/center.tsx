"use client";

// RingCenter: the NumberFlow stat inside the innermost ring (kit/polar/center-shell.tsx), over core/ring/center.ts.
import type { ReactElement, ReactNode } from "react";
import { PolarCenter } from "../kit/polar/center-shell";
import { defaultCenterStatFormat } from "../core/polar/center";
import { ringCenterOf } from "../core/ring/center";
import type { RingData, RingCenterProps as CoreRingCenterProps } from "../core/types/ring";
import { useScheduledHoverIndex } from "../kit/polar/polar-hover";
import { useRingHoverCoordinator, useRingStable } from "./model";

/** Props for `RingCenter`. */
interface RingCenterProps extends CoreRingCenterProps<ReactNode> {}

/**
 * Shows the sum of all ring values in the middle of the rings, and the hovered ring's value and label while a ring is hovered or keyboard-focused. This is how rings report values instead of a tooltip.
 * Customise the text with `defaultLabel`, `prefix`, `suffix` and `formatOptions`, or take over the hovered content with a `children` render function.
 */
const RingCenter = /* @__PURE__ */ Object.assign(function RingCenter({ defaultLabel = "Total", formatOptions = defaultCenterStatFormat, children, className, valueClassName, labelClassName, prefix, suffix }: Readonly<RingCenterProps>): ReactElement {
  const stable = useRingStable();
  const hoveredIndex = useScheduledHoverIndex(useRingHoverCoordinator());
  const center = ringCenterOf(stable, hoveredIndex);
  return (
    <PolarCenter<RingData> className={className} valueClassName={valueClassName} labelClassName={labelClassName} prefix={prefix} suffix={suffix} defaultLabel={defaultLabel} formatOptions={formatOptions} hoveredData={center.hoveredData} innerRadius={center.innerRadius} totalValue={center.totalValue}>
      {children}
    </PolarCenter>
  );
}, { displayName: "RingCenter" });

export { RingCenter };
export type { RingCenterProps };
