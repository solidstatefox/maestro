"use client";

// bklit profit/loss legend (its items and helpers: core/profit-loss.ts). Legend hover (0 = Profit, 1 = Loss) is the kit context in
// kit/legend/legend.tsx, which the cartesian kit reads to dim the other sign on ProfitLossLine.
import type { ReactElement } from "react";
import { cn } from "./core/cn";
import { LEGEND_ALIGN_CLASSES, PROFIT_LOSS_LEGEND_ITEMS } from "./core/profit-loss";
import type { ProfitLossLegendProps } from "./core/types/legend";
import { Legend, LegendItemComponent, LegendLabel, LegendMarker } from "./kit/legend/legend-compose";

/**
 * A two-item legend (Profit in green, Loss in red) for a `ProfitLossLine`. Hovering an item dims the line segments of the other sign.
 */
export const ProfitLossLegend = ({ hoveredIndex = null, onHoverChange, align = "start", className }: ProfitLossLegendProps): ReactElement => (
    <div className={cn("bk-pl-legend", LEGEND_ALIGN_CLASSES[align], className)}>
      <Legend className="bk-legend-inline" hoveredIndex={hoveredIndex} items={[...PROFIT_LOSS_LEGEND_ITEMS]} onHoverChange={onHoverChange}>
        <LegendItemComponent className="bk-legend-item-flex">
          <LegendMarker className="bk-marker-size" />
          <LegendLabel className="bk-text-xs" />
        </LegendItemComponent>
      </Legend>
    </div>
  );
