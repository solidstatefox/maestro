import type { ReactNode } from "react";
import { pulseStrokeTree } from "../../core/markup/loading";
import type { LineLoadingPulseStrokeProps } from "../../core/types/loading";
import { renderMarkup } from "../../runtime/markup";
import { useOptionalChartStable } from "../cartesian/chart-context";
import { useSanitizedId } from "../use-sanitized-id";

export type { LineLoadingPulseMode } from "../../core/motion/phase";

/** @internal */
export const LineLoadingPulseStroke = /* @__PURE__ */ Object.assign(function LineLoadingPulseStroke(props: Readonly<LineLoadingPulseStrokeProps>): ReactNode {
  const chart = useOptionalChartStable();
  const innerWidth = props.innerWidth ?? chart?.innerWidth ?? 0;
  const gradientId = `line-loading-gradient-${useSanitizedId()}`;
  return renderMarkup(pulseStrokeTree(props, innerWidth, gradientId));
}, { displayName: "LineLoadingPulseStroke" });
