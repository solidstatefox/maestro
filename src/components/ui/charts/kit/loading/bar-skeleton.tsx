"use client";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { barSkeletonTree } from "../../core/markup/loading";
import type { BarLoadingSkeletonProps } from "../../core/types/loading";
import { renderMarkup } from "../../runtime/markup";
import { useSanitizedId } from "../use-sanitized-id";
import { usePrefersReducedMotion } from "./reduced-motion";

/** @internal */
export const BarLoadingSkeleton = /* @__PURE__ */ Object.assign(function BarLoadingSkeleton(props: Readonly<BarLoadingSkeletonProps>): ReactNode {
  const reduceMotion = usePrefersReducedMotion();
  const chartId = `bar-sweep-${useSanitizedId()}`;
  const [tick, setTick] = useState(0);
  const onSweepComplete = useCallback(() => {
    setTick((prev) => prev + 1);
  }, []);
  return renderMarkup(barSkeletonTree(props, { chartId, onSweepComplete, reduceMotion, tick }));
}, { displayName: "BarLoadingSkeleton" });
