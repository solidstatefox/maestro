import type { Readable } from "../store";

/** What `useChartLegendHover()` returns. */
export interface ChartLegendHoverValue {
  hoveredIndex: number | null;
  readonly setHoveredIndex: (index: number | null) => void;
}

/** What `useProfitLossLegendHover()` returns (bklit profit-loss-legend-hover): 0 = Profit, 1 = Loss. Separate from the series index because
 * ProfitLossLine dims by sign, not by series. */
export interface ProfitLossLegendHoverValue {
  hoveredIndex: number | null;
}

/** The value outside a `ChartLegendHoverProvider`: nothing hovered, a no-op setter. */
export const NO_LEGEND_HOVER: ChartLegendHoverValue = {
  hoveredIndex: null,
  setHoveredIndex: () => {
    /* No-op outside ChartLegendHoverProvider */
  },
};

/** The value outside a `ProfitLossLegendHoverProvider`. */
export const NO_PROFIT_LOSS_HOVER: ProfitLossLegendHoverValue = { hoveredIndex: null };

/** A `ChartLegendHoverProvider`'s value: the legend's `onHoverChange` is the setter. */
export const chartLegendHoverValue = (hoveredIndex: number | null, onHoverChange: (index: number | null) => void): ChartLegendHoverValue => ({
  hoveredIndex,
  setHoveredIndex: onHoverChange,
});

/** A `ProfitLossLegendHoverProvider`'s value. */
export const profitLossLegendHoverValue = (hoveredIndex: number | null): ProfitLossLegendHoverValue => ({ hoveredIndex });

/** Both legend hovers as a chart's host shows them. */
export interface LegendHover {
  readonly legend: number | null;
  readonly profitLoss: number | null;
}

// Nothing hovered.
const NO_HOVER: LegendHover = { legend: null, profitLoss: null };

/**
 * Both legend hovers as the one store a port's chart hands its controller (`ChartEnv.legendHover`, which the controller writes to the
 * host as React's LegendHostSync does): the value keeps its object while both indexes hold, and listeners hear only a change of either.
 */
export function legendHoverOf(legend: Readable<ChartLegendHoverValue>, profitLoss: Readable<ProfitLossLegendHoverValue>): Readable<LegendHover> {
  let last = NO_HOVER;
  const get = (): LegendHover => {
    const next = legend.get().hoveredIndex;
    const sign = profitLoss.get().hoveredIndex;
    if (next !== last.legend || sign !== last.profitLoss) {
      last = { legend: next, profitLoss: sign };
    }
    return last;
  };
  return {
    get,
    subscribe(listener) {
      let seen = get();
      const changed = (): void => {
        const now = get();
        if (now !== seen) {
          seen = now;
          listener();
        }
      };
      const offs = [legend.subscribe(changed), profitLoss.subscribe(changed)];
      return () => {
        for (const off of offs) {
          off();
        }
      };
    },
  };
}
