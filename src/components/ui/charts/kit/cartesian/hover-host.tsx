"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import { writeLegendHover } from "../../core/hover/host-sync";
import { useChartLegendHover, useProfitLossLegendHover } from "../legend/legend";

/** Legend hover -> host: `data-bkm-legend` (series index) and `data-bkm-pl` (profit 0 / loss 1). Render inside the chart host;
 * it is the only consumer of the legend contexts, so a legend hover never touches the definition. */
export function LegendHostSync({ hostRef }: { readonly hostRef: RefObject<HTMLElement | null> }): null {
  const legend = useChartLegendHover().hoveredIndex;
  const profitLoss = useProfitLossLegendHover().hoveredIndex;
  useEffect(() => {
    const el = hostRef.current;
    if (el) {
      writeLegendHover(el, { legend, profitLoss });
    }
  }, [hostRef, legend, profitLoss]);
  return null;
}
