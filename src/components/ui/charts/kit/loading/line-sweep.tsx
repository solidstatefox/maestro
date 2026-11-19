"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { lineSweepTree } from "../../core/markup/loading";
import type { LineLoadingSweepProps } from "../../core/types/loading";
import { renderMarkup } from "../../runtime/markup";
import { useOptionalChartStable } from "../cartesian/chart-context";
import { useSanitizedId } from "../use-sanitized-id";
import { usePrefersReducedMotion } from "./reduced-motion";

/** @internal */
export const LineLoadingSweep = /* @__PURE__ */ Object.assign(function LineLoadingSweep(props: Readonly<LineLoadingSweepProps>): ReactNode {
  const { mode = "loop", onTransitionComplete } = props;
  const chart = useOptionalChartStable();
  const innerWidth = props.innerWidth ?? chart?.innerWidth ?? 0;
  const innerHeight = props.innerHeight ?? chart?.innerHeight ?? 0;
  const reduceMotion = usePrefersReducedMotion();
  const chartId = `line-sweep-${useSanitizedId()}`;
  const isLoop = mode === "loop";
  const [tick, setTick] = useState(0);
  // Re-roll only while looping; a transition holds the silhouette so it fades as one piece.
  const onSweepComplete = useCallback(() => {
    if (isLoop) {
      setTick((prev) => prev + 1);
    }
  }, [isLoop]);
  // Reduced motion has no fade to wait for: hand off at once or the phase machine would stall mid-transition.
  useEffect(() => {
    if (reduceMotion && !isLoop) {
      onTransitionComplete?.();
    }
  }, [reduceMotion, isLoop, onTransitionComplete]);
  return renderMarkup(lineSweepTree(props, { innerHeight, innerWidth }, { chartId, onSweepComplete, reduceMotion, tick }));
}, { displayName: "LineLoadingSweep" });
