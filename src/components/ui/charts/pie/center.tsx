"use client";

// PieCenter and the standalone PieCenterShell over core/pie/center.ts; the stat itself is kit/polar/center-shell.tsx.
import { useMemo } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { PolarCenter, useFlowValue } from "../kit/polar/center-shell";
import { defaultCenterStatFormat } from "../core/polar/center";
import { pieCenterOf, pieCenterRest, pieCenterShellContext } from "../core/pie/center";
import type { PieData, PieCenterProps as CorePieCenterProps, PieCenterShellProps as CorePieCenterShellProps } from "../core/types/pie";
import { useScheduledHoverIndex } from "../kit/polar/polar-hover";
import { INERT_HOVER } from "../core/polar/hover";
import { PieHoverCoordinatorContext, PieStableContext, usePieHoverCoordinator, usePieStable } from "./model";
import type { PieStableValue } from "./model";

/** Props for `PieCenter`. */
interface PieCenterProps extends CorePieCenterProps<ReactNode> {}

/** Props for `PieCenterShell`. It accepts the `PieCenterProps<Node>` except `children`. */
type PieCenterShellProps = CorePieCenterShellProps<ReactNode>;

/**
 * Shows the total in the middle of a donut, and the hovered slice's value and label while a slice is hovered or keyboard-focused.
 * This is how a pie reports values instead of a tooltip. Customise the text with `defaultLabel`, `prefix`, `suffix` and `formatOptions`, or take over the content with a `children` render function (called at rest with the total, and while a slice is hovered).
 * Renders nothing unless the chart has a positive `innerRadius`.
 */
const PieCenter = /* @__PURE__ */ Object.assign(function PieCenter({ defaultLabel = "Total", formatOptions = defaultCenterStatFormat, children, className, valueClassName, labelClassName, prefix, suffix }: Readonly<PieCenterProps>): ReactElement | null {
  const stable = usePieStable();
  const hoveredIndex = useScheduledHoverIndex(usePieHoverCoordinator());
  const center = pieCenterOf(stable, hoveredIndex);
  // bklit #264: a render child shows at rest too, with the total under `defaultLabel`.
  const restData = useMemo(() => (children === undefined || center === null ? undefined : pieCenterRest(defaultLabel, center.totalValue)), [children, center?.totalValue, defaultLabel]);
  if (center === null) { return null; }
  return (
    <PolarCenter<PieData> restData={restData} className={className} valueClassName={valueClassName} labelClassName={labelClassName} prefix={prefix} suffix={suffix} defaultLabel={defaultLabel} formatOptions={formatOptions} hoveredData={center.hoveredData} innerRadius={center.innerRadius} totalValue={center.totalValue}>
      {children}
    </PolarCenter>
  );
}, { displayName: "PieCenter" });

const CONTENTS_STYLE: CSSProperties = { display: "contents" };

/**
 * Standalone centre stat with the same layout as `PieCenter`, without slices. Use it inside other charts, for example a gauge, that want a donut-style centre value. It is never hovered.
 */
const PieCenterShell = /* @__PURE__ */ Object.assign(function PieCenterShell({ centerValue, contextSize, innerRadiusPx, animateEntrance = true, defaultLabel, formatOptions, className, valueClassName, labelClassName, prefix, suffix }: Readonly<PieCenterShellProps>): ReactElement {
  const flowTotal = useFlowValue(centerValue, animateEntrance);
  const value = useMemo((): PieStableValue => pieCenterShellContext(flowTotal, contextSize, innerRadiusPx), [flowTotal, contextSize, innerRadiusPx]);
  return (
    <PieStableContext.Provider value={value}>
      <PieHoverCoordinatorContext.Provider value={INERT_HOVER}>
        <div data-bkm-chart="pie" data-slot="chart" style={CONTENTS_STYLE}><PieCenter className={className} defaultLabel={defaultLabel} formatOptions={formatOptions} labelClassName={labelClassName} prefix={prefix} suffix={suffix} valueClassName={valueClassName} /></div>
      </PieHoverCoordinatorContext.Provider>
    </PieStableContext.Provider>
  );
}, { displayName: "PieCenterShell" });

export { PieCenter, PieCenterShell };
export type { PieCenterProps, PieCenterShellProps };
